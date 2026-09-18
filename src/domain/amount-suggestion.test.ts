/**
 * Pure aggregation for reading amounts from receipts/proofs (Phase 10 §3.5 table, Appendix A).
 */
import { describe, expect, it } from "vitest";

import {
  aggregateAmountSuggestion,
  fileSetSignature,
  nextKeysToRead,
  panelVisible,
  type ReadableFile,
} from "./amount-suggestion";

function found(subtotalCents: number, taxCents: number, feesCents: number, totalCents: number) {
  return { status: "found" as const, amounts: { subtotalCents, taxCents, feesCents, totalCents } };
}
const none = { status: "none" as const };
const pending = { status: "pending" as const };

function receipt(key: string, name: string, result: ReadableFile["result"]): ReadableFile {
  return { key, name, kind: "receipt", result };
}
function proof(key: string, name: string, result: ReadableFile["result"]): ReadableFile {
  return { key, name, kind: "proof", result };
}

describe("aggregateAmountSuggestion — §3.5 table", () => {
  it("no files at all → hidden", () => {
    expect(aggregateAmountSuggestion([], false)).toEqual({ state: "hidden" });
  });

  it("every file none → nothing", () => {
    const files = [receipt("r1", "a.pdf", none), proof("p1", "b.png", none)];
    expect(aggregateAmountSuggestion(files, false)).toEqual({ state: "nothing" });
  });

  it("any pending → reading with correct pendingCount, even when others are done (no partial totals)", () => {
    const files = [
      receipt("r1", "a.pdf", found(10000, 0, 0, 10000)),
      receipt("r2", "b.pdf", pending),
      proof("p1", "c.png", pending),
    ];
    const result = aggregateAmountSuggestion(files, false);
    expect(result).toEqual({ state: "reading", pendingCount: 2 });
  });

  it("receipts found, no proofs → proofCheck null, receipt lines only", () => {
    const files = [receipt("r1", "a.pdf", found(11000, 660, 340, 12000))];
    const result = aggregateAmountSuggestion(files, false);
    expect(result.state).toBe("done");
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.proofCheck).toBeNull();
    expect(result.subtotalCents).toBe(11000);
    expect(result.totalCents).toBe(12000);
    expect(result.lines).toEqual([
      {
        key: "r1",
        name: "a.pdf",
        kind: "receipt",
        outcome: "found",
        amounts: { subtotalCents: 11000, taxCents: 660, feesCents: 340, totalCents: 12000 },
        partsMismatch: false,
      },
    ]);
    expect(result.someMissing).toBe(false);
  });

  it("proofs found, no receipts uploaded → totals from proofs, never 'matches'", () => {
    const files = [proof("p1", "bank.png", found(16500, 0, 0, 16500))];
    const result = aggregateAmountSuggestion(files, false);
    expect(result.state).toBe("done");
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.proofCheck).toBeNull();
    expect(result.totalCents).toBe(16500);
    expect(result.lines[0]).toMatchObject({ kind: "proof", outcome: "found", matches: false });
  });

  it("Appendix A example: two receipts sum to $165.00, matching proof shows ✓ matches", () => {
    // $110.00 + $6.60 + $3.40 = $120.00 ; $40.00 + $2.40 + $2.60 = $45.00
    const files = [
      receipt("r1", "Staples invoice 0412.pdf", found(11000, 660, 340, 12000)),
      receipt("r2", "Staples invoice 0418.jpg", found(4000, 240, 260, 4500)),
      proof("p1", "Bank transaction.png", found(16500, 0, 0, 16500)),
    ];
    const result = aggregateAmountSuggestion(files, false);
    expect(result.state).toBe("done");
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.subtotalCents).toBe(15000); // $150.00
    expect(result.taxCents).toBe(900); // $9.00
    expect(result.feesCents).toBe(600); // $6.00
    expect(result.totalCents).toBe(16500); // $165.00
    expect(result.proofCheck).toEqual({ receiptsCents: 16500, proofsCents: 16500, matches: true });
    const proofLine = result.lines.find((l) => l.kind === "proof")!;
    expect(proofLine).toMatchObject({ outcome: "found", matches: true });
  });

  it("Appendix A example: proof differs ($170.00) → matches false, no lines say matches", () => {
    const files = [
      receipt("r1", "Staples invoice 0412.pdf", found(11000, 660, 340, 12000)),
      receipt("r2", "Staples invoice 0418.jpg", found(4000, 240, 260, 4500)),
      proof("p1", "Bank transaction.png", found(17000, 0, 0, 17000)),
    ];
    const result = aggregateAmountSuggestion(files, false);
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.proofCheck).toEqual({ receiptsCents: 16500, proofsCents: 17000, matches: false });
    const proofLine = result.lines.find((l) => l.kind === "proof")!;
    expect(proofLine).toMatchObject({ outcome: "found", matches: false });
  });

  it("noReceipt true drops receipt files entirely, even pending ones, and sums proofs only", () => {
    const files = [
      receipt("r1", "a.pdf", found(10000, 0, 0, 10000)),
      receipt("r2", "b.pdf", pending), // must be ignored — otherwise state would be "reading"
      proof("p1", "c.png", found(5000, 0, 0, 5000)),
    ];
    const result = aggregateAmountSuggestion(files, true);
    expect(result.state).toBe("done");
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.totalCents).toBe(5000);
    expect(result.lines.every((l) => l.kind === "proof")).toBe(true);
    expect(result.proofCheck).toBeNull();
  });

  it("receipts all none, proofs found → totals from proofs, receipt lines show none, proofCheck null (same as proofs-only)", () => {
    const files = [receipt("r1", "a.pdf", none), proof("p1", "b.png", found(5000, 0, 0, 5000))];
    const result = aggregateAmountSuggestion(files, false);
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.totalCents).toBe(5000);
    expect(result.proofCheck).toBeNull();
    expect(result.lines.find((l) => l.kind === "receipt")).toEqual({
      key: "r1",
      name: "a.pdf",
      kind: "receipt",
      outcome: "none",
    });
    expect(result.someMissing).toBe(true);
  });

  it("some found, some none → someMissing true, totals only from the found ones", () => {
    const files = [
      receipt("r1", "a.pdf", found(10000, 0, 0, 10000)),
      receipt("r2", "b.pdf", none),
    ];
    const result = aggregateAmountSuggestion(files, false);
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.someMissing).toBe(true);
    expect(result.totalCents).toBe(10000);
  });

  it("receipt parts ≠ total → partsMismatch true, figures reported as read (not corrected)", () => {
    const files = [receipt("r1", "a.pdf", found(10000, 500, 500, 10500))]; // total should be 11000
    const result = aggregateAmountSuggestion(files, false);
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.lines[0]).toMatchObject({ partsMismatch: true });
    expect(result.totalCents).toBe(10500); // as read, not recomputed
  });

  it("negative/refund amounts are summed like the form allows", () => {
    const files = [
      receipt("r1", "a.pdf", found(10000, 0, 0, 10000)),
      receipt("r2", "refund.pdf", found(-3000, 0, 0, -3000)),
    ];
    const result = aggregateAmountSuggestion(files, false);
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.totalCents).toBe(7000);
  });

  it("lists receipts before proofs (Appendix A §2), keeping picking order within each", () => {
    const files = [
      proof("p1", "first.png", found(1000, 0, 0, 1000)),
      receipt("r1", "second.pdf", found(1000, 0, 0, 1000)),
      proof("p2", "third.png", found(1000, 0, 0, 1000)),
      receipt("r2", "fourth.pdf", found(1000, 0, 0, 1000)),
    ];
    const result = aggregateAmountSuggestion(files, false);
    if (result.state !== "done") throw new Error("unreachable");
    expect(result.lines.map((l) => l.key)).toEqual(["r1", "r2", "p1", "p2"]);
  });
});

