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
  /**
   * A `data-tour` value clicked, once, right before `target` is resolved — what lets a tour
   * put the page into the state its own step actually describes instead of just pointing at a
   * closed control: switching a Settings tab, opening the Line Items "Manage" modal, or
   * opening a row's ⋮ menu (Phase 7, D-95 follow-up — "show the edit and others", not just
   * describe them). Only clicked when the resolved element's `aria-expanded` isn't already
   * `"true"`, so revisiting a step that already opened a toggle (Back, then Next again) can't
   * accidentally close it back up.
   */
  autoOpen?: string;
};

export type ResolvedStep<El> = { el: El; step: TourStep };

/** Resolves one step's `target` against `find`, first-present-wins across its fallback list. */
export function resolveOneStep<El>(
  step: TourStep,
  find: (dataTourKey: string) => El | null,
): El | null {
  const candidates = Array.isArray(step.target) ? step.target : [step.target];
  for (const key of candidates) {
    const el = find(key);
    if (el) return el;
  }
  return null;
}

export function resolveTourSteps<El>(
  steps: readonly TourStep[],
  find: (dataTourKey: string) => El | null,
): ResolvedStep<El>[] {
  const resolved: ResolvedStep<El>[] = [];
  for (const step of steps) {
    const el = resolveOneStep(step, find);
    if (el) resolved.push({ el, step });
  }
  return resolved;
}
