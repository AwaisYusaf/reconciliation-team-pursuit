/** U-13: which Settings section a `?section=` link opens (Phase 16 P19). */
import { describe, expect, it } from "vitest";

import { DEFAULT_SECTION, parseSettingsSection, SECTION_IDS } from "./sections";

describe("parseSettingsSection", () => {
  it.each(SECTION_IDS.filter((id) => id !== "users"))("opens %s for anyone while billing is on", (id) => {
    expect(parseSettingsSection(id, false, true)).toBe(id);
    expect(parseSettingsSection(id, true, true)).toBe(id);
  });

  it("while billing is off there is no Plan & billing: a link to it opens Organization", () => {
    expect(parseSettingsSection("plan", true, false)).toBe(DEFAULT_SECTION);
    expect(parseSettingsSection("plan", false, false)).toBe(DEFAULT_SECTION);
    expect(parseSettingsSection("account", true, false)).toBe("account");
  });

  it("opens Users for an admin only; a manager gets Organization", () => {
    expect(parseSettingsSection("users", true, true)).toBe("users");
    expect(parseSettingsSection("users", false, true)).toBe(DEFAULT_SECTION);
  });

  it.each([undefined, null, "", "Plan", "billing", "constructor", "__proto__", ["plan"], 1])(
    "anything else (%j) opens Organization",
    (value) => {
      expect(parseSettingsSection(value, true, true)).toBe("organization");
    },
  );

  it("Plan & billing sits near the end, before Account (D4)", () => {
    expect(SECTION_IDS.slice(-2)).toEqual(["plan", "account"]);
  });
});
