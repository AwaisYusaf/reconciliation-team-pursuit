"use client";

/**
 * Org-wide audit log table (D-87) — filter, pagination and the before/after diff dialog.
 * The page itself stays a server component; this is the interactive part next to it.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

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
 * kept for the two-column edit view; `value` is shared by every view. `diffable` marks the
 * long free-text fields that get the word-level change list below — short/structured fields
 * (dates, money, month, yes/no) are cheap to eyeball as-is and don't need it.
 */
const FIELDS: {
  label: string;
  value: (snapshot: ExpenseAuditSnapshot) => string;
  differs: (before: ExpenseAuditSnapshot, after: ExpenseAuditSnapshot) => boolean;
  diffable?: boolean;
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
    diffable: true,
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
  {
    label: "Note",
    value: (s) => s.note || NONE,
    differs: (a, b) => (a.note ?? "") !== (b.note ?? ""),
    diffable: true,
  },
  {
    label: "Narrative",
    value: (s) => s.narrative || NONE,
    differs: (a, b) => (a.narrative ?? "") !== (b.narrative ?? ""),
    diffable: true,
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
    diffable: true,
  },
];

/**
 * Word-level diff for long free-text fields, expressed as alternating blocks of untouched
 * text and changed text. Blocks (rather than a flat token list) are what let us later group
 * nearby edits into one readable snippet instead of reconstructing the whole paragraph.
 */
type DiffBlock =
  | { type: "equal"; tokens: string[] }
  | { type: "changed"; beforeTokens: string[]; afterTokens: string[] };

// LCS is O(n*m) in token count. Above this, a full diff isn't worth the compute — fall back
// to plain text rather than risk freezing the tab on a pathologically long blob.
const MAX_DIFF_TOKENS = 4000;

