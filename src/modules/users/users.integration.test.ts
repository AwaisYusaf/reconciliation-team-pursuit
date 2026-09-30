/**
 * User management (RBAC phase 1), exercised against a real database.
 *
 * `@/src/services/auth/session` is mocked so the test controls which session is "signed
 * in" per call â€” `actionSession()` (via `requireSession`) and `setUserPasswordAction`'s
 * `revokeOtherSessions` both import from this one module, so a single mock covers both.
 * Everything below that (the real `requireAdmin()` role check, org scoping, hashing, and
 * the DB writes) is the real production code running against a real database.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/services/auth/session", () => {
  class UnauthenticatedError extends Error {
    constructor() {
      super("Not signed in");
      this.name = "UnauthenticatedError";
    }
  }
  return {
    requireSession: vi.fn(),
    revokeOtherSessions: vi.fn(async () => {}),
    UnauthenticatedError,
  };
});

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("user management (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, users } = await import("@/src/db/schema");
  const { hashPassword, verifyPassword, validatePasswordPolicy, generatePassword } = await import(
    "@/src/services/auth/passwords"
  );
  const { requireSession, UnauthenticatedError } = await import("@/src/services/auth/session");
  const { FORBIDDEN } = await import("@/src/lib/action-session");
  const { SESSION_EXPIRED } = await import("@/src/lib/action-result");
  const { createOrgUserAction, setUserPasswordAction, setUserNameAction, listOrgUsersAction } =
    await import("./actions");

  const session = vi.mocked(requireSession);

  const MONTH = "2099-01";

  type Ctx = {
    userId: string;
    orgId: string;
    email: string;
    role: "admin" | "manager";
    orgName: string;
    docName: string;
    activeMonth: string;
    activeFundingSourceId: string | null;
    onboarded: boolean;
    welcomeDismissed: boolean;
  };

  function asSession(ctx: Partial<Ctx> & { userId: string; orgId: string; role: "admin" | "manager" }) {
    session.mockResolvedValue({
      email: "session-user@example.com",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
      ...ctx,
    });
  }

  async function insertUser(orgId: string, role: "admin" | "manager", email?: string) {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: email ?? `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role,
      })
      .returning({ id: users.id });
    return row.id;
  }

  async function hashOf(userId: string) {
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    return row?.hash;
  }

  async function userCount(orgId: string) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId));
    return rows.length;
  }

  async function nameOf(userId: string) {
    const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    return row?.name;
  }

  let orgAId: string;
  let orgBId: string;
  let adminAId: string;
  let managerAId: string;
  let adminBId: string;
  let targetInOrgAId: string;
  let targetInOrgBId: string;

  beforeAll(async () => {
    const [orgA] = await db
      .insert(organizations)
      .values({ name: "Users Org A", docName: "Users A", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgAId = orgA.id;

    const [orgB] = await db
      .insert(organizations)
      .values({ name: "Users Org B", docName: "Users B", activeMonth: MONTH })
      .returning({ id: organizations.id });
    orgBId = orgB.id;

    adminAId = await insertUser(orgAId, "admin");
    managerAId = await insertUser(orgAId, "manager");
    adminBId = await insertUser(orgBId, "admin");
    targetInOrgAId = await insertUser(orgAId, "manager");
    targetInOrgBId = await insertUser(orgBId, "manager");
  });

  afterAll(async () => {
    for (const id of [orgAId, orgBId]) {
      if (id) await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  describe("(a) a manager is refused, with no side effect", () => {
    it("createOrgUserAction: rejected, no user row created", async () => {
      asSession({ userId: managerAId, orgId: orgAId, role: "manager" });
      const before = await userCount(orgAId);

      const result = await createOrgUserAction({ name: "New Person", email: "new-person@example.test" });
      expect(result).toEqual({ ok: false, error: FORBIDDEN });

      expect(await userCount(orgAId)).toBe(before);
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "new-person@example.test"));
      expect(existing).toHaveLength(0);
    });

    it("setUserPasswordAction: rejected, target's hash unchanged", async () => {
      asSession({ userId: managerAId, orgId: orgAId, role: "manager" });
      const before = await hashOf(targetInOrgAId);

      const result = await setUserPasswordAction(targetInOrgAId, "a-new-password-12");
      expect(result).toEqual({ ok: false, error: FORBIDDEN });

      expect(await hashOf(targetInOrgAId)).toBe(before);
    });

    it("listOrgUsersAction: rejected", async () => {
      asSession({ userId: managerAId, orgId: orgAId, role: "manager" });
      const result = await listOrgUsersAction();
      expect(result).toEqual({ ok: false, error: FORBIDDEN });
    });

    it("setUserNameAction: rejected, target's name unchanged", async () => {
      asSession({ userId: managerAId, orgId: orgAId, role: "manager" });
      const before = await nameOf(targetInOrgAId);

      const result = await setUserNameAction(targetInOrgAId, "Sneaky Rename");
      expect(result).toEqual({ ok: false, error: FORBIDDEN });

      expect(await nameOf(targetInOrgAId)).toBe(before);
    });
  });

  describe("(b) org scoping for an admin", () => {
    it("setUserPasswordAction: admin A against org B's real userId is rejected, org B's hash unchanged", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const before = await hashOf(targetInOrgBId);

      const result = await setUserPasswordAction(targetInOrgBId, "a-new-password-12");
      expect(result.ok).toBe(false);

      expect(await hashOf(targetInOrgBId)).toBe(before);
    });

    it("listOrgUsersAction: admin A sees only org A's users, never org B's", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const result = await listOrgUsersAction();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const ids = result.data.map((row) => row.id);
      expect(ids).toContain(adminAId);
      expect(ids).toContain(managerAId);
      expect(ids).toContain(targetInOrgAId);
      expect(ids).not.toContain(adminBId);
      expect(ids).not.toContain(targetInOrgBId);
    });
  });

  describe("(c) duplicate email on createOrgUserAction", () => {
    it("same-org duplicate is rejected", async () => {
      const email = `dup-same-org-${Date.now()}@example.test`;
      await insertUser(orgAId, "manager", email);

      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const result = await createOrgUserAction({ name: "Dup Person", email });
      expect(result.ok).toBe(false);
    });

    it("cross-org duplicate is rejected (the unique index is global)", async () => {
      const email = `dup-cross-org-${Date.now()}@example.test`;
      await insertUser(orgBId, "manager", email);

      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const result = await createOrgUserAction({ name: "Dup Person", email });
      expect(result.ok).toBe(false);

      // And no second row was created for it (still just the one in org B).
      const rows = await db.select({ id: users.id, orgId: users.orgId }).from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(1);
      expect(rows[0].orgId).toBe(orgBId);
    });

    it("duplicate check is case-insensitive", async () => {
      const mixedCaseEmail = `Foo-${Date.now()}@x.test`;
      await insertUser(orgAId, "manager", mixedCaseEmail);

      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const result = await createOrgUserAction({
        name: "Foo",
        email: mixedCaseEmail.toLowerCase(),
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("(d) signUpAction's admin-on-signup invariant", () => {
    // signUpAction itself calls requireSession(), cookies(), a rate limiter, and redirect() â€”
    // mocking all of that out to drive the action directly is disproportionate for what's
    // really being asserted. Verified instead two ways:
    // 1. Source: src/modules/auth/actions.ts line 266 inserts `role: "admin"` explicitly on
    //    every sign-up, never left to a default.
    // 2. Schema-level: role has NOT NULL and (per the migration) no column default, so an
    //    insert that omits it is refused by the database rather than silently minting a role.
    it("the users table refuses an insert that omits role (no default to silently mint one)", async () => {
      const insert = db.insert(users).values({
        orgId: orgAId,
        email: `no-role-${Date.now()}@example.test`,
        passwordHash: "x",
        // role omitted on purpose
      } as never);

      await expect(insert).rejects.toThrow();
    });
  });

  describe("(e) an admin-created user can actually sign in", () => {
    it("returns a plaintext password that verifies against the stored hash, role manager, orgId is the admin's org", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const email = `new-login-${Date.now()}@example.test`;

      const result = await createOrgUserAction({ name: "New Login", email });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const [row] = await db
        .select({ id: users.id, role: users.role, orgId: users.orgId, hash: users.passwordHash })
        .from(users)
        .where(eq(users.email, email));

      expect(row.role).toBe("manager");
      expect(row.orgId).toBe(orgAId);
      expect(await verifyPassword(row.hash, result.data.password)).toBe(true);
      expect(await verifyPassword(row.hash, "definitely-the-wrong-password")).toBe(false);
    });
  });

  describe("(f) an admin can actually set a password on a profile in their own org", () => {
    it("a generated password replaces the stored hash and verifies against it", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const before = await hashOf(targetInOrgAId);

      const result = await setUserPasswordAction(targetInOrgAId);
      expect(result.ok).toBe(true);
      if (!result.ok || !result.data) throw new Error("expected a generated password back");

      const after = await hashOf(targetInOrgAId);
      expect(after).not.toBe(before);
      expect(await verifyPassword(after as string, result.data.password)).toBe(true);
      expect(await verifyPassword(after as string, "original-password-here")).toBe(false);
    });

    it("an admin-chosen password is applied but never echoed back to the caller", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });

      const result = await setUserPasswordAction(targetInOrgAId, "a-chosen-password-12");
      expect(result).toEqual({ ok: true, data: undefined });

      expect(await verifyPassword((await hashOf(targetInOrgAId)) as string, "a-chosen-password-12")).toBe(true);
    });

    it("the refusal for another org's user is worded identically to a user that does not exist", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });

      const crossOrg = await setUserPasswordAction(targetInOrgBId);
      const absent = await setUserPasswordAction("00000000-0000-0000-0000-000000000000");

      expect(crossOrg.ok).toBe(false);
      expect(absent.ok).toBe(false);
      // Indistinguishable on purpose: a crafted id must not confirm that a user exists elsewhere.
      expect(crossOrg).toEqual(absent);
    });
  });

  describe("(g) createOrgUserAction name validation (D-89)", () => {
    it("rejects an empty name and writes no user row", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const email = `empty-name-${Date.now()}@example.test`;

      const result = await createOrgUserAction({ name: "", email });
      expect(result.ok).toBe(false);

      const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(0);
    });

    it("rejects a whitespace-only name and writes no user row", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const email = `whitespace-name-${Date.now()}@example.test`;

      const result = await createOrgUserAction({ name: "   ", email });
      expect(result.ok).toBe(false);

      const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      expect(rows).toHaveLength(0);
    });

    it("accepts a valid name, trimmed", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const email = `trimmed-name-${Date.now()}@example.test`;

      const result = await createOrgUserAction({ name: "  Trimmed Name  ", email });
      expect(result.ok).toBe(true);

      const [row] = await db.select({ name: users.name }).from(users).where(eq(users.email, email));
      expect(row.name).toBe("Trimmed Name");
    });
  });

  describe("(h) setUserNameAction (D-89)", () => {
    it("an admin can rename a user in their own org, trimmed", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });

      const result = await setUserNameAction(targetInOrgAId, "  Renamed Person  ");
      expect(result).toEqual({ ok: true, data: undefined });

      expect(await nameOf(targetInOrgAId)).toBe("Renamed Person");
    });

    it("rejects an empty name, target's name unchanged", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const before = await nameOf(targetInOrgAId);

      const result = await setUserNameAction(targetInOrgAId, "");
      expect(result.ok).toBe(false);

      expect(await nameOf(targetInOrgAId)).toBe(before);
    });

    it("rejects a whitespace-only name, target's name unchanged", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const before = await nameOf(targetInOrgAId);

      const result = await setUserNameAction(targetInOrgAId, "   ");
      expect(result.ok).toBe(false);

      expect(await nameOf(targetInOrgAId)).toBe(before);
    });

    it("rejects a non-uuid userId", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const result = await setUserNameAction("not-a-uuid", "Whoever");
      expect(result.ok).toBe(false);
    });

    it("is org-scoped: another org's user id is refused with the same 'no longer exists' wording, and that user's name is unchanged", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const before = await nameOf(targetInOrgBId);

      const crossOrg = await setUserNameAction(targetInOrgBId, "Should Not Land");
      const absent = await setUserNameAction("00000000-0000-0000-0000-000000000000", "Whoever");

      expect(crossOrg.ok).toBe(false);
      expect(absent.ok).toBe(false);
      expect(crossOrg).toEqual(absent);
      expect(await nameOf(targetInOrgBId)).toBe(before);
    });
  });

  describe("(i) a legacy user with no name on file (D-89)", () => {
    it("listOrgUsersAction returns name: null for a row that predates the column", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      // insertUser deliberately never sets `name`, so this row is exactly the legacy shape.
      const legacyId = await insertUser(orgAId, "manager");

      const result = await listOrgUsersAction();
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const row = result.data.find((entry) => entry.id === legacyId);
      expect(row).toBeDefined();
      expect(row!.name).toBeNull();
    });
  });

  describe("session edge cases", () => {
    it("an expired/unauthenticated session returns the session-expired result rather than throwing", async () => {
      session.mockRejectedValueOnce(new UnauthenticatedError());

      const result = await createOrgUserAction({ name: "Whoever", email: "whoever@example.test" });
      expect(result).toEqual({ ok: false, error: SESSION_EXPIRED });
    });

    it("setUserPasswordAction also reports session-expired rather than throwing", async () => {
      session.mockRejectedValueOnce(new UnauthenticatedError());

      const result = await setUserPasswordAction(targetInOrgAId, "a-new-password-12");
      expect(result).toEqual({ ok: false, error: SESSION_EXPIRED });
    });

    it("setUserNameAction also reports session-expired rather than throwing", async () => {
      session.mockRejectedValueOnce(new UnauthenticatedError());

      const result = await setUserNameAction(targetInOrgAId, "Whoever");
      expect(result).toEqual({ ok: false, error: SESSION_EXPIRED });
    });

    it("listOrgUsersAction also reports session-expired rather than throwing", async () => {
      session.mockRejectedValueOnce(new UnauthenticatedError());

      const result = await listOrgUsersAction();
      expect(result).toEqual({ ok: false, error: SESSION_EXPIRED });
    });
  });

  describe("malformed and policy-violating input", () => {
    it("setUserPasswordAction refuses a non-uuid userId", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const result = await setUserPasswordAction("not-a-uuid", "a-new-password-12");
      expect(result.ok).toBe(false);
    });

    it("setUserPasswordAction refuses an explicit password shorter than 12 chars, and the hash is unchanged", async () => {
      asSession({ userId: adminAId, orgId: orgAId, role: "admin" });
      const before = await hashOf(targetInOrgAId);

      const result = await setUserPasswordAction(targetInOrgAId, "short12345"); // 10 chars, below the 12 minimum
      expect(result.ok).toBe(false);

      expect(await hashOf(targetInOrgAId)).toBe(before);
    });
  });

  describe("the argon2 provisioning budget", () => {
    it("throttles an admin past the hourly limit, so a stolen cookie cannot flood the hash threadpool", async () => {
      // A userId of its own, so exhausting this bucket cannot affect the other tests'.
      const floodingAdmin = "11111111-1111-1111-1111-111111111111";
      asSession({ userId: floodingAdmin, orgId: orgAId, role: "admin" });

      const { LIMITS } = await import("@/src/services/rate-limit");
      const results = [];
      for (let i = 0; i < LIMITS.userProvisioning.limit + 1; i++) {
        // A malformed id returns before argon2 but after the budget is spent, so this stays fast.
        results.push(await setUserPasswordAction("not-a-uuid"));
      }

      const last = results[results.length - 1];
      expect(last.ok).toBe(false);
      if (last.ok) throw new Error("unreachable");
      expect(last.error).toMatch(/^Too many user changes/);
      // And a manager never even reaches the budget â€” requireAdmin refuses first.
      asSession({ userId: managerAId, orgId: orgAId, role: "manager" });
      expect(await listOrgUsersAction()).toEqual({ ok: false, error: FORBIDDEN });
    });
  });

  describe("(j) the one-time password comes with the sign-in link (usability #51)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    /** Its own admin, so these calls cannot spend admin A's provisioning budget. */
    async function freshAdmin() {
      const id = await insertUser(orgAId, "admin");
      asSession({ userId: id, orgId: orgAId, role: "admin" });
      return id;
    }

    it("E32: createOrgUserAction returns APP_URL's origin plus /login, whatever path APP_URL carries", async () => {
      vi.stubEnv("APP_URL", "https://app.example.org/some/path/");
      await freshAdmin();
      const email = `signin-link-${Date.now()}@example.test`;

      const result = await createOrgUserAction({ name: "Link Person", email });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.signInUrl).toBe("https://app.example.org/login");
      const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.email, email));
      expect(await verifyPassword(row.hash, result.data.password)).toBe(true);
    });

    it("E32: a generated reset returns the same link; an admin-chosen one still returns nothing", async () => {
      vi.stubEnv("APP_URL", "https://app.example.org");
      await freshAdmin();

      const generated = await setUserPasswordAction(targetInOrgAId);
      expect(generated.ok).toBe(true);
      if (!generated.ok || !generated.data) throw new Error("expected a generated password back");
      expect(generated.data.signInUrl).toBe("https://app.example.org/login");
      expect(await verifyPassword((await hashOf(targetInOrgAId)) as string, generated.data.password)).toBe(true);

      expect(await setUserPasswordAction(targetInOrgAId, "a-chosen-password-12")).toEqual({ ok: true, data: undefined });
    });

    it("E33: a manager's refusal is unchanged and carries no link", async () => {
      vi.stubEnv("APP_URL", "https://app.example.org");
      asSession({ userId: managerAId, orgId: orgAId, role: "manager" });

      expect(await createOrgUserAction({ name: "Nope", email: `nope-${Date.now()}@example.test` })).toEqual({
        ok: false,
        error: FORBIDDEN,
      });
      expect(await setUserPasswordAction(targetInOrgAId)).toEqual({ ok: false, error: FORBIDDEN });
    });

    it("an unusable APP_URL in production fails BEFORE the user is created or the password changed", async () => {
      await freshAdmin();
      const email = `no-origin-${Date.now()}@example.test`;
      const before = await hashOf(targetInOrgAId);
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("APP_URL", "");

      await expect(createOrgUserAction({ name: "No Origin", email })).rejects.toThrow(/APP_URL is unusable/);
      await expect(setUserPasswordAction(targetInOrgAId)).rejects.toThrow(/APP_URL is unusable/);

      vi.unstubAllEnvs();
      expect(await db.select({ id: users.id }).from(users).where(eq(users.email, email))).toHaveLength(0);
      expect(await hashOf(targetInOrgAId)).toBe(before);
    });
  });

  describe("generatePassword()", () => {
    it("passes the password policy and two calls differ", () => {
      const a = generatePassword();
      const b = generatePassword();

      expect(validatePasswordPolicy(a)).toBeNull();
      expect(validatePasswordPolicy(b)).toBeNull();
      expect(a).not.toBe(b);
    });
  });
});
