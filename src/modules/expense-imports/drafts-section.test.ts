/**
 * Structural wiring + fixture-driven logic checks for the "Waiting for review" drafts section
 * (Phase 14 final phase). This repo runs no jsdom/component-rendering tests (`vitest.config.mts`:
 * `environment: "node"`), so component wiring is proven by reading the source, the way
 * `src/modules/monthly-summary/screen.test.ts` and `src/modules/tours/packet-tour.test.ts` do.
 *
 * `draftNeeds`'s own text-per-missing-field cases (missing line item / narrative / both) are
 * already fully covered by src/domain/draft-rules.test.ts — not duplicated here. What this file
 * adds is that the section actually *uses* that function to drive its rendering and its gates.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { draftIsReady, type DraftReadiness } from "@/src/domain/draft-rules";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function read(relPath: string): string {
  return readFileSync(`${repoRoot}${relPath}`, "utf8");
}

const SECTION = "app/r/expenses/drafts-section.tsx";
const PAGE = "app/r/expenses/page.tsx";

describe("DraftsSection wiring", () => {
  const source = read(SECTION);

  it("returns null before rendering anything when there are no drafts", () => {
    // Must be the very first thing the component does, before readyCount/JSX are built off an
    // empty (or absent) array.
    expect(source).toMatch(/if \(rows\.length === 0\) return null;/);
  });

  it("drives 'Still needs' from draftNeeds, joined for the row, not a hand-rolled message", () => {
    expect(source).toContain("draftNeeds(row).join(");
  });

  it("gates the per-row Approve button on draftIsReady(row), not e.g. draft.status", () => {
    const readyLine = source.match(/const ready = draftIsReady\(row\);/);
    expect(readyLine).not.toBeNull();
    // The button itself is only rendered `{ready && (...)}`.
    expect(source).toMatch(/\{ready && \(/);
  });

  it("computes 'Approve all ready' count as rows.filter(draftIsReady).length, not e.g. rows.length", () => {
    expect(source).toContain("rows.filter(draftIsReady).length");
  });

  it("disables 'Approve all ready' when there is nothing ready (readyCount === 0)", () => {
    expect(source).toMatch(/disabled=\{pending \|\| readyCount === 0\}/);
  });

  it("discard flow: discardDraftAction, then a toastWithAction whose action is undoDiscardAction", () => {
    const discardCallIdx = source.indexOf("await discardDraftAction(row.id)");
    const toastIdx = source.indexOf("toastWithAction(", discardCallIdx);
    const undoCallIdx = source.indexOf("await undoDiscardAction(discarded)", toastIdx);
    expect(discardCallIdx).toBeGreaterThan(-1);
    expect(toastIdx).toBeGreaterThan(discardCallIdx);
    expect(undoCallIdx).toBeGreaterThan(toastIdx);
  });

  it("bails out of the discard flow on failure without ever showing the undo toast", () => {
    const discardCallIdx = source.indexOf("await discardDraftAction(row.id)");
    const guardIdx = source.indexOf("if (!result.ok)", discardCallIdx);
    const returnIdx = source.indexOf("return;", guardIdx);
    const toastIdx = source.indexOf("toastWithAction(", discardCallIdx);
    expect(guardIdx).toBeGreaterThan(discardCallIdx);
    expect(returnIdx).toBeGreaterThan(guardIdx);
    expect(returnIdx).toBeLessThan(toastIdx);
  });
});

describe("'Approve all ready' count logic (fixture-driven, over draftIsReady itself)", () => {
  function row(overrides: Partial<DraftReadiness> = {}): DraftReadiness {
    return {
      name: "Vendor",
      lineItemId: "11111111-1111-7111-8111-111111111111",
      paymentSource: "Operating account",
      date: "2026-03-14",
      narrative: "A narrative.",
      ...overrides,
    };
  }

  it("counts zero when every draft is incomplete", () => {
    const rows = [row({ lineItemId: null }), row({ narrative: null })];
    expect(rows.filter(draftIsReady).length).toBe(0);
  });

  it("counts only the ready ones out of a mixed set, not the total row count", () => {
    const rows = [
      row(), // ready
      row({ lineItemId: null }), // not ready
      row(), // ready
      row({ narrative: "   " }), // not ready
      row(), // ready
    ];
    const readyCount = rows.filter(draftIsReady).length;
    expect(readyCount).toBe(3);
    expect(readyCount).not.toBe(rows.length);
  });

  it("counts every draft when every draft is ready", () => {
    const rows = [row(), row(), row()];
    expect(rows.filter(draftIsReady).length).toBe(rows.length);
  });

  it("counts zero for an empty fixture (the section itself never renders this case — rows.length === 0 short-circuits first)", () => {
    expect(([] as DraftReadiness[]).filter(draftIsReady).length).toBe(0);
  });
});

describe("Expenses page: rows/labels/presentSourceIds derive from `expenses` only", () => {
  const source = read(PAGE);

  it("rows (the ExpensesTable input) maps expenses.map, not drafts anywhere near it", () => {
    expect(source).toContain("const rows: ExpenseRow[] = expenses.map((expense) => {");
  });

  it("payment source labels are built from paySources and rows (expenses), not draftRows", () => {
    const line = source.match(/const labels = \[.*\];/);
    expect(line).not.toBeNull();
    expect(line![0]).not.toContain("draft");
  });

  it("presentSourceIds is built from expenses, not drafts or draftRows", () => {
    expect(source).toContain(
      "const presentSourceIds = new Set(expenses.map((expense) => expense.fundingSourceId));",
    );
  });

  it("draftRows is only ever passed as the rows prop of <DraftsSection>, never to <ExpensesTable>", () => {
    const sectionCallIdx = source.indexOf("<DraftsSection");
    const sectionCloseIdx = source.indexOf("/>", sectionCallIdx);
    const sectionProps = source.slice(sectionCallIdx, sectionCloseIdx);
    expect(sectionProps).toContain("rows={draftRows}");

    const tableCallIdx = source.indexOf("<ExpensesTable");
    const tableCloseIdx = source.indexOf("/>", tableCallIdx);
    const tableProps = source.slice(tableCallIdx, tableCloseIdx);
    expect(tableProps).not.toContain("draft");
  });
});

describe("Audit diff: 'Created from an invoice' is not a FIELDS row", () => {
  const source = read("src/components/audit/audit-diff.tsx");

  it("fromInvoice is read via its own helper, never added to the fixed FIELDS list", () => {
    const fieldsStart = source.indexOf("const FIELDS");
    const fieldsEnd = source.indexOf("];", fieldsStart);
    expect(fieldsStart).toBeGreaterThan(-1);
    const fieldsBlock = source.slice(fieldsStart, fieldsEnd);
    expect(fieldsBlock).not.toContain("fromInvoice");
    // Sanity: the block really is the FIELDS array (a handful of real labels), not an empty slice.
    expect(fieldsBlock).toContain('label: "Name"');
  });

  it("renders the invoice line from the fromInvoice() helper, not by reading the flag inline", () => {
    expect(source).toMatch(/\{fromInvoice\(after\) && /);
    expect(source).toMatch(/\{fromInvoice\(before \?\? after\) && /);
  });
});
