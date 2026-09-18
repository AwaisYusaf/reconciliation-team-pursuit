"use client";

import { Button } from "@/src/components/ui/button";
import { PLUS_FRAME_STYLE, PlusBadge, SparkleIcon } from "@/src/components/ui/plus-badge";
import { Helper } from "@/src/components/ui/field";
import { formatMoney } from "@/src/domain/format";
import { amountFigures, UI } from "@/src/domain/strings";
import type { AmountSuggestion, SuggestionLine } from "@/src/domain/amount-suggestion";

/**
 * The Subtotal/Tax/Fees suggestion panel (Phase 10, Appendix A §2) — three states, always
 * rendered from `aggregateAmountSuggestion`'s output rather than re-deriving anything here.
 */
export function AmountSuggestionPanel({
  suggestion,
  onUse,
  onDismiss,
}: {
  suggestion: AmountSuggestion;
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
            <Button onClick={onUse}>{UI.useTheseAmounts}</Button>
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
