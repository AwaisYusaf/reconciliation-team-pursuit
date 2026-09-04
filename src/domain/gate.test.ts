import { describe, expect, it } from "vitest";

import {
  DOCUMENTATION_FILTERS,
  blockingLabel,
  blockingRecords,
  documentationStatus,
  isLineItemBlocked,
  isMonthBlocked,
  lineItemReadiness,
  matchesDocumentationFilter,
  missingPhrase,
  type GateExpense,
} from "./gate";

const attached = (kind: "proof" | "receipt" | "supporting") =>
  ({ kind, status: "attached" }) as const;

function expense(overrides: Partial<GateExpense> = {}): GateExpense {
  return {
    id: "e1",
    name: "Stock Media",
    lineItemName: "Promotional & Marketing",
    noReceipt: false,
    hasNarrative: true,
    documents: [attached("proof"), attached("receipt")],
    ...overrides,
  };
}

describe("documentationStatus (R4.1, R4.2, R4.7)", () => {
  it("is complete with proof, a receipt, and a narrative", () => {
    const status = documentationStatus(expense());
    expect(status).toEqual({
      hasProof: true,
      hasReceipt: true,
      hasNarrative: true,
      complete: true,
      missing: null,
    });
  });

  it("requires proof of payment with no exception", () => {
    const status = documentationStatus(expense({ documents: [attached("receipt")] }));
    expect(status.complete).toBe(false);
    expect(status.missing).toEqual(["proof"]);
  });

  it("requires a receipt unless the expense is marked no-receipt", () => {
    expect(documentationStatus(expense({ documents: [attached("proof")] })).missing).toEqual([
      "receipt",
    ]);
    expect(
      documentationStatus(expense({ documents: [attached("proof")], noReceipt: true })).complete,
    ).toBe(true);
  });

  it("still requires proof even when marked no-receipt", () => {
    const status = documentationStatus(expense({ documents: [], noReceipt: true }));
    expect(status.complete).toBe(false);
    expect(status.missing).toEqual(["proof"]);
  });

  it("reports both proof and receipt missing when nothing is attached", () => {
    expect(documentationStatus(expense({ documents: [] })).missing).toEqual(["proof", "receipt"]);
  });

  it("ignores supporting documents — they never satisfy the gate", () => {
    const status = documentationStatus(expense({ documents: [attached("supporting")] }));
    expect(status.missing).toEqual(["proof", "receipt"]);
  });

  it("counts only attached uploads, never pending or failed ones (R4.6)", () => {
    const pending = documentationStatus(
      expense({
        documents: [
          { kind: "proof", status: "pending" },
          { kind: "receipt", status: "attached" },
        ],
      }),
    );
    expect(pending.missing).toEqual(["proof"]);

    const failed = documentationStatus(
      expense({
        documents: [
          { kind: "proof", status: "failed" },
          { kind: "receipt", status: "failed" },
        ],
      }),
    );
    expect(failed.missing).toEqual(["proof", "receipt"]);
  });

  it("accepts several proofs, as salary expenses have (D-05)", () => {
    const salary = expense({
      name: "Quincy Smith",
      lineItemName: "Salary",
      documents: [attached("proof"), attached("proof"), attached("receipt")],
    });
    expect(documentationStatus(salary).complete).toBe(true);
  });

  it("requires a narrative (R4.7): an otherwise-complete expense with none is incomplete", () => {
    const status = documentationStatus(expense({ hasNarrative: false }));
    expect(status.complete).toBe(false);
    expect(status.missing).toEqual(["narrative"]);
  });

  it("can be missing narrative alongside proof and/or receipt", () => {
    expect(
      documentationStatus(expense({ hasNarrative: false, documents: [attached("receipt")] }))
        .missing,
    ).toEqual(["proof", "narrative"]);
    expect(
      documentationStatus(expense({ hasNarrative: false, documents: [attached("proof")] }))
        .missing,
    ).toEqual(["receipt", "narrative"]);
    expect(documentationStatus(expense({ hasNarrative: false, documents: [] })).missing).toEqual([
      "proof",
      "receipt",
      "narrative",
    ]);
  });
});

