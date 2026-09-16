import { describe, expect, it } from "vitest";

import {
  complimentaryState,
  describeAccountEvent,
  type AccountEvent,
  type DirectoryOrg,
} from "./directory";

// Type-level guard (Phase 9 Â§7 note): `queries.ts`'s row types must stay structurally
// assignable to `directory.ts`'s own re-declared types, or the two silently drift apart.
// `import type` is erased at runtime (isolatedModules), so this never drags `server-only`
// into this unit test.
import type { OrgAccountEventRow, OrgDirectoryRow } from "./queries";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _directoryRowCheck: DirectoryOrg = {} as OrgDirectoryRow;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _accountEventCheck: AccountEvent = {} as OrgAccountEventRow;

describe("complimentaryState (Phase 9 Â§7 Q6)", () => {
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

describe("describeAccountEvent (Phase 9 Â§5)", () => {
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