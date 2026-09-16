"use server";

/**
 * Authentication and onboarding server actions (m00).
 *
 * Every action authenticates independently — middleware only improves redirect UX and is
 * never the security boundary (architecture §Application layout).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/src/db";
import {
  fundingSources,
  lineItems,
  orgAccountEvents,
  organizations,
  paymentSources,
  staffUsers,
  supportingDocTypes,
  users,
} from "@/src/db/schema";
import { currentMonthKey, isValidMonthKey } from "@/src/domain/dates";
import { parseMoneyToCents } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, SESSION_EXPIRED, type ActionResult } from "@/src/lib/action-result";
import {
  endSession,
  getStaffSession,
  requireSession,
  startSession,
  startStaffSession,
  UnauthenticatedError,
  type SessionContext,
} from "@/src/services/auth/session";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/src/services/auth/passwords";
import { emailInUse } from "@/src/modules/auth/emails";
import { ORIGINAL_RULES } from "@/src/modules/expenses/reimbursement";
import { primaryFundingSourceId, requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";
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

/**
 * Run an authenticated action, turning an expired session into a typed result instead of
 * an error boundary — the client keeps the user's typed form state and shows a sign-in
 * prompt rather than discarding their work (review finding A13).
 */
async function requireSessionOrExpired(): Promise<
  SessionContext | { expired: ActionResult<never> }
> {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { expired: fail(SESSION_EXPIRED) };
    throw error;
  }
}

/**
 * The client's IP, for rate limiting.
 *
 * `X-Forwarded-For` is appended to by each hop, so the LAST entries are the ones our own
 * proxies wrote and the leftmost are attacker-controlled. Taking the leftmost value let an
 * attacker mint a fresh rate-limit bucket per request simply by varying the header, which
 * defeated the login limiter entirely — and that limiter is deliberately the only
 * brute-force bound, since lockout would be a denial of service against a shared account.
 *
 * `TRUSTED_PROXY_HOPS` says how many reverse proxies sit in front of the app (Caddy or
 * nginx terminating TLS is 1). We count that many entries back from the right. With no
 * proxies configured the header is ignored altogether.
 */
/** RFC 5321 caps a forward path at 256 characters; 320 leaves room and refuses the absurd. */
const MAX_EMAIL_LENGTH = 320;

/**
 * Whether a proxy-supplied value is plausibly an address.
 *
 * Deliberately permissive about *which* address — the point is only that a caller cannot
 * substitute unbounded arbitrary text for their identity, not to parse every IPv6 form.
 */
function isIpAddress(value: string): boolean {
  if (value.length > 45) return false; // longest IPv6 with an embedded IPv4
  return /^[0-9a-fA-F:.]+$/.test(value) && /[0-9a-fA-F]/.test(value);
}

async function clientIp(): Promise<string> {
  const store = await headers();
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");

  if (hops > 0) {
    const forwarded = store.get("x-forwarded-for");
    if (forwarded) {
      const entries = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
      const candidate = entries[entries.length - hops];
      if (candidate && isIpAddress(candidate)) return candidate;
    }
    // Only accepted when it actually looks like an address. Unvalidated, this header let a
    // caller send a fresh nonce per request, landing every attempt in a virgin bucket and
    // making both login budgets unreachable — unbounded guessing against the one shared
    // account, behind which there is deliberately no lockout.
    const real = store.get("x-real-ip")?.trim();
    if (real && isIpAddress(real)) return real;
  }

  // Without a proxy count the client cannot be identified, so every visitor shares one
  // bucket — which turns the per-account limit into a weapon: an attacker's wrong guesses
  // lock the real user out, exactly the denial of service the no-lockout design avoids.
  // Production refuses to run that way, the same as it refuses the local storage driver.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "TRUSTED_PROXY_HOPS must be set in production — without it login rate limits cannot " +
        "tell clients apart and become an account lockout. Set it to the number of reverse " +
        "proxies in front of the app (Caddy or nginx terminating TLS is 1).",
    );
  }
  return "direct";
}

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
      onboardedAt: organizations.onboardedAt,
      suspendedAt: organizations.suspendedAt,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.orgId))
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
    return fail("You are already signed in. Log out first to create another organization.");
  } catch {
    // Not signed in, which is the expected case here.
  }

  // A staff member has no customer session, so the check above doesn't see them. The signup
  // page already redirects them to `/a`, but server actions are directly invocable, and going
  // through here would replace their staff session with a customer one (`startSession` clears
  // both tables) and leave a junk organization in the directory (Phase 9 §3.3).
  if (await getStaffSession()) {
    return fail("You are signed in as AB Solutions staff. Log out first to create an organization.");
  }

  // Bounded before argon2 is reached: hashing runs on the same threadpool login's
  // verification uses, so an unauthenticated flood here would starve sign-in.
  const budget = consume("signUp", await clientIp());
  if (!budget.allowed) return fail(tooManyAttempts(budget.retryAfterSeconds));

  const parsed = signUpSchema.safeParse({
    orgName: formData.get("orgName") ?? "",
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });

  if (!parsed.success) {
    return fail("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
  }

  const { orgName, name, email, password, confirmPassword } = parsed.data;

  const policyError = validatePasswordPolicy(password);
  if (policyError) return fail("Check the highlighted fields.", { password: policyError });
  if (password !== confirmPassword) {
    return fail("Check the highlighted fields.", { confirmPassword: "Passwords don't match." });
  }

  if (await emailInUse(email)) {
    return fail("Check the highlighted fields.", { email: UI.duplicateEmail });
  }

  const passwordHash = await hashPassword(password);

  const userId = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        name: orgName,
        docName: orgName,
        activeMonth: currentMonthKey(),
      })
      .returning({ id: organizations.id });

    const [user] = await tx
      .insert(users)
      .values({ orgId: org.id, name, email, passwordHash, role: "admin" })
      .returning({ id: users.id });

    // Every organisation gets a first funding source at sign-up (Phase 6, D-93 decision 2.2).
    await tx.insert(fundingSources).values({
      orgId: org.id,
      name: "Source 1",
      type: "grant",
      sortOrder: 0,
      ...ORIGINAL_RULES,
    });

    return user.id;
  });

  await startSession(userId);
  redirect("/onboarding/line-items");
}