function diffWords(a: string, b: string): DiffBlock[] | null {
  const tokenize = (s: string) => s.match(/\S+|\s+/g) ?? [];
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);

  if (aTokens.length * bTokens.length > MAX_DIFF_TOKENS * MAX_DIFF_TOKENS) return null;

  const n = aTokens.length;
  const m = bTokens.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aTokens[i] === bTokens[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  type Op = { kind: "equal" | "remove" | "add"; text: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aTokens[i] === bTokens[j]) {
      ops.push({ kind: "equal", text: aTokens[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "remove", text: aTokens[i] });
      i++;
    } else {
      ops.push({ kind: "add", text: bTokens[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "remove", text: aTokens[i++] });
  while (j < m) ops.push({ kind: "add", text: bTokens[j++] });

  // Merge consecutive same-kind ops into blocks: a run of "equal" becomes one untouched
  // block, a run of "remove"/"add" (an edit made in place) becomes one changed block.
  const blocks: DiffBlock[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].kind === "equal") {
      const tokens: string[] = [];
      while (k < ops.length && ops[k].kind === "equal") tokens.push(ops[k++].text);
      blocks.push({ type: "equal", tokens });
    } else {
      const beforeTokens: string[] = [];
      const afterTokens: string[] = [];
      while (k < ops.length && ops[k].kind !== "equal") {
        if (ops[k].kind === "remove") beforeTokens.push(ops[k].text);
        else afterTokens.push(ops[k].text);
        k++;
      }
      blocks.push({ type: "changed", beforeTokens, afterTokens });
    }
  }
  return blocks;
}

// How many characters of untouched text to keep as context around a change (used both by the
// compact change list and by the "full text" fallback view below). Character count, not word
// count, is what actually determines how long a line looks on screen — a budget in "words"
// gets blown out by a single long URL token.
const CONTEXT_CHARS = 70;

/** Walks forward from the start of `tokens`, keeping whole tokens until `maxChars` is spent. */
function takeHead(tokens: string[], maxChars: number): number {
  let used = 0;
  let i = 0;
  while (i < tokens.length && (used === 0 || used + tokens[i].length <= maxChars)) {
    used += tokens[i].length;
    i++;
  }
  return i;
}

/** Walks backward from the end of `tokens`, keeping whole tokens until `maxChars` is spent. */
function takeTail(tokens: string[], maxChars: number): number {
  let used = 0;
  let i = tokens.length;
  while (i > 0 && (used === 0 || used + tokens[i - 1].length <= maxChars)) {
    used += tokens[i - 1].length;
    i--;
  }
  return i;
}

/**
 * Decides whether an untouched block is worth folding, and if so, returns the bit to keep
 * on each end plus how many words got hidden in between. Returns null when the block is
 * already short enough, has nothing to anchor a collapse to, or the two context windows
 * would overlap anyway — in every case callers just show the block in full.
 */
function collapseEqualTokens(tokens: string[], keepHead: boolean, keepTail: boolean) {
  if (!keepHead && !keepTail) return null;

  const headEnd = keepHead ? takeHead(tokens, CONTEXT_CHARS) : 0;
  const tailStart = keepTail ? takeTail(tokens, CONTEXT_CHARS) : tokens.length;
  if (headEnd >= tailStart) return null; // context windows cover the whole block already

  const hidden = tokens.slice(headEnd, tailStart);
  const hiddenWords = hidden.filter((t) => t.trim() !== "").length;
  if (hiddenWords === 0) return null; // only whitespace in between — not worth an ellipsis

  return { head: tokens.slice(0, headEnd), tail: tokens.slice(tailStart), hiddenWords };
}

/** Renders one side (before/after) of a full, uncollapsed block-based diff. */
function DiffSide({ blocks, side }: { blocks: DiffBlock[]; side: "before" | "after" }) {
  return (
    <span className="whitespace-pre-wrap">
      {blocks.map((block, idx) => {
        if (block.type === "equal") return <span key={idx}>{block.tokens.join("")}</span>;
        const text = side === "before" ? block.beforeTokens.join("") : block.afterTokens.join("");
        // A pure insertion has nothing to show on the "before" side (and a pure deletion
        // nothing on "after") — the highlighted text on the other side already says it all.
        if (!text) return null;
        return (
          <mark
            key={idx}
            className={
              side === "before"
                ? "bg-red-100 text-red-700 line-through rounded-[2px] no-underline"
                : "bg-green-100 text-green-800 rounded-[2px] no-underline"
            }
          >
            {text}
          </mark>
        );
      })}
    </span>
  );
}

/**
 * One entry in the compact change list: a run of blocks bracketing a single edit (or a
 * cluster of edits close enough together that showing them separately would just repeat the
 * same context twice). `truncatedStart`/`truncatedEnd` say whether real document text was
 * folded away right before/after this snippet, so the renderer knows whether to show "…".
 */
type ChangeGroup = { blocks: DiffBlock[]; truncatedStart: boolean; truncatedEnd: boolean };

function groupChanges(blocks: DiffBlock[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  let current: DiffBlock[] = [];
  let currentTruncatedStart = false;

  blocks.forEach((block, idx) => {
    if (block.type === "equal") {
      const collapse = collapseEqualTokens(block.tokens, idx > 0, idx < blocks.length - 1);
      if (collapse) {
        // A real gap: the tail end of the run we were building gets the trailing context for
        // the change just before it, then we close that group and start a fresh one — seeded
        // with the leading context for whatever change comes next.
        if (collapse.head.length > 0) current.push({ type: "equal", tokens: collapse.head });
        if (current.length > 0) {
          groups.push({ blocks: current, truncatedStart: currentTruncatedStart, truncatedEnd: true });
        }
        current = collapse.tail.length > 0 ? [{ type: "equal", tokens: collapse.tail }] : [];
        currentTruncatedStart = true;
        return;
      }
    }
    current.push(block);
  });

  if (current.length > 0) {
    groups.push({ blocks: current, truncatedStart: currentTruncatedStart, truncatedEnd: false });
  }

  return groups;
}

/**
 * Renders one side's column for the compact change list: each change group becomes its own
 * line, built from the SAME `DiffSide` renderer used by the full-text view — so "Before" only
 * ever shows before-text and "After" only ever shows after-text, matching the table's header.
 */
function ChangeGroupsColumn({ groups, side }: { groups: ChangeGroup[]; side: "before" | "after" }) {
  return (
    <ul className="space-y-2">
      {groups.map((group, idx) => (
        <li key={idx} className="text-[15px] leading-relaxed">
          {group.truncatedStart && <span className="text-gray-400 italic">… </span>}
          <DiffSide blocks={group.blocks} side={side} />
          {group.truncatedEnd && <span className="text-gray-400 italic"> …</span>}
        </li>
      ))}
    </ul>
  );
}

function DiffDialog({
  event,
  onDismiss,
}: {
  event: OrgAuditEvent | null;
  onDismiss: () => void;
}) {
  // Which diffable fields (by label) are pinned open to their full before/after text for the
  // currently viewed event, instead of the default compact change list. Reset whenever the
  // viewed event changes so switching rows doesn't carry a stale "expanded" state over onto
  // an unrelated event.
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setExpandedFields({});
  }, [event?.id]);

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
      size="lg"
    >
      {before && after ? (
        <TableCard minWidth={640}>
          <thead>
            <tr>
              <Th>Field</Th>
              <Th>Before</Th>
              <Th>After</Th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.filter((field) => field.differs(before, after)).map((field) => {
              const beforeValue = field.value(before);
              const afterValue = field.value(after);
              const blocks = field.diffable ? diffWords(beforeValue, afterValue) : null;

              // Not diffable, or too long to diff cheaply (see MAX_DIFF_TOKENS) — fall back to
              // the plain two-column view exactly as before.
              if (!blocks) {
                return (
                  <tr key={field.label}>
                    <Td bold>{field.label}</Td>
                    <Td>{beforeValue}</Td>
                    <Td>{afterValue}</Td>
                  </tr>
                );
              }

              const expanded = expandedFields[field.label] ?? false;
              const changeCount = blocks.filter((b) => b.type === "changed").length;
              const groups = groupChanges(blocks);

              return (
                <tr key={field.label}>
                  <Td bold>
                    {field.label}
                    <div className="text-[13px] font-normal text-gray-500 mt-0.5">
                      {changeCount} {changeCount === 1 ? "change" : "changes"}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedFields((prev) => ({ ...prev, [field.label]: !prev[field.label] }))
                      }
                      className="text-[13px] font-normal text-accent underline hover:text-accent-dark"
                    >
                      {expanded ? "Show summary" : "Show full text"}
                    </button>
                  </Td>
                  <Td>
                    {expanded ? (
                      <DiffSide blocks={blocks} side="before" />
                    ) : (
                      <ChangeGroupsColumn groups={groups} side="before" />
                    )}
                  </Td>
                  <Td>
                    {expanded ? (
                      <DiffSide blocks={blocks} side="after" />
                    ) : (
                      <ChangeGroupsColumn groups={groups} side="after" />
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableCard>
      ) : (
        <TableCard minWidth={480}>
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