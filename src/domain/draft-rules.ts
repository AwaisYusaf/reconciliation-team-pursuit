/**
 * What a draft still needs before it can become a real expense (Phase 14 §7).
 *
 * One source of truth for three things that must never disagree: the plain-words list on each
 * draft row, whether its Approve button is offered at all, and which drafts "Approve all ready"
 * actually approves. The last of those runs on the server over rows it re-read itself, so a
 * client that lies about a draft being ready cannot get it approved.
 *
 * The rule is the ticket's: a name, a line item, a payment source, a date and a narrative. The
 * receipt and the proof of payment stay optional here exactly as they are on a hand-added
 * expense, because they gate the download, not the save (R4.3 vs R4.7).
 *
 * Pure and database-free, so both callers can use it without one of them reaching for a query.
 */
import { isValidIsoDate } from "./dates";
import { UI } from "./strings";

/** The parts of a draft this judges. Anything else on the row is irrelevant to approving. */
export type DraftReadiness = {
  name: string;
  lineItemId: string | null;
  paymentSource: string;
  date: string;
  narrative: string | null;
};

/**
 * What is missing, in the order a person reads the row, or an empty list when nothing is.
 *
 * Only the two the ticket names get their own words, because they are the two the import can
 * legitimately leave blank. A missing name, payment source or date is not reachable through the
 * import path (the check screen requires a name, the payment source falls back to the
 * organization's usual one, and the date is the invoice's), so each falls back to the same
 * generic sentence the expense form already uses rather than inventing copy for a state the
 * feature cannot produce. A missing proof of payment is deliberately NOT listed: it is shown
 * the normal way in the row's own documents column, and saying it twice would read as a
 * blocker when it is not (ticket §5).
 */
export function draftNeeds(draft: DraftReadiness): string[] {
  const needs: string[] = [];
  if (draft.lineItemId === null) needs.push(UI.draftNeedsLineItem);
  if (!draft.narrative?.trim()) needs.push(UI.draftNeedsNarrative);
  if (!draft.name.trim() || !draft.paymentSource.trim() || !isValidIsoDate(draft.date)) {
    needs.push(UI.expenseMissingFields);
  }
  return needs;
}

/** A draft with nothing missing. The Approve button and the bulk approve both ask only this. */
export function draftIsReady(draft: DraftReadiness): boolean {
  return draftNeeds(draft).length === 0;
}
