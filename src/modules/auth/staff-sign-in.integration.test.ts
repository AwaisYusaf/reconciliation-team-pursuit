/**
 * `signInAction`'s staff fallback and the customer `last_sign_in_at` write (Phase 9 §3.3, §5),
 * exercised against a real database with a faked cookie jar, faked `headers()`, and a
 * `redirect()` sentinel — same approach as the sibling Phase 9 integration tests.
 *
 * Rate-limit buckets are cleared before every test: `clientIp()` returns the constant "direct"
 * outside production, so every call in this file would otherwise share one `loginPerIp` bucket
 * (limit 30) and start failing partway through the suite for a reason unrelated to what's being
 * tested.
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

describe.skipIf(!hasDatabase)("signInAction staff fallback (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, staffSessions, staffUsers, users } = await import("@/src/db/schema");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { clearAll } = await import("@/src/services/rate-limit");
  const { UI } = await import("@/src/domain/strings");
  const { IDLE } = await import("@/src/lib/action-result");
  const { signInAction } = await import("./actions");

  let orgId: string;
  let onboardedOrgId: string;
  let customerId: string;
  let onboardedCustomerId: string;
  let wrongPasswordCustomerId: string;
  const customerPassword = "customer-real-password-1";
  let staffId: string;
  const staffEmail = `signin-staff-${Date.now()}@example.test`;
  const staffPassword = "staff-real-password-12";

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Sign-In Org", docName: "Sign-In", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    orgId = org.id;
    const [customer] = await db
      .insert(users)
      .values({
        orgId,
        email: `signin-customer-${Date.now()}@example.test`,
        passwordHash: await hashPassword(customerPassword),
        role: "admin",
      })
      .returning({ id: users.id });
    customerId = customer.id;

    const [onboardedOrg] = await db
      .insert(organizations)
      .values({
        name: "Sign-In Onboarded Org",
        docName: "Sign-In Onboarded",
        activeMonth: "2026-02",
        onboardedAt: new Date(),
      })
      .returning({ id: organizations.id });
    onboardedOrgId = onboardedOrg.id;
    const [onboardedCustomer] = await db
      .insert(users)
      .values({
        orgId: onboardedOrgId,
        email: `signin-onboarded-${Date.now()}@example.test`,
        passwordHash: await hashPassword(customerPassword),
        role: "admin",
      })
      .returning({ id: users.id });
    onboardedCustomerId = onboardedCustomer.id;

    const [wrongPasswordCustomer] = await db
      .insert(users)
      .values({
        orgId,
        email: `signin-wrongpass-${Date.now()}@example.test`,
        passwordHash: await hashPassword(customerPassword),
        role: "admin",
      })
      .returning({ id: users.id });
    wrongPasswordCustomerId = wrongPasswordCustomer.id;

    const [staff] = await db
      .insert(staffUsers)
      .values({ email: staffEmail, name: "Sign In Staff", passwordHash: await hashPassword(staffPassword) })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
    if (onboardedOrgId) await db.delete(organizations).where(eq(organizations.id, onboardedOrgId));
    if (staffId) await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  beforeEach(() => {
    clearAll();
  });

  function formWith(email: string, password: string): FormData {
    const form = new FormData();
    form.set("email", email);
    form.set("password", password);
    return form;
  }

  it("staff credentials: creates a staff_sessions row, redirects /a, and creates NO customer sessions row", async () => {
    await expect(signInAction(IDLE, formWith(staffEmail, staffPassword))).rejects.toThrow("NEXT_REDIRECT:/a");

    const rows = await db.select().from(staffSessions).where(eq(staffSessions.staffUserId, staffId));
    expect(rows).toHaveLength(1);

    const { sessions } = await import("@/src/db/schema");
    const customerRows = await db.select().from(sessions).where(eq(sessions.userId, customerId));
    expect(customerRows).toHaveLength(0);

    await db.delete(staffSessions).where(eq(staffSessions.staffUserId, staffId));
  });

  it("staff wrong password: normal wrong-password message, no session row", async () => {
    const result = await signInAction(IDLE, formWith(staffEmail, "totally-wrong-password"));
    expect(result).toEqual({ ok: false, error: UI.signInWrongPassword });

    const rows = await db.select().from(staffSessions).where(eq(staffSessions.staffUserId, staffId));
    expect(rows).toHaveLength(0);
  });

  it("unknown email: same 'unknown email' wording as a customer miss", async () => {
    const result = await signInAction(IDLE, formWith(`nobody-${Date.now()}@example.test`, "whatever-password-12"));
    expect(result).toEqual({ ok: false, error: UI.signInUnknownEmail });
  });

  it("staff email in a different case signs in", async () => {
    await expect(
      signInAction(IDLE, formWith(staffEmail.toUpperCase(), staffPassword)),
    ).rejects.toThrow("NEXT_REDIRECT:/a");

    const rows = await db.select().from(staffSessions).where(eq(staffSessions.staffUserId, staffId));
    expect(rows).toHaveLength(1);
    await db.delete(staffSessions).where(eq(staffSessions.staffUserId, staffId));
  });

  it("customer sign-in sets last_sign_in_at: null before, recent after, redirects to onboarding when not onboarded", async () => {
    const [before] = await db.select({ lastSignInAt: users.lastSignInAt }).from(users).where(eq(users.id, customerId));
    expect(before.lastSignInAt).toBeNull();

    await expect(
      signInAction(IDLE, formWith((await customerEmail()), customerPassword)),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");

    const [after] = await db.select({ lastSignInAt: users.lastSignInAt }).from(users).where(eq(users.id, customerId));
    expect(after.lastSignInAt).not.toBeNull();
    expect(Date.now() - after.lastSignInAt!.getTime()).toBeLessThan(60_000);

    const { sessions } = await import("@/src/db/schema");
    await db.delete(sessions).where(eq(sessions.userId, customerId));
  });

  it("customer sign-in redirects to /r once onboarded", async () => {
    await expect(
      signInAction(IDLE, formWith((await onboardedCustomerEmail()), customerPassword)),
    ).rejects.toThrow("NEXT_REDIRECT:/r");

    const { sessions } = await import("@/src/db/schema");
    await db.delete(sessions).where(eq(sessions.userId, onboardedCustomerId));
  });

  it("customer wrong password: last_sign_in_at stays null", async () => {
    const [target] = await db.select({ email: users.email }).from(users).where(eq(users.id, wrongPasswordCustomerId));
    const result = await signInAction(IDLE, formWith(target.email, "definitely-wrong"));
    expect(result).toEqual({ ok: false, error: UI.signInWrongPassword });

    const [row] = await db
      .select({ lastSignInAt: users.lastSignInAt })
      .from(users)
      .where(eq(users.id, wrongPasswordCustomerId));
    expect(row.lastSignInAt).toBeNull();
  });

  async function customerEmail(): Promise<string> {
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, customerId));
    return row.email;
  }

  async function onboardedCustomerEmail(): Promise<string> {
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, onboardedCustomerId));
    return row.email;
  }
});
