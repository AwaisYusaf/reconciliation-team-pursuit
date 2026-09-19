/**
 * Em and en dashes out of text the app writes (D-113, PHASE-13 §5).
 *
 * Used on the monthly summary drafts the AI writes. The prompt asks for no dashes, and this makes
 * that a guarantee. Each dash is judged by what touches it, so the replacement reads as the writer
 * meant: a minus sign stays a minus, a range of like figures says "to", an aside or a second
 * clause takes a comma, and a dash that punctuation already covers is dropped.
 *
 * Text people typed keeps its dashes (D-113). A draft quotes names and descriptions from the
 * month's data, so any of those passed in `keep` is put back exactly as typed.
 *
 * The dashes are written as `\u` escapes, so this file passes the no-dashes guard's reading of
 * its own source. It is on that guard's allowlist only because it has to name what it removes.
 */

const DASH = /[\u2013\u2014]/;
const EM_DASH = "\u2014";

/** A run of dashes with the spaces around it. Never line breaks: Markdown's lines must survive. */
const DASH_RUN = /([^\S\r\n]*)([\u2013\u2014]+)([^\S\r\n]*)/g;

// Private-use characters mark where a kept name sits. Any already in a draft are removed first.
const KEEP_OPEN = "\uE000";
const KEEP_CLOSE = "\uE001";
const KEPT = /\uE000(\d+)\uE001/g;
const PRIVATE_MARKS = /[\uE000\uE001]/g;

/** A figure ending just before a dash, or starting just after one: `$5,000.00`, `12%`, `3`. */
const FIGURE_BEFORE = /\$?\d(?:[\d,]*\d)?(?:\.\d+)?%?$/;
const FIGURE_AFTER = /^\$?\d(?:[\d,]*\d)?(?:\.\d+)?%?/;
const LOOK = 40;

type Figure = "money" | "percent" | "number";

function figureKind(figure: string): Figure {
  if (figure.startsWith("$")) return "money";
  return figure.endsWith("%") ? "percent" : "number";
}

/** Two figures a dash can join as a range: the same kind, or a bare number beside either. */
function isRange(left: string, right: string): boolean {
  const a = figureKind(left);
  const b = figureKind(right);
  return a === b || a === "number" || b === "number";
}

const isDigit = (char: string) => /\d/.test(char);
const isAlphanumeric = (char: string) => /[\p{L}\p{N}\uE000\uE001]/u.test(char);
const isLineEdge = (char: string) => char === "" || char === "\n" || char === "\r";

function replacement(lead: string, dashes: string, trail: string, prefix: string, suffix: string): string {
  const before = prefix.charAt(prefix.length - 1);
  const after = suffix.charAt(0);
  const spaced = lead !== "" || trail !== "";
  const em = dashes.includes(EM_DASH);
  const left = FIGURE_BEFORE.exec(prefix)?.[0];
  const right = FIGURE_AFTER.exec(suffix)?.[0];

  // A line that ends on a dash: drop it, and the spaces before it.
  if (isLineEdge(after)) return "";

  // Touching a figure on its right only, and not joining two words: a minus sign.
  if (trail === "" && right && !left && (isLineEdge(before) || lead !== "" || !isAlphanumeric(before))) {
    if (isLineEdge(before) || lead !== "") return `${lead}-`;
    return /[\s([]/.test(before) ? "-" : " -";
  }

  // A line that starts with one: a bullet written with a dash becomes a Markdown bullet.
  if (isLineEdge(before)) return trail !== "" ? `${lead}- ` : lead;

  // Between two figures: a range when they are alike, unless a spaced em dash sets off a clause.
  if (left && right && isRange(left, right) && (!em || !spaced)) return " to ";

  // Joining two words or figures with no spaces.
  if (!spaced && isAlphanumeric(before) && isAlphanumeric(after)) {
    if (em) return ", ";
    return isDigit(before) && !isDigit(after) ? " to " : "-";
  }

  // Punctuation (or the end of a bold or italic run) already on the right: the dash adds nothing.
  if (/[*_]/.test(after)) {
    const past = suffix.replace(/^[*_]+/, "").charAt(0);
    if (past === "" || /[\s.,;:!?)\]]/.test(past)) return "";
  }
  if (/[.,;:!?)\]]/.test(after)) return "";

  // Punctuation, a heading mark or a bracket already on the left.
  if (/[.,;:#]/.test(before)) return " ";
  if (before === "(" || before === "[") return "";

  return ", ";
}

/** `text` with no em or en dash left outside the `keep` strings. */
export function replaceDashes(text: string, options: { keep?: readonly string[] } = {}): string {
  if (!DASH.test(text)) return text;

  // Longest first, so a name that contains a shorter kept name is protected whole.
  const keep = [...new Set(options.keep ?? [])].filter((value) => DASH.test(value)).sort((a, b) => b.length - a.length);
  let protectedText = text.replace(PRIVATE_MARKS, "");
  keep.forEach((value, index) => {
    protectedText = protectedText.split(value).join(`${KEEP_OPEN}${index}${KEEP_CLOSE}`);
  });

  const cleaned = protectedText.replace(
    DASH_RUN,
    (match, lead: string, dashes: string, trail: string, offset: number, whole: string) => {
      // A figure is never longer than this, and a bounded look keeps a reply padded with a very
      // long run of digits from making each dash cost a scan of the whole draft.
      const end = offset + match.length;
      return replacement(lead, dashes, trail, whole.slice(Math.max(0, offset - LOOK), offset), whole.slice(end, end + LOOK));
    },
  );

  return cleaned.replace(KEPT, (match, index: string) => keep[Number(index)] ?? match);
}

/**
 * Every string inside `value` that has a dash among real words: the typed text a draft may quote.
 * A value that is little more than a dash (a description of just one) is left out, or keeping it
 * would protect every dash in the draft.
 */
export function textsWithDashes(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      if (DASH.test(node) && node.trim().length >= 3 && /[\p{L}\p{N}]/u.test(node)) found.add(node);
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...found];
}
