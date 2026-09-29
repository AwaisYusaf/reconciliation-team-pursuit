/**
 * Matching a vendor read off a receipt to the organization's vendor library (Phase 19).
 *
 * Pure. The receipt says "THE HOME DEPOT #2718" or "Amazon.com"; the library says "Home Depot"
 * and "Amazon". Name prints on the cover sheet (R6.2), so when the two are the same business
 * the library's spelling is the one offered, and choosing it lets vendor memory (R8.1) fill the
 * rest of the form.
 *
 * Deliberately exact after normalising: capitals, accents, punctuation, a leading "The", store
 * numbers (#2718, or three digits or more at the end) and endings such as Inc, LLC or .com are
 * ignored, and nothing else. A looser rule (one name starting with the other) would turn
 * "Amazon Web Services" into "Amazon" and pull in Amazon's line item; dropping any trailing
 * number would make "Motel 6" "Motel" and "Pay Period 3" "Pay Period 1". The library also holds
 * labels and people ("Payroll - Pay Period 1", "Emerald Sims"), since every saved Name is
 * learned, and exact matching never lands on those by accident.
 */

/** Words that end a business's legal or shop name without naming it. */
const TRAILING_WORDS = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "co",
  "corp",
  "corporation",
  "company",
  "lp",
  "llp",
  "pllc",
  "store",
]);

/**
 * The comparable form of a business name: "THE HOME DEPOT #2718" and "Home Depot" both become
 * "home depot". Empty when nothing of a name is left.
 */
export function vendorKey(name: string): string {
  const text = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/\.(com|net|org)\b/g, " ")
    .replace(/#\s*\d+/g, " ")
    // Any script's letters, not just a to z, so two different names in another alphabet never
    // both reduce to nothing and "agree".
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const words = text ? text.split(" ") : [];
  if (words[0] === "the" && words.length > 1) words.shift();
  // A store number is three digits or more; a shorter one is part of the name (Motel 6, Studio 54).
  while (words.length > 1 && (TRAILING_WORDS.has(words.at(-1)!) || /^\d{3,}$/.test(words.at(-1)!))) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * The library's spelling of the vendor read off a receipt, or null when no remembered name is
 * the same business. Two library names that both match (say "Lowes" and "Lowe's") are a tie,
 * and a tie is not guessed: the receipt's own spelling is offered instead.
 */
export function matchLibraryVendor(read: string, library: readonly string[]): string | null {
  const key = vendorKey(read);
  if (!key) return null;
  const matches = library.filter((name) => vendorKey(name) === key);
  return matches.length === 1 ? matches[0] : null;
}

/** Whether a typed Name already says this vendor: capitals and spacing aside, the same text. */
export function sameName(a: string, b: string): boolean {
  const plain = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  return plain(a) === plain(b);
}
