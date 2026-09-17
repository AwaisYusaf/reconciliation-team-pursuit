"use client";

import { Button } from "@/src/components/ui/button";
import { PLUS_FRAME_STYLE, PlusBadge, SparkleIcon } from "@/src/components/ui/plus-badge";
import { Helper } from "@/src/components/ui/field";
import { formatMoney } from "@/src/domain/format";
import { amountsSummaryParts, UI } from "@/src/domain/strings";
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
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink mb-1.5">
            <SparkleIcon className="text-accent" />
            <span className="flex-1">{UI.amountsFoundTitle}</span>
            <PlusBadge size="sm" />
          </div>
          <Summary suggestion={suggestion} />

          <ul className="flex flex-col gap-1.5 mt-2.5 text-[15px]">
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

function Summary({
  suggestion,
}: {
  suggestion: Extract<AmountSuggestion, { state: "done" }>;
}) {
  const { lead, totalPaid } = amountsSummaryParts(suggestion);
  return (
    <div className="text-[15px] tabular-nums">
      {lead}
      <span className="font-bold">{totalPaid}</span>
    </div>
  );
}

function Line({ line }: { line: SuggestionLine }) {
  const kindTag = line.kind === "proof" ? ` ${UI.proofOfPaymentTag}` : "";
  return (
    <li className="tabular-nums break-words">
      {line.name}
      {kindTag}:{" "}
      {line.outcome === "none" ? (
        UI.noAmountFound
      ) : line.kind === "receipt" ? (
        <>
          {UI.receiptLineAmounts(line.amounts)}
          {line.partsMismatch && (
            <div className="text-caution">{UI.receiptDoesNotAddUp}</div>
          )}
        </>
      ) : (
        <>
          {formatMoney(line.amounts.totalCents)}
          {line.matches && ` ${UI.proofMatches}`}
        </>
      )}
    </li>
  );
}
