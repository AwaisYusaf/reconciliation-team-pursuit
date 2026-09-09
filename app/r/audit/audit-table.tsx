"use client";

/**
 * Org-wide audit log table (D-87) — filter, pagination and the before/after diff dialog.
 * The page itself stays a server component; this is the interactive part next to it.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { buttonClassName } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { Label } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { EmptyState } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateTimeUS, formatDateUS, monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import type { ExpenseAuditActionType, ExpenseAuditSnapshot } from "@/src/db/schema";
import type { OrgAuditEvent } from "@/src/modules/expenses/queries";

const ACTION_LABELS: Record<ExpenseAuditActionType, string> = {
  created: "Created",
  edited: "Edited",
  deleted: "Deleted",
  restored: "Restored",
  permanently_deleted: "Permanently deleted",
};

const ALL_ACTIONS = "All actions";

/** Visible, non-em-dash placeholder for a blank field in the diff dialog. */
const NONE = "None";

/**
 * One row's field, in the fixed order the dialog shows them. `differs` decides which rows are
 * kept for the two-column edit view; `value` is shared by every view.
 */
const FIELDS: {
  label: string;
  value: (snapshot: ExpenseAuditSnapshot) => string;
  differs: (before: ExpenseAuditSnapshot, after: ExpenseAuditSnapshot) => boolean;
}[] = [
  { label: "Name", value: (s) => s.name || NONE, differs: (a, b) => a.name !== b.name },
  {
    label: "Line Item",
    value: (s) => s.lineItemName || NONE,
    // lineItemId is deliberately never shown on its own (noise) — but a change to the id with
    // an unchanged name (a rename collision, or a delete/recreate) must still surface as a row.
    differs: (a, b) => a.lineItemId !== b.lineItemId || a.lineItemName !== b.lineItemName,
  },
  {
    label: "Payment Source",
    value: (s) => s.paymentSource || NONE,
    differs: (a, b) => a.paymentSource !== b.paymentSource,
  },
  { label: "Month", value: (s) => monthLabel(s.month), differs: (a, b) => a.month !== b.month },
  { label: "Date", value: (s) => formatDateUS(s.date), differs: (a, b) => a.date !== b.date },
  {
    label: "Description",
    value: (s) => s.description || NONE,
    differs: (a, b) => a.description !== b.description,
  },
  {
    label: "Subtotal",
    value: (s) => formatMoney(s.subtotalCents),
    differs: (a, b) => a.subtotalCents !== b.subtotalCents,
  },
  {
    label: "Tax",
    value: (s) => formatMoney(s.taxCents),
    differs: (a, b) => a.taxCents !== b.taxCents,
  },
  {
    label: "Fees",
    value: (s) => formatMoney(s.feesCents),
    differs: (a, b) => a.feesCents !== b.feesCents,
  },
  {
    label: "Tax Reimbursable",
    value: (s) => (s.taxReimbursable ? "Yes" : "No"),
    differs: (a, b) => a.taxReimbursable !== b.taxReimbursable,
  },
  {
    label: "Fees Reimbursable",
    value: (s) => (s.feesReimbursable ? "Yes" : "No"),
    differs: (a, b) => a.feesReimbursable !== b.feesReimbursable,
  },
  { label: "Note", value: (s) => s.note || NONE, differs: (a, b) => (a.note ?? "") !== (b.note ?? "") },
  {
    label: "Narrative",
    value: (s) => s.narrative || NONE,
    differs: (a, b) => (a.narrative ?? "") !== (b.narrative ?? ""),
  },
  {
    label: "No Receipt",
    value: (s) => (s.noReceipt ? "Yes" : "No"),
    differs: (a, b) => a.noReceipt !== b.noReceipt,
  },
  {
    label: "No Receipt Reason",
    value: (s) => s.noReceiptReason || NONE,
    differs: (a, b) => (a.noReceiptReason ?? "") !== (b.noReceiptReason ?? ""),
  },
];

