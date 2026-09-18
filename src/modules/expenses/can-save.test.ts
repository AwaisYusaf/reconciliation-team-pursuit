/** The expense form's save gate (PR #18 round 2, #6; round 3, #2). */
import { describe, expect, it } from "vitest";

import { canSave } from "./can-save";

describe("canSave", () => {
  it("saves when nothing is running and no photo is converting", () => {
    expect(canSave([], false)).toBe(true);
    expect(canSave([{}, { converting: false }], false)).toBe(true);
  });

  it("waits while any picked HEIC is still converting — saving then lost the photo", () => {
    expect(canSave([{}, { converting: true }], false)).toBe(false);
  });

  it("waits while a save is already running", () => {
    expect(canSave([], true)).toBe(false);
  });
});
