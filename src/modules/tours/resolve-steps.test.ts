import { describe, expect, it } from "vitest";

import { resolveTourSteps, type TourStep } from "./resolve-steps";

describe("resolveTourSteps", () => {
  it("resolves an ordinary single-target step when it's present", () => {
    const steps: TourStep[] = [{ target: "a", title: "A", body: "" }];
    const result = resolveTourSteps(steps, (key) => (key === "a" ? "el-a" : null));
    expect(result).toEqual([{ el: "el-a", step: steps[0] }]);
  });

  it("drops a step whose target isn't present, rather than blocking on it", () => {
    const steps: TourStep[] = [
      { target: "present", title: "Shown", body: "" },
      { target: "absent", title: "Never shown", body: "" },
    ];
    const result = resolveTourSteps(steps, (key) => (key === "present" ? "el" : null));
    expect(result).toEqual([{ el: "el", step: steps[0] }]);
  });

  it("returns an empty list when every step's target is absent", () => {
    const steps: TourStep[] = [{ target: "missing", title: "Never shown", body: "" }];
    expect(resolveTourSteps(steps, () => null)).toEqual([]);
  });

  it("Recurring's fallback: prefers the first candidate over the second when both exist", () => {
    const steps: TourStep[] = [
      { target: ["recurring-add-to-month", "recurring-add-item"], title: "Add", body: "" },
    ];
    const find = (key: string) =>
      key === "recurring-add-to-month" || key === "recurring-add-item" ? `el-${key}` : null;
    const result = resolveTourSteps(steps, find);
    expect(result).toEqual([{ el: "el-recurring-add-to-month", step: steps[0] }]);
  });

  it("Recurring's fallback: falls back to the empty-state button when the row button is absent", () => {
    const steps: TourStep[] = [
      { target: ["recurring-add-to-month", "recurring-add-item"], title: "Add", body: "" },
    ];
    const find = (key: string) => (key === "recurring-add-item" ? "el-empty-state" : null);
    const result = resolveTourSteps(steps, find);
    expect(result).toEqual([{ el: "el-empty-state", step: steps[0] }]);
  });

  it("preserves the given step order for the ones that resolve", () => {
    const steps: TourStep[] = [
      { target: "first", title: "1", body: "" },
      { target: "gone", title: "2", body: "" },
      { target: "third", title: "3", body: "" },
    ];
    const find = (key: string) => (key === "gone" ? null : `el-${key}`);
    const result = resolveTourSteps(steps, find);
    expect(result.map((r) => r.step.title)).toEqual(["1", "3"]);
  });
});
