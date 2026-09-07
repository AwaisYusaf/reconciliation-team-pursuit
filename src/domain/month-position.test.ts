/**
 * The month view, the grant view, and the divergence between what was submitted and what the
 * data now says (R3.8, D-68).
 *
 * The client's complaint was that these were mixed: "when we move into June, June's activity
 * should begin as its own reporting period instead of making May's monthly numbers appear to
 * roll directly into June."
 */
import { describe, expect, it } from "vitest";

import {
  allLineItemStats,
  grantPosition,
  monthPositions,
  snapshotDrift,
  type ExpenseAmount,
  type LineItemBudget,
} from "./budget-math";

const ITEMS: LineItemBudget[] = [
  { id: "promo", name: "Promotional", scheduledValueCents: 100_000, performanceCents: 0, openingBilledCents: 10_000, sortOrder: 0 },
  { id: "travel", name: "Travel", scheduledValueCents: 50_000, performanceCents: 0, openingBilledCents: 0, sortOrder: 1 },
];

function spend(lineItemId: string, month: string, cents: number): ExpenseAmount {
  return {
    lineItemId,
    month,
    subtotalCents: cents,
    taxCents: 0,
    feesCents: 0,
    taxReimbursable: false,
    feesReimbursable: true,
  };
}

const AMOUNTS: ExpenseAmount[] = [
  spend("promo", "2026-04", 15_000),
  spend("promo", "2026-05", 20_000),
  spend("travel", "2026-05", 5_000),
];

describe("monthPositions (R3.8)", () => {
  it("separates what came before the month from the month itself", () => {
    const may = monthPositions(allLineItemStats(ITEMS, AMOUNTS, "2026-05"));
    const promo = may.find((row) => row.name === "Promotional")!;

    // Budget available when May opened: 100k scheduled less 10k opening balance and 15k
    // spent in April. May's own spend is not in it.
    expect(promo.openingCents).toBe(75_000);
    expect(promo.thisMonthCents).toBe(20_000);
    expect(promo.closingCents).toBe(55_000);
  });

  it("starts June as its own period rather than rolling May's activity into it", () => {
    // The exact confusion the client described.
    const may = monthPositions(allLineItemStats(ITEMS, AMOUNTS, "2026-05"));
    const june = monthPositions(allLineItemStats(ITEMS, AMOUNTS, "2026-06"));

    const mayPromo = may.find((row) => row.name === "Promotional")!;
    const junePromo = june.find((row) => row.name === "Promotional")!;

    expect(mayPromo.thisMonthCents).toBe(20_000);
    expect(junePromo.thisMonthCents).toBe(0);
    // June opens exactly where May closed — the chain the client wants visible.
    expect(junePromo.openingCents).toBe(mayPromo.closingCents);
  });

  it("reconciles by subtraction: opening − this month = closing", () => {
    // The property that makes the three figures readable as a statement rather than three
    // unrelated numbers.
    for (const row of monthPositions(allLineItemStats(ITEMS, AMOUNTS, "2026-05"))) {
      expect(row.openingCents - row.thisMonthCents).toBe(row.closingCents);
    }
  });
});

describe("grantPosition (R3.8)", () => {
  it("is cumulative and carries no month in it", () => {
    const grant = grantPosition(allLineItemStats(ITEMS, AMOUNTS, "2026-05"));
    expect(grant.approvedCents).toBe(150_000);
    expect(grant.spentToDateCents).toBe(50_000); // 10k opening + 15k April + 20k + 5k May
    expect(grant.remainingCents).toBe(100_000);
  });

  it("does not divide by zero when nothing is budgeted (R3.5)", () => {
    expect(grantPosition([]).percentComplete).toBe(0);
  });
});

describe("snapshotDrift (D-68, D-72)", () => {
  /** What the month was submitted as, in the shape the snapshot stores. */
  function submittedAs(overrides: Partial<{ promo: number; travel: number }> = {}) {
    const may = monthPositions(allLineItemStats(ITEMS, AMOUNTS, "2026-05"));
    return may.map((row) => ({
      lineItemId: row.lineItemId,
      lineItemName: row.name,
      openingCents: row.openingCents,
      spentThisMonthCents:
        overrides[row.lineItemId as "promo" | "travel"] ?? row.thisMonthCents,
      closingCents: row.closingCents,
    }));
  }

  const current = () => monthPositions(allLineItemStats(ITEMS, AMOUNTS, "2026-05"));

  it("is silent while the submitted figures still hold", () => {
    expect(snapshotDrift(submittedAs(), current())).toEqual([]);
  });

  it("reports a category corrected after submission", () => {
    const corrected = [...AMOUNTS, spend("promo", "2026-05", 3_000)];
    const drift = snapshotDrift(
      submittedAs(),
      monthPositions(allLineItemStats(ITEMS, corrected, "2026-05")),
    );

    const promo = drift.find((row) => row.name === "Promotional")!;
    const spent = promo.changes.find((c) => c.field === "spent")!;
    expect(spent.submittedCents).toBe(20_000);
    expect(spent.currentCents).toBe(23_000);
    expect(spent.differenceCents).toBe(3_000);
    // The closing balance moved with it, and is reported too.
    expect(promo.changes.some((c) => c.field === "closing")).toBe(true);
  });

  it("catches a budget change that never touches the month's own spend (D-72)", () => {
    // The gap that let a submitted month's closing balance drift in silence: editing a line
    // item's scheduled value or opening balance moves opening and closing while `spent`
    // stays exactly as submitted.
    const rebudgeted: LineItemBudget[] = [
      { ...ITEMS[0], scheduledValueCents: 90_000 },
      ITEMS[1],
    ];
    const drift = snapshotDrift(
      submittedAs(),
      monthPositions(allLineItemStats(rebudgeted, AMOUNTS, "2026-05")),
    );

    const promo = drift.find((row) => row.name === "Promotional")!;
    expect(promo.changes.map((c) => c.field).sort()).toEqual(["closing", "opening"]);
    expect(promo.changes.every((c) => c.differenceCents === -10_000)).toBe(true);
    // Spend is untouched, so it must not be reported as having moved.
    expect(promo.changes.some((c) => c.field === "spent")).toBe(false);
  });

  it("does not report a rename as movement in the money (D-72)", () => {
    // Matched on the id captured at submission. Matching by name alone invented two
    // movements: the old name dropping to zero and the new one appearing from nowhere.
    const renamed: LineItemBudget[] = [
      { ...ITEMS[0], name: "Promotional & Marketing" },
      ITEMS[1],
    ];
    expect(
      snapshotDrift(submittedAs(), monthPositions(allLineItemStats(renamed, AMOUNTS, "2026-05"))),
    ).toEqual([]);
  });

  it("reports a category that gained its first expense only after submission", () => {
    const before = submittedAs().filter((row) => row.lineItemName === "Promotional");
    const drift = snapshotDrift(before, current());
    expect(drift.map((row) => row.name)).toContain("Travel");
  });

  it("reports an expense removed after submission", () => {
    const drift = snapshotDrift(
      submittedAs(),
      monthPositions(allLineItemStats(ITEMS, [spend("promo", "2026-05", 20_000)], "2026-05")),
    );
    const travel = drift.find((row) => row.name === "Travel")!;
    expect(travel.changes.find((c) => c.field === "spent")!.differenceCents).toBe(-5_000);
  });

  it("still names a deleted line item by the name it was submitted under", () => {
    // Its id no longer resolves, so the fallback keeps the row findable in the packet the
    // funder holds.
    const drift = snapshotDrift(submittedAs(), [current()[0]]);
    expect(drift.map((row) => row.name)).toContain("Travel");
  });
});
