/**
 * Making arbitrary text safe for pdf-lib's standard fonts.
 *
 * The generated PDF sections draw with Helvetica, a standard font whose encoding is WinAnsi
 * (CP1252). pdf-lib *throws* on any character outside it, so a single invisible character in
 * an organisation or line item name — a non-breaking hyphen or zero-width space, both of
 * which ride along invisibly when text is pasted from Word or a PDF — would abort the whole
 * packet build with an error pointing nowhere near Settings.
 *
 * Names are user data and cannot be restricted to Latin-1, so the text is folded to the
 * closest representable form instead: typographic punctuation maps to its ASCII equivalent,
 * accented letters decompose, invisible characters vanish, and anything genuinely
 * unrepresentable becomes "?" — a visibly imperfect document beats no document at all.
 */

/** CP1252's high range: the characters WinAnsi adds above ASCII and Latin-1. */
const CP1252_HIGH = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Direct substitutions for characters that have an obvious plain equivalent. */
const SUBSTITUTIONS: Record<string, string> = {
  " ": " ", // non-breaking space
  " ": " ", // figure space
  " ": " ", // narrow no-break space
  "‑": "-", // non-breaking hyphen
  "‒": "-", // figure dash
  "―": "-", // horizontal bar
  "−": "-", // minus sign
  "​": "", // zero-width space
  "‌": "", // zero-width non-joiner
  "‍": "", // zero-width joiner
  "﻿": "", // byte-order mark
  "­": "", // soft hyphen
  "⁄": "/", // fraction slash
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',

  // Letters whose diacritic is a stroke through the glyph rather than a combining mark, so
  // NFKD cannot decompose them. Common in Polish and Croatian names, where "?" would be a
  // poor showing on a document with someone's name on it.
  "Ł": "L",
  "ł": "l",
  "Đ": "D",
  "đ": "d",
  "Ħ": "H",
  "ħ": "h",
  "Ŧ": "T",
  "ŧ": "t",
  "ı": "i",
};

function encodable(character: string): boolean {
  const code = character.codePointAt(0)!;
  // Printable ASCII, Latin-1 supplement, or one of CP1252's additions.
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    CP1252_HIGH.includes(character)
  );
}

/**
 * Fold `text` to something a standard font can draw.
 *
 * Never throws and never returns a character pdf-lib will reject.
 */
export function winAnsiSafe(text: string): string {
  let result = "";

  for (const character of text) {
    const substitute = SUBSTITUTIONS[character];
    if (substitute !== undefined) {
      result += substitute;
      continue;
    }
    if (encodable(character)) {
      result += character;
      continue;
    }

    // Strip diacritics before giving up: "ł" has no Latin-1 form but "Ł" → "L" is better
    // than "?", and "é" survives as itself.
    const decomposed = character
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .split("")
      .filter(encodable)
      .join("");

    result += decomposed || "?";
  }

  return result;
}
