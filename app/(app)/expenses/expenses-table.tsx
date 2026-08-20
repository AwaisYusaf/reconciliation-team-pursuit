"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import {
  DocumentThumbnail,
  inlineSrc,
  isPdf,
  thumbnailSrc,
  useDocumentViewer,
} from "@/src/components/ui/document-viewer";
import { Label, Select } from "@/src/components/ui/field";
import { Card, DangerPanel, EmptyState } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { reportResult } from "@/src/components/ui/toast";
import { formatDateUS } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { deleteExpenseAction } from "@/src/modules/expenses/actions";

/** One attached document, as much of it as a row needs to preview it. */
export type RowDocument = {
  id: string;
  filename: string;
  mimeType: string;
};

export type ExpenseRow = {
  id: string;
  date: string;
  name: string;
  lineItemName: string;
  paymentSource: string;
  reimbursableCents: number;
  proofs: RowDocument[];
  receipts: RowDocument[];
  supporting: RowDocument[];
  noReceipt: boolean;
  noReceiptReason: string | null;
  complete: boolean;
};

const ALL_LINE_ITEMS = "All line items";
const ALL_SOURCES = "All payment sources";

export function ExpensesTable({
  rows,
  paymentSourceLabels,
  lineItemNames,
  month,
}: {
  rows: ExpenseRow[];
  paymentSourceLabels: string[];
  lineItemNames: string[];
  month: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lineFilter, setLineFilter] = useState(ALL_LINE_ITEMS);
  const [sourceFilter, setSourceFilter] = useState(ALL_SOURCES);
  const [confirming, setConfirming] = useState<ExpenseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open, viewer } = useDocumentViewer();

  const openDocuments = useCallback(
    (documents: RowDocument[], index: number) => {
      open(
        documents.map((document) => ({
          src: inlineSrc(document.id),
          filename: document.filename,
          mimeType: document.mimeType,
        })),
        index,
      );
    },
    [open],
  );

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          (lineFilter === ALL_LINE_ITEMS || row.lineItemName === lineFilter) &&
          (sourceFilter === ALL_SOURCES || row.paymentSource === sourceFilter),
      ),
    [rows, lineFilter, sourceFilter],
  );

  // Cards always total the whole month, never the filtered subset (R5.2).
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const label of paymentSourceLabels) map.set(label, 0);
    for (const row of rows) {
      map.set(row.paymentSource, (map.get(row.paymentSource) ?? 0) + row.reimbursableCents);
    }
    return map;
  }, [rows, paymentSourceLabels]);

  const incomplete = rows.filter((row) => !row.complete).length;

  if (rows.length === 0) {
    return <EmptyState>No expenses recorded for {month} yet.</EmptyState>;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-5">
        {paymentSourceLabels.map((label) => (
          <Card key={label} className="flex-1 min-w-[240px] px-5 py-[18px]">
            <div className="text-[13px] text-sub leading-snug">{label}</div>
            <div className="text-xl font-bold tabular-nums mt-2">
              {formatMoney(totals.get(label) ?? 0)}
            </div>
          </Card>
        ))}
      </div>

      {incomplete > 0 && (
        <DangerPanel tone="notice" className="mb-6">
          {incomplete} record{incomplete === 1 ? " is" : "s are"} missing documents —{" "}
          <Link href="/packet" className="underline">
            view Month-End Packet
          </Link>
        </DangerPanel>
      )}

      {error && (
        <DangerPanel tone="notice" className="mb-4">
          {error}
        </DangerPanel>
      )}

      {confirming && (
        <DangerPanel title="Delete this expense?" className="mb-4">
          <p className="mb-3">
            {confirming.name} — {formatMoney(confirming.reimbursableCents)}. Its attached files
            are removed too. This cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteExpenseAction(confirming.id);
                  setConfirming(null);
                  if (reportResult(result, `${confirming.name} deleted`)) router.refresh();
                  else setError(result.error);
                })
              }
            >
              Delete expense
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(null)}>
              Keep it
            </Button>
          </div>
        </DangerPanel>
      )}

      <div className="flex flex-wrap gap-[18px] mb-5">
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label htmlFor="lineFilter">Filter by line item</Label>
          <Select
            id="lineFilter"
            value={lineFilter}
            onChange={(event) => setLineFilter(event.target.value)}
          >
            <option>{ALL_LINE_ITEMS}</option>
            {lineItemNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
        </div>
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label htmlFor="sourceFilter">Filter by payment source</Label>
          <Select
            id="sourceFilter"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option>{ALL_SOURCES}</option>
            {paymentSourceLabels.map((label) => (
              <option key={label}>{label}</option>
            ))}
          </Select>
        </div>
      </div>

      <TableCard minWidth={1040}>
        <thead>
          <tr>
            <Th sticky>Date</Th>
            <Th>Name</Th>
            <Th>Line Item</Th>
            <Th>Payment Source</Th>
            <Th align="right">Reimbursable Amount</Th>
            <Th>Proof</Th>
            <Th>Receipt</Th>
            <Th>Supporting</Th>
            <Th align="right" />
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.id}>
              <Td numeric sticky>{formatDateUS(row.date)}</Td>
              <Td>{row.name}</Td>
              <Td>{row.lineItemName}</Td>
              <Td className="text-[15px] text-sub leading-snug">{row.paymentSource}</Td>
              <Td align="right" numeric>
                {formatMoney(row.reimbursableCents)}
              </Td>
              <Td>
                <DocumentCell documents={row.proofs} onOpen={openDocuments} />
              </Td>
              <Td>
                {row.noReceipt ? (
                  <span className="text-[15px] italic text-sub">
                    No receipt{row.noReceiptReason ? ` (${row.noReceiptReason})` : ""}
                  </span>
                ) : (
                  <DocumentCell documents={row.receipts} onOpen={openDocuments} />
                )}
              </Td>
              <Td className="text-sub">
                {row.supporting.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => openDocuments(row.supporting, 0)}
                    className="text-base underline decoration-line underline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded-[2px]"
                  >
                    {row.supporting.length} attached
                  </button>
                ) : (
                  "—"
                )}
              </Td>
              <Td align="right" className="whitespace-nowrap">
                <div className="flex gap-4 justify-end">
                  <Link
                    href={`/expenses/${row.id}/edit`}
                    className="py-2.5 text-[15px] text-accent underline hover:text-accent-dark"
                  >
                    Edit
                  </Link>
                  <Button variant="quiet" onClick={() => setConfirming(row)} disabled={pending}>
                    Delete
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      {visible.length === 0 && (
        <div className="py-10 text-center text-base text-sub">
          No expenses match these filters.
        </div>
      )}

      {viewer}
    </div>
  );
}

/**
 * Attached count with a preview, or the red MISSING the gate depends on (R4.4).
 *
 * The whole cell opens the viewer, so the receipt can be checked from the list without
 * opening the expense for editing.
 */
function DocumentCell({
  documents,
  onOpen,
}: {
  documents: RowDocument[];
  onOpen: (documents: RowDocument[], index: number) => void;
}) {
  if (documents.length === 0) {
    return <span className="text-base font-bold text-danger">MISSING</span>;
  }

  const [first] = documents;

  return (
    <button
      type="button"
      onClick={() => onOpen(documents, 0)}
      title={`Preview ${first.filename}`}
      className="flex items-center gap-2 whitespace-nowrap text-left rounded-[2px] hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <DocumentThumbnail
        src={thumbnailSrc(first.id, first.mimeType)}
        pdf={isPdf(first.mimeType)}
        size="sm"
      />
      <span className="text-base underline decoration-line underline-offset-2">
        {documents.length} attached
      </span>
    </button>
  );
}
