/**
 * Pure aggregation for reading amounts from receipts/proofs (Phase 10, §3.5).
 *
 * No React, no server imports — this is the logic `use-amount-reads.ts` and
 * `amount-suggestion-panel.tsx` both drive, kept testable without a browser or a database.
 * Money stays integer cents throughout, matching `src/domain/money.ts`.
 */
import { sumCents } from "@/src/domain/money";

export type ReadKind = "receipt" | "proof";

export type ReadAmounts = {
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  totalCents: number;
};

export type FileReadResult =
  | { status: "pending" }
  | { status: "none" }
  | { status: "found"; amounts: ReadAmounts };

export type ReadableFile = {
  key: string;
  name: string;
  kind: ReadKind;
  result: FileReadResult;
};

export type SuggestionLine =
  | { key: string; name: string; kind: ReadKind; outcome: "none" }
  | {
      key: string;
      name: string;
      kind: "receipt";
      outcome: "found";
      amounts: ReadAmounts;
      partsMismatch: boolean;
    }
  | {
      key: string;
      name: string;
      kind: "proof";
      outcome: "found";
      amounts: ReadAmounts;
      matches: boolean;
    };

export type ProofCheck = { receiptsCents: number; proofsCents: number; matches: boolean };

export type AmountSuggestion =
  | { state: "hidden" }
  | { state: "reading"; pendingCount: number }
  | { state: "nothing" }
  | {
      state: "done";
      subtotalCents: number;
      taxCents: number;
      feesCents: number;
      totalCents: number;
      lines: SuggestionLine[];
      proofCheck: ProofCheck | null;
      someMissing: boolean;
    };

function sumAmounts(files: ReadonlyArray<{ result: FileReadResult }>): ReadAmounts {
  const found = files
    .map((file) => file.result)
    .filter((result): result is Extract<FileReadResult, { status: "found" }> => result.status === "found");
  return {
    subtotalCents: sumCents(...found.map((f) => f.amounts.subtotalCents)),
    taxCents: sumCents(...found.map((f) => f.amounts.taxCents)),
    feesCents: sumCents(...found.map((f) => f.amounts.feesCents)),
    totalCents: sumCents(...found.map((f) => f.amounts.totalCents)),
  };
}

/**
 * Combine every readable file's result into what the panel shows (Phase 10 §3.5 table).
 *
 * `noReceipt` drops receipt files entirely before anything else runs — ticking "No receipt
 * available" makes the expense proofs-only, same as if no receipt had ever been chosen.
 */
export function aggregateAmountSuggestion(
  files: readonly ReadableFile[],
  noReceipt: boolean,
): AmountSuggestion {
  const active = noReceipt ? files.filter((file) => file.kind !== "receipt") : files;
  if (active.length === 0) return { state: "hidden" };

  const pendingCount = active.filter((file) => file.result.status === "pending").length;
  if (pendingCount > 0) return { state: "reading", pendingCount };

  if (active.every((file) => file.result.status === "none")) return { state: "nothing" };

  const receipts = active.filter((file) => file.kind === "receipt");
  const proofs = active.filter((file) => file.kind === "proof");
  const receiptsFound = receipts.filter((file) => file.result.status === "found");
  const proofsFound = proofs.filter((file) => file.result.status === "found");

  const useReceipts = receiptsFound.length > 0;
  const totals = useReceipts ? sumAmounts(receiptsFound) : sumAmounts(proofsFound);

  let proofCheck: ProofCheck | null = null;
  if (useReceipts && proofsFound.length > 0) {
    const receiptsCents = totals.totalCents;
    const proofsCents = sumAmounts(proofsFound).totalCents;
    proofCheck = { receiptsCents, proofsCents, matches: receiptsCents === proofsCents };
  }

  // Receipts first, then proofs, as Appendix A §2 lists them — whatever order the form holds
  // them in (Edit lists attached proofs before receipts). Stable, so picking order is kept.
  const ordered = [...receipts, ...proofs];
  const lines: SuggestionLine[] = ordered.map((file) => {
    if (file.result.status !== "found") {
      return { key: file.key, name: file.name, kind: file.kind, outcome: "none" };
    }
    if (file.kind === "receipt") {
      const { subtotalCents, taxCents, feesCents, totalCents } = file.result.amounts;
      return {
        key: file.key,
        name: file.name,
        kind: "receipt",
        outcome: "found",
        amounts: file.result.amounts,
        partsMismatch: totalCents !== subtotalCents + taxCents + feesCents,
      };
    }
    return {
      key: file.key,
      name: file.name,
      kind: "proof",
      outcome: "found",
      amounts: file.result.amounts,
      matches: proofCheck !== null && proofCheck.matches,
    };
  });

  return {
    state: "done",
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    feesCents: totals.feesCents,
    totalCents: totals.totalCents,
    lines,
    proofCheck,
    someMissing: active.some((file) => file.result.status === "none"),
  };
}

/* ---------------------------------------------------- lifecycle helpers (useAmountReads) */

/** Order-independent signature for a set of file keys — changes exactly when the set of
 *  receipt/proof files changes, regardless of the order they were picked in. */
export function fileSetSignature(keys: readonly string[]): string {
  return [...keys].sort().join("|");
}

/**
 * Which keys to start reading next, up to `limit` concurrent reads.
 *
 * A key already cached or already in flight is never started again — `presentKeys` is the
 * current set of readable files, and everything else has either finished or is running.
 */
export function nextKeysToRead(
  presentKeys: readonly string[],
  cachedKeys: ReadonlySet<string>,
  inFlightKeys: ReadonlySet<string>,
  limit = 2,
): string[] {
  const slots = limit - inFlightKeys.size;
  if (slots <= 0) return [];
  const candidates = presentKeys.filter((key) => !cachedKeys.has(key) && !inFlightKeys.has(key));
  return candidates.slice(0, slots);
}

/** Whether the suggestion panel should be shown: enabled, files present, and not dismissed for
 *  the current set of files. */
export function panelVisible(input: {
  enabled: boolean;
  signature: string;
  dismissedFor: string | null;
  hasFiles: boolean;
}): boolean {
  return input.enabled && input.hasFiles && input.dismissedFor !== input.signature;
}
