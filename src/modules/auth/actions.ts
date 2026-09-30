"use server";

/**
 * Authentication and onboarding server actions (m00).
 *
 * Every action authenticates independently — middleware only improves redirect UX and is
 * never the security boundary (architecture §Application layout).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/src/db";
import { billingCopyOn } from "@/src/db/billing-copy";
import { isUniqueViolation } from "@/src/db/pg-errors";
import {
  fundingSources,
  lineItems,
  orgAccountEvents,
  orgBilling,
  organizations,
  paymentSources,
  staffUsers,
  supportingDocTypes,
  users,
} from "@/src/db/schema";
import { currentMonthKey, isValidIsoDate, isValidMonthKey } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { fundingTotalCents, overLimitCents } from "@/src/domain/funding-limit";
import { parseMoneyToCents, sumBy } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import {
  endSession,
  getStaffSession,
  requireSession,
  startSession,
  startStaffSession,
} from "@/src/services/auth/session";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/src/services/auth/passwords";
import { ENTITLEMENT_COLUMNS, entitlementOf, ORG_ENTITLEMENT_COLUMNS } from "@/src/services/auth/entitlement";
import { isInterval, isPlanId } from "@/src/modules/billing/rules";
import { emailInUse } from "@/src/modules/auth/emails";
import { ORIGINAL_RULES } from "@/src/modules/expenses/reimbursement";
import {
  findFundingSource,
  loadFundingPosition,
  primaryFundingSourceId,
  requireOwnedFundingSource,
} from "@/src/modules/funding-sources/queries";
import { clientIp } from "@/src/services/client-ip";
import { consume, reset } from "@/src/services/rate-limit";
import { nameSchema } from "@/src/domain/name";

import { signupEnabled } from "./config";

/** Seeded defaults for a brand-new organisation's configurable lists (R5.1, R11.1 / D-19). */
const DEFAULT_PAYMENT_SOURCES = [
  "Paid by us, reimbursement requested",
  "Invoiced to fiduciary in advance",
  "Paid directly by fiduciary",
];

const DEFAULT_SUPPORTING_DOC_TYPES = [
  "Check copy",
  "Request form",
  "Vendor invoice",
  "Event flyer",
  "Narrative",
  "Other",
];

/** RFC 5321 caps a forward path at 256 characters; 320 leaves room and refuses the absurd. */
const MAX_EMAIL_LENGTH = 320;

/* ------------------------------------------------------------------ sign in */