describe("blocking list wording (R4.4)", () => {
  it("uses the rulebook's exact phrases for a single missing item", () => {
    expect(missingPhrase(["proof"])).toBe("missing proof of payment");
    expect(missingPhrase(["receipt"])).toBe("missing receipt/justification");
    expect(missingPhrase(["narrative"])).toBe("missing narrative");
  });

  it("keeps the legacy 'missing both' wording verbatim for proof + receipt", () => {
    expect(missingPhrase(["proof", "receipt"])).toBe("missing both");
  });

  it("joins any other combination in plain English, Oxford comma on three", () => {
    expect(missingPhrase(["proof", "narrative"])).toBe("missing proof of payment and narrative");
    expect(missingPhrase(["receipt", "narrative"])).toBe(
      "missing receipt/justification and narrative",
    );
    expect(missingPhrase(["proof", "receipt", "narrative"])).toBe(
      "missing proof of payment, receipt/justification, and narrative",
    );
  });

  it("renders the lines the approved packet screen shows", () => {
    expect(blockingLabel(expense(), ["proof"])).toBe(
      "Stock Media — Promotional & Marketing — missing proof of payment",
    );
    expect(
      blockingLabel(expense({ name: "JDS Silkscreen & Embroidery" }), ["proof", "receipt"]),
    ).toBe("JDS Silkscreen & Embroidery — Promotional & Marketing — missing both");
    expect(
      blockingLabel(expense({ name: "Cornelius Webb", lineItemName: "Salary" }), ["proof"]),
    ).toBe("Cornelius Webb — Salary — missing proof of payment");
  });

  it("lists only incomplete records, preserving order", () => {
    const month = [
      expense({ id: "a", name: "Quincy Smith", lineItemName: "Salary" }),
      expense({ id: "b", name: "Stock Media", documents: [attached("receipt")] }),
      expense({ id: "c", name: "JDS Silkscreen & Embroidery", documents: [] }),
    ];

    expect(blockingRecords(month)).toEqual([
      {
        expenseId: "b",
        missing: ["proof"],
        label: "Stock Media — Promotional & Marketing — missing proof of payment",
      },
      {
        expenseId: "c",
        missing: ["proof", "receipt"],
        label: "JDS Silkscreen & Embroidery — Promotional & Marketing — missing both",
      },
    ]);
  });
});

describe("gate scope (R4.3)", () => {
  const complete = expense({ id: "ok", lineItemName: "Salary" });
  const incomplete = expense({ id: "bad", lineItemName: "Promotional & Marketing", documents: [] });

  it("blocks the month when any record is incomplete", () => {
    expect(isMonthBlocked([complete])).toBe(false);
    expect(isMonthBlocked([complete, incomplete])).toBe(true);
    expect(isMonthBlocked([])).toBe(false);
  });

  it("blocks only the line item that has the gap", () => {
    const month = [complete, incomplete];
    expect(isLineItemBlocked(month, "Promotional & Marketing")).toBe(true);
    expect(isLineItemBlocked(month, "Salary")).toBe(false);
  });

  it("recurring one-click adds arrive incomplete, which is the reminder (R4.5)", () => {
    const justAdded = expense({ id: "recurring", name: "Cornelius Webb", documents: [] });
    expect(documentationStatus(justAdded).missing).toEqual(["proof", "receipt"]);
    expect(isMonthBlocked([justAdded])).toBe(true);
  });
});

