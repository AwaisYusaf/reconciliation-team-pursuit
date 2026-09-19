/**
 * Em and en dashes out of text the app writes (D-113, PHASE-13 §5).
 *
 * Used on the monthly summary drafts the AI writes. The prompt asks for no dashes, and this makes
 * that a guarantee. Each dash is judged by what touches it, so the replacement reads as the writer
 * meant: a minus sign stays a minus, a range says "to", an aside or a second clause takes a comma.
 *
 * Text people typed keeps its dashes (D-113). A draft quotes names and descriptions from the
 * month's data, so any of those passed in `keep` is put back exactly as typed.
 *
 * The dashes are written as `\u` escapes, so this file passes the no-dashes guard's reading of
 * its own source. It is on that guard's allowlist only because it has to name what it removes.
 */

const DASH = /[\u2013\u2014]/;
const EN_DASH = "\u2013";

/** A dash with the spaces and tabs around it. Never newlines: Markdown's lines must survive. */
const DASH_RUN = /([ \t]*)([\u2013\u2014])([ \t]*)/g;

// Private-use characters, which no draft or name contains, mark where a kept name sits.
const KEEP_OPEN = "\uE000";
const KEEP_CLOSE = "\uE001";
const KEPT = /\uE000(\d+)\uE001/g;

const isDigit = (char: string) => /\d/.test(char);
const isLetter = (char: string) => /[\p{L}\uE000\uE001]/u.test(char);
const isLineEdge = (char: string) => char === "" || char === "\n" || char === "\r";

function replacement(
  lead: string,
  dash: string,
  trail: string,
  before: string,
  after: string,
): string {
  const spaced = lead !== "" || trail !== "";

  // A line that ends on a dash: drop it, and the spaces before it.
  if (isLineEdge(after)) return "";
  // A line that starts with one: a bullet written with a dash becomes a Markdown bullet.
  if (isLineEdge(before)) return trail !== "" ? `${lead}- ` : lead;
  // Between two figures: a range, unless it's a spaced em dash between two clauses.
  if (/[\d%]/.test(before) && (isDigit(after) || after === "$") && (dash === EN_DASH || !spaced)) return " to ";
  // Touching a figure on its right only, after a space or a bracket: a minus sign.
  if (lead !== "" && trail === "" && /[\d$]/.test(after)) return `${lead}-`;
  if (!spaced && (before === "(" || before === "[") && /[\d$]/.test(after)) return "-";
  // Joining two words with no spaces: an en dash is a compound or range, an em dash an aside.
  if (!spaced && isLetter(before) && isLetter(after)) return dash === EN_DASH ? "-" : ", ";
  // Punctuation already on the right, or already separating on the left: the dash adds nothing.
  if (/[.,;:!?)\]]/.test(after)) return "";
  if (/[,;:]/.test(before)) return " ";
  if (before === "(" || before === "[") return "";
  return ", ";
}

/** `text` with no em or en dash left outside the `keep` strings. */
export function replaceDashes(text: string, options: { keep?: readonly string[] } = {}): string {
  if (!DASH.test(text)) return text;

  // Longest first, so a name that contains a shorter kept name is protected whole.
  const keep = [...new Set(options.keep ?? [])].filter((value) => DASH.test(value)).sort((a, b) => b.length - a.length);
  let protectedText = text;
  keep.forEach((value, index) => {
    protectedText = protectedText.split(value).join(`${KEEP_OPEN}${index}${KEEP_CLOSE}`);
  });

  const cleaned = protectedText.replace(DASH_RUN, (match, lead: string, dash: string, trail: string, offset: number, whole: string) =>
    replacement(lead, dash, trail, whole.charAt(offset - 1), whole.charAt(offset + match.length)),
  );

  return cleaned.replace(KEPT, (_, index: string) => keep[Number(index)]);
}

/** Every string anywhere inside `value` that contains a dash: the typed text a draft may quote. */
export function textsWithDashes(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      if (DASH.test(node)) found.add(node);
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...found];
}
