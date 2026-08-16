import { describe, expect, it } from "vitest";

import {
  blockingLabel,
  blockingRecords,
  documentationStatus,
  isLineItemBlocked,
  isMonthBlocked,
  lineItemReadiness,
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
    documents: [attached("proof"), attached("receipt")],
    ...overrides,
  };
}

describe("documentationStatus (R4.1, R4.2)", () => {
  it("is complete with both a proof and a receipt", () => {
    const status = documentationStatus(expense());
    expect(status).toEqual({ hasProof: true, hasReceipt: true, complete: true, missing: null });
  });

  it("requires proof of payment with no exception", () => {
    const status = documentationStatus(expense({ documents: [attached("receipt")] }));
    expect(status.complete).toBe(false);
    expect(status.missing).toBe("proof");
  });

  it("requires a receipt unless the expense is marked no-receipt", () => {
    expect(documentationStatus(expense({ documents: [attached("proof")] })).missing).toBe("receipt");
    expect(
      documentationStatus(expense({ documents: [attached("proof")], noReceipt: true })).complete,
    ).toBe(true);
  });

  it("still requires proof even when marked no-receipt", () => {
    const status = documentationStatus(expense({ documents: [], noReceipt: true }));
    expect(status.complete).toBe(false);
    expect(status.missing).toBe("proof");
  });

  it("reports 'both' when nothing is attached", () => {
    expect(documentationStatus(expense({ documents: [] })).missing).toBe("both");
  });

  it("ignores supporting documents — they never satisfy the gate", () => {
    const status = documentationStatus(expense({ documents: [attached("supporting")] }));
    expect(status.missing).toBe("both");
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
    expect(pending.missing).toBe("proof");

    const failed = documentationStatus(
      expense({
        documents: [
          { kind: "proof", status: "failed" },
          { kind: "receipt", status: "failed" },
        ],
      }),
    );
    expect(failed.missing).toBe("both");
  });

  it("accepts several proofs, as salary expenses have (D-05)", () => {
    const salary = expense({
      name: "Quincy Smith",
      lineItemName: "Salary",
      documents: [attached("proof"), attached("proof"), attached("receipt")],
    });
    expect(documentationStatus(salary).complete).toBe(true);
  });
});

describe("blocking list wording (R4.4)", () => {
  it("uses the rulebook's exact phrases", () => {
    expect(missingPhrase("proof")).toBe("missing proof of payment");
    expect(missingPhrase("receipt")).toBe("missing receipt/justification");
    expect(missingPhrase("both")).toBe("missing both");
  });

  it("renders the lines the approved packet screen shows", () => {
    expect(blockingLabel(expense(), "proof")).toBe(
      "Stock Media — Promotional & Marketing — missing proof of payment",
    );
    expect(
      blockingLabel(
        expense({ name: "JDS Silkscreen & Embroidery" }),
        "both",
      ),
    ).toBe("JDS Silkscreen & Embroidery — Promotional & Marketing — missing both");
    expect(
      blockingLabel(expense({ name: "Cornelius Webb", lineItemName: "Salary" }), "proof"),
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
        missing: "proof",
        label: "Stock Media — Promotional & Marketing — missing proof of payment",
      },
      {
        expenseId: "c",
        missing: "both",
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
    expect(documentationStatus(justAdded).missing).toBe("both");
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
