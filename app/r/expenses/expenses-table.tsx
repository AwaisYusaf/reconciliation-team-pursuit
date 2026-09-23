"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react";

import { ACTION_LABELS, AuditDiffContent } from "@/src/components/audit/audit-diff";
import { Button } from "@/src/components/ui/button";
import { ExpenseDetailsDialog } from "./expense-details-dialog";
import { Dialog } from "@/src/components/ui/dialog";
import {
  DocumentThumbnail,
  inlineSrc,
  isPdf,
  thumbnailSrc,
  useDocumentViewer,
} from "@/src/components/ui/document-viewer";
import { Input, Label } from "@/src/components/ui/field";
import { Menu, MenuItem, MenuLink } from "@/src/components/ui/menu";
import { Modal } from "@/src/components/ui/modal";
import { Select } from "@/src/components/ui/select";
import { Card, DangerPanel, EmptyState } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateTimeUS, formatDateUS, monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import {
  ALL_DOCUMENTATION,
  DOCUMENTATION_FILTERS,
  matchesDocumentationFilter,
  type DocumentationFilter,
  type MissingKind,
} from "@/src/domain/gate";
import { UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";
import { UserAvatar } from "@/src/components/app-shell/user-avatar";
import { userDisplay } from "@/src/domain/user-display";
import { deleteExpenseAction, loadExpenseHistoryAction } from "@/src/modules/expenses/actions";
// Type-only: `queries.ts` is `server-only`, so importing a runtime value from it into this
// client component would fail the build.
import type { OrgAuditEvent } from "@/src/modules/expenses/queries";

/**
 * The gate's verdict on one requirement, as a pill.
 *
 * `MISSING` was bold red text at body size, repeated in up to four columns on every row — on a
 * month where little is documented yet the table came out as a wall of red shouting the same
 * word, which stops being a signal. A pill at label size says the same thing once per cell and
 * leaves the figures as the loudest thing in the row, which is what should be.
 */
function StatusPill({ tone, children }: { tone: "missing" | "ok"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] whitespace-nowrap",
        tone === "missing" ? "bg-danger-bg text-danger" : "bg-success-bg text-success",
      )}
    >
      {children}
    </span>
  );
}

/** One attached document, as much of it as a row needs to preview it. */
export type RowDocument = {
  id: string;
  filename: string;
  mimeType: string;
};

/** How the list is ordered. Sorting is client-side: the month's rows are all loaded already. */
const SORTS = {
  "date-desc": { label: "Date (newest first)", compare: (a: ExpenseRow, b: ExpenseRow) => b.date.localeCompare(a.date) },
  "date-asc": { label: "Date (oldest first)", compare: (a: ExpenseRow, b: ExpenseRow) => a.date.localeCompare(b.date) },
  reference: { label: "Reference", compare: (a: ExpenseRow, b: ExpenseRow) => a.reference.localeCompare(b.reference) },
  "name-asc": { label: "Name (A to Z)", compare: (a: ExpenseRow, b: ExpenseRow) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) },
  "name-desc": { label: "Name (Z to A)", compare: (a: ExpenseRow, b: ExpenseRow) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }) },
  "amount-desc": { label: "Amount (highest first)", compare: (a: ExpenseRow, b: ExpenseRow) => b.reimbursableCents - a.reimbursableCents },
  "amount-asc": { label: "Amount (lowest first)", compare: (a: ExpenseRow, b: ExpenseRow) => a.reimbursableCents - b.reimbursableCents },
} as const;

type SortKey = keyof typeof SORTS;

/** Entry order, which is what the packet and cover sheets use. */
const DEFAULT_SORT: SortKey = "reference";

