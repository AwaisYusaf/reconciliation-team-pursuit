/**
 * Revoking, reinstating and deleting a manager's account.
 *
 * These are the auth boundary, so the properties worth proving are the ones an attacker or a
 * mistake would probe: a revoked person's live cookie stops working *now* rather than in
 * thirty days, an admin cannot be targeted through this screen at all (which is what stops an
 * organisation locking itself out), an admin in another organisation is refused without being
 * told the difference, and an account carrying audit history cannot be deleted no matter which
 * path reaches the delete.
 *
 * `@/src/services/auth/session` is mocked so the test controls who is signed in, exactly as
 * `users.integration.test.ts` does. The real `requireAdmin()`, the real org scoping and the
 * real database are all in play below that.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/services/auth/session", () => ({
  requireSession: vi.fn(),
  revokeOtherSessions: vi.fn(async () => {}),
}));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("manager access actions (integration)", async () => {
  const { db } = await import("@/src/db");
  const { expenseAuditEvents, organizations, sessions, users } = await import("@/src/db/schema");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { requireSession } = await import("@/src/services/auth/session");
  const { FORBIDDEN } = await import("@/src/lib/action-session");
  const { generateSessionToken, hashSessionToken, sessionExpiry } = await import(
    "@/src/services/auth/tokens"
  );
  const { resolveSession } = await import("@/src/services/auth/store");
  const { storage } = await import("@/src/services/storage/driver");
  const { avatarKey } = await import("@/src/services/storage/keys");
  const { rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const {
    revokeUserAccessAction,
    reinstateUserAccessAction,
    deleteUserAccountAction,
    listOrgUsersAction,
  } = await import("./actions");

  const session = vi.mocked(requireSession);
  const MONTH = "2099-01";

  let orgAId: string;
  let orgBId: string;
  let adminAId: string;
  let adminBId: string;

  function signedInAs(userId: string, orgId: string, role: "admin" | "manager") {
    session.mockResolvedValue({
      userId,
      orgId,
      role,
      email: "session-user@example.com",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  }

  async function insertUser(orgId: string, role: "admin" | "manager"): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role,
      })
      .returning({ id: users.id });
    return row.id;
  }

  /** A real session row, so revocation can be shown to end a live cookie rather than a fixture. */
  async function signInFor(userId: string): Promise<string> {
    const token = generateSessionToken();
    await db.insert(sessions).values({
      id: hashSessionToken(token),
      userId,
      expiresAt: sessionExpiry(),
    });
    return token;
  }

  async function deactivatedAtOf(userId: string): Promise<Date | null> {
    const [row] = await db
      .select({ at: users.deactivatedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.at ?? null;
  }

  async function sessionCountFor(userId: string): Promise<number> {
    const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
    return rows.length;
  }

  beforeAll(async () => {
    const [orgA] = await db
      .insert(organizations)
      .values({ name: "Access Org A", docName: "Access A", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgAId = orgA.id;

    const [orgB] = await db
      .insert(organizations)
      .values({ name: "Access Org B", docName: "Access B", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgBId = orgB.id;

    adminAId = await insertUser(orgAId, "admin");
    adminBId = await insertUser(orgBId, "admin");
  });

  afterAll(async () => {
    for (const id of [orgAId, orgBId]) {
      if (!id) continue;
      await db.delete(organizations).where(eq(organizations.id, id));
      await rm(path.join(process.cwd(), ".storage", "org", id), { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    signedInAs(adminAId, orgAId, "admin");
  });

  /** A stored photo on the person's row, as the upload route leaves it. */
  async function givePhoto(userId: string): Promise<string> {
    const key = avatarKey({ orgId: orgAId, userId, uploadId: crypto.randomUUID(), mimeType: "image/jpeg" });
    await storage().put({ key, body: Buffer.from("photo"), contentType: "image/jpeg" });
    await db.update(users).set({ avatarKey: key, avatarBytes: 5 }).where(eq(users.id, userId));
    return key;
  }

  describe("revoking", () => {
    it("ends every live session the moment it is revoked, and only that person's", async () => {
      const target = await insertUser(orgAId, "manager");
      const bystander = await insertUser(orgAId, "manager");

      const targetToken = await signInFor(target);
      await signInFor(target);
      const bystanderToken = await signInFor(bystander);

      // The cookie works right up to the revocation.
      expect(await resolveSession(targetToken)).not.toBeNull();

      expect(await revokeUserAccessAction(target)).toEqual({ ok: true });

      expect(await deactivatedAtOf(target)).toBeInstanceOf(Date);
      // Both of their sessions are gone — this is what makes it immediate rather than
      // "whenever the thirty-day cookie happens to expire".
      expect(await sessionCountFor(target)).toBe(0);
      expect(await resolveSession(targetToken)).toBeNull();

      // Nobody else is signed out by it.
      expect(await sessionCountFor(bystander)).toBe(1);
      expect(await resolveSession(bystanderToken)).not.toBeNull();
    });

    it("refuses a cookie made after the revocation too, so no path re-opens access", async () => {
      const target = await insertUser(orgAId, "manager");
      await revokeUserAccessAction(target);

      // `resolveSession` filters on `deactivated_at` as well, so even a session row created
      // some other way resolves to nothing.
      const token = await signInFor(target);
      expect(await resolveSession(token)).toBeNull();
    });

    it("reinstating restores sign-in and keeps the same account", async () => {
      const target = await insertUser(orgAId, "manager");
      await revokeUserAccessAction(target);

      expect(await reinstateUserAccessAction(target)).toEqual({ ok: true });
      expect(await deactivatedAtOf(target)).toBeNull();

      const token = await signInFor(target);
      const resolved = await resolveSession(token);
      expect(resolved?.context.userId).toBe(target);
    });
  });

  describe("who may be targeted", () => {
    it("refuses an admin, which is what stops an organisation locking itself out", async () => {
      // Including the caller's own account: an admin cannot revoke themselves here.
      for (const action of [revokeUserAccessAction, reinstateUserAccessAction, deleteUserAccountAction]) {
        expect(await action(adminAId)).toEqual({
          ok: false,
          error: "Only a manager's access can be changed here.",
        });
      }
      expect(await deactivatedAtOf(adminAId)).toBeNull();
    });

    it("refuses a manager in another organisation, and says only that they do not exist", async () => {
      const otherOrgManager = await insertUser(orgBId, "manager");

      // "No longer exists", not "not your organisation" — a crafted id must not be able to
      // tell the difference between a real person elsewhere and nobody at all.
      expect(await revokeUserAccessAction(otherOrgManager)).toEqual({
        ok: false,
        error: "That user no longer exists.",
      });
      expect(await deactivatedAtOf(otherOrgManager)).toBeNull();

      // And the reverse direction: org B's admin cannot reach into org A.
      const orgAManager = await insertUser(orgAId, "manager");
      signedInAs(adminBId, orgBId, "admin");
      expect(await revokeUserAccessAction(orgAManager)).toEqual({
        ok: false,
        error: "That user no longer exists.",
      });
      expect(await deactivatedAtOf(orgAManager)).toBeNull();
    });

    it("refuses an id that was never real, and one that is not a uuid", async () => {
      for (const id of ["not-a-uuid", "", "00000000-0000-7000-8000-00000000dead"]) {
        expect(await revokeUserAccessAction(id)).toEqual({
          ok: false,
          error: "That user no longer exists.",
        });
      }
    });

    it("refuses a manager caller outright — requireAdmin is the boundary", async () => {
      const manager = await insertUser(orgAId, "manager");
      const target = await insertUser(orgAId, "manager");
      signedInAs(manager, orgAId, "manager");

      for (const action of [revokeUserAccessAction, reinstateUserAccessAction, deleteUserAccountAction]) {
        expect(await action(target)).toEqual({ ok: false, error: FORBIDDEN });
      }
      expect(await deactivatedAtOf(target)).toBeNull();
    });
  });

  describe("deleting", () => {
    it("deletes a manager who has no history, and takes their sessions with them", async () => {
      const target = await insertUser(orgAId, "manager");
      await signInFor(target);

      expect(await deleteUserAccountAction(target)).toEqual({ ok: true });

      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, target));
      expect(row).toBeUndefined();
      // `sessions` cascades from the user, so nothing is left behind pointing at a gone row.
      expect(await sessionCountFor(target)).toBe(0);
    });

    it("removes the person's photo from storage with the account (D-119)", async () => {
      const target = await insertUser(orgAId, "manager");
      const key = await givePhoto(target);

      expect(await deleteUserAccountAction(target)).toEqual({ ok: true });

      // The row was the only thing that could ever find this object again.
      await expect(storage().get(key)).rejects.toThrow();
    });

    it("keeps the photo when the delete is refused", async () => {
      const target = await insertUser(orgAId, "manager");
      const key = await givePhoto(target);
      await db.insert(expenseAuditEvents).values({ orgId: orgAId, actorUserId: target, action: "created" });

      expect((await deleteUserAccountAction(target)).ok).toBe(false);
      await expect(storage().get(key)).resolves.toBeInstanceOf(Buffer);
    });

    it("refuses one who has touched an expense, in words rather than a database error", async () => {
      const target = await insertUser(orgAId, "manager");
      await db.insert(expenseAuditEvents).values({
        orgId: orgAId,
        actorUserId: target,
        action: "created",
      });

      const result = await deleteUserAccountAction(target);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toMatch(/history of changes/);

      // Still there, and still able to be named by the audit trail — which is the reason the
      // delete is refused in the first place.
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, target));
      expect(row?.id).toBe(target);
    });

    it("is offered in the list only when it would actually succeed", async () => {
      const clean = await insertUser(orgAId, "manager");
      const withHistory = await insertUser(orgAId, "manager");
      await db.insert(expenseAuditEvents).values({
        orgId: orgAId,
        actorUserId: withHistory,
        action: "created",
      });

      const listed = await listOrgUsersAction();
      expect(listed.ok).toBe(true);
      if (!listed.ok) throw new Error("unreachable");

      const byId = new Map(listed.data.map((row) => [row.id, row]));
      expect(byId.get(clean)?.deletable).toBe(true);
      // A Delete that is offered and then refuses is worse than one that is never offered.
      expect(byId.get(withHistory)?.deletable).toBe(false);
      // An admin is never deletable here, history or not.
      expect(byId.get(adminAId)?.deletable).toBe(false);
    });
  });
});