export async function signInAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return fail(UI.signInMissingFields);

  // Checked before the value reaches a rate-limit key. The key is derived from this string,
  // and an unbounded one lets an unauthenticated caller pin arbitrary memory in the bucket
  // map. RFC 5321 caps a forward path at 256 characters, so anything longer is not an
  // address and is refused with the same wording as any other unknown one.
  if (email.length > MAX_EMAIL_LENGTH || !email.includes("@")) {
    return fail(UI.signInUnknownEmail);
  }

  // Two budgets: one bounds targeted guessing, one bounds the argon2 CPU an attacker
  // can burn by rotating email addresses from a single source.
  const ip = await clientIp();
  const perIp = consume("loginPerIp", ip);
  if (!perIp.allowed) return fail(tooManyAttempts(perIp.retryAfterSeconds));
  const perAccount = consume("loginPerAccount", `${email.toLowerCase()}|${ip}`);
  if (!perAccount.allowed) return fail(tooManyAttempts(perAccount.retryAfterSeconds));

  const found = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      orgId: users.orgId,
      deactivatedAt: users.deactivatedAt,
      onboardedAt: organizations.onboardedAt,
      suspendedAt: organizations.suspendedAt,
      ...ENTITLEMENT_COLUMNS,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    .leftJoin(orgBilling, billingCopyOn())
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  const user = found[0];

  // Staff and customer accounts share one login form and the same wording either way, so the
  // form can't be used to tell staff addresses from customer ones (Phase 9 §3.3).
  if (!user) {
    const [staff] = await db
      .select({ id: staffUsers.id, passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(sql`lower(${staffUsers.email}) = lower(${email})`)
      .limit(1);

    if (!staff) return fail(UI.signInUnknownEmail);
    if (!(await verifyPassword(staff.passwordHash, password))) {
      return fail(UI.signInWrongPassword);
    }

    reset("loginPerAccount", `${email.toLowerCase()}|${ip}`);
    reset("loginPerIp", ip);
    await startStaffSession(staff.id);
    redirect("/a");
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    return fail(UI.signInWrongPassword);
  }

  // Only after the password checks out (Phase 9 §3.5) — a wrong password on a suspended org
  // gets the normal wrong-password message above, so the form can't be used to learn whether
  // an address's organization is suspended. No session, no `last_sign_in_at` write, and the
  // rate limiters stay untouched — this attempt did not prove anything a limiter should forget.
  // A revoked account, checked after the password for the same reason as the suspended org
  // below: answering before the password would turn this form into a way of asking whether a
  // given address still has access.
  if (user.deactivatedAt) return fail(UI.signInAccessRevoked);

  if (user.suspendedAt) {
    // The reason AB Solutions gave, from the suspension that is still in force — the newest
    // `suspended` event, since an org can have been suspended and reinstated before. Falls back
    // to the bare message if the row is somehow missing, so sign-in never fails on a message.
    const [event] = await db
      .select({ note: orgAccountEvents.note })
      .from(orgAccountEvents)
      .where(and(eq(orgAccountEvents.orgId, user.orgId), eq(orgAccountEvents.action, "suspended")))
      .orderBy(desc(orgAccountEvents.createdAt))
      .limit(1);

    const reason = event?.note?.trim();
    return fail(reason ? UI.orgAccessPausedWithReason(reason) : UI.orgAccessPaused);
  }

  reset("loginPerAccount", `${email.toLowerCase()}|${ip}`);
  reset("loginPerIp", ip);
  await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
  await startSession(user.id);

  // No free use (Phase 16, C6): an unpaid org reaches only the plan chooser, before onboarding.
  if (!entitlementOf(user).paid) redirect("/r/plan");

  // Onboarding is resumable: an abandoned signup lands back here until it completes.
  redirect(user.onboardedAt ? "/r" : "/onboarding/line-items");
}

function tooManyAttempts(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/* ----------------------------------------------------------------- sign out */

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

/* ------------------------------------------------------------------ sign up */

const signUpSchema = z.object({
  orgName: z.string().trim().min(1, "Enter your organization's name."),
  name: nameSchema,
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string(),
  confirmPassword: z.string(),
});

export async function signUpAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!signupEnabled()) return fail(UI.signupsClosed);

  // Someone already signed in has an organisation; letting them mint another silently swaps
  // them onto an empty one and leaves the first orphaned.
  try {
    await requireSession();
    return fail("You are already signed in. Sign out first to create another organization.");
  } catch {
    // Not signed in, which is the expected case here.
  }

  // A staff member has no customer session, so the check above doesn't see them. The signup
  // page already redirects them to `/a`, but server actions are directly invocable, and going
  // through here would replace their staff session with a customer one (`startSession` clears
  // both tables) and leave a junk organization in the directory (Phase 9 §3.3).
  if (await getStaffSession()) {
    return fail("You are signed in as AB Solutions staff. Sign out first to create an organization.");
  }

  // Bounded before argon2 is reached: hashing runs on the same threadpool login's
  // verification uses, so an unauthenticated flood here would starve sign-in.
  const budget = consume("signUp", await clientIp());
  if (!budget.allowed) return fail(tooManyAttempts(budget.retryAfterSeconds));

  const raw = {
    orgName: formData.get("orgName") ?? "",
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  };
  const parsed = signUpSchema.safeParse(raw);
  // Every problem at once (usability #2): the schema's, the password policy and the confirmation,
  // instead of stopping at the first. "Already in use" is asked only once everything else passes,
  // so a form with a bad password can't be used to test whether an address has an account.
  const fieldErrors: Record<string, string> = parsed.success ? {} : fieldErrorsFrom(parsed.error);
  const password = typeof raw.password === "string" ? raw.password : "";
  const confirmPassword = typeof raw.confirmPassword === "string" ? raw.confirmPassword : "";
  const policyError = validatePasswordPolicy(password);
  if (policyError) fieldErrors.password ??= policyError;
  if (password !== confirmPassword) fieldErrors.confirmPassword ??= "Passwords don't match.";
  if (!parsed.success || Object.keys(fieldErrors).length > 0) {
    return fail(UI.checkHighlightedFields, fieldErrors);
  }
  const { orgName, name, email: cleanEmail } = parsed.data;
  if (await emailInUse(cleanEmail)) {
    return fail(UI.checkHighlightedFields, { email: UI.duplicateEmail });
  }

  const passwordHash = await hashPassword(password);

  // The landing page's plan links pass these along as hidden fields, so a preselected plan
  // survives sign-up onto `/r/plan`; an invalid or absent value is simply dropped, never
  // refused — this is a display preference, not a purchase (that happens on `/r/plan` itself).
  const plan = formData.get("plan");
  const interval = formData.get("interval");
  const preselectedPlan = isPlanId(plan) ? plan : null;
  const preselectedInterval = isInterval(interval) ? interval : null;

  const { userId, org } = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: orgName,
        docName: orgName,
        activeMonth: currentMonthKey(),
      })
      .returning({ id: organizations.id, ...ORG_ENTITLEMENT_COLUMNS });

    const [user] = await tx
      .insert(users)
      .values({ orgId: org.id, name, email: cleanEmail, passwordHash, role: "admin" })
      .returning({ id: users.id });

    // Every organisation gets a first funding source at sign-up (Phase 6, D-93 decision 2.2).
    await tx.insert(fundingSources).values({
      orgId: org.id,
      name: "Source 1",
      type: "grant",
      sortOrder: 0,
      ...ORIGINAL_RULES,
    });

    return { userId: user.id, org };
  });

  await startSession(userId);

  // No free use (Phase 16, C6): a new organization has never paid, so it always lands on the
  // plan chooser rather than onboarding — `entitlementOf` still covers billing-off and
  // complimentary-by-default test orgs (P28), so this is never true in either of those cases.
  if (!entitlementOf(org).paid) {
    const params = new URLSearchParams();
    if (preselectedPlan) params.set("plan", preselectedPlan);
    if (preselectedInterval) params.set("interval", preselectedInterval);
    const query = params.toString();
    redirect(query ? `/r/plan?${query}` : "/r/plan");
  }
  redirect("/onboarding/line-items");
}