export type ExpenseRow = {
  id: string;
  /** `2026-02-014` — unique within the month, printed in the packet index (R2.6). */
  reference: string;
  /** Searchable, though it is the cover sheet rather than this table that prints it. */
  description: string;
  date: string;
  name: string;
  lineItemName: string;
  paymentSource: string;
  fundingSourceName: string;
  /** This row's own source and month — the lock key `"{fundingSourceId}:{month}"` (D-96). */
  fundingSourceId: string;
  month: string;
  reimbursableCents: number;
  proofs: RowDocument[];
  receipts: RowDocument[];
  supporting: RowDocument[];
  /** Proof, receipt and supporting together — what the reference opens. */
  allDocuments: RowDocument[];
  noReceipt: boolean;
  noReceiptReason: string | null;
  hasNarrative: boolean;
  /**
   * The rest of the record, for the details dialog only — no column shows these.
   *
   * Carried on the row rather than fetched when the dialog opens: `loadMonthExpenses` has
   * already read every one of them for this table, so passing them through costs nothing,
   * where a lookup per open would be a round trip for data the page is holding.
   */
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  taxReimbursable: boolean;
  feesReimbursable: boolean;
  narrative: string | null;
  note: string | null;
  complete: boolean;
  /** What R4.4 says this record is missing, or null when it is complete. From the gate. */
  missing: MissingKind | null;
};

const ALL_LINE_ITEMS = "All line items";
const ALL_SOURCES = "All payment sources";
const ALL_FUNDING_SOURCES = "All funding sources";

/**
 * This expense's audit trail (D-89), opened from the "History" item in the row's ⋮ menu
 * (`RowMenu` below) and from there to the D-87 diff view. Admin-only content — the menu
 * never offers "History" to a manager, so this never opens for one.
 *
 * Presentational — the fetch is kicked off by the "History" click in `ExpensesTable`, so
 * opening this and loading what's behind it are one user action and nothing here needs an
 * effect.
 */
