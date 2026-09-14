/**
 * The tour engine's step-resolution algorithm, pulled out of `tour.tsx` and kept free of
 * `document`/DOM types (Phase 7, D-94).
 *
 * A step whose target isn't on the page right now is dropped, not blocked on — the one
 * mechanism that covers every "only when relevant" case in the spec: the funding-source step,
 * the "cannot be downloaded yet" step, and Recurring's own two-button fallback (prefer the
 * per-row "Add to month" button, else the empty-state "+ Add recurring item" button). Kept as a
 * plain function, injected with a lookup rather than calling `document.querySelector` itself,
 * so this — including the fallback branch — can be unit tested without a jsdom harness this
 * repo doesn't otherwise use (`vitest.config.ts` runs `environment: "node"` throughout).
 */
export type TourStep = {
  /** One or more `data-tour` values, tried in order — the first one present wins. A single
   *  string for an ordinary step; an array for a "prefer this, else fall back to that" case. */
  target: string | readonly string[];
  title: string;
  body: string;
};

export type ResolvedStep<El> = { el: El; step: TourStep };

export function resolveTourSteps<El>(
  steps: readonly TourStep[],
  find: (dataTourKey: string) => El | null,
): ResolvedStep<El>[] {
  const resolved: ResolvedStep<El>[] = [];
  for (const step of steps) {
    const candidates = Array.isArray(step.target) ? step.target : [step.target];
    for (const key of candidates) {
      const el = find(key);
      if (el) {
        resolved.push({ el, step });
        break;
      }
    }
  }
  return resolved;
}
