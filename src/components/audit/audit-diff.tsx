"use client";

/**
 * The before/after diff view for one audit event (D-87/D-89), hosted by the Expenses table's
 * three-dot "View history" modal.
 *
 * Its own module rather than living in that table: the diff rendering is the substantial part
 * and has nothing to do with the expense list around it. It was also once shared with an
 * org-wide `/r/audit` page, which has since been removed in favour of the per-expense view.
 */
import { useMemo, useState } from "react";

import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateUS, monthLabel } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import type { ExpenseAuditActionType, ExpenseAuditSnapshot } from "@/src/db/schema";
import type { OrgAuditEvent } from "@/src/modules/expenses/queries";

export const ACTION_LABELS: Record<ExpenseAuditActionType, string> = {
  created: "Created",
  edited: "Edited",
  deleted: "Deleted",
  restored: "Restored",
  permanently_deleted: "Permanently deleted",
};

/** Visible, non-em-dash placeholder for a blank field in the diff dialog. */
const NONE = "None";

/** Reads the `fromInvoice` flag `approveDraftAction` writes into a "created" snapshot's jsonb,
 *  without touching `ExpenseAuditSnapshot` in schema.ts (off limits). Not added to `FIELDS`
 *  below on purpose: that list renders in full in the single-column view, so a field there
 *  would put a "None" row on every hand-typed expense. */
function fromInvoice(snapshot: ExpenseAuditSnapshot | null): boolean {
  return Boolean(snapshot && (snapshot as ExpenseAuditSnapshot & { fromInvoice?: boolean }).fromInvoice);
}

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
    label: "Funding source",
    value: (s) => s.fundingSourceName || NONE,
    differs: (a, b) => (a.fundingSourceName ?? "") !== (b.fundingSourceName ?? ""),
  },
  {
    label: "Line item",
    value: (s) => s.lineItemName || NONE,
    // lineItemId is deliberately never shown on its own (noise) — but a change to the id with
    // an unchanged name (a rename collision, or a delete/recreate) must still surface as a row.
    differs: (a, b) => a.lineItemId !== b.lineItemId || a.lineItemName !== b.lineItemName,
  },
  {
    label: "Payment source",
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
    label: "Tax reimbursable",
    value: (s) => (s.taxReimbursable ? "Yes" : "No"),
    differs: (a, b) => a.taxReimbursable !== b.taxReimbursable,
  },
  {
    label: "Fees reimbursable",
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
    label: "No receipt available",
    value: (s) => (s.noReceipt ? "Yes" : "No"),
    differs: (a, b) => a.noReceipt !== b.noReceipt,
  },
  {
    label: "Reason for no receipt",
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

/**
 * Ceiling on the LCS table, as a token-pair count: above it, fall back to plain text.
 *
 * The budget that matters here is memory, not time. The table is one tagged value per pair,
 * so a pair count is directly a byte count (×8) — measured at the previous 4000×4000 ceiling
 * it was 122 MB of heap for 155 ms of work. Nothing caps narrative length, four fields on one
 * event are diffable, and this runs in the viewer's tab, so that ceiling allowed a single
 * "View changes" click to ask for roughly half a gigabyte. 2.25M pairs is ~18 MB and ~20 ms,
 * covers a 750-word-per-side edit in full, and anything longer still renders — just as the
 * plain before/after columns rather than a word-level diff.
 */
const MAX_DIFF_PAIRS = 1500 * 1500;

function diffWords(a: string, b: string): DiffBlock[] | null {
  const tokenize = (s: string) => s.match(/\S+|\s+/g) ?? [];
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);

  if (aTokens.length * bTokens.length > MAX_DIFF_PAIRS) return null;

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
              // Tokens, not raw Tailwind palette: no component here hardcodes a colour
              // (globals.css). `diff-added`/`diff-removed` rather than the `success-bg`/
              // `danger-bg` panel washes — a wash is too dim to pick a changed word out of a
              // paragraph, which is the whole job here.
              side === "before"
                ? "bg-diff-removed text-danger line-through rounded-[2px] no-underline"
                : "bg-diff-added text-success rounded-[2px] no-underline"
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
          {group.truncatedStart && <span className="text-sub italic">… </span>}
          <DiffSide blocks={group.blocks} side={side} />
          {group.truncatedEnd && <span className="text-sub italic"> …</span>}
        </li>
      ))}
    </ul>
  );
}

/** The diff view's content for one audit event — no dialog chrome, so a caller can host it
 *  inside whatever overlay makes sense for it (today: `Modal`, from the Expenses table's
 *  three-dot menu). */
export function AuditDiffContent({ event }: { event: OrgAuditEvent }) {
  // Which diffable fields (by label) are pinned open to their full before/after text for the
  // currently viewed event, instead of the default compact change list.
  //
  // Reset by remounting — every call site passes `key={event.id}` — rather than the
  // effect-plus-setState this used to do, so switching rows still can't carry a stale
  // "expanded" state onto an unrelated event, without the cascading extra render
  // (`react-hooks/set-state-in-effect`) that pattern costs.
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>({});

  const before = event.beforeData;
  const after = event.afterData;

  /**
   * Every changed field's diff, computed once per event instead of on every render.
   *
   * `diffWords` allocates an LCS table per diffable field (see `MAX_DIFF_PAIRS`), and toggling
   * one field's "Show full text" re-renders this whole table — so without memoising, each such
   * click rebuilt *every* field's diff from scratch. Null when there is only one side to show,
   * which is the single-column view below.
   */
  const rows = useMemo(() => {
    if (!before || !after) return null;
    return FIELDS.filter((field) => field.differs(before, after)).map((field) => {
      const beforeValue = field.value(before);
      const afterValue = field.value(after);
      const blocks = field.diffable ? diffWords(beforeValue, afterValue) : null;
      return {
        label: field.label,
        beforeValue,
        afterValue,
        blocks,
        changeCount: blocks ? blocks.filter((block) => block.type === "changed").length : 0,
        groups: blocks ? groupChanges(blocks) : [],
      };
    });
  }, [before, after]);

  return rows ? (
    <>
      {fromInvoice(after) && <p className="text-[15px] text-sub mb-3">Created from an invoice</p>}
      <TableCard minWidth={640}>
        <thead>
          <tr>
            <Th>Field</Th>
            <Th>Before</Th>
            <Th>After</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, beforeValue, afterValue, blocks, changeCount, groups }) => {
          // Not diffable, or too long to diff within the memory ceiling (see MAX_DIFF_PAIRS) —
          // fall back to the plain two-column view.
          if (!blocks) {
            return (
              <tr key={label}>
                <Td bold>{label}</Td>
                <Td>{beforeValue}</Td>
                <Td>{afterValue}</Td>
              </tr>
            );
          }

          const expanded = expandedFields[label] ?? false;

          return (
            <tr key={label}>
              <Td bold>
                {label}
                <div className="text-[13px] font-normal text-sub mt-0.5">
                  {changeCount} {changeCount === 1 ? "change" : "changes"}
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedFields((prev) => ({ ...prev, [label]: !prev[label] }))}
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
    </>
  ) : (
    <>
      {fromInvoice(before ?? after) && (
        <p className="text-[15px] text-sub mb-3">Created from an invoice</p>
      )}
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
    </>
  );
}