/* --------------------------------------------------------------- onboarding */

/**
 * Onboarding step 1 — replace the organisation's line items.
 *
 * Saved immediately rather than held in client state, so a refresh or an abandoned
 * signup never loses the budget the user just typed; `onboarded_at` stays null until
 * step 2, which is what makes the flow resumable.
 */
export async function saveOnboardingLineItemsAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSessionOrExpired();
  if ("expired" in session) return session.expired;
  // Server Actions are directly invocable, so the page guard is not enough: a replayed or
  // stale-tab call would otherwise wipe a live organisation's approved budget.
  if (session.onboarded) return fail("Onboarding is already complete.");

  const names = formData.getAll("lineItemName").map((value) => String(value).trim());
  const budgets = formData.getAll("lineItemBudget").map((value) => String(value));

  const rows = names
    .map((name, index) => ({ name, cents: parseMoneyToCents(budgets[index] ?? "") }))
    .filter((row) => row.name !== "" && row.cents !== null && row.cents > 0);

  if (rows.length === 0) {
    return fail("Add at least one line item with a budget.");
  }

  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) return fail(UI.lineItemDuplicate);
    seen.add(key);
  }

  await db.transaction(async (tx) => {
    const fundingSourceId = await primaryFundingSourceId(session.orgId, tx);
    // Safe to replace wholesale: onboarding runs before any expense can exist.
    await tx
      .delete(lineItems)
      .where(and(eq(lineItems.orgId, session.orgId), eq(lineItems.fundingSourceId, fundingSourceId)));
    await tx.insert(lineItems).values(
      rows.map((row, index) => ({
        orgId: session.orgId,
        fundingSourceId,
        name: row.name,
        scheduledValueCents: row.cents as number,
        sortOrder: index,
      })),
    );
  });

  redirect("/onboarding/contract");
}

const contractSchema = z.object({
  contractValue: z.string().optional(),
  contractStart: z.string().optional(),
  contractEnd: z.string().optional(),
  fiduciaryName: z.string().optional(),
});

/**
 * Onboarding step 2 — record the optional contract details, seed the configurable
 * lists, and mark the organisation onboarded. "Skip for now" runs the same path with
 * empty values, so the contract settings row always exists (data-model).
 */
export async function completeOnboardingAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSessionOrExpired();
  if ("expired" in session) return session.expired;
  if (session.onboarded) return fail("Onboarding is already complete.");
  const skip = formData.get("intent") === "skip";

  const parsed = contractSchema.safeParse({
    contractValue: formData.get("contractValue") ?? "",
    contractStart: formData.get("contractStart") ?? "",
    contractEnd: formData.get("contractEnd") ?? "",
    fiduciaryName: formData.get("fiduciaryName") ?? "",
  });
  if (!parsed.success) return fail("Check the highlighted fields.", fieldErrorsFrom(parsed.error));

  const values = skip
    ? { contractValueCents: 0, contractStart: null, contractEnd: null, fiduciaryName: "" }
    : {
        contractValueCents: parseMoneyToCents(parsed.data.contractValue ?? "") ?? 0,
        contractStart: emptyToNull(parsed.data.contractStart),
        contractEnd: emptyToNull(parsed.data.contractEnd),
        fiduciaryName: (parsed.data.fiduciaryName ?? "").trim(),
      };

  await db.transaction(async (tx) => {
    // Writes the contract fields straight to the org's (only, at onboarding time) funding
    // source row — the sole reader of contract details as of Phase 3.
    const fundingSourceId = await primaryFundingSourceId(session.orgId, tx);
    await tx.update(fundingSources).set(values).where(eq(fundingSources.id, fundingSourceId));

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
  });

  redirect("/r");
}

/* ------------------------------------------------------------- shell state */

export async function setActiveMonthAction(month: string): Promise<ActionResult> {
  const session = await requireSessionOrExpired();
  if ("expired" in session) return session.expired;
  if (!isValidMonthKey(month)) return fail("That is not a valid month.");

  await db
    .update(organizations)
    .set({ activeMonth: month })
    .where(eq(organizations.id, session.orgId));

  return ok();
}

/** Persist the header's funding source selection (R2.3). `null` means "All". */
export async function setActiveFundingSourceAction(id: string | null): Promise<ActionResult> {
  const session = await requireSessionOrExpired();
  if ("expired" in session) return session.expired;

  if (id !== null) {
    const owned = await requireOwnedFundingSource(session, id);
    if ("denied" in owned) return owned.denied;
  }

  await db
    .update(organizations)
    .set({ activeFundingSourceId: id })
    .where(eq(organizations.id, session.orgId));

  return ok();
}

export async function dismissWelcomeAction(): Promise<ActionResult> {
  const session = await requireSessionOrExpired();
  if ("expired" in session) return session.expired;
  await db
    .update(organizations)
    .set({ welcomeDismissedAt: new Date() })
    .where(eq(organizations.id, session.orgId));
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

function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}
