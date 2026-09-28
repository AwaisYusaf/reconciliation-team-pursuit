"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClassName } from "@/src/components/ui/button";
import {
  DocumentThumbnail,
  isPdf,
  thumbnailSrc,
} from "@/src/components/ui/document-viewer";
import { Modal } from "@/src/components/ui/modal";
import { formatDateUS, monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { missingPhrase } from "@/src/domain/gate";
import { receiptTotalCents } from "@/src/domain/money";
import { cn } from "@/src/lib/cn";
import type { ExpenseRow, RowDocument } from "./expenses-table";

/**
 * The whole record for one expense, read-only.
 *
 * Distinct from what the reference link already does: that opens the attached files, this is
 * the figures, the wording that prints, and what the record is still missing. The files are
 * here too, as thumbnails that hand off to the same viewer rather than a second one.
 *
 * Read-only on purpose. Editing lives on one screen, reached by the button at the bottom —
 * a second place to change an expense is a second place for the save rules to drift.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-sub font-bold">{label}</dt>
      <dd className="m-0 mt-1 text-[15px] text-ink break-words">{children}</dd>
    </div>
  );
}

/** An empty value reads as the app's empty cell rather than as a blank gap. */
function orDash(value: string | null | undefined): ReactNode {
  const trimmed = value?.trim();
  return trimmed ? trimmed : <span className="text-sub">-</span>;
}

export function ExpenseDetailsDialog({
  row,
  onClose,
  onOpenDocuments,
}: {
  row: ExpenseRow | null;
  onClose: () => void;
  /** The table's own viewer, passed down so a document opened here pages through the same
   *  overlay the reference and the column counts use rather than a second one of its own. */
  onOpenDocuments: (documents: RowDocument[], index: number) => void;
}) {
  // Always rendered, open while a row is set: the Modal keeps showing the last row while it
  // fades out, which it can't do if this returned null the moment the row was cleared.
  return (
    <Modal open={row !== null} title={row?.name ?? ""} onClose={onClose} size="lg">
      {row && <ExpenseDetailsBody row={row} onOpenDocuments={onOpenDocuments} />}
    </Modal>
  );
}

function ExpenseDetailsBody({
  row,
  onOpenDocuments,
}: {
  row: ExpenseRow;
  onOpenDocuments: (documents: RowDocument[], index: number) => void;
}) {
  const receiptTotal = receiptTotalCents(row);
  const excluded = receiptTotal - row.reimbursableCents;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15px] tabular-nums text-sub">{row.reference}</span>
        <span className="text-[15px] text-sub">{formatDateUS(row.date)}</span>
        {row.missing ? (
          <span className="text-[11px] uppercase tracking-[0.06em] font-bold text-danger bg-danger-bg rounded-full px-2 py-1">
            {missingPhrase(row.missing)}
          </span>
        ) : (
          <span className="text-[11px] uppercase tracking-[0.06em] font-bold text-success bg-success-bg rounded-full px-2 py-1">
            Complete
          </span>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 m-0">
        <Field label="Line item">{row.lineItemName}</Field>
        <Field label="Funding source">{orDash(row.fundingSourceName)}</Field>
        <Field label="Payment source">{row.paymentSource}</Field>
        <Field label="Month">{monthLabel(row.month)}</Field>
        <Field label="Reimbursable amount">
          <span className="font-bold tabular-nums">{formatMoney(row.reimbursableCents)}</span>
        </Field>
        {/*
          The receipt total only when it differs from what is claimed. Equal figures shown
          twice invite the reader to hunt for a difference that is not there; R1.3's split
          matters precisely when tax or fees were left out.
        */}
        {excluded !== 0 && (
          <Field label="Receipt total">
            <span className="tabular-nums">{formatMoney(receiptTotal)}</span>{" "}
            <span className="text-sub">({formatMoney(excluded)} not reimbursed)</span>
          </Field>
        )}
      </dl>

      <div className="border-t border-line pt-4">
        <dl className="grid gap-4 sm:grid-cols-3 m-0">
          <Field label="Subtotal">
            <span className="tabular-nums">{formatMoney(row.subtotalCents)}</span>
          </Field>
          <Field label="Tax">
            <span className="tabular-nums">{formatMoney(row.taxCents)}</span>
            {row.taxCents !== 0 && !row.taxReimbursable && (
              <span className="text-sub"> (not reimbursed)</span>
            )}
          </Field>
          <Field label="Fees">
            <span className="tabular-nums">{formatMoney(row.feesCents)}</span>
            {row.feesCents !== 0 && !row.feesReimbursable && (
              <span className="text-sub"> (not reimbursed)</span>
            )}
          </Field>
        </dl>
      </div>

      <div className="border-t border-line pt-4 flex flex-col gap-4">
        <Field label="Description / role">{orDash(row.description)}</Field>
        <Field label="Narrative">{orDash(row.narrative)}</Field>
        {row.note?.trim() && <Field label="Note">{row.note}</Field>}
        {row.noReceipt && (
          <Field label="No receipt available">{orDash(row.noReceiptReason)}</Field>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <dl className="grid gap-4 sm:grid-cols-3 m-0">
          {(
            [
              ["Proof of payment", row.proofs],
              ["Receipt / justification", row.receipts],
              ["Supporting", row.supporting],
            ] as const
          ).map(([label, documents]) => (
            <Field key={label} label={label}>
              {documents.length === 0 ? (
                <span className="text-sub">-</span>
              ) : (
                <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                  {documents.map((document, index) => (
                    <li key={document.id}>
                      {/*
                        A thumbnail and a real button, not a filename. Checking an expense is
                        a visual act — you are looking for whether the receipt is the right
                        receipt — and a name alone cannot answer that. Opening the shared
                        viewer at this document's own index means the arrows then page
                        through the rest of the set rather than starting from the first.
                      */}
                      <button
                        type="button"
                        onClick={() => onOpenDocuments(documents, index)}
                        title={document.filename}
                        className="flex items-center gap-2 w-full text-left rounded-[6px] p-1 -m-1 hover:bg-section focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <DocumentThumbnail
                          src={thumbnailSrc(document.id, document.mimeType)}
                          pdf={isPdf(document.mimeType)}
                          size="sm"
                        />
                        <span className="min-w-0 truncate text-[14px]">{document.filename}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap gap-3 pt-1">
        <Link
          href={`/r/expenses/${row.id}/edit`}
          className={cn(buttonClassName("primary"), "min-h-11")}
        >
          Edit this expense
        </Link>
      </div>
    </div>
  );
}
