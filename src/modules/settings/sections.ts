/**
 * The Settings sidebar's sections, in order, and how a `?section=` link picks one (Phase 15 P19,
 * U-13). Pure, so both the server page and the client component use the same list and the
 * parsing is unit-tested.
 */
export const SECTION_IDS = [
  "organization",
  "fundingSources",
  "labels",
  "vendors",
  "users",
  // Near the end, not first (D4): rarely opened, and the Plus pill and banners link straight to it.
  "plan",
  "account",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const DEFAULT_SECTION: SectionId = "organization";

/**
 * The section a `?section=` value opens. Only known ids are accepted; anything else (missing,
 * misspelled, an array from a repeated parameter) opens Organization. "users" is admin-only
 * (D-85), so a manager asking for it also gets Organization.
 */
export function parseSettingsSection(value: unknown, isAdmin: boolean): SectionId {
  if (typeof value !== "string") return DEFAULT_SECTION;
  const id = (SECTION_IDS as readonly string[]).includes(value) ? (value as SectionId) : DEFAULT_SECTION;
  return id === "users" && !isAdmin ? DEFAULT_SECTION : id;
}
