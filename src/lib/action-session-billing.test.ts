/**
 * PHASE-15 U-17 (unit): `actionSession()` and `requireAdmin()` refuse an unpaid organization
 * (§4.7), and their `*AnyPlan` counterparts don't. `requireSession`/`getStaffSession`/
 * `getSession` are mocked so every combination of signed-in state × role × paid state is
 * reachable without a database; `UnauthenticatedError` is imported from the real module so
 * `instanceof` still works inside `actionSessionAnyPlan`.
 *
 * `action-session.staff.integration.test.ts` already covers `requireStaff()` against a real
 * database; this file is the billing-refusal half U-17 asks for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UI } from "@/src/domain/strings";
import { SESSION_EXPIRED } from "@/src/lib/action-result";
import type { SessionContext } from "@/src/services/auth/store";

const state = vi.hoisted(() => ({
  session: null as SessionContext | null,
}));

vi.mock("@/src/services/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/services/auth/session")>();
  return {
    ...actual,
    getSession: async () => state.session,
    getStaffSession: async () => null,
    requireSession: async () => {
      if (!state.session) throw new actual.UnauthenticatedError();
      return state.session;
    },
  };
});

import { actionSession, actionSessionAnyPlan, requireAdmin, requireAdminAnyPlan } from "./action-session";

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: "u1",
    orgId: "o1",
    email: "person@example.test",
    role: "admin",
    orgName: "Org",
    plan: "reconciliation",
    docName: "Org",
    activeMonth: "2026-01",
    activeFundingSourceId: null,
    onboarded: true,
    welcomeDismissed: true,
    ...overrides,
  };
}

const paid = { paid: true as const, plan: "reconciliation" as const, reason: "subscription" as const };
const unpaid = { paid: false as const, plan: "reconciliation" as const, reason: "new" as const };

beforeEach(() => {
  state.session = null;
});

describe("actionSessionAnyPlan (no billing check — the base every action goes through)", () => {
  it("signed out -> { expired: SESSION_EXPIRED }, never throws", async () => {
    const result = await actionSessionAnyPlan();
    expect(result).toEqual({ expired: { ok: false, error: SESSION_EXPIRED } });
  });

  it("unpaid session -> returned as-is (the billing check is not here)", async () => {
    const s = session({ entitlement: unpaid });
    state.session = s;
    expect(await actionSessionAnyPlan()).toBe(s);
  });

  it("paid session -> returned as-is", async () => {
    const s = session({ entitlement: paid });
    state.session = s;
    expect(await actionSessionAnyPlan()).toBe(s);
  });
});

describe("actionSession (U-17: refuses an unpaid org, never throws)", () => {
  it("signed out -> { expired: SESSION_EXPIRED }", async () => {
    const result = await actionSession();
    expect(result).toEqual({ expired: { ok: false, error: SESSION_EXPIRED } });
  });

  it("unpaid -> { expired: billingPlanRequired }, reusing the expired key (~70 callers check it)", async () => {
    state.session = session({ entitlement: unpaid });
    const result = await actionSession();
    expect(result).toEqual({ expired: { ok: false, error: UI.billingPlanRequired } });
  });

  it("paid -> returns the session", async () => {
    const s = session({ entitlement: paid });
    state.session = s;
    expect(await actionSession()).toBe(s);
  });

  it("billing off, no entitlement on the session -> treated as paid", async () => {
    vi.stubEnv("BILLING_ENABLED", "false");
    const s = session({ entitlement: undefined });
    state.session = s;
    expect(await actionSession()).toBe(s);
    vi.unstubAllEnvs();
  });
});

describe("requireAdminAnyPlan (no billing check, role check only)", () => {
  it("signed out -> { denied: SESSION_EXPIRED }", async () => {
    const result = await requireAdminAnyPlan();
    expect(result).toEqual({ denied: { ok: false, error: SESSION_EXPIRED } });
  });

  it("unpaid manager -> { denied: FORBIDDEN } (role, not billing, since this is the AnyPlan variant)", async () => {
    state.session = session({ role: "manager", entitlement: unpaid });
    const result = await requireAdminAnyPlan();
    expect(result).toEqual({ denied: { ok: false, error: "You do not have permission to do that." } });
  });

  it("unpaid admin -> returns the session (billing is not checked here)", async () => {
    const s = session({ role: "admin", entitlement: unpaid });
    state.session = s;
    expect(await requireAdminAnyPlan()).toBe(s);
  });
});

describe("requireAdmin (U-17: the plan check runs before the role check)", () => {
  it("unpaid admin -> { denied: billingPlanRequired }", async () => {
    state.session = session({ role: "admin", entitlement: unpaid });
    const result = await requireAdmin();
    expect(result).toEqual({ denied: { ok: false, error: UI.billingPlanRequired } });
  });

  it("unpaid manager -> { denied: billingPlanRequired } too — same message as the unpaid admin, not FORBIDDEN", async () => {
    state.session = session({ role: "manager", entitlement: unpaid });
    const result = await requireAdmin();
    expect(result).toEqual({ denied: { ok: false, error: UI.billingPlanRequired } });
  });

  it("paid manager -> { denied: FORBIDDEN } (now the role check is reached)", async () => {
    state.session = session({ role: "manager", entitlement: paid });
    const result = await requireAdmin();
    expect(result).toEqual({ denied: { ok: false, error: "You do not have permission to do that." } });
  });

  it("paid admin -> returns the session", async () => {
    const s = session({ role: "admin", entitlement: paid });
    state.session = s;
    expect(await requireAdmin()).toBe(s);
  });

  it("signed out -> { denied: SESSION_EXPIRED }, never throws", async () => {
    const result = await requireAdmin();
    expect(result).toEqual({ denied: { ok: false, error: SESSION_EXPIRED } });
  });
});
