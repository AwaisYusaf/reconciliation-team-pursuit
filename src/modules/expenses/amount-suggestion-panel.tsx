"use client";

import type { Ref } from "react";

import { Button } from "@/src/components/ui/button";
import { PLUS_FRAME_STYLE, PlusBadge, SparkleIcon } from "@/src/components/ui/plus-badge";
import { Helper } from "@/src/components/ui/field";
import { SavedTick } from "@/src/components/ui/surfaces";
import { formatMoney } from "@/src/domain/format";
import { amountFigures, UI } from "@/src/domain/strings";
import type { AmountSuggestion, SuggestionLine } from "@/src/domain/amount-suggestion";

/**
 * The Subtotal/Tax/Fees suggestion panel (Phase 10, Appendix A §2) — three states, always
 * rendered from `aggregateAmountSuggestion`'s output rather than re-deriving anything here.
 */
export function AmountSuggestionPanel({
  suggestion,
  applied,
  onUse,
  onDismiss,
}: {
  suggestion: AmountSuggestion;
  /** Subtotal, Tax and Fees already hold these amounts: "✓ Amounts used" replaces the Use
   *  button, and the button comes back once a field or the suggestion changes (usability #58). */
  applied: boolean;
  onUse: () => void;
  onDismiss: () => void;
}) {
  // "nothing" shows no panel: each file row already says "No amount found", and a second box
  // saying the same thing read as an error (user feedback, 2026-09-17).
  if (suggestion.state === "hidden" || suggestion.state === "nothing") return null;

  return (
    <div
      aria-live="polite"
      className="rounded-[3px] bg-autofill px-4 py-3.5"
      style={PLUS_FRAME_STYLE}
    >
      {suggestion.state === "reading" && (
        <div className="flex items-center gap-2 text-[15px] text-accent font-semibold">
          <SparkleIcon className="motion-safe:animate-pulse" />
          <span className="flex-1">{UI.readingDocuments(suggestion.pendingCount)}</span>
          <PlusBadge size="sm" />
        </div>
      )}

      {suggestion.state === "done" && (
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink mb-3">
            <SparkleIcon className="text-accent" />
            <span className="flex-1">{UI.amountsFoundTitle}</span>
            <PlusBadge size="sm" />
          </div>
          <Figures suggestion={suggestion} />

          <ul className="flex flex-col mt-3 border-t border-line/70">
            {suggestion.lines.map((line) => (
              <Line key={line.key} line={line} />
            ))}
          </ul>

          {suggestion.proofCheck && !suggestion.proofCheck.matches && (
            <div className="text-[15px] text-caution mt-2.5">
              {UI.proofsDifferWarning(
                formatMoney(suggestion.proofCheck.receiptsCents),
                formatMoney(suggestion.proofCheck.proofsCents),
              )}
            </div>
          )}

          {suggestion.someMissing && <Helper className="mt-2.5">{UI.amountsLeftOut}</Helper>}

          <div className="flex flex-wrap gap-x-5 gap-y-1 items-center mt-3.5">
            {applied ? (
              <SavedTick>{UI.amountsUsed}</SavedTick>
            ) : (
              <Button onClick={onUse}>{UI.useTheseAmounts}</Button>
            )}
            <Button variant="quiet" onClick={onDismiss}>
              {UI.dismiss}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The totals as four cells lined up like the Subtotal/Tax/Fees boxes above — two by two on a
 *  phone — with Total paid, the figure that has to match the bank, set apart. */
function Figures({
  suggestion,
}: {
  suggestion: Extract<AmountSuggestion, { state: "done" }>;
}) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-[3px] overflow-hidden border border-line/70 bg-line/70 tabular-nums">
      {amountFigures(suggestion).map((figure) => (
        <div
          key={figure.label}
          className={`px-3 py-2 ${figure.total ? "bg-surface" : "bg-surface/60"}`}
        >
          <dt className="text-[13px] text-sub">{figure.label}</dt>
          <dd
            className={
              figure.total ? "text-[17px] font-bold text-accent" : "text-[17px] font-semibold text-ink"
            }
          >
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One document: its name on the first line, what was read from it on the second, so a long
 *  name or a narrow screen never splits a figure from its label. */
function Line({ line }: { line: SuggestionLine }) {
  return (
    <li className="flex gap-2.5 py-2 border-b border-line/70 last:border-b-0 min-w-0">
      <DocumentIcon />
      <div className="min-w-0 flex-1 text-[14px] tabular-nums">
        <div className="text-ink font-medium truncate" title={line.name}>
          {line.name}
          {line.kind === "proof" && (
            <span className="text-sub font-normal"> {UI.proofOfPaymentTag}</span>
          )}
        </div>
        <div className="text-sub break-words">
          {line.outcome === "none" ? (
            line.reason === "too-long" ? (
              UI.readAmountsTooLongLine
            ) : (
              UI.noAmountFound
            )
          ) : line.kind === "receipt" ? (
            <>
              {UI.receiptLineAmounts(line.amounts)}
              {line.partsMismatch && <div className="text-caution">{UI.receiptDoesNotAddUp}</div>}
            </>
          ) : (
            <>
              {formatMoney(line.amounts.totalCents)}
              {line.matches && <span className="text-success font-medium"> {UI.proofMatches}</span>}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function DocumentIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="w-4 h-4 mt-[3px] shrink-0 text-sub"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" strokeLinejoin="round" />
      <path d="M9.5 1.5v3h3M6 8h4.5M6 10.5h4.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A receipt's vendor and date, each with an Add button (Phase 19). Its own box, just above the
 * amounts panel, rather than rows inside it: that panel can be dismissed, and it draws nothing
 * when no amount was found, while a receipt can still name who was paid and when.
 *
 * Renders nothing when there is nothing to offer. A row the form already holds is passed as
 * null by the form, so pressing Add is what makes its row go away.
 */
export function ReceiptDetailsSuggestion({
  containerRef,
  vendor,
  date,
  onAddVendor,
  onAddDate,
}: {
  /** Lets the form move focus to the Add that is left once one row has gone. */
  containerRef?: Ref<HTMLDivElement>;
  vendor: string | null;
  /** Already formatted for display (9/12/2026). */
  date: string | null;
  /** `fromKeyboard`: pressed with Enter or Space rather than clicked. `at`: the press's own
   *  `event.timeStamp`, so the form can tell a double-click from two choices. */
  onAddVendor: (fromKeyboard: boolean, at: number) => void;
  onAddDate: (fromKeyboard: boolean, at: number) => void;
}) {
  if (vendor === null && date === null) return null;

  return (
    <div
      ref={containerRef}
      aria-live="polite"
      className="flex items-start gap-3 rounded-[3px] bg-autofill px-4 py-3"
      style={PLUS_FRAME_STYLE}
    >
      <ul className="flex-1 min-w-0 flex flex-col gap-1">
        {vendor !== null && (
          <DetailRow
            label={UI.receiptVendorLabel}
            value={vendor}
            addLabel={UI.addReceiptVendorLabel(vendor)}
            onAdd={onAddVendor}
          />
        )}
        {date !== null && (
          <DetailRow
            label={UI.receiptDateLabel}
            value={date}
            addLabel={UI.addReceiptDateLabel(date)}
            onAdd={onAddDate}
          />
        )}
      </ul>
      {/* Its own column beside the rows, which a phone cannot spare: there the amounts box just
          below carries the badge, and the rows get the width. */}
      <PlusBadge size="sm" className="mt-3 max-sm:hidden" />
    </div>
  );
}

/** One suggestion: what was read, and the button that puts it in the form. The text wraps
 *  under a long vendor name rather than pushing Add off a phone's screen. */
function DetailRow({
  label,
  value,
  addLabel,
  onAdd,
}: {
  label: string;
  value: string;
  addLabel: string;
  onAdd: (fromKeyboard: boolean, at: number) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <SparkleIcon className="text-accent" />
      <span className="flex-1 min-w-[9rem] text-[15px] text-ink break-words">
        {label} <span className="font-semibold">{value}</span>
      </span>
      {/* A button pressed with Enter or Space sends a click with no count (`detail` 0). */}
      <Button variant="quiet" aria-label={addLabel} onClick={(event) => onAdd(event.detail === 0, event.timeStamp)}>
        {UI.addReceiptDetail}
      </Button>
    </li>
  );
}
