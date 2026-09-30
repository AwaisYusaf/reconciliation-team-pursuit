/**
 * `signUpAction` returns every field problem in one submit (usability #2): the schema's, the
 * password policy and the confirmation, instead of stopping at the first. Whether the address is
 * already in use is asked only once all of those pass, so a bad form can't probe for accounts.
 * The rate limit still runs before any of it.
 *
 * Same mocks as `emails.integration.test.ts`: `next/headers` is faked so the real session code
 * runs, `redirect()` throws a sentinel. `emailInUse` is the real one, wrapped in a spy so E27 and
 * E28 can prove it is never asked while another field is wrong.
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

vi.mock("@/src/modules/auth/emails", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/modules/auth/emails")>();
  return { ...actual, emailInUse: vi.fn(actual.emailInUse) };
});

config({ path: ".env.local", quiet: true });

import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("signUpAction: every field error at once (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, users } = await import("@/src/db/schema");
  const { IDLE } = await import("@/src/lib/action-result");
  const { UI } = await import("@/src/domain/strings");
  const { clearAll, LIMITS } = await import("@/src/services/rate-limit");
  const { emailInUse } = await import("@/src/modules/auth/emails");
  const { signUpAction } = await import("./actions");

  const inUse = vi.mocked(emailInUse);
  const POLICY = "Password must be at least 12 characters.";
  const MISMATCH = "Passwords don't match.";
  const STRONG = "a-strong-password-12";

  let existingEmail: string;
  let existingOrgId: string;

  beforeAll(async () => {
    await db.delete(organizations).where(like(organizations.name, "Should Not Exist%"));
    const [org] = await db
      .insert(organizations)
      .values({ name: "Signup Validation Existing Org", docName: "SVE", activeMonth: "2026-01" })
      .returning({ id: organizations.id });
    existingOrgId = org.id;
    existingEmail = `signup-existing-${Date.now()}@example.test`;
    await db.insert(users).values({ orgId: org.id, email: existingEmail, passwordHash: "unused", role: "admin" });
  });

  afterAll(async () => {
    if (existingOrgId) await db.delete(organizations).where(eq(organizations.id, existingOrgId));
    // Only this suite's throwaway names; they exist only if a guard under test was neutralised.
    await db.delete(organizations).where(like(organizations.name, "Should Not Exist%"));
    await db.delete(organizations).where(like(organizations.name, "Signup Validation Fresh%"));
  });

  beforeEach(async () => {
    clearAll();
    inUse.mockClear();
    const nextHeaders = (await import("next/headers")) as unknown as {
      __setSessionCookie: (v: string | undefined) => void;
    };
    nextHeaders.__setSessionCookie(undefined);
  });

  function form(values: { orgName?: string; name?: string; email?: string; password?: string; confirmPassword?: string }) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  }

  async function orgsNamed(name: string) {
    return db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, name));
  }

  it("E25: a short password with a different confirmation returns BOTH errors; no org created", async () => {
    const orgName = `Should Not Exist E25 ${Date.now()}`;
    const result = await signUpAction(
      IDLE,
      form({ orgName, name: "Someone", email: `e25-${Date.now()}@example.test`, password: "short", confirmPassword: "shorx" }),
    );

    expect(result).toEqual({
      ok: false,
      error: UI.checkHighlightedFields,
      fieldErrors: { password: POLICY, confirmPassword: MISMATCH },
    });
    expect(await orgsNamed(orgName)).toHaveLength(0);
  });

  it("E26: an empty form names org name, name, email and password; confirm matches the empty password so no mismatch", async () => {
    const result = await signUpAction(
      IDLE,
      form({ orgName: "", name: "", email: "", password: "", confirmPassword: "" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe(UI.checkHighlightedFields);
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["email", "name", "orgName", "password"]);
    expect(result.fieldErrors?.orgName).toBe("Enter your organization's name.");
    expect(result.fieldErrors?.email).toBe("Enter a valid email address.");
    expect(result.fieldErrors?.password).toBe(POLICY);
    expect(inUse).not.toHaveBeenCalled();
  });

  it("E27: an address already in use with a short password gives only the password error; the address is never looked up", async () => {
    const orgName = `Should Not Exist E27 ${Date.now()}`;
    const result = await signUpAction(
      IDLE,
      form({ orgName, name: "Someone", email: existingEmail, password: "short", confirmPassword: "short" }),
    );

    expect(result).toEqual({ ok: false, error: UI.checkHighlightedFields, fieldErrors: { password: POLICY } });
    expect(inUse).not.toHaveBeenCalled();
    expect(await orgsNamed(orgName)).toHaveLength(0);
  });

  it("E27 variant: an address in use with everything else valid still gives the email error (unchanged)", async () => {
    const orgName = `Should Not Exist E27b ${Date.now()}`;
    const result = await signUpAction(
      IDLE,
      form({ orgName, name: "Someone", email: `  ${existingEmail.toUpperCase()} `, password: STRONG, confirmPassword: STRONG }),
    );

    expect(result).toEqual({ ok: false, error: UI.checkHighlightedFields, fieldErrors: { email: UI.duplicateEmail } });
    expect(await orgsNamed(orgName)).toHaveLength(0);
  });

  it("E28: an invalid address and a short password give both errors, and emailInUse is never asked about it", async () => {
    const orgName = `Should Not Exist E28 ${Date.now()}`;
    const result = await signUpAction(
      IDLE,
      form({ orgName, name: "Someone", email: "not-an-email", password: "short", confirmPassword: "short" }),
    );

    expect(result).toEqual({
      ok: false,
      error: UI.checkHighlightedFields,
      fieldErrors: { email: "Enter a valid email address.", password: POLICY },
    });
    expect(inUse).not.toHaveBeenCalled();
    expect(await orgsNamed(orgName)).toHaveLength(0);
  });

  it("E29: a valid sign-up still creates the org and redirects, storing the trimmed email", async () => {
    const orgName = `Signup Validation Fresh ${Date.now()}`;
    const email = `signup-fresh-${Date.now()}@example.test`;

    await expect(
      signUpAction(IDLE, form({ orgName, name: "Someone", email: ` ${email} `, password: STRONG, confirmPassword: STRONG })),
    ).rejects.toThrow(/^NEXT_REDIRECT:/);

    const [org] = await orgsNamed(orgName);
    expect(org).toBeDefined();
    try {
      const [user] = await db.select({ email: users.email }).from(users).where(eq(users.orgId, org.id));
      expect(user.email).toBe(email);
    } finally {
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  }, 30_000);

  it("E30: the rate limit still answers before any validation", async () => {
    for (let i = 0; i < LIMITS.signUp.limit; i++) {
      const spent = await signUpAction(IDLE, form({ password: "short", confirmPassword: "shorx" }));
      expect(spent.ok).toBe(false);
    }
    const limited = await signUpAction(IDLE, form({ password: "short", confirmPassword: "shorx" }));

    expect(limited.ok).toBe(false);
    if (limited.ok) throw new Error("unreachable");
    expect(limited.error).toMatch(/^Too many sign-in attempts\. Try again in \d+ minutes?\.$/);
    expect(limited.fieldErrors).toBeUndefined();
  });
});