describe("fileSetSignature", () => {
  it("order-independent for the same set of keys", () => {
    expect(fileSetSignature(["b", "a", "c"])).toBe(fileSetSignature(["a", "c", "b"]));
  });

  it("changes when a key is added or removed", () => {
    const base = fileSetSignature(["a", "b"]);
    expect(fileSetSignature(["a", "b", "c"])).not.toBe(base);
    expect(fileSetSignature(["a"])).not.toBe(base);
  });

  it("empty list has a stable signature", () => {
    expect(fileSetSignature([])).toBe(fileSetSignature([]));
  });
});

describe("nextKeysToRead", () => {
  it("respects the concurrency limit", () => {
    expect(nextKeysToRead(["a", "b", "c"], new Set(), new Set(), 2)).toEqual(["a", "b"]);
  });

  it("skips cached and in-flight keys", () => {
    expect(nextKeysToRead(["a", "b", "c"], new Set(["a"]), new Set(["b"]), 2)).toEqual(["c"]);
  });

  it("returns [] when already at the limit (full in-flight)", () => {
    expect(nextKeysToRead(["a", "b", "c"], new Set(), new Set(["x", "y"]), 2)).toEqual([]);
  });

  it("returns [] for an empty presentKeys list", () => {
    expect(nextKeysToRead([], new Set(), new Set(), 2)).toEqual([]);
  });

  it("defaults to a limit of 2", () => {
    expect(nextKeysToRead(["a", "b", "c", "d"], new Set(), new Set())).toEqual(["a", "b"]);
  });
});

describe("panelVisible", () => {
  it("false after dismiss for the same signature", () => {
    expect(
      panelVisible({ enabled: true, signature: "sig1", dismissedFor: "sig1", hasFiles: true }),
    ).toBe(false);
  });

  it("true again once the signature changes (files changed)", () => {
    expect(
      panelVisible({ enabled: true, signature: "sig2", dismissedFor: "sig1", hasFiles: true }),
    ).toBe(true);
  });

  it("false when disabled, even with files and no dismissal", () => {
    expect(
      panelVisible({ enabled: false, signature: "sig1", dismissedFor: null, hasFiles: true }),
    ).toBe(false);
  });

  it("false with no files", () => {
    expect(
      panelVisible({ enabled: true, signature: "", dismissedFor: null, hasFiles: false }),
    ).toBe(false);
  });
});

describe("refunds (PR #18 round 2, #5)", () => {
  it("a refund receipt matches the bank credit that returned the money", () => {
    const result = aggregateAmountSuggestion(
      [receipt("r", "refund.pdf", found(-14500, 0, 0, -14500)), proof("p", "credit.png", found(-14500, 0, 0, -14500))],
      false,
    );
    expect(result).toMatchObject({ state: "done", proofCheck: { matches: true } });
  });

  it("with no receipt, a refund's bank credit fills a negative subtotal, so it saves as a refund", () => {
    const result = aggregateAmountSuggestion([proof("p", "credit.png", found(-14500, 0, 0, -14500))], true);
    expect(result).toMatchObject({ state: "done", subtotalCents: -14500, totalCents: -14500 });
  });
});
