"use server";

/**
 * Authentication and onboarding server actions (m00).
 *
 * Every action authenticates independently — middleware only improves redirect UX and is
 * never the security boundary (architecture §Application layout).
 */
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/src/db";
import {
  contractSettings,
  lineItems,
  organizations,
  paymentSources,
  supportingDocTypes,
  users,
} from "@/src/db/schema";
import { currentMonthKey, isValidMonthKey } from "@/src/domain/dates";
import { parseMoneyToCents } from "@/src/domain/money";
import { UI } from "@/src/domain/strings";
import { fail, ok, SESSION_EXPIRED, type ActionResult } from "@/src/lib/action-result";
import {
  endSession,
  requireSession,
  startSession,
  UnauthenticatedError,
  type SessionContext,
} from "@/src/services/auth/session";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/src/services/auth/passwords";
import { consume, reset } from "@/src/services/rate-limit";

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
async function clientIp(): Promise<string> {
  const store = await headers();
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");

  if (hops > 0) {
    const forwarded = store.get("x-forwarded-for");
    if (forwarded) {
      const entries = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
      const candidate = entries[entries.length - hops];
      if (candidate) return candidate;
    }
    const real = store.get("x-real-ip");
    if (real) return real.trim();
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
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.orgId))
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);

  const user = found[0];
  if (!user) return fail(UI.signInUnknownEmail);

  if (!(await verifyPassword(user.passwordHash, password))) {
    return fail(UI.signInWrongPassword);
  }

  reset("loginPerAccount", `${email.toLowerCase()}|${ip}`);
  reset("loginPerIp", ip);
  await startSession(user.id);

  // Onboarding is resumable: an abandoned signup lands back here until it completes.
  redirect(user.onboardedAt ? "/" : "/onboarding/line-items");
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
  orgName: z.string().trim().min(1, "Enter your organisation's name."),
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string(),
  confirmPassword: z.string(),
});

export async function signUpAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!signupEnabled()) return fail(UI.signupsClosed);

  const parsed = signUpSchema.safeParse({
    orgName: formData.get("orgName") ?? "",
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });

  if (!parsed.success) {
    return fail("Check the highlighted fields.", fieldErrorsFrom(parsed.error));
  }

  const { orgName, email, password, confirmPassword } = parsed.data;

  const policyError = validatePasswordPolicy(password);
  if (policyError) return fail("Check the highlighted fields.", { password: policyError });
  if (password !== confirmPassword) {
    return fail("Check the highlighted fields.", { confirmPassword: "Passwords don't match." });
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (existing.length > 0) return fail("Check the highlighted fields.", { email: UI.duplicateEmail });

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
      .values({ orgId: org.id, email, passwordHash })
      .returning({ id: users.id });

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
    // Safe to replace wholesale: onboarding runs before any expense can exist.
    await tx.delete(lineItems).where(eq(lineItems.orgId, session.orgId));
    await tx.insert(lineItems).values(
      rows.map((row, index) => ({
        orgId: session.orgId,
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
    await tx
      .insert(contractSettings)
      .values({ orgId: session.orgId, ...values })
      .onConflictDoUpdate({ target: contractSettings.orgId, set: values });

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

  redirect("/");
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
