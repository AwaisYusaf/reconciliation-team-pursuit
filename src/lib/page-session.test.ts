/**
 * PHASE-16 U-17 (unit): `pageSession()` and `planPageSession()` (§4.7).
 *
 * `getSession()` is mocked so every branch — signed out, unpaid, paid, and a session built
 * without an `entitlement` field at all (the shape most test fixtures elsewhere use) — is
 * reachable without a database. `next/navigation`'s `redirect()` is replaced with a sentinel
 * that throws, matching the pattern `action-session.staff.integration.test.ts` already uses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionContext } from "@/src/services/auth/store";

const state = vi.hoisted(() => ({ session: null as SessionContext | null }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/src/services/auth/session", () => ({
  getSession: async () => state.session,
}));

import { pageSession, planPageSession } from "./page-session";

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

describe("pageSession (U-17)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    state.session = null;
  });

  it("signed out -> redirects to /login", async () => {
    await expect(pageSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("unpaid admin -> redirects to /r/plan, never returning a session", async () => {
    state.session = session({ role: "admin", entitlement: unpaid });
    await expect(pageSession()).rejects.toThrow("NEXT_REDIRECT:/r/plan");
  });

  it("unpaid manager -> redirects to /r/plan as well (the page shows the manager notice there)", async () => {
    state.session = session({ role: "manager", entitlement: unpaid });
    await expect(pageSession()).rejects.toThrow("NEXT_REDIRECT:/r/plan");
  });

  it("paid -> returns the session, no redirect, and the page's data is reachable", async () => {
    const s = session({ entitlement: paid });
    state.session = s;
    await expect(pageSession()).resolves.toBe(s);
  });

  it("billing off, session built with no entitlement (most fixtures) -> treated as paid", async () => {
    vi.stubEnv("BILLING_ENABLED", "false");
    const s = session({ entitlement: undefined });
    state.session = s;
    await expect(pageSession()).resolves.toBe(s);
  });

  it("billing on, session built with no entitlement -> fails closed, redirects to /r/plan", async () => {
    vi.stubEnv("BILLING_ENABLED", "true");
    state.session = session({ entitlement: undefined });
    await expect(pageSession()).rejects.toThrow("NEXT_REDIRECT:/r/plan");
  });
});

describe("planPageSession (U-17: never loops)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    state.session = null;
  });

  it("signed out -> redirects to /login", async () => {
    await expect(planPageSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("paid and onboarded -> redirected on into the app at /r, not back here", async () => {
    state.session = session({ onboarded: true, entitlement: paid });
    await expect(planPageSession()).rejects.toThrow("NEXT_REDIRECT:/r");
  });

  it("paid but not onboarded -> redirected to onboarding, not back here", async () => {
    state.session = session({ onboarded: false, entitlement: paid });
    await expect(planPageSession()).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");
  });

  it("unpaid -> returns the session so the chooser can render (no redirect loop)", async () => {
    const s = session({ entitlement: unpaid });
    state.session = s;
    await expect(planPageSession()).resolves.toBe(s);
  });

  it("unpaid but somehow not onboarded either -> still returns the session, never onboarding (no loop)", async () => {
    const s = session({ onboarded: false, entitlement: unpaid });
    state.session = s;
    await expect(planPageSession()).resolves.toBe(s);
  });
});