/* --------------------------------------------------------------- onboarding */

/*
 * Onboarding is two steps, funding first (m00): step 1 names the organisation's first funding
 * source and records its total, step 2 splits that total into line items and finishes. Both
 * are resumable: step 1 is saved to the database, and `onboarded_at` stays null until step 2
 * succeeds.
 */

const ALREADY_SET_UP = "Your organization is already set up.";

/**
 * Onboarding step 1: the funding. Renames the organisation's first funding source (created as
 * "Source 1" at sign-up) and records its total, dates and fiduciary. Saving it again later (the
 * Back button on step 2) simply overwrites it.
 *
 * Does not check the total against line items: the app's pages stay closed until step 2
 * finishes, and step 2 replaces the line items and refuses to finish over the total (R9.6).
 */
export async function saveOnboardingFundingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;
  // Server Actions are directly invocable, so the page guard is not enough: a replayed or
  // stale-tab call would otherwise rewrite a live organisation's funding.
  if (session.onboarded) return fail(ALREADY_SET_UP);

  const name = String(formData.get("fundingName") ?? "").trim();
  const contractValue = String(formData.get("contractValue") ?? "");
  const start = String(formData.get("contractStart") ?? "").trim();
  const end = String(formData.get("contractEnd") ?? "").trim();
  const fiduciaryName = String(formData.get("fiduciaryName") ?? "").trim();

  // Every problem at once, not the first only.
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.fundingName = "Enter a name for this funding.";
  const contractValueCents = parseMoneyToCents(contractValue);
  if (contractValueCents === null || contractValueCents <= 0) {
    fieldErrors.contractValue = "Enter the total amount.";
  }
  const startValid = start === "" || isValidIsoDate(start);
  const endValid = end === "" || isValidIsoDate(end);
  if (!startValid) fieldErrors.contractStart = "Enter a valid start date.";
  if (!endValid) fieldErrors.contractEnd = "Enter a valid end date.";
  if (start && end && startValid && endValid && end < start) {
    fieldErrors.contractEnd = "The end date is before the start date.";
  }
  if (Object.keys(fieldErrors).length > 0 || contractValueCents === null) {
    return fail(UI.checkHighlightedFields, fieldErrors);
  }

  let result: ActionResult | null;
  try {
    result = await db.transaction(async (tx) => {
      // NO KEY UPDATE, not `lockOrg`'s FOR UPDATE: it queues with the other onboarding step and
      // with completion, which updates this row, without blocking foreign-key key shares.
      const [org] = await tx
        .select({ onboardedAt: organizations.onboardedAt })
        .from(organizations)
        .where(eq(organizations.id, session.orgId))
        .for("no key update");
      if (!org || org.onboardedAt) return fail(ALREADY_SET_UP);

      const fundingSourceId = await primaryFundingSourceId(session.orgId, tx);
      await tx
        .update(fundingSources)
        .set({
          name,
          contractValueCents,
          contractStart: start || null,
          contractEnd: end || null,
          fiduciaryName,
        })
        .where(and(eq(fundingSources.id, fundingSourceId), eq(fundingSources.orgId, session.orgId)));
      return null;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(UI.checkHighlightedFields, {
        fundingName: "A funding source with that name already exists.",
      });
    }
    throw error;
  }
  if (result) return result;

  redirect("/onboarding/line-items");
}

