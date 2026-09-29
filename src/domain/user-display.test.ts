import { describe, expect, it } from "vitest";

import { greetingName, userDisplay } from "./user-display";

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

/** The name in the dashboard's `Welcome, {name}!` (usability #17, E1). */
describe("greetingName", () => {
  it("is the first word of the name", () => {
    expect(greetingName("Mary Anne Carter", "m@example.test")).toBe("Mary");
    expect(greetingName("  Dana  ", "d@example.test")).toBe("Dana");
  });

  it("falls back to the email's local part, never the whole address", () => {
    expect(greetingName(null, "dana.reyes@example.test")).toBe("dana.reyes");
    expect(greetingName("   ", "x@y")).toBe("x");
  });

  it("is empty with no local part, so the page says Welcome! with no name", () => {
    expect(greetingName(null, "@example.test")).toBe("");
  });
});
