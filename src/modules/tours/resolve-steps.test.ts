import { describe, expect, it } from "vitest";

import {
  countResolvableAfter,
  fitsVertically,
  popShownStep,
  pushShownStep,
  resolveOneStep,
  sideRoom,
  type TargetBox,
  type TourStep,
} from "./resolve-steps";

describe("resolveOneStep", () => {
  it("resolves a single-target step when present", () => {
    const step: TourStep = { target: "a", title: "A", body: "" };
    expect(resolveOneStep(step, (key) => (key === "a" ? "el-a" : null))).toBe("el-a");
  });

  it("returns null when the target is absent", () => {
    const step: TourStep = { target: "missing", title: "Never shown", body: "" };
    expect(resolveOneStep(step, () => null)).toBeNull();
  });

  it("prefers the first fallback candidate over the second when both exist", () => {
    const step: TourStep = { target: ["first", "second"], title: "Add", body: "" };
    expect(resolveOneStep(step, () => "el")).toBe("el"); // both resolve to the same stub; order proven below
    const order: string[] = [];
    resolveOneStep(step, (key) => {
      order.push(key);
      return "el";
    });
    expect(order).toEqual(["first"]); // stops at the first match, never even checks "second"
  });

  it("falls back to the second candidate when the first is absent", () => {
    const step: TourStep = { target: ["first", "second"], title: "Add", body: "" };
    expect(resolveOneStep(step, (key) => (key === "second" ? "el-second" : null))).toBe(
      "el-second",
    );
  });
});

/**
 * Where the step card goes. The engine's own constants are passed in, so these read in the
 * same numbers the real thing uses.
 */
describe("card placement", () => {
  const SPACING = { gap: 12, margin: 12, cardHeight: 285 };

  function box(partial: Partial<TargetBox>): TargetBox {
    return { top: 0, bottom: 0, left: 0, right: 0, height: 0, ...partial };
  }

  it("fits vertically when there is a card's worth of room below", () => {
    const rect = box({ top: 100, bottom: 160, height: 60 });
    expect(fitsVertically(rect, 900, SPACING)).toBe(true);
  });

  it("fits vertically when the room is above instead", () => {
    const rect = box({ top: 600, bottom: 660, height: 60 });
    expect(fitsVertically(rect, 700, SPACING)).toBe(true);
  });

  it("doesn't fit when a tall target leaves too little either side of it", () => {
    // The reported case: the packet's "cannot be downloaded yet" panel on a laptop viewport.
    // 130 above and 225 below, against a 285-tall card — neither is enough, and the old code
    // picked "below" anyway and then clamped the card back up over the panel.
    const rect = box({ top: 130, bottom: 265, height: 135 });
    expect(fitsVertically(rect, 490, SPACING)).toBe(false);
  });

  it("puts the card to the right of a target that leaves room there", () => {
    // The same panel: 820 wide in a 1240 viewport, so ~408px free on the right.
    const rect = box({ top: 130, bottom: 265, left: 52, right: 872, height: 135 });
    expect(sideRoom(rect, 1240, 340, SPACING)).toBe("right");
  });

  it("falls back to the left when only that side has room", () => {
    const rect = box({ left: 500, right: 1230 });
    expect(sideRoom(rect, 1240, 340, SPACING)).toBe("left");
  });

  it("reports no side at all when the target spans the width", () => {
    const rect = box({ left: 12, right: 1228 });
    expect(sideRoom(rect, 1240, 340, SPACING)).toBeNull();
  });
});

/**
 * What Back walks. The engine used to just decrement the step index, which is only the same
 * thing when no step was ever dropped — see the third case, which is the bug these replace.
 */
