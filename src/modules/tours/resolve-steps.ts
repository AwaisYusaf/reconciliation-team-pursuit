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

/** What `firstShown` reads off a node: structural, so a test can pass plain objects. */
export type Measurable = {
  getClientRects(): { length: number };
  getBoundingClientRect(): { width: number; height: number };
};

/**
 * The first of these nodes that is actually on the screen — how the engine turns a `data-tour`
 * key into an element.
 *
 * Not the first node, because a responsive screen renders the same key twice on purpose: a
 * card list at `lg:hidden` and a table at `hidden lg:block` both carry the row's controls, and
 * only one of them is displayed at any width. `querySelector` returns whichever comes first in
 * the document, which on a desktop is the hidden phone copy — a `display:none` element whose
 * rect is 0×0 at the origin, so the spotlight opened onto an empty box in the corner of the
 * viewport and the step pointed at nothing.
 *
 * Measured rather than inferred from classes: `getClientRects()` is empty for anything
 * `display:none`, whatever put it there, so this holds for a container hidden three levels up
 * as well as for the element itself. The dimension check catches the other shape of the same
 * problem — an element kept in the DOM at zero width to animate, which does report a rect.
 *
 * Returning `null` when every copy is hidden is the point: the resolver skips a step whose
 * target it cannot find, which is the correct outcome for a control that genuinely is not on
 * this screen, and far better than spotlighting a box nobody can see.
 */
export function firstShown<El extends Measurable>(nodes: Iterable<El>): El | null {
  for (const node of nodes) {
    if (node.getClientRects().length === 0) continue;
    const { width, height } = node.getBoundingClientRect();
    if (width > 0 && height > 0) return node;
  }
  return null;
}

/** The part of a `DOMRect` the placement maths needs — kept structural so these stay testable. */
export type TargetBox = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
};

/**
 * Whether a whole step card fits above or below the target without being pushed off screen.
 *
 * `gap` is the breathing room between card and target, `margin` the minimum distance from the
 * viewport edge, `cardHeight` the card's estimated height — all passed in so this file stays
 * free of the engine's layout constants.
 */
export function fitsVertically(
  rect: TargetBox,
  viewportHeight: number,
  { gap, margin, cardHeight }: { gap: number; margin: number; cardHeight: number },
): boolean {
  const below = viewportHeight - rect.bottom - gap;
  const above = rect.top - gap;
  return Math.max(below, above) >= cardHeight + margin;
}

/**
 * Which side of the target a card fits beside, or `null` if neither does. Used only once the
 * vertical placements have been ruled out — a tall target on a short viewport, where the
 * alternative is drawing the card on top of what it describes. The right is preferred simply
 * because content is left-aligned, so the free space is usually there.
 */
export function sideRoom(
  rect: TargetBox,
  viewportWidth: number,
  cardWidth: number,
  { gap, margin }: { gap: number; margin: number },
): "right" | "left" | null {
  if (viewportWidth - rect.right - gap >= cardWidth + margin) return "right";
  if (rect.left - gap >= cardWidth + margin) return "left";
  return null;
}

/**
 * Record that `index` is now on screen. Returns the trail of steps the user has actually seen,
 * oldest first — what Back walks instead of `stepIndex - 1`.
 *
 * A step dropped on the way forward (its target wasn't on the page) is not a step the user
 * ever saw, so decrementing blindly landed on it, failed to resolve it again, and let the
 * resolver push straight forward — Back appeared to do nothing at all (review fix). Arriving
 * *via* Back re-enters a step that is already the trail's last entry, so nothing is appended.
 */
export function pushShownStep(trail: readonly number[], index: number): number[] {
  if (trail[trail.length - 1] === index) return [...trail];
  return [...trail, index];
}

/**
 * Step back one: drops the step being left and names the one to return to. `index` is
 * `undefined` when nothing earlier was ever shown, in which case Back isn't offered at all.
 */
export function popShownStep(trail: readonly number[]): {
  trail: number[];
  index: number | undefined;
} {
  const next = trail.slice(0, -1);
  return { trail: next, index: next[next.length - 1] };
}

/**
 * How many steps after `index` are still likely to show — what the engine needs to print an
 * honest "Step 3 of 5" and to know whether the card in front of the user is really the last
 * one (review fix: the raw list length counted steps that were dropped, so a tour whose
 * trailing steps didn't apply ended on a card labelled "Next", and the counter's total was a
 * number the user would never reach).
 *
 * A step whose own `target` is on the page right now obviously counts. A step with `autoOpen`
 * counts on whether its *opener* is on the page instead: its real target (a Settings section,
 * a modal's contents) does not exist until that opener is clicked, so probing the target
 * itself would always say "gone". An `autoOpen` whose opener is absent — the Users section
 * for a manager, say — correctly counts as dropped.
 */
export function countResolvableAfter<El>(
  steps: readonly TourStep[],
  index: number,
  find: (dataTourKey: string) => El | null,
): number {
  let count = 0;
  for (let i = index + 1; i < steps.length; i += 1) {
    const step = steps[i];
    const reachable = step.autoOpen ? find(step.autoOpen) !== null : resolveOneStep(step, find) !== null;
    if (reachable) count += 1;
  }
  return count;
}