/**
 * Onboarding step 2: the line items, then finish. All or nothing: any row error, or rows adding
 * up to more than the funding's total (R9.6), saves nothing; otherwise it replaces the funding
 * source's line items, seeds the configurable lists (D-19) and marks the organisation onboarded
 * in one transaction.
 */
export async function saveOnboardingLineItemsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;
  // Server Actions are directly invocable, so the page guard is not enough: a replayed or
  // stale-tab call would otherwise wipe a live organisation's approved budget.
  if (session.onboarded) return fail(ALREADY_SET_UP);

  // Funding first, before the rows are read: a tab left open on the previous flow posts line
  // items before any funding exists, and this is a message its page can show.
  const source = await findFundingSource(session.orgId, await primaryFundingSourceId(session.orgId));
  if (!source || source.contractValueCents <= 0) return fail(UI.onboardingFundingFirst);

  const names = formData.getAll("lineItemName").map((value) => String(value).trim());
  const amounts = formData.getAll("lineItemBudget").map((value) => String(value));

  // One message per row (the first that applies), every row's at once. Blank rows are ignored.
  // Keyed by the box that is wrong (`row-N-name` / `row-N-amount`), so the form marks and
  // focuses that box rather than the whole row (PR #27).
  const fieldErrors: Record<string, string> = {};
  const seen = new Set<string>();
  const rows: { name: string; cents: number }[] = [];
  names.forEach((name, index) => {
    const amount = amounts[index] ?? "";
    if (name === "" && amount.trim() === "") return;
    if (name === "") {
      fieldErrors[`row-${index}-name`] = UI.onboardingRowNeedsName;
      return;
    }
    // Every named row counts as seen, errored or not.
    const key = name.toLowerCase();
    const repeated = seen.has(key);
    seen.add(key);
    const cents = amount.trim() === "" ? null : parseMoneyToCents(amount);
    if (cents === null) fieldErrors[`row-${index}-amount`] = UI.onboardingRowNeedsAmount(name);
    else if (cents < 0) fieldErrors[`row-${index}-amount`] = UI.onboardingRowNegative(name);
    else if (repeated) fieldErrors[`row-${index}-name`] = UI.lineItemDuplicate;
    else rows.push({ name, cents });
  });
  if (Object.keys(fieldErrors).length > 0) return fail(UI.onboardingCheckRows, fieldErrors);
  if (rows.length === 0) return fail(UI.onboardingNoLineItems);

  let result: ActionResult;
  try {
    result = await db.transaction(async (tx): Promise<ActionResult> => {
      const [org] = await tx
        .select({ onboardedAt: organizations.onboardedAt })
        .from(organizations)
        .where(eq(organizations.id, session.orgId))
        .for("no key update");
      if (!org || org.onboardedAt) return fail(ALREADY_SET_UP);

      const fundingSourceId = await primaryFundingSourceId(session.orgId, tx);
      const position = await loadFundingPosition(tx, session.orgId, fundingSourceId, true);
      if (!position || position.contractValueCents <= 0) return fail(UI.onboardingFundingFirst);

      // The replace below removes every performance, and none can exist before onboarding, so 0
      // is the truth. Strict, not "further over": onboarding only finishes within the total (R9.6).
      const planned = {
        contractValueCents: position.contractValueCents,
        scheduledCents: sumBy(rows, (row) => row.cents),
        newPerformanceCents: 0,
      };
      if (overLimitCents(planned) > 0) {
        return fail(
          UI.onboardingOverTotal(formatMoney(planned.scheduledCents), formatMoney(fundingTotalCents(planned))),
        );
      }

      // Safe to replace wholesale: onboarding runs before any expense can exist.
      await tx
        .delete(lineItems)
        .where(and(eq(lineItems.orgId, session.orgId), eq(lineItems.fundingSourceId, fundingSourceId)));
      await tx.insert(lineItems).values(
        rows.map((row, index) => ({
          orgId: session.orgId,
          fundingSourceId,
          name: row.name,
          scheduledValueCents: row.cents,
          sortOrder: index,
        })),
      );

      await tx
        .insert(paymentSources)
        .values(
          DEFAULT_PAYMENT_SOURCES.map((label, index) => ({
            orgId: session.orgId,
            label,
            sortOrder: index,
          })),
        )
        .onConflictDoNothing();

      await tx
        .insert(supportingDocTypes)
        .values(
          DEFAULT_SUPPORTING_DOC_TYPES.map((label, index) => ({
            orgId: session.orgId,
            label,
            sortOrder: index,
          })),
        )
        .onConflictDoNothing();

      await tx
        .update(organizations)
        .set({ onboardedAt: new Date() })
        .where(eq(organizations.id, session.orgId));
      return ok();
    });
  } catch (error) {
    // JS `toLowerCase` and Postgres `lower()` can disagree on some Unicode names, so the index
    // can still refuse a pair the check above let through.
    if (isUniqueViolation(error)) return fail(UI.lineItemDuplicate);
    throw error;
  }
  if (!result.ok) return result;

  redirect("/r");
}

