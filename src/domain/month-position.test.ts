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
  { id: "promo", name: "Promotional", scheduledValueCents: 100_000, openingBilledCents: 10_000, sortOrder: 0 },
  { id: "travel", name: "Travel", scheduledValueCents: 50_000, openingBilledCents: 0, sortOrder: 1 },
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

describe("snapshotDrift (D-68)", () => {
  const submitted = [
    { lineItemName: "Promotional", spentThisMonthCents: 20_000 },
    { lineItemName: "Travel", spentThisMonthCents: 5_000 },
  ];

  it("is silent while the submitted figures still hold", () => {
    const current = monthPositions(allLineItemStats(ITEMS, AMOUNTS, "2026-05"));
    expect(snapshotDrift(submitted, current)).toEqual([]);
  });

  it("reports a category corrected after submission", () => {
    const corrected = [...AMOUNTS, spend("promo", "2026-05", 3_000)];
    const current = monthPositions(allLineItemStats(ITEMS, corrected, "2026-05"));

    const drift = snapshotDrift(submitted, current);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      name: "Promotional",
      submittedThisMonthCents: 20_000,
      currentThisMonthCents: 23_000,
      differenceCents: 3_000,
    });
  });

  it("reports a category that gained its first expense only after submission", () => {
    // No submitted row exists for it at all, which is just as much a divergence.
    const current = monthPositions(allLineItemStats(ITEMS, AMOUNTS, "2026-05"));
    const drift = snapshotDrift([{ lineItemName: "Promotional", spentThisMonthCents: 20_000 }], current);
    expect(drift.map((row) => row.name)).toContain("Travel");
  });

  it("reports an expense removed after submission", () => {
    const current = monthPositions(allLineItemStats(ITEMS, [spend("promo", "2026-05", 20_000)], "2026-05"));
    const drift = snapshotDrift(submitted, current);
    expect(drift.find((row) => row.name === "Travel")?.differenceCents).toBe(-5_000);
  });

  it("does not read a rename as a change in the money", () => {
    // The snapshot stores the name it was submitted under, so renaming the line item later
    // must not make a figure look corrected when nothing about it moved.
    const renamed: LineItemBudget[] = [
      { ...ITEMS[0], name: "Promotional & Marketing" },
      ITEMS[1],
    ];
    const current = monthPositions(allLineItemStats(renamed, AMOUNTS, "2026-05"));
    const drift = snapshotDrift(submitted, current);

    // It reports the old name as gone and the new one as arrived, rather than silently
    // matching them up — a rename is visible, but no figure is claimed to have changed.
    const total = drift.reduce((sum, row) => sum + row.differenceCents, 0);
    expect(total).toBe(0);
  });
});
