/**
 * Header helpers shared by the download routes.
 *
 * Pure and dependency-free so they can be unit tested without a database.
 */

/**
 * `Content-Disposition` for a file download.
 *
 * Filenames reaching this can be user-supplied (an uploaded document's own name), so the
 * quoted form is stripped of anything that could terminate the quoted string or start a
 * second header, and the RFC 5987 form carries the exact name for clients that read it.
 * Both are sent: `filename*` wins wherever it is understood, and the ASCII fallback keeps
 * older clients from inventing a name.
 */
export function attachmentHeader(filename: string): string {
  // An uploaded name can be arbitrarily long. Left unbounded it produces a header larger
  // than most reverse proxies accept, which makes the document undownloadable rather than
  // merely oddly named.
  const bounded = filename.slice(0, MAX_FILENAME_LENGTH);

  const fallback =
    // Control characters, quotes and backslashes are the header-injection surface; the
    // rest of ASCII is safe inside a quoted-string.
    bounded
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/["\\]/g, "")
      .trim() || "download";

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeExtValue(bounded)}`;
}

const MAX_FILENAME_LENGTH = 120;

/**
 * RFC 8187 ext-value encoding.
 *
 * `encodeURIComponent` leaves `'`, `(`, `)`, `*` and `!` unescaped, and `'` is the
 * delimiter that separates the charset and language from the value — so a file called
 * `Bob's receipt.pdf` would produce a header a strict parser reads as malformed.
 */
function encodeExtValue(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `inline` disposition, for previews rendered in the page rather than saved. */
export const INLINE_DISPOSITION = "inline";
