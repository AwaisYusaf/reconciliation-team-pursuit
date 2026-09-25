/**
 * PHASE-15 U-17 (unit): `routeSession()` and `routeSessionAnyPlan()` (§4.7).
 *
 * `getSession()` is mocked; no database, no Next request context needed since neither
 * function reads the request itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionContext } from "@/src/services/auth/store";
import { UI } from "@/src/domain/strings";

const state = vi.hoisted(() => ({ session: null as SessionContext | null }));

vi.mock("@/src/services/auth/session", () => ({
  getSession: async () => state.session,
}));

import { routeSession, routeSessionAnyPlan, type RouteSessionDenial } from "./route-session";

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: "u1",
    orgId: "o1",
    email: "admin@example.test",
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

describe("routeSession (U-17)", () => {
  beforeEach(() => {
    state.session = null;
  });

  it("signed out -> null (each route keeps its own 401 wording)", async () => {
    expect(await routeSession("json")).toBeNull();
    expect(await routeSession("text")).toBeNull();
  });

  it("unpaid -> a 403 JSON denial with the billing message", async () => {
    state.session = session({ entitlement: unpaid });
    const result = await routeSession("json");
    expect(result).not.toBeNull();
    expect(result && "denied" in result).toBe(true);
    const { denied } = result as RouteSessionDenial;
    expect(denied.status).toBe(403);
    const body = await denied.json();
    expect(body).toEqual({ ok: false, error: UI.billingPlanRequired });
  });

  it("unpaid -> a 403 text/plain denial with the same message, for a route that streams a download", async () => {
    state.session = session({ entitlement: unpaid });
    const result = await routeSession("text");
    const { denied } = result as RouteSessionDenial;
    expect(denied.status).toBe(403);
    expect(denied.headers.get("Content-Type")).toContain("text/plain");
    const body = await denied.text();
    expect(body).toBe(UI.billingPlanRequired);
  });

  it("paid -> returns the session itself, not a denial", async () => {
    const s = session({ entitlement: paid });
    state.session = s;
    expect(await routeSession("json")).toBe(s);
  });

  it("billing off, no entitlement on the session -> treated as paid", async () => {
    vi.stubEnv("BILLING_ENABLED", "false");
    const s = session({ entitlement: undefined });
    state.session = s;
    expect(await routeSession("json")).toBe(s);
    vi.unstubAllEnvs();
  });
});

describe("routeSessionAnyPlan (allow-listed routes only)", () => {
  beforeEach(() => {
    state.session = null;
  });

  it("signed out -> null", async () => {
    expect(await routeSessionAnyPlan()).toBeNull();
  });

  it("passes an unpaid session through unguarded", async () => {
    const s = session({ entitlement: unpaid });
    state.session = s;
    expect(await routeSessionAnyPlan()).toBe(s);
  });
});
