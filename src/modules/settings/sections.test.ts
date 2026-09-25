/** U-13: which Settings section a `?section=` link opens (Phase 16 P19). */
import { describe, expect, it } from "vitest";

import { DEFAULT_SECTION, parseSettingsSection, SECTION_IDS } from "./sections";

describe("parseSettingsSection", () => {
  it.each(SECTION_IDS.filter((id) => id !== "users"))("opens %s for anyone", (id) => {
    expect(parseSettingsSection(id, false)).toBe(id);
    expect(parseSettingsSection(id, true)).toBe(id);
  });

  it("opens Users for an admin only; a manager gets Organization", () => {
    expect(parseSettingsSection("users", true)).toBe("users");
    expect(parseSettingsSection("users", false)).toBe(DEFAULT_SECTION);
  });

  it.each([undefined, null, "", "Plan", "billing", "constructor", "__proto__", ["plan"], 1])(
    "anything else (%j) opens Organization",
    (value) => {
      expect(parseSettingsSection(value, true)).toBe("organization");
    },
  );

  it("Plan & billing sits near the end, before Account (D4)", () => {
    expect(SECTION_IDS.slice(-2)).toEqual(["plan", "account"]);
  });
});
