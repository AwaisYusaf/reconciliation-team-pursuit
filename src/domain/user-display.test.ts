import { describe, expect, it } from "vitest";

import { userDisplay } from "./user-display";

describe("userDisplay", () => {
  it("returns the name when present", () => {
    expect(userDisplay("Jane Doe", "jane@example.test")).toBe("Jane Doe");
  });

  it("falls back to email when name is null", () => {
    expect(userDisplay(null, "jane@example.test")).toBe("jane@example.test");
  });

  it("falls back to email when name is undefined", () => {
    expect(userDisplay(undefined, "jane@example.test")).toBe("jane@example.test");
  });

  it("falls back to email when name is an empty string", () => {
    expect(userDisplay("", "jane@example.test")).toBe("jane@example.test");
  });

  it("falls back to email when name is whitespace-only", () => {
    expect(userDisplay("   ", "jane@example.test")).toBe("jane@example.test");
  });

  it("trims surrounding whitespace off a real name", () => {
    expect(userDisplay("  Jane Doe  ", "jane@example.test")).toBe("Jane Doe");
  });
});
