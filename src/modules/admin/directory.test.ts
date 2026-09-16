import { describe, expect, it } from "vitest";

import {
  complimentaryState,
  describeAccountEvent,
  filterOrgs,
  summarize,
  type AccountEvent,
  type DirectoryOrg,
} from "./directory";

// Type-level guard (Phase 9 §7 note): `queries.ts`'s row types must stay structurally
// assignable to `directory.ts`'s own re-declared types, or the two silently drift apart.
// `import type` is erased at runtime (isolatedModules), so this never drags `server-only`
// into this unit test.
import type { OrgAccountEventRow, OrgDirectoryRow } from "./queries";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _directoryRowCheck: DirectoryOrg = {} as OrgDirectoryRow;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _accountEventCheck: AccountEvent = {} as OrgAccountEventRow;

describe("complimentaryState (Phase 9 §7 Q6)", () => {
  const today = "2027-01-01";

  it("is 'none' when complimentary is off, even with a date set", () => {
    expect(complimentaryState({ complimentary: false, complimentaryUntil: null }, today)).toBe("none");
    expect(complimentaryState({ complimentary: false, complimentaryUntil: "2099-01-01" }, today)).toBe(
      "none",
    );
  });

  it("is 'active' with no end date", () => {
    expect(complimentaryState({ complimentary: true, complimentaryUntil: null }, today)).toBe("active");
  });

  it("an end date of exactly today is still active (Q6)", () => {
    expect(complimentaryState({ complimentary: true, complimentaryUntil: today }, today)).toBe("active");
  });

  it("an end date of yesterday has ended", () => {
    expect(complimentaryState({ complimentary: true, complimentaryUntil: "2026-12-31" }, today)).toBe(
      "ended",
    );
  });

  it("an end date far in the future is active", () => {
    expect(complimentaryState({ complimentary: true, complimentaryUntil: "2030-06-01" }, today)).toBe(
      "active",
    );
  });

  it("compares safely across a year/month rollover, not lexically within one field", () => {
    // 2026-12-31 < 2027-01-01 as ISO strings, but a naive "same year" or "same month" compare
    // would get this wrong; the plain string comparison the implementation uses is exercised here.
    expect(complimentaryState({ complimentary: true, complimentaryUntil: "2026-12-31" }, "2027-01-01")).toBe(
      "ended",
    );
  });
});

describe("filterOrgs search (Phase 9 §3.9, §6)", () => {
  const rows: DirectoryOrg[] = [
    {
      id: "1",
      name: "Acme Grants",
      plan: "reconciliation",
      subscriptionStatus: "trial",
      complimentary: false,
      complimentaryUntil: null,
      suspendedAt: null,
    },
    {
      id: "2",
      name: "Beacon Nonprofit",
      plan: "reconciliation_ai",
      subscriptionStatus: "active",
      complimentary: false,
      complimentaryUntil: null,
      suspendedAt: null,
    },
  ];
  const today = "2027-01-01";

  it("matches exactly, case-insensitively, with leading/trailing whitespace, and mid-string", () => {
    expect(filterOrgs(rows, { search: "Acme Grants" }, today)).toEqual([rows[0]]);
    expect(filterOrgs(rows, { search: "acme grants" }, today)).toEqual([rows[0]]);
    expect(filterOrgs(rows, { search: "  Acme Grants  " }, today)).toEqual([rows[0]]);
    expect(filterOrgs(rows, { search: "con Non" }, today)).toEqual([rows[1]]);
  });

  it("empty and whitespace-only search match every row", () => {
    expect(filterOrgs(rows, { search: "" }, today)).toEqual(rows);
    expect(filterOrgs(rows, { search: "   " }, today)).toEqual(rows);
    expect(filterOrgs(rows, {}, today)).toEqual(rows);
  });

  it("no match returns an empty array", () => {
    expect(filterOrgs(rows, { search: "nonexistent" }, today)).toEqual([]);
  });

  it("combines search, plan and badge with AND", () => {
    const compRows: DirectoryOrg[] = [
      { ...rows[0], complimentary: true, complimentaryUntil: null },
      { ...rows[1], name: "Acme AI", complimentary: true, complimentaryUntil: null },
    ];
    expect(
      filterOrgs(compRows, { search: "acme", plan: "reconciliation_ai", badge: "complimentary" }, today),
    ).toEqual([compRows[1]]);
    // Search matches both, plan narrows to none.
    expect(filterOrgs(compRows, { search: "acme", plan: "reconciliation" }, today)).toEqual([compRows[0]]);
  });

  it("preserves input order", () => {
    const threeRows = [rows[1], rows[0]];
    expect(filterOrgs(threeRows, {}, today).map((r) => r.id)).toEqual(["2", "1"]);
  });
});

