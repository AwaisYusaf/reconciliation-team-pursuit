import { documentationStatus, type DocumentState } from "@/src/domain/gate";
import { UI } from "@/src/domain/strings";

/**
 * The toast after an expense is saved (m02, usability #30): every gap the documentation gate
 * will still hold it for, counted from what the expense will have once its queued files upload.
 * Narrative is not asked about: a save without one is refused (R4.7).
 */
export function savedMessage(input: {
  noReceipt: boolean;
  /** Already-attached files (edit). Only `attached` status counts (R4.6). */
  attached: readonly DocumentState[];
  /** Files queued in the form, uploaded right after the save and before this toast shows. */
  queued: readonly { scope: DocumentState["kind"] }[];
  /** An invoice card's invoice becomes the charge's receipt when it is created (Phase 14). */
  invoiceIsReceipt: boolean;
}): string {
  const { missing } = documentationStatus({
    noReceipt: input.noReceipt,
    hasNarrative: true,
    documents: [
      ...input.attached,
      ...input.queued.map((item) => ({ kind: item.scope, status: "attached" as const })),
      ...(input.invoiceIsReceipt ? [{ kind: "receipt" as const, status: "attached" as const }] : []),
    ],
  });
  return UI.expenseSaved(missing);
}
