/**
 * `requireStaff()` / `requireStaffPage()` and the login/signup staff redirect (Phase 9, D-98),
 * exercised against a real database with a faked cookie jar and a `redirect()` sentinel — same
 * mocking approach as `staff-session-cookie.integration.test.ts`.
 *
 * Also proves the "no loop" flow: a staff cookie on the customer app's session resolver and a
 * customer cookie on the staff guard land where the product spec says, not back where they came
 * from.
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

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("staff action/page guards (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, staffUsers, users } = await import("@/src/db/schema");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const nextHeaders = (await import("next/headers")) as unknown as {
    __setSessionCookie: (v: string | undefined) => void;
  };
  const { startSession, startStaffSession, endSession } = await import("@/src/services/auth/session");
  const { requireStaff } = await import("./action-session");
  const { requireStaffPage } = await import("@/src/modules/admin/guard");
  const { SESSION_EXPIRED } = await import("./action-result");

  let orgId: string;
  let adminId: string;
  let managerId: string;
  let staffId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Guard Org", docName: "Guard", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [admin] = await db
      .insert(users)
      .values({ orgId, email: `guard-admin-${Date.now()}@example.test`, passwordHash: "unused", role: "admin" })
      .returning({ id: users.id });
    adminId = admin.id;

    const [manager] = await db
      .insert(users)
      .values({ orgId, email: `guard-manager-${Date.now()}@example.test`, passwordHash: "unused", role: "manager" })
      .returning({ id: users.id });
    managerId = manager.id;

    const [staff] = await db
      .insert(staffUsers)
      .values({
        email: `guard-staff-${Date.now()}@example.test`,
        name: "Guard Staff",
        passwordHash: await hashPassword("irrelevant-password-1"),
      })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
    if (staffId) await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  beforeEach(() => {
    nextHeaders.__setSessionCookie(undefined);
  });

  describe("requireStaff (action)", () => {
    it("signed out -> SESSION_EXPIRED", async () => {
      const result = await requireStaff();
      expect(result).toEqual({ denied: { ok: false, error: SESSION_EXPIRED } });
    });

    it("customer admin -> FORBIDDEN", async () => {
      await startSession(adminId);
      const result = await requireStaff();
      expect("denied" in result).toBe(true);
      if (!("denied" in result)) throw new Error("unreachable");
      expect(result.denied.ok).toBe(false);
      expect((result.denied as { error: string }).error).toBe(
        "You do not have permission to do that.",
      );
      await endSession();
    });

    it("customer manager -> FORBIDDEN", async () => {
      await startSession(managerId);
      const result = await requireStaff();
      expect("denied" in result).toBe(true);
      if (!("denied" in result)) throw new Error("unreachable");
      expect((result.denied as { error: string }).error).toBe(
        "You do not have permission to do that.",
      );
      await endSession();
    });

    it("staff -> returns the staff context", async () => {
      await startStaffSession(staffId);
      const result = await requireStaff();
      expect("denied" in result).toBe(false);
      if ("denied" in result) throw new Error("unreachable");
      expect(result.staffId).toBe(staffId);
      await endSession();
    });
  });

  describe("requireStaffPage", () => {
    it("staff -> returns the staff context, no redirect", async () => {
      await startStaffSession(staffId);
      const ctx = await requireStaffPage();
      expect(ctx.staffId).toBe(staffId);
      await endSession();
    });

    it("onboarded customer -> redirects to /r", async () => {
      await db.update(organizations).set({ onboardedAt: new Date() }).where(eq(organizations.id, orgId));
      await startSession(adminId);
      await expect(requireStaffPage()).rejects.toThrow("NEXT_REDIRECT:/r");
      await endSession();
      await db.update(organizations).set({ onboardedAt: null }).where(eq(organizations.id, orgId));
    });

    it("non-onboarded customer -> redirects to /onboarding/line-items", async () => {
      await startSession(adminId);
      await expect(requireStaffPage()).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");
      await endSession();
    });

    it("signed out -> redirects to /login", async () => {
      await expect(requireStaffPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    });
  });

  describe("login and signup pages: staff session -> redirect /a", () => {
    it("login page redirects a staff session to /a", async () => {
      await startStaffSession(staffId);
      const LoginPage = (await import("@/app/(auth)/login/page")).default;
      await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT:/a");
      await endSession();
    });

    it("signup page redirects a staff session to /a", async () => {
      await startStaffSession(staffId);
      const SignupPage = (await import("@/app/(auth)/signup/page")).default;
      await expect(SignupPage()).rejects.toThrow("NEXT_REDIRECT:/a");
      await endSession();
    });
  });

  describe("flow check: staff cookie visiting the customer app never loops", () => {
    it("a staff cookie makes getSession() null, so /r's own guard sends it to /login, and login sends it on to /a (no loop)", async () => {
      const { getSession } = await import("@/src/services/auth/session");
      await startStaffSession(staffId);

      // /r's layout would see no customer session for this cookie...
      expect(await getSession()).toBeNull();

      // ...and land on /login, whose own page redirects a staff session straight to /a rather
      // than back to /login or /r.
      const LoginPage = (await import("@/app/(auth)/login/page")).default;
      await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT:/a");

      await endSession();
    });
  });
});