describe("summarize matches filterOrgs for every card (Phase 9 §7 Q5, Q10)", () => {
  const today = "2027-01-01";
  const suspended = new Date("2026-06-01T00:00:00Z");

  const rows: DirectoryOrg[] = [
    { id: "1", name: "Org 1", plan: "reconciliation", subscriptionStatus: "trial", complimentary: false, complimentaryUntil: null, suspendedAt: null },
    { id: "2", name: "Org 2", plan: "reconciliation", subscriptionStatus: "active", complimentary: true, complimentaryUntil: null, suspendedAt: null },
    { id: "3", name: "Org 3", plan: "reconciliation", subscriptionStatus: "past_due", complimentary: true, complimentaryUntil: "2026-12-31", suspendedAt: null },
    { id: "4", name: "Org 4", plan: "reconciliation", subscriptionStatus: "cancelled", complimentary: false, complimentaryUntil: null, suspendedAt: suspended },
    { id: "5", name: "Org 5", plan: "reconciliation_ai", subscriptionStatus: "trial", complimentary: true, complimentaryUntil: "2027-06-01", suspendedAt: null },
    { id: "6", name: "Org 6", plan: "reconciliation_ai", subscriptionStatus: "active", complimentary: false, complimentaryUntil: null, suspendedAt: null },
    { id: "7", name: "Org 7", plan: "reconciliation_ai", subscriptionStatus: "past_due", complimentary: false, complimentaryUntil: null, suspendedAt: suspended },
    { id: "8", name: "Org 8", plan: "reconciliation_ai", subscriptionStatus: "cancelled", complimentary: true, complimentaryUntil: "2027-01-01", suspendedAt: null },
    { id: "9", name: "Org 9", plan: "reconciliation", subscriptionStatus: "active", complimentary: false, complimentaryUntil: "2020-01-01", suspendedAt: null },
    { id: "10", name: "Org 10", plan: "reconciliation_ai", subscriptionStatus: "trial", complimentary: true, complimentaryUntil: null, suspendedAt: suspended },
  ];

  it("every plan and status count equals filterOrgs(rows, thatCard'sFilter).length, and both sum to the row total", () => {
    const summary = summarize(rows, today);

    for (const plan of ["reconciliation", "reconciliation_ai"] as const) {
      expect(summary.plan[plan]).toBe(filterOrgs(rows, { plan }, today).length);
    }
    for (const status of ["trial", "active", "past_due", "cancelled"] as const) {
      expect(summary.status[status]).toBe(filterOrgs(rows, { status }, today).length);
    }

    const planSum = Object.values(summary.plan).reduce((a, b) => a + b, 0);
    const statusSum = Object.values(summary.status).reduce((a, b) => a + b, 0);
    expect(planSum).toBe(rows.length);
    expect(statusSum).toBe(rows.length);
  });

  it("complimentary and suspended counts equal filterOrgs(rows, thatCard'sFilter).length", () => {
    const summary = summarize(rows, today);
    expect(summary.complimentary).toBe(filterOrgs(rows, { badge: "complimentary" }, today).length);
    expect(summary.suspended).toBe(filterOrgs(rows, { badge: "suspended" }, today).length);
  });

  it("Q5: the complimentary card counts an org whose end date has already passed", () => {
    const summary = summarize(rows, today);
    // Org 3's complimentaryUntil (2026-12-31) is before today (2027-01-01) — ended, not none.
    expect(complimentaryState(rows[2], today)).toBe("ended");
    const complimentaryRows = filterOrgs(rows, { badge: "complimentary" }, today);
    expect(complimentaryRows.map((r) => r.id)).toContain("3");
    expect(summary.complimentary).toBe(complimentaryRows.length);
  });

  it("Q10: summarize always counts every row, independent of any table filter", () => {
    // summarize takes only the full row list and today — there is no filter parameter to
    // narrow it, so the same call over the same rows is unaffected by whatever the table
    // happens to be displaying. Prove it by calling it twice, once "as if" a badge filter were
    // active elsewhere in the UI, and confirming the totals are the unfiltered totals.
    const filteredForDisplay = filterOrgs(rows, { badge: "suspended" }, today);
    expect(filteredForDisplay.length).toBeLessThan(rows.length);

    const summary = summarize(rows, today);
    const planSum = Object.values(summary.plan).reduce((a, b) => a + b, 0);
    expect(planSum).toBe(rows.length); // not filteredForDisplay.length
  });
});