describe("shown-step trail", () => {
  it("records each new step the user reaches", () => {
    let trail = pushShownStep([], 0);
    trail = pushShownStep(trail, 1);
    expect(trail).toEqual([0, 1]);
  });

  it("doesn't re-record the step Back just returned to", () => {
    const trail = pushShownStep([0, 1], 1);
    expect(trail).toEqual([0, 1]);
  });

  it("Back skips over a step that was dropped on the way forward", () => {
    // Step 1's target wasn't on the page (an org with one funding source, say), so the user
    // went 0 → 2 and never saw step 1. Back from step 2 must return to step 0: a blind
    // `stepIndex - 1` landed on 1, which the resolver dropped again and pushed forward from,
    // so Back silently did nothing.
    const trail = pushShownStep(pushShownStep([], 0), 2);
    expect(trail).toEqual([0, 2]);

    const back = popShownStep(trail);
    expect(back.index).toBe(0);
    expect(back.trail).toEqual([0]);
  });

  it("reports no earlier step on the first one, so Back isn't offered", () => {
    expect(popShownStep([0]).index).toBeUndefined();
    expect(popShownStep([]).index).toBeUndefined();
  });

  it("walks all the way back out through several dropped steps", () => {
    let trail = pushShownStep(pushShownStep(pushShownStep([], 0), 3), 5);
    const first = popShownStep(trail);
    expect(first.index).toBe(3);
    trail = first.trail;
    const second = popShownStep(trail);
    expect(second.index).toBe(0);
  });
});

/**
 * The counter behind "Step 3 of 5" and the Next/Done label. Before this existed the engine
 * used raw list positions, so a tour whose conditional steps didn't apply promised a total the
 * user never reached and labelled its real last card "Next".
 */
describe("countResolvableAfter", () => {
  it("counts only the steps after the given index", () => {
    const steps: TourStep[] = [
      { target: "a", title: "1", body: "" },
      { target: "b", title: "2", body: "" },
      { target: "c", title: "3", body: "" },
    ];
    expect(countResolvableAfter(steps, 0, () => "el")).toBe(2);
    expect(countResolvableAfter(steps, 1, () => "el")).toBe(1);
  });

  it("is 0 on the last step, so the card reads Done", () => {
    const steps: TourStep[] = [{ target: "only", title: "1", body: "" }];
    expect(countResolvableAfter(steps, 0, () => "el")).toBe(0);
  });

  it("doesn't count a step whose target is absent", () => {
    const steps: TourStep[] = [
      { target: "here", title: "1", body: "" },
      { target: "gone", title: "2", body: "" },
    ];
    expect(countResolvableAfter(steps, 0, (key) => (key === "here" ? "el" : null))).toBe(0);
  });

  it("Dashboard on a single-source org: the funding-source step is not counted", () => {
    const steps: TourStep[] = [
      { target: "month-selector", title: "1", body: "" },
      { target: "funding-source-selector", title: "2", body: "" },
      { target: "dashboard-closing-balance", title: "3", body: "" },
      { target: "add-expense-nav", title: "4", body: "" },
    ];
    // The selector isn't rendered at all when the org has one source (app/r/layout.tsx).
    const find = (key: string) => (key === "funding-source-selector" ? null : "el");
    // Step 1 of 3, not of 4 — and step 3 really is the last one.
    expect(countResolvableAfter(steps, 0, find)).toBe(2);
    expect(countResolvableAfter(steps, 3, find)).toBe(0);
  });

  it("counts an autoOpen step by its opener, since its own target isn't in the DOM yet", () => {
    const steps: TourStep[] = [
      { target: "settings-sidebar", title: "1", body: "" },
      { target: "settings-labels", autoOpen: "settings-tab-labels", title: "2", body: "" },
    ];
    // The Labels card only exists once its sidebar button has been clicked.
    const find = (key: string) => (key === "settings-tab-labels" ? "el" : null);
    expect(countResolvableAfter(steps, 0, find)).toBe(1);
  });

  it("drops an autoOpen step whose opener is absent — Settings' Users step for a manager", () => {
    const steps: TourStep[] = [
      { target: "settings-sidebar", title: "1", body: "" },
      { target: "settings-users", autoOpen: "settings-tab-users", title: "2", body: "" },
    ];
    // A manager never gets the Users item in the sidebar, so nothing can open that section.
    expect(countResolvableAfter(steps, 0, () => null)).toBe(0);
  });

  it("Recurring's fallback target counts when only the second candidate is present", () => {
    const steps: TourStep[] = [
      { target: "recurring-heading", title: "0", body: "" },
      { target: ["recurring-add-to-month", "recurring-add-item"], title: "1", body: "" },
    ];
    const find = (key: string) => (key === "recurring-add-item" ? "el" : null);
    expect(countResolvableAfter(steps, 0, find)).toBe(1);
  });
});