/* ------------------------------------------------------------- shell state */

/** The signed-in person's row, and only theirs: the header's month and source, and the welcome
 *  banner's dismissal, are per person (Phase 18, D-131). */
function ownRow(session: { userId: string; orgId: string }) {
  return and(eq(users.id, session.userId), eq(users.orgId, session.orgId));
}

/** Persist the header's month for the signed-in person (R2.3, per person since Phase 18). */
export async function setActiveMonthAction(month: string): Promise<ActionResult> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  await db.update(users).set({ activeMonth: month }).where(ownRow(session));

  return ok();
}

/** Persist the header's funding source for the signed-in person (R2.3). `null` means "All". */
export async function setActiveFundingSourceAction(id: string | null): Promise<ActionResult> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  if (id !== null) {
    const owned = await requireOwnedFundingSource(session, id);
    if ("denied" in owned) return owned.denied;
  }

  await db.update(users).set({ activeFundingSourceId: id }).where(ownRow(session));

  return ok();
}

/** Hide the dashboard's welcome banner for the signed-in person only (m00, per person since Phase 18). */
export async function dismissWelcomeAction(): Promise<ActionResult> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;
  await db.update(users).set({ welcomeDismissedAt: new Date() }).where(ownRow(session));
  return ok();
}

/* ------------------------------------------------------------------ helpers */

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !result[key]) result[key] = issue.message;
  }
  return result;
}
