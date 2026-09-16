/**
 * `emailInUse()` and its two callers' staff-email rejection (Phase 9, §3.3): `signUpAction`
 * refuses to create an organisation for an address that already belongs to AB Solutions staff,
 * and `createOrgUserAction` refuses to add one as an org's user.
 *
 * `next/headers` is faked the same way as the other Phase 9 integration tests, so the real
 * `requireSession()`/cookie code runs. `next/navigation` `redirect()` is a throwing sentinel.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/headers", () => {
  let cookieValue: string | undefined;
  return {
    cookies: async () => ({
      get: (name: string) => (name === "session" && cookieValue !== undefined ? { name, value: cookieValue } : undefined),
      set: (name: string, value: string) => {
        if (name === "session") cookieValue = value;
      },
      delete: (name: string) => {
        if (name === "session") cookieValue = undefined;
      },
    }),
    headers: async () => ({ get: () => null }),
    __setSessionCookie: (value: string | undefined) => {
      cookieValue = value;
    },
  };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

config({ path: ".env.local", quiet: true });

import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("staff/customer email uniqueness (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, staffUsers, users } = await import("@/src/db/schema");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { emailInUse } = await import("./emails");
  const { clearAll } = await import("@/src/services/rate-limit");

  let existingCustomerEmail: string;
  let existingStaffEmail: string;
  let existingStaffId: string;
  const cleanupOrgIds: string[] = [];

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Email Uniqueness Org", docName: "Email", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    cleanupOrgIds.push(org.id);

    existingCustomerEmail = `existing-customer-${Date.now()}@example.test`;
    await db.insert(users).values({
      orgId: org.id,
      email: existingCustomerEmail,
      passwordHash: "unused",
      role: "admin",
    });

    existingStaffEmail = `existing-staff-${Date.now()}@example.test`;
    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: existingStaffEmail,
        name: "Existing Staff",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });
    existingStaffId = staff.id;
  });

  afterAll(async () => {
    for (const id of cleanupOrgIds) await db.delete(organizations).where(eq(organizations.id, id));
    if (existingStaffId) await db.delete(staffUsers).where(eq(staffUsers.id, existingStaffId));

    // The signup tests below assert that no org was created. When the guard they cover is
    // deliberately neutralised â€” a fail-before proof â€” signup really does create one, and
    // without this the "Should Not Exist" orgs pile up in the developer's database and then
    // show on the /a dashboard. Only ever matches this suite's own throwaway names.
    await db.delete(organizations).where(like(organizations.name, "Should Not Exist%"));
  });

  beforeEach(async () => {
    clearAll();
    const nextHeaders = (await import("next/headers")) as unknown as {
      __setSessionCookie: (v: string | undefined) => void;
    };
    nextHeaders.__setSessionCookie(undefined);
  });

  describe("emailInUse", () => {
    it("true for an email in users", async () => {
      expect(await emailInUse(existingCustomerEmail)).toBe(true);
    });

    it("true for an email in staff_users", async () => {
      expect(await emailInUse(existingStaffEmail)).toBe(true);
    });

    it("is case-insensitive for a customer email", async () => {
      expect(await emailInUse(existingCustomerEmail.toUpperCase())).toBe(true);
    });

    it("is case-insensitive for a staff email", async () => {
      expect(await emailInUse(existingStaffEmail.toUpperCase())).toBe(true);
    });

    it("false for an email that belongs to neither table", async () => {
      expect(await emailInUse(`nobody-${Date.now()}@example.test`)).toBe(false);
    });
  });

  describe("signUpAction rejects a staff email", () => {
    it("exact case: field error, no org or user created", async () => {
      const { signUpAction } = await import("./actions");
      const { IDLE } = await import("@/src/lib/action-result");
      const { UI } = await import("@/src/domain/strings");

      const orgName = `Should Not Exist ${Date.now()}`;
      const form = new FormData();
      form.set("orgName", orgName);
      form.set("name", "Someone");
      form.set("email", existingStaffEmail);
      form.set("password", "a-strong-password-12");
      form.set("confirmPassword", "a-strong-password-12");

      const result = await signUpAction(IDLE, form);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.fieldErrors?.email).toBe(UI.duplicateEmail);

      const orgs = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
      expect(orgs).toHaveLength(0);
    });

    it("mixed case: still rejected, no org created", async () => {
      const { signUpAction } = await import("./actions");
      const { IDLE } = await import("@/src/lib/action-result");

      const orgName = `Should Not Exist Mixed ${Date.now()}`;
      const form = new FormData();
      form.set("orgName", orgName);
      form.set("name", "Someone");
      form.set("email", existingStaffEmail.toUpperCase());
      form.set("password", "a-strong-password-12");
      form.set("confirmPassword", "a-strong-password-12");

      const result = await signUpAction(IDLE, form);
      expect(result.ok).toBe(false);

      const orgs = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
      expect(orgs).toHaveLength(0);
    });

    it("a genuinely free email creates a Trial, non-complimentary org", async () => {
      const { signUpAction } = await import("./actions");
      const { IDLE } = await import("@/src/lib/action-result");

      const orgName = `Fresh Signup ${Date.now()}`;
      const email = `fresh-signup-${Date.now()}@example.test`;
      const form = new FormData();
      form.set("orgName", orgName);
      form.set("name", "Someone");
      form.set("email", email);
      form.set("password", "a-strong-password-12");
      form.set("confirmPassword", "a-strong-password-12");

      await expect(signUpAction(IDLE, form)).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");

      const [org] = await db
        .select({
          id: organizations.id,
          plan: organizations.plan,
          subscriptionStatus: organizations.subscriptionStatus,
          complimentary: organizations.complimentary,
          complimentaryUntil: organizations.complimentaryUntil,
          suspendedAt: organizations.suspendedAt,
        })
        .from(organizations)
        .where(eq(organizations.name, orgName));

      expect(org).toBeDefined();
      expect(org.plan).toBe("reconciliation");
      expect(org.subscriptionStatus).toBe("trial");
      expect(org.complimentary).toBe(false);
      expect(org.complimentaryUntil).toBeNull();
      expect(org.suspendedAt).toBeNull();

      cleanupOrgIds.push(org.id);
    });
  });

  describe("createOrgUserAction rejects a staff email", () => {
    it("no user row created for an admin adding a staff email as a user", async () => {
      vi.doMock("@/src/services/auth/session", () => ({
        requireSession: vi.fn(),
        revokeOtherSessions: vi.fn(async () => {}),
      }));
      // requireAdmin/actionSession import from @/src/services/auth/session at module load time;
      // reset the module registry so this file's own doMock above takes effect for actions.ts.
      vi.resetModules();
      vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

      const [org] = await db
        .insert(organizations)
        .values({ name: "Add User Staff Email Org", docName: "Add", activeMonth: "2026-02" })
        .returning({ id: organizations.id });
      cleanupOrgIds.push(org.id);
      const [admin] = await db
        .insert(users)
        .values({ orgId: org.id, email: `add-admin-${Date.now()}@example.test`, passwordHash: "unused", role: "admin" })
        .returning({ id: users.id });

      const { requireSession } = (await import("@/src/services/auth/session")) as unknown as {
        requireSession: ReturnType<typeof vi.fn>;
      };
      requireSession.mockResolvedValue({
        userId: admin.id,
        orgId: org.id,
        email: "admin@example.test",
        role: "admin",
        orgName: "Add User Staff Email Org",
        docName: "Add",
        activeMonth: "2026-02",
        activeFundingSourceId: null,
        onboarded: true,
        welcomeDismissed: true,
        plan: "reconciliation" as const,
      });

      const { createOrgUserAction } = await import("@/src/modules/users/actions");
      const result = await createOrgUserAction({ name: "Sneaky Staff", email: existingStaffEmail });
      expect(result.ok).toBe(false);

      const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, existingStaffEmail));
      expect(rows).toHaveLength(0);

      vi.doUnmock("@/src/services/auth/session");
      vi.doUnmock("next/cache");
      vi.resetModules();
    });
  });
});
