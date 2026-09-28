import { describe, expect, it } from "vitest";

import { initialPresence, nextPresence, type Presence } from "@/src/components/ui/overlay-shell";

/** Feeds a run of `open` values through `nextPresence`, as successive renders would. */
function run(start: boolean, opens: boolean[]): Presence {
  return opens.reduce(nextPresence, initialPresence(start));
}

describe("nextPresence (PHASE-16 §14 A5, A6)", () => {
  it("starts closed and unopened, or open as the first opening", () => {
    expect(initialPresence(false)).toEqual({ open: false, closing: false, opens: 0 });
    expect(initialPresence(true)).toEqual({ open: true, closing: false, opens: 1 });
  });

  it("returns the same state while open doesn't change, so rendering doesn't loop", () => {
    const closed = initialPresence(false);
    expect(nextPresence(closed, false)).toBe(closed);
    const open = run(false, [true]);
    expect(nextPresence(open, true)).toBe(open);
  });

  it("opening counts a new opening and is not closing", () => {
    expect(run(false, [true])).toEqual({ open: true, closing: false, opens: 1 });
  });

  it("closing keeps the count and starts the fade", () => {
    expect(run(false, [true, false])).toEqual({ open: false, closing: true, opens: 1 });
  });

  it("reopening mid-fade ends the fade and counts a new opening, so a keyed popup starts fresh", () => {
    expect(run(false, [true, false, true])).toEqual({ open: true, closing: false, opens: 2 });
  });

  it("every opening gets a different key", () => {
    const keys = [];
    let state = initialPresence(false);
    for (let i = 0; i < 3; i++) {
      state = nextPresence(state, true);
      keys.push(state.opens);
      state = nextPresence(state, false);
    }
    expect(new Set(keys).size).toBe(3);
  });
});