function HistoryModal({
  row,
  history,
  pending,
  error,
  onClose,
}: {
  row: ExpenseRow | null;
  history: { events: OrgAuditEvent[]; truncated: boolean } | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [diffEvent, setDiffEvent] = useState<OrgAuditEvent | null>(null);

  if (!row) return null;

  return (
    <Modal open title={`${row.reference} · ${row.name}`} onClose={onClose} size="lg">
      {diffEvent ? (
        <div>
          <AuditDiffContent key={diffEvent.id} event={diffEvent} />
          <Button variant="quiet" className="mt-4" onClick={() => setDiffEvent(null)}>
            Back
          </Button>
        </div>
      ) : (
        <div>
          {error ? (
            <p className="text-[15px] text-danger">{error}</p>
          ) : pending || !history ? (
            <p className="text-[15px] text-sub">Loading…</p>
          ) : history.events.length === 0 ? (
            <p className="text-[15px] text-sub">No history recorded for this expense.</p>
          ) : (
            <>
              {/* Said out loud rather than silently dropped: an audit trail that shows a
                  partial list without admitting it is worse than one showing fewer rows. */}
              {history.truncated && (
                <p className="text-[15px] text-sub mb-3">
                  Showing the most recent changes only. This expense has more history than
                  fits here.
                </p>
              )}
              <TableCard minWidth={640}>
                <thead>
                  <tr>
                    <Th>Date and time</Th>
                    <Th>User</Th>
                    <Th>Action</Th>
                    <Th align="right" />
                  </tr>
                </thead>
                <tbody>
                  {history.events.map((event) => (
                    <tr key={event.id}>
                      <Td className="whitespace-nowrap tabular-nums">
                        {formatDateTimeUS(event.at)}
                      </Td>
                      <Td>
                        <span className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar
                            name={event.actorName}
                            email={event.actorEmail}
                            avatarKey={event.actorAvatarKey}
                          />
                          <span className="truncate">
                            {userDisplay(event.actorName, event.actorEmail)}
                          </span>
                        </span>
                      </Td>
                      <Td>{ACTION_LABELS[event.action]}</Td>
                      <Td align="right">
                        {(event.beforeData || event.afterData) && (
                          <button
                            type="button"
                            onClick={() => setDiffEvent(event)}
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
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

export function ExpensesTable({
  rows,
  paymentSourceLabels,
  lineItemNames,
  month,
  monthParam,
  isAdmin,
  multiSource,
  fundingSources,
  selectedSourceId,
  sourceFilterOffered,
  totalBy,
  lockedMonths,
}: {
  rows: ExpenseRow[];
  paymentSourceLabels: string[];
  lineItemNames: string[];
  month: string;
  /** The raw `?month=` value the page was opened with, if any — carried onto the funding
   *  source filter's navigation so switching sources does not lose it. */
  monthParam?: string;
  isAdmin: boolean;
  /** True when the org has more than one funding source (active or archived). */
  multiSource: boolean;
  /** Active sources, plus any archived one with an expense in this month's rows. */
  fundingSources: { id: string; name: string }[];
  /** The resolved header/`?source=` scope. Null means "All". */
  selectedSourceId: string | null;
  /** True when the header is on "All" — the only time the source filter is offered. */
  sourceFilterOffered: boolean;
  /** "source" only when All is the resolved scope (R5.2: no combined total across funders). */
  totalBy: "payment" | "source";
  /** Every locked `"{fundingSourceId}:{month}"` in the org (Appendix A §2, D-96). */
  lockedMonths: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lockedMonthKeys = useMemo(() => new Set(lockedMonths), [lockedMonths]);
  const [lineFilter, setLineFilter] = useState(ALL_LINE_ITEMS);
  const [sourceFilter, setSourceFilter] = useState(ALL_SOURCES);
  const [docFilter, setDocFilter] = useState<DocumentationFilter>(ALL_DOCUMENTATION);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [confirming, setConfirming] = useState<ExpenseRow | null>(null);
  /** The row whose details dialog is open, or null. Holds the row itself, so the dialog needs
   *  no fetch of its own — every field it shows is already on the row. */
  const [detailsRow, setDetailsRow] = useState<ExpenseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingHistory, setViewingHistory] = useState<ExpenseRow | null>(null);
  const [history, setHistory] = useState<{
    events: OrgAuditEvent[];
    truncated: boolean;
  } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Its own transition, not the delete/`pending` one: loading a history must not disable
  // every row's Delete button while it runs.
  const [historyPending, startHistory] = useTransition();
  const { open, viewer } = useDocumentViewer();

  /** Opens this row's history modal and starts fetching what's behind it — so landing on it
   *  shows loaded content instead of a spinner (D-89). Only reachable for an admin: the row
   *  menu never offers "History" to a manager. */
  const openHistory = (row: ExpenseRow) => {
    setViewingHistory(row);
    setHistory(null);
    setHistoryError(null);
    startHistory(async () => {
      const result = await loadExpenseHistoryAction(row.id);
      if (result.ok) setHistory(result.data);
      else setHistoryError(result.error);
    });
  };

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

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matched = rows.filter(
      (row) =>
        (lineFilter === ALL_LINE_ITEMS || row.lineItemName === lineFilter) &&
        (sourceFilter === ALL_SOURCES || row.paymentSource === sourceFilter) &&
        matchesDocumentationFilter(row, docFilter) &&
        // Reference, name and description: the three things someone actually knows when
        // they are looking for one expense among a month of them.
        (term === "" ||
          row.reference.toLowerCase().includes(term) ||
          row.name.toLowerCase().includes(term) ||
          row.description.toLowerCase().includes(term)),
    );
    // Sorted on a copy — `rows` is a prop, and sorting in place would mutate it.
    return [...matched].sort(SORTS[sort].compare);
  }, [rows, lineFilter, sourceFilter, docFilter, query, sort]);

  // Cards always total the whole month, never the filtered subset (R5.2). With All selected,
  // one card per funding source instead of per payment source — different funders' money is
  // not one budget, so there is deliberately no combined figure either way.
  const cardLabels = totalBy === "source" ? fundingSources.map((source) => source.name) : paymentSourceLabels;
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const label of cardLabels) map.set(label, 0);
    const key = totalBy === "source" ? (row: ExpenseRow) => row.fundingSourceName : (row: ExpenseRow) => row.paymentSource;
    for (const row of rows) {
      const label = key(row);
      map.set(label, (map.get(label) ?? 0) + row.reimbursableCents);
    }
    return map;
  }, [rows, cardLabels, totalBy]);

  // Counted with the filter's own predicate rather than `!row.complete`. The two are equal by
  // construction in the gate, but "equal by construction somewhere else" is how this project's
  // defects have started; this way the strip and the filter are one code path.
  const incomplete = rows.filter((row) =>
    matchesDocumentationFilter(row, "Missing documentation"),
  ).length;

  // Server-scoped, not a client-side filter: offered whenever the header is on "All" — keyed
  // on that, not on the current filter value, or picking a source hid the control and left no
  // way back to All. Navigates so the resolved scope actually changes what's loaded.
  const sourceFilterControl =
    multiSource && sourceFilterOffered ? (
      <div className="flex-1 min-w-[240px] max-w-[340px]">
        <Label id="fundingSourceFilter-label" htmlFor="fundingSourceFilter">
          Filter by funding source
        </Label>
        <Select
          id="fundingSourceFilter"
          aria-labelledby="fundingSourceFilter-label"
          value={selectedSourceId ?? ""}
          onValueChange={(value) => {
            const params = new URLSearchParams();
            if (monthParam) params.set("month", monthParam);
            if (value) params.set("source", value);
            const query = params.toString();
            router.push(`/r/expenses${query ? `?${query}` : ""}`);
          }}
        >
          <option value="">{ALL_FUNDING_SOURCES}</option>
          {fundingSources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </Select>
      </div>
    ) : null;

  if (rows.length === 0) {
    // A source filter that matched nothing must still offer the way back.
    return (
      <div className="flex flex-col gap-5">
        {sourceFilterControl}
        <EmptyState>No expenses recorded for {month} yet.</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-5">
        {cardLabels.map((label) => (
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
          {incomplete} expense{incomplete === 1 ? " is" : "s are"} missing documentation.{" "}
          {docFilter === "Missing documentation" ? (
            <button
              type="button"
              onClick={() => setDocFilter(ALL_DOCUMENTATION)}
              className="underline"
            >
              Show all expenses
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDocFilter("Missing documentation")}
              className="underline"
            >
              Show only those
            </button>
          )}{" "}
          or{" "}
          <Link href="/r/packet" className="underline">
            go to the Month-End Packet
          </Link>
          .
        </DangerPanel>
      )}

      {error && (
        <DangerPanel tone="notice" className="mb-4">
          {error}
        </DangerPanel>
      )}

      <ExpenseDetailsDialog
        row={detailsRow}
        onClose={() => setDetailsRow(null)}
        onOpenDocuments={openDocuments}
      />

      <Dialog
        open={confirming !== null}
        title="Move this expense to the trash?"
        dismissLabel="Keep it"
        onDismiss={() => setConfirming(null)}
        confirm={{
          label: "Move to trash",
          disabled: pending,
          onConfirm: () => {
            const row = confirming!;
            startTransition(async () => {
              setError(null);
              const result = await deleteExpenseAction(row.id);
              // Stays open (Move to trash disabled via `pending`) until the outcome is known,
              // so a failure is visible in place instead of the dialog vanishing before the
              // user can tell what happened.
              setConfirming(null);
              // No toast either way: the row leaving the table is the confirmation, and a
              // failure already shows in the panel above — a toast only repeated it.
              if (result.ok) router.refresh();
              else setError(result.error);
            });
          },
        }}
      >
        {confirming &&
          `${confirming.name} (${formatMoney(confirming.reimbursableCents)}) moves to the trash${confirming.allDocuments.length > 0 ? " with its files" : ""} and can be restored.`}
      </Dialog>

      <div className="flex flex-wrap gap-[18px] mb-5" data-tour="expenses-filters">
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="expenseSearch-label" htmlFor="expenseSearch">Search</Label>
          <Input
            id="expenseSearch"
            type="search"
            aria-labelledby="expenseSearch-label"
            placeholder="Reference, name or description"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="expenseSort-label" htmlFor="expenseSort">Sort by</Label>
          <Select
            id="expenseSort"
            aria-labelledby="expenseSort-label"
            value={sort}
            onValueChange={(value) => setSort(value as SortKey)}
          >
            {Object.entries(SORTS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="lineFilter-label" htmlFor="lineFilter">Filter by line item</Label>
          <Select
            id="lineFilter"
            aria-labelledby="lineFilter-label"
            value={lineFilter}
            onValueChange={setLineFilter}
          >
            <option>{ALL_LINE_ITEMS}</option>
            {lineItemNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
        </div>
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="docFilter-label" htmlFor="docFilter">Filter by documentation</Label>
          <Select
            id="docFilter"
            aria-labelledby="docFilter-label"
            value={docFilter}
            onValueChange={(value) => setDocFilter(value as DocumentationFilter)}
          >
            {DOCUMENTATION_FILTERS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </Select>
        </div>
        <div className="flex-1 min-w-[240px] max-w-[340px]">
          <Label id="sourceFilter-label" htmlFor="sourceFilter">Filter by payment source</Label>
          <Select
            id="sourceFilter"
            aria-labelledby="sourceFilter-label"
            value={sourceFilter}
            onValueChange={setSourceFilter}
          >
            <option>{ALL_SOURCES}</option>
            {paymentSourceLabels.map((label) => (
              <option key={label}>{label}</option>
            ))}
          </Select>
        </div>
        {sourceFilterControl}
      </div>

      {/* `dense`, and a floor that accounts for the column count: the 1160 measured for this
          table predates the Funding source column, which "All sources" adds as an eleventh. At
          the 1220px content cap the extra column pushed it over and the whole table scrolled
          sideways, which the design language does not allow at that width (m03). */}
      <TableCard dense minWidth={multiSource ? 1160 : 1060}>
        <thead>
          <tr>
            <Th sticky>Ref / Date</Th>
            <Th>Name</Th>
            <Th>Line item</Th>
            {multiSource && <Th>Funding source</Th>}
            <Th>Payment source</Th>
            <Th align="right">Amount</Th>
            <Th>Proof</Th>
            <Th>Receipt</Th>
            <Th>Supporting</Th>
            <Th>Narrative</Th>
            <Th align="right" stickyEnd />
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const rowLocked = lockedMonthKeys.has(`${row.fundingSourceId}:${row.month}`);
            return (
            <tr
              key={row.id}
              onClick={(event) => {
                // The row holds three controls of its own — the reference and the document
                // counts open the viewer, and the menu opens itself. A blanket handler would
                // fire on all of them, so anything that is already interactive keeps its own
                // click and only the gaps between them open the details.
                if ((event.target as HTMLElement).closest("a, button, [role='menuitem']")) return;
                setDetailsRow(row);
              }}
              className="cursor-pointer hover:bg-section/60 transition-colors"
            >
              <Td sticky className="whitespace-nowrap">
                {row.allDocuments.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => openDocuments(row.allDocuments, 0)}
                    title={`Open the ${row.allDocuments.length} document${row.allDocuments.length === 1 ? "" : "s"} filed under ${row.reference}`}
                    className="tabular-nums text-[15px] underline decoration-line underline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded-[2px]"
                    data-tour="expenses-reference-viewer"
                  >
                    {row.reference}
                  </button>
                ) : (
                  // Nothing attached yet, so there is nothing for a click to open. Shown
                  // plainly rather than as a control that does nothing.
                  <span className="tabular-nums text-[15px] text-sub">{row.reference}</span>
                )}
                {/* Reference and date are both the row's identity, so they share the sticky
                    column rather than paying a second column's padding for one short value. */}
                <span className="block text-sm text-sub tabular-nums">
                  {formatDateUS(row.date)}
                </span>
              </Td>
              {/*
                A real button, not just the row's click handler. A clickable `<tr>` cannot be
                tabbed to and is not announced as doing anything, so the name carries the
                affordance: it is the obvious thing to click and it works from the keyboard.
              */}
              <Td>
                <button
                  type="button"
                  onClick={() => setDetailsRow(row)}
                  className="text-left underline decoration-line underline-offset-2 hover:decoration-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded-[2px]"
                >
                  {row.name}
                </button>
              </Td>
              <Td>{row.lineItemName}</Td>
              {multiSource && (
                // Capped and clipped, with the full name on hover and for a screen reader:
                // this is the column that pushed the table past the 1220px content cap, and a
                // grant name like "Community Violence Intervention" has no short word to wrap
                // on, so it set its own column three lines tall and as wide as its longest word.
                <Td className="text-[15px] text-sub leading-snug">
                  <span className="block max-w-[132px] truncate" title={row.fundingSourceName}>
                    {row.fundingSourceName}
                  </span>
                </Td>
              )}
              {/*
                Capped and clipped, with the full label on hover and for a screen reader, the
                same treatment the funding source column already gets.

                These labels are sentences — "Paid by us, reimbursement requested" — and they
                repeat on every row, so left to wrap they took three lines each and set the
                height of the entire table. One line per row is what makes the list scannable;
                the value is the same on most rows anyway, so it is the column you read least.
              */}
              <Td className="text-[15px] text-sub">
                <span className="block max-w-[150px] truncate" title={row.paymentSource}>
                  {row.paymentSource}
                </span>
              </Td>
              {/* The one figure on the row, so it carries the weight the repeated red used to. */}
              <Td align="right" numeric bold>
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
                    {row.supporting.length}
                  </button>
                ) : (
                  "-"
                )}
              </Td>
              <Td>
                {row.hasNarrative ? (
                  <StatusPill tone="ok">Provided</StatusPill>
                ) : (
                  <StatusPill tone="missing">Missing</StatusPill>
                )}
              </Td>
              <Td align="right" stickyEnd className="whitespace-nowrap">
                {/* Edit, Delete and (for an admin) History all live in this one menu.
                    Rendered for every role: only History is admin-only, the expense actions
                    never were. */}
                <div className="flex justify-end items-center">
                  <Menu
                    label={`Actions for ${row.reference}`}
                    triggerClassName="px-2 py-2.5 text-lg leading-none text-sub hover:text-ink rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    triggerDataTour="expenses-row-menu-trigger"
                    panelDataTour="expenses-row-menu-panel"
                  >
                    <MenuLink href={`/r/expenses/${row.id}/edit`}>Edit</MenuLink>
                    <MenuItem
                      disabled={pending || rowLocked}
                      onClick={() => setConfirming(row)}
                      // `disabled:opacity-100!` beats the item's own `disabled:opacity-50`, which
                      // faded the reason below it too far to read; "Delete" is greyed instead.
                      className={
                        rowLocked
                          ? "flex-col items-start h-auto py-2 gap-0.5 text-sub disabled:opacity-100!"
                          : undefined
                      }
                    >
                      Delete
                      {rowLocked && (
                        <span className="text-xs font-normal normal-case text-ink">
                          {UI.monthLocked(monthLabel(row.month))}
                        </span>
                      )}
                    </MenuItem>
                    {isAdmin && <MenuItem onClick={() => openHistory(row)}>History</MenuItem>}
                  </Menu>
                </div>
              </Td>
            </tr>
            );
          })}
        </tbody>
      </TableCard>

      {visible.length === 0 && (
        <div className="py-10 text-center text-base text-sub">
          No expenses match these filters.
        </div>
      )}

      {viewer}

      {/* Keyed on the row id so switching rows without an intervening close remounts fresh —
          otherwise the previous row's diff-view step would carry over as stale state. Only
          ever opened for an admin (the row menu never offers "History" otherwise). */}
      <HistoryModal
        key={viewingHistory?.id ?? "none"}
        row={viewingHistory}
        history={history}
        pending={historyPending}
        error={historyError}
        onClose={() => setViewingHistory(null)}
      />
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
    return <StatusPill tone="missing">Missing</StatusPill>;
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
        {documents.length}
      </span>
    </button>
  );
}
