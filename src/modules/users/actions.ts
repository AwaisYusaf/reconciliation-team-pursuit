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
import { expenseAuditEvents, sessions, users, type UserRole } from "@/src/db/schema";
import { nameSchema } from "@/src/domain/name";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { requireAdmin, requireAdminAnyPlan, type AdminSession } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";
import { emailInUse } from "@/src/modules/auth/emails";
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
  // emailInUse also checks staff_users, so an admin can't accidentally create a customer
  // account that collides with an AB Solutions staff address (Phase 9 §3.3).
  if (await emailInUse(cleanEmail)) return fail(EMAIL_IN_USE);

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
    Array<{
      id: string;
      name: string | null;
      email: string;
      role: UserRole;
      createdAt: Date;
      /** Set once an admin revoked this account; null while it is active. */
      deactivatedAt: Date | null;
      /**
       * Whether a permanent delete would succeed.
       *
       * Computed here rather than discovered when the button is pressed: the answer is "no" for
       * almost every real account, and a Delete that is offered and then refuses is worse than
       * one that is not offered. `expense_audit.actor_user_id` is NOT NULL with no cascade, so
       * any history at all makes the row undeletable.
       */
      deletable: boolean;
    }>
  >
> {
  // Allow-listed (Phase 15 §4.7): Settings' Users tab must still show who to ask to pay.
  const current = await requireAdminAnyPlan();
  if ("denied" in current) return current.denied;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      deactivatedAt: users.deactivatedAt,
      auditCount: sql<number>`count(${expenseAuditEvents.id})::int`,
    })
    .from(users)
    // Left, and grouped: a user with no history must still appear, and they are precisely the
    // ones this count exists to identify.
    .leftJoin(expenseAuditEvents, eq(expenseAuditEvents.actorUserId, users.id))
    .where(eq(users.orgId, current.orgId))
    .groupBy(users.id)
    .orderBy(users.createdAt);

  return ok(
    rows.map(({ auditCount, ...row }) => ({
      ...row,
      // Managers only, matching what the actions will accept.
      deletable: row.role === "manager" && auditCount === 0,
    })),
  );
}

/**
 * A manager in this admin's own organisation, loaded for a removal action.
 *
 * Every guard the removal paths share, in one place and on the server, because a server action
 * is directly invocable: the caller is an admin (`requireAdmin`), the target is in the caller's
 * organisation, and the target is a manager.
 *
 * Admins are refused deliberately. The client asked for managers only, and it also removes the
 * question of what happens to the last admin — an organisation cannot lock itself out through
 * this screen at all.
 *
 * "No longer exists" for every refusal, matching the other actions here: a crafted id must not
 * be able to distinguish "is an admin" from "is in another org" from "was never real".
 */
const NO_SUCH_USER = "That user no longer exists.";
const NOT_A_MANAGER = "Only a manager's access can be changed here.";
const HAS_HISTORY =
  "This account has a history of changes, so it can't be deleted. Revoke its access instead, which keeps that history readable.";

/** Postgres `foreign_key_violation`. The driver surfaces the SQLSTATE as `code`. */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23503";
}

async function requireManagerTarget(userId: string, admin: () => Promise<AdminSession> = requireAdmin) {
  const current = await admin();
  // An explicit `ok` discriminant rather than testing for a `denied` key: the success branch
  // has no such key, so `"denied" in guard` leaves its type optional at every call site.
  if ("denied" in current) return { ok: false as const, denied: current.denied };
  if (!isUuid(userId)) return { ok: false as const, denied: fail(NO_SUCH_USER) };

  const [target] = await db
    .select({ id: users.id, role: users.role, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.orgId, current.orgId)))
    .limit(1);

  if (!target) return { ok: false as const, denied: fail(NO_SUCH_USER) };
  // Belt and braces with the role check: an admin cannot reach their own row here anyway,
  // since they are an admin, but stating it means a future change to who counts as a manager
  // cannot quietly make self-removal reachable.
  if (target.id === current.userId) return { ok: false as const, denied: fail(NOT_A_MANAGER) };
  if (target.role !== "manager") return { ok: false as const, denied: fail(NOT_A_MANAGER) };

  return { ok: true as const, current, target };
}

/**
 * Close a manager's account: they cannot sign in, and every session they hold ends now.
 *
 * Deleting their `sessions` rows is what makes this immediate — without it a cookie already in
 * a browser keeps resolving until it expires, which for this app is up to thirty days.
 * `resolveSession` also filters on `deactivated_at`, so the two together mean there is no
 * window and no path.
 */
export async function revokeUserAccessAction(userId: string): Promise<ActionResult> {
  // Allow-listed (Phase 15 §4.7): an unpaid admin can still remove a departed user.
  const guard = await requireManagerTarget(userId, requireAdminAnyPlan);
  if (!guard.ok) return guard.denied;

  await db.transaction(async (tx) => {
    await tx.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  revalidatePath("/r/settings/users");
  return ok();
}

/** Undo a revocation. They keep their own history rather than returning as a new person. */
export async function reinstateUserAccessAction(userId: string): Promise<ActionResult> {
  const guard = await requireManagerTarget(userId);
  if (!guard.ok) return guard.denied;

  await db.update(users).set({ deactivatedAt: null }).where(eq(users.id, userId));

  revalidatePath("/r/settings/users");
  return ok();
}

/**
 * Delete a manager's account outright, which is only possible when they have no audit history.
 *
 * `expense_audit.actor_user_id` is NOT NULL with no cascade, so Postgres refuses to delete
 * anyone who has ever created, edited or deleted an expense — by design, since an audit trail
 * that loses its actor is not one. Rather than let that surface as a foreign-key error, the
 * count is checked first and the refusal is said in words.
 *
 * The check and the delete share a transaction so an expense saved between them cannot leave
 * an account deleted whose history has just started.
 */
export async function deleteUserAccountAction(userId: string): Promise<ActionResult> {
  const guard = await requireManagerTarget(userId);
  if (!guard.ok) return guard.denied;

  return db.transaction(async (tx) => {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(expenseAuditEvents)
      .where(eq(expenseAuditEvents.actorUserId, userId));

    if (count > 0) return fail(HAS_HISTORY);

    // `sessions` and `user_tour_progress` cascade from the user; everything else that points
    // at one nulls out, and for an account with no audit history there is nothing to null.
    //
    // The count above is not quite enough on its own. If this person saves an expense between
    // the count and this delete, Postgres refuses the delete on `expense_audit`'s foreign key
    // and would throw where every other refusal here is a sentence. Catching the violation
    // turns that race into the same answer the count gives, which is also the true one: by the
    // time it fires, they do have a history.
    try {
      await tx.delete(users).where(eq(users.id, userId));
    } catch (error) {
      if (isForeignKeyViolation(error)) return fail(HAS_HISTORY);
      throw error;
    }
    revalidatePath("/r/settings/users");
    return ok();
  });
}