describe("describeAccountEvent (Phase 9 §5)", () => {
  const base = {
    before: { plan: "reconciliation" as const, status: "trial" as const, complimentaryUntil: null },
    after: { plan: "reconciliation" as const, status: "trial" as const, complimentaryUntil: null },
    actorName: "Staff Person" as string | null,
    actorEmail: "staff@example.test" as string | null,
  };

  function event(overrides: Partial<AccountEvent>): AccountEvent {
    return { action: "plan_changed", ...base, ...overrides } as AccountEvent;
  }

  it("plan_changed: plan only", () => {
    const e = event({
      before: { ...base.before, plan: "reconciliation" },
      after: { ...base.after, plan: "reconciliation_ai" },
    });
    expect(describeAccountEvent(e)).toBe("Staff Person changed plan from Reconciliation to Reconciliation + AI");
  });

  it("plan_changed: status only", () => {
    const e = event({
      before: { ...base.before, status: "trial" },
      after: { ...base.after, status: "active" },
    });
    expect(describeAccountEvent(e)).toBe("Staff Person changed status from Trial to Active");
  });

  it("plan_changed: both plan and status", () => {
    const e = event({
      before: { ...base.before, plan: "reconciliation", status: "trial" },
      after: { ...base.after, plan: "reconciliation_ai", status: "active" },
    });
    expect(describeAccountEvent(e)).toBe(
      "Staff Person changed plan from Reconciliation to Reconciliation + AI and status from Trial to Active",
    );
  });

  it("complimentary_granted with and without an end date", () => {
    expect(describeAccountEvent(event({ action: "complimentary_granted" }))).toBe(
      "Staff Person gave complimentary access",
    );
    expect(
      describeAccountEvent(
        event({ action: "complimentary_granted", after: { ...base.after, complimentaryUntil: "2027-06-30" } }),
      ),
    ).toBe("Staff Person gave complimentary access until 30 Jun 2027");
  });

  it("complimentary_changed to a date and to no end date", () => {
    expect(
      describeAccountEvent(
        event({ action: "complimentary_changed", after: { ...base.after, complimentaryUntil: "2027-01-15" } }),
      ),
    ).toBe("Staff Person changed complimentary access to end 15 Jan 2027");
    expect(describeAccountEvent(event({ action: "complimentary_changed" }))).toBe(
      "Staff Person changed complimentary access to no end date",
    );
  });

  it("complimentary_removed", () => {
    expect(describeAccountEvent(event({ action: "complimentary_removed" }))).toBe(
      "Staff Person removed complimentary access",
    );
  });

  it("suspended", () => {
    expect(describeAccountEvent(event({ action: "suspended" }))).toBe("Staff Person suspended access");
  });

  it("reinstated", () => {
    expect(describeAccountEvent(event({ action: "reinstated" }))).toBe("Staff Person reinstated access");
  });

  it("actor falls back to email when actorName is null", () => {
    const e = event({ action: "suspended", actorName: null, actorEmail: "person@example.test" });
    expect(describeAccountEvent(e)).toBe("person@example.test suspended access");
  });

  it("actorEmail null (deleted staff account) renders the actor as 'Unknown'", () => {
    const e = event({ action: "suspended", actorName: "Someone", actorEmail: null });
    expect(describeAccountEvent(e)).toBe("Unknown suspended access");
  });
});