describe("lineItemReadiness (m06 table)", () => {
  it("counts records and reports completeness", () => {
    const month = [
      expense({ id: "1", lineItemName: "Salary" }),
      expense({ id: "2", lineItemName: "Salary" }),
      expense({ id: "3", lineItemName: "Salary", documents: [] }),
    ];
    expect(lineItemReadiness(month, "Salary")).toEqual({
      recordCount: 3,
      complete: false,
      isEmpty: false,
    });
  });

  it("marks an empty line item as empty rather than complete", () => {
    expect(lineItemReadiness([], "Salary")).toEqual({
      recordCount: 0,
      complete: false,
      isEmpty: true,
    });
  });

  it("is complete when every record of that line item is documented", () => {
    const month = [expense({ id: "1", lineItemName: "Salary" })];
    expect(lineItemReadiness(month, "Salary").complete).toBe(true);
  });
});

describe("matchesDocumentationFilter", () => {
  const complete = { missing: null } as const;
  const noProof = { missing: ["proof"] } as const;
  const noReceipt = { missing: ["receipt"] } as const;
  const noNarrative = { missing: ["narrative"] } as const;
  const neither = { missing: ["proof", "receipt"] } as const;
  const allThree = { missing: ["proof", "receipt", "narrative"] } as const;

  it("keeps everything under the default", () => {
    for (const row of [complete, noProof, noReceipt, noNarrative, neither, allThree]) {
      expect(matchesDocumentationFilter(row, "All records")).toBe(true);
    }
  });

  it("finds every incomplete record, and only those", () => {
    expect(matchesDocumentationFilter(complete, "Missing documentation")).toBe(false);
    for (const row of [noProof, noReceipt, noNarrative, neither, allThree]) {
      expect(matchesDocumentationFilter(row, "Missing documentation")).toBe(true);
    }
  });

  it("counts a record missing several things as missing each of them", () => {
    // The case a hand-rolled `missing === "proof"` would get wrong: the worst records would
    // vanish from the filters most likely to be used to hunt them down.
    expect(matchesDocumentationFilter(neither, "Missing proof of payment")).toBe(true);
    expect(matchesDocumentationFilter(neither, "Missing receipt/justification")).toBe(true);
    expect(matchesDocumentationFilter(allThree, "Missing proof of payment")).toBe(true);
    expect(matchesDocumentationFilter(allThree, "Missing receipt/justification")).toBe(true);
    expect(matchesDocumentationFilter(allThree, "Missing narrative")).toBe(true);
  });

  it("separates the three specific filters", () => {
    expect(matchesDocumentationFilter(noProof, "Missing proof of payment")).toBe(true);
    expect(matchesDocumentationFilter(noProof, "Missing receipt/justification")).toBe(false);
    expect(matchesDocumentationFilter(noProof, "Missing narrative")).toBe(false);
    expect(matchesDocumentationFilter(noReceipt, "Missing receipt/justification")).toBe(true);
    expect(matchesDocumentationFilter(noReceipt, "Missing proof of payment")).toBe(false);
    expect(matchesDocumentationFilter(noNarrative, "Missing narrative")).toBe(true);
    expect(matchesDocumentationFilter(noNarrative, "Missing proof of payment")).toBe(false);
    expect(matchesDocumentationFilter(noNarrative, "Missing receipt/justification")).toBe(false);
  });

  it("never shows a complete record under any missing filter", () => {
    for (const filter of DOCUMENTATION_FILTERS.filter((f) => f !== "All records")) {
      expect(matchesDocumentationFilter(complete, filter)).toBe(false);
    }
  });

  it("agrees with the gate: a row matches 'Missing documentation' exactly when incomplete", () => {
    // The filter and the packet's blocking list must be one judgement (R4.3).
    const expenses: GateExpense[] = [
      { id: "a", name: "A", lineItemName: "Salary", noReceipt: false, hasNarrative: true, documents: [] },
      {
        id: "b",
        name: "B",
        lineItemName: "Salary",
        noReceipt: true,
        hasNarrative: false,
        documents: [{ kind: "proof", status: "attached" }],
      },
    ];
    for (const expense of expenses) {
      const status = documentationStatus(expense);
      expect(matchesDocumentationFilter(status, "Missing documentation")).toBe(!status.complete);
    }
  });
});
