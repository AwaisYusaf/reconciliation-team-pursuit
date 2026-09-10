"use server";

/**
 * User management (RBAC phase 1) — admin-only. See docs/04-engineering/decisions.md D-85.
 *
 * Enforcement lives here, not in the page or nav: server actions are directly invocable,
 * so `requireAdmin()` at the top of every export is the real boundary.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/src/db";
import { users, type UserRole } from "@/src/db/schema";
import { nameSchema } from "@/src/domain/name";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { requireAdmin } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";
import { generatePassword, hashPassword, validatePasswordPolicy } from "@/src/services/auth/passwords";
import { revokeOtherSessions } from "@/src/services/auth/session";
import { consume } from "@/src/services/rate-limit";

const emailSchema = z.string().trim().max(320).email();

/** Same message for "already in use" everywhere, so it never reveals which org holds it. */
const EMAIL_IN_USE = "That email is already in use.";

/**
 * Bound the argon2 both of these reach, keyed on the admin doing it.
 *
 * The same reasoning `changePasswordAction` already applies: hashing runs on the libuv
 * threadpool sign-in's verification uses, so an authenticated flood here — a stolen admin
 * cookie, or a script — starves login for everyone else.
 */
function withinProvisioningBudget(userId: string): ActionResult<never> | null {
  const budget = consume("userProvisioning", userId);
  if (budget.allowed) return null;
  const minutes = Math.ceil(budget.retryAfterSeconds / 60);
  return fail<never>(
    `Too many user changes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  );
}

export async function createOrgUserAction({
  name,
  email,
}: {
  name: string;
  email: string;
}): Promise<ActionResult<{ password: string }>> {
  const current = await requireAdmin();
  if ("denied" in current) return current.denied;

  // Ahead of both the lookup and the hashing, so it also bounds how fast the duplicate check
  // below can be used as a "does this address exist anywhere" oracle.
  const throttled = withinProvisioningBudget(current.userId);
  if (throttled) return throttled;

  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return fail("Enter a name.");
  const cleanName = parsedName.data;

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return fail("Enter a valid email address.");
  const cleanEmail = parsed.data;

  // Checked before hashing, and the index is global (schema.ts:113): a probe loop against
  // this must not get to burn argon2 CPU, and the message must not confirm cross-org state.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${cleanEmail})`)
    .limit(1);
  if (existing.length > 0) return fail(EMAIL_IN_USE);

  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  try {
    await db.insert(users).values({
      orgId: current.orgId,
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      role: "manager",
    });
  } catch {
    // The unique-index race: two inserts for the same email land within the same window.
    return fail(EMAIL_IN_USE);
  }

  revalidatePath("/r/settings/users");
  return ok({ password });
}

export async function setUserPasswordAction(
  userId: string,
  newPassword?: string,
): Promise<ActionResult<{ password: string } | undefined>> {
  const current = await requireAdmin();
  if ("denied" in current) return current.denied;

  const throttled = withinProvisioningBudget(current.userId);
  if (throttled) return throttled;

  if (!isUuid(userId)) return fail("That user no longer exists.");

  // Same wording as a real miss, so a crafted id cannot confirm a user exists in another org.
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.orgId, current.orgId)))
    .limit(1);
  if (!target) return fail("That user no longer exists.");

  let password: string | undefined;
  if (newPassword) {
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) return fail(policyError);
    password = newPassword;
  } else {
    password = generatePassword();
  }

  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash })
    .where(and(eq(users.id, userId), eq(users.orgId, current.orgId)));

  // An admin-set password has to end the old sessions or it is not a reset. Resetting your
  // own account keeps the current cookie, same as changePasswordAction.
  await revokeOtherSessions(userId);

  return newPassword ? ok(undefined) : ok({ password });
}

/**
 * Change a user's display name (D-89) — admin-only, no password hashing involved. Does NOT
 * consume the argon2 provisioning budget: that budget protects the libuv threadpool argon2
 * runs on, and a name change never touches it, so charging it here would throttle real
 * password resets for no reason.
 */
export async function setUserNameAction(userId: string, name: string): Promise<ActionResult> {
  const current = await requireAdmin();
  if ("denied" in current) return current.denied;

  if (!isUuid(userId)) return fail("That user no longer exists.");

  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return fail("Enter a name.");

  // Same wording as setUserPasswordAction's miss, so a crafted id cannot confirm a user
  // exists in another org.
  const updated = await db
    .update(users)
    .set({ name: parsedName.data })
    .where(and(eq(users.id, userId), eq(users.orgId, current.orgId)))
    .returning({ id: users.id });
  if (updated.length === 0) return fail("That user no longer exists.");

  revalidatePath("/r/settings/users");
  return ok();
}

export async function listOrgUsersAction(): Promise<
  ActionResult<
    Array<{ id: string; name: string | null; email: string; role: UserRole; createdAt: Date }>
  >
> {
  const current = await requireAdmin();
  if ("denied" in current) return current.denied;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.orgId, current.orgId))
    .orderBy(users.createdAt);

  return ok(rows);
}
