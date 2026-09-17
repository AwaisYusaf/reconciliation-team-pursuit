/**
 * Whether the Dashboard's "Monthly summary ready" link (Phase 11 §7.5) must switch the header's
 * active funding source before navigating to /r/monthly-summary. That screen follows the
 * header's own funding source and month, so opening it from the "All" view (`selectedId` null)
 * or from another source's section would land on the source picker unless the header is
 * switched to this link's source first.
 */
export function summaryLinkNeedsSourceSwitch(selectedId: string | null, sourceId: string): boolean {
  return selectedId !== sourceId;
}
