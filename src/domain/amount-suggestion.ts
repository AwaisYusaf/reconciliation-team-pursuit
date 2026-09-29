/**
 * Pure aggregation for reading amounts from receipts/proofs (Phase 10, §3.5).
 *
 * No React, no server imports — this is the logic `use-amount-reads.ts` and
 * `amount-suggestion-panel.tsx` both drive, kept testable without a browser or a database.
 * Money stays integer cents throughout, matching `src/domain/money.ts`.
 */
import type { IsoDate } from "@/src/domain/dates";
import { sumCents } from "@/src/domain/money";
import { vendorKey } from "@/src/domain/vendor-match";

export type ReadKind = "receipt" | "proof";

/**
 * Who was paid and when, as read off one receipt (Phase 19). Each is null when the receipt
 * does not show it. Only receipts carry these: a proof of payment is a bank line, too messy to
 * name a vendor from. Read in the same request as the amounts, and kept even when the amounts
 * could not be read, since a receipt with an unreadable total can still name its vendor.
 */
export type ReceiptDetails = { vendor: string | null; date: IsoDate | null };

export type ReadAmounts = {
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  totalCents: number;
};

export type FileReadResult =
  | { status: "pending" }
  /** `reason` is only set where "No amount found" would mislead: a document refused before it
   *  ever reached the model reads as an AI failure otherwise (PR #18 review). */
  | { status: "none"; reason?: "too-long"; details?: ReceiptDetails }
  | { status: "found"; amounts: ReadAmounts; details?: ReceiptDetails };

export type ReadableFile = {
  key: string;
  name: string;
  kind: ReadKind;
  result: FileReadResult;
};

export type SuggestionLine =
  | { key: string; name: string; kind: ReadKind; outcome: "none"; reason?: "too-long" }
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
      return {
        key: file.key,
        name: file.name,
        kind: file.kind,
        outcome: "none",
        ...(file.result.status === "none" && file.result.reason ? { reason: file.result.reason } : {}),
      };
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

/* ------------------------------------------------ Phase 19: a receipt's vendor and date */

/**
 * What the vendor and date box offers, once every receipt has been read.
 *
 * Receipts only, and nothing while "No receipt available" is ticked (the expense is then
 * proofs-only, as in `aggregateAmountSuggestion`). A vendor is offered only when every receipt
 * that names one names the same business (compared by `vendorKey`, so "The Home Depot" and
 * "HOME DEPOT" agree, and the first spelling is shown); a date only when they all show the same
 * day. Offering one of two different vendors would be a guess, so a disagreement offers
 * nothing for that field. Null when there is nothing to offer at all.
 */
export function aggregateReceiptDetails(
  files: readonly ReadableFile[],
  noReceipt: boolean,
): ReceiptDetails | null {
  if (noReceipt) return null;
  const receipts = files.filter((file) => file.kind === "receipt");
  if (receipts.length === 0) return null;
  if (receipts.some((file) => file.result.status === "pending")) return null;

  const read = receipts.flatMap((file) =>
    file.result.status !== "pending" && file.result.details ? [file.result.details] : [],
  );
  const vendors = read.flatMap((details) => (details.vendor ? [details.vendor] : []));
  const dates = read.flatMap((details) => (details.date ? [details.date] : []));

  const vendor =
    vendors.length > 0 && vendors.every((name) => vendorKey(name) === vendorKey(vendors[0]))
      ? vendors[0]
      : null;
  const date = dates.length > 0 && dates.every((day) => day === dates[0]) ? dates[0] : null;
  return vendor === null && date === null ? null : { vendor, date };
}

/**
 * Whether the form reads its documents now, and whether it offers a receipt's vendor and date.
 *
 * Add reads as soon as a receipt or proof is chosen (Phase 10). Edit waits for Read amounts
 * from documents, except that choosing a new file starts reading on its own (Phase 19): every
 * file on the form is then read, the attached ones too, exactly as the button would, because a
 * total read from the new file alone would replace the expense's amounts with that file's share.
 * Not on a draft: its attached files live in `expense_draft_documents`, which the read route
 * does not look in, so the same short total would follow. The vendor and date box is for Add
 * and Edit only, never a draft or an invoice card, where the invoice already set both.
 */
export function readingFor(input: {
  allowed: boolean;
  editing: boolean;
  draft: boolean;
  embedded: boolean;
  requested: boolean;
  newFileQueued: boolean;
}): { reading: boolean; offerDetails: boolean } {
  const reading =
    input.allowed && (!input.editing || input.requested || (input.newFileQueued && !input.draft));
  return { reading, offerDetails: reading && !input.draft && !input.embedded };
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