function DiffDialog({
  event,
  onDismiss,
}: {
  event: OrgAuditEvent | null;
  onDismiss: () => void;
}) {
  // Bails before building any content when there's nothing to show: `Dialog` itself renders
  // null while `open` is false, but React still has to evaluate `children` to construct its
  // props, so a ternary computed here unconditionally ran `field.value(null)` on every render
  // while the dialog was closed (`viewing` starts null) and crashed immediately on page load.
  if (!event) return null;

  const before = event.beforeData;
  const after = event.afterData;

  return (
    <Dialog
      open
      title={`${ACTION_LABELS[event.action]} — ${event.reference ?? event.expenseName}`}
      dismissLabel="Close"
      onDismiss={onDismiss}
    >
      {before && after ? (
        <TableCard>
          <thead>
            <tr>
              <Th>Field</Th>
              <Th>Before</Th>
              <Th>After</Th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.filter((field) => field.differs(before, after)).map((field) => (
              <tr key={field.label}>
                <Td bold>{field.label}</Td>
                <Td>{field.value(before)}</Td>
                <Td>{field.value(after)}</Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      ) : (
        <TableCard>
          <thead>
            <tr>
              <Th colSpan={2}>{before ? "Final values" : "Initial values"}</Th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((field) => (
              <tr key={field.label}>
                <Td bold>{field.label}</Td>
                <Td>{field.value((before ?? after)!)}</Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </Dialog>
  );
}

export function AuditTable({
  events,
  page,
  hasNextPage,
  actionType,
}: {
  events: OrgAuditEvent[];
  page: number;
  hasNextPage: boolean;
  actionType?: ExpenseAuditActionType;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewing, setViewing] = useState<OrgAuditEvent | null>(null);

  function hrefFor(nextPage: number, nextAction: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    if (nextAction === ALL_ACTIONS) params.delete("action");
    else params.set("action", nextAction);
    return `/r/audit?${params.toString()}`;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-[18px] mb-5">
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="auditActionFilter-label" htmlFor="auditActionFilter">
            Filter by action
          </Label>
          <Select
            id="auditActionFilter"
            aria-labelledby="auditActionFilter-label"
            value={actionType ?? ALL_ACTIONS}
            onValueChange={(value) => router.push(hrefFor(1, value))}
          >
            <option>{ALL_ACTIONS}</option>
            {(Object.keys(ACTION_LABELS) as ExpenseAuditActionType[]).map((action) => (
              <option key={action} value={action}>
                {ACTION_LABELS[action]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState>
          {/* "recorded yet" is only true of an unfiltered first page — on a filter or a later
              page an empty result means this view is empty, not that the log is. */}
          {actionType || page > 1
            ? "No audit events match this view."
            : "No audit events recorded yet."}
        </EmptyState>
      ) : (
        <TableCard minWidth={860}>
          <thead>
            <tr>
              <Th>Date/Time</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Expense</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <Td className="whitespace-nowrap tabular-nums">{formatDateTimeUS(event.at)}</Td>
                <Td>{event.actorEmail}</Td>
                <Td>{ACTION_LABELS[event.action]}</Td>
                <Td>
                  {event.reference ? `${event.reference} — ${event.expenseName}` : event.expenseName}
                </Td>
                <Td align="right">
                  {(event.beforeData || event.afterData) && (
                    <button
                      type="button"
                      onClick={() => setViewing(event)}
                      className="text-[15px] text-accent underline hover:text-accent-dark"
                    >
                      View changes
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {/* Outside the empty branch on purpose: a page past the end renders no rows, and with
          the controls nested in the table branch there was no "Previous" left to get back. */}
      {(page > 1 || hasNextPage) && (
        <div className="flex justify-between mt-5">
          {page > 1 ? (
            <Link href={hrefFor(page - 1, actionType ?? ALL_ACTIONS)} className={buttonClassName("secondary")}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          {hasNextPage && (
            <Link href={hrefFor(page + 1, actionType ?? ALL_ACTIONS)} className={buttonClassName("secondary")}>
              Next
            </Link>
          )}
        </div>
      )}

      <DiffDialog event={viewing} onDismiss={() => setViewing(null)} />
    </div>
  );
}
