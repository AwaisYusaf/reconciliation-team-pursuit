/**
 * The monthly summary Markdown parser (Phase 11, D-107, P6).
 *
 * The one place any of the three surfaces that read a summary's structure — the Word builder,
 * the PDF (via Word) and Copy text's HTML — understand Markdown. Deliberately small: headings
 * `#`–`###`, paragraphs, `-`/`*` bullet lists (one level, no nesting), `**bold**`, `*italic*`
 * and `***both***`. Everything else a user could type — links, images, tables, code fences,
 * inline code, HTML tags, `_underscore_` emphasis — is never specially recognised, and comes
 * out as the literal text it was typed as (P6): with no HTML rendering anywhere but here, and
 * this file escaping every text node, there is no script-injection path and no need to rewrite
 * what the user typed.
 *
 * Pure: no IO.
 */
import { SUMMARY_SECTION_TITLES } from "./strings";

/** Longest a summary's Markdown may be (P6, data model `monthly_summaries_content_length_ck`).
 *  Counted in code points, matching Postgres `char_length` — the check the app must agree with. */
export const SUMMARY_MAX_CHARS = 60_000;

export type Inline = { text: string; bold: boolean; italic: boolean };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; items: Inline[][] };

type Line =
  | { kind: "blank" }
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const BULLET_RE = /^[-*]\s+(.+)$/;

function classifyLine(rawLine: string): Line {
  const line = rawLine.replace(/^\s+/, "");
  if (line.trim() === "") return { kind: "blank" };

  // A paragraph that would otherwise misparse as a heading or a bullet, because the user's own
  // text (or `serializeSummaryMarkdown`'s round trip) happens to start with a bare `#` or `-`,
  // carries one leading `\` to say so (Tiptap round trip, PR #18 review #8). Stripping it here —
  // before either regex runs — is what makes the escape take effect: the rest of the line is
  // taken as literal text verbatim, and `parseInline` (further down) unescapes any `\*`/`\\` in
  // it the normal way.
  //
  // Deliberately NOT `*`, even though `BULLET_RE` treats it the same as `-`: `escapeRunText`
  // already escapes every literal `*` on its own, one at a time, so a leading `\*` is never the
  // *only* escape on the line — `\*\*not bold\*\*` is two of them back to back. Special-casing
  // "one leading `\`" here would consume just the first and leave a bare `*` for `parseInline`
  // to misread as opening italic; leaving `*` to `parseInline`'s own per-character escape walk
  // (already run below) handles any number of them correctly, one at a time.
  if (line.length >= 2 && line[0] === "\\" && "#-".includes(line[1])) {
    return { kind: "text", text: line.slice(1).trim() };
  }

  const heading = HEADING_RE.exec(line);
  if (heading) return { kind: "heading", level: heading[1].length, text: heading[2].trimEnd() };

  const bullet = BULLET_RE.exec(line);
  if (bullet) return { kind: "bullet", text: bullet[1].trimEnd() };

  return { kind: "text", text: line.trim() };
}

/** `**bold**`, `*italic*`, `***both***`; an unmatched marker is left as literal text. No other
 *  syntax (links, images, code, HTML, `_x_`) is ever recognised — it passes through untouched,
 *  including whatever `*`/`#` characters it happens to contain. */
function parseInline(text: string): Inline[] {
  const inlines: Inline[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer !== "") {
      inlines.push({ text: buffer, bold: false, italic: false });
      buffer = "";
    }
  };

  while (i < text.length) {
    // `\*` is a literal `*`, `\\` is a literal `\` (Tiptap round trip, PR #18 review #8) — checked
    // before the emphasis markers below, so an escaped `*` never opens/closes a bold or italic
    // run. Any other backslash (not followed by `*` or `\`) has no special meaning and is kept
    // as itself; nothing in this parser ever produces one.
    if (text[i] === "\\" && (text[i + 1] === "*" || text[i + 1] === "\\")) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (text.startsWith("***", i)) {
      const close = text.indexOf("***", i + 3);
      if (close > i + 3) {
        flush();
        inlines.push({ text: text.slice(i + 3, close), bold: true, italic: true });
        i = close + 3;
        continue;
      }
    } else if (text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      if (close > i + 2) {
        flush();
        inlines.push({ text: text.slice(i + 2, close), bold: true, italic: false });
        i = close + 2;
        continue;
      }
    } else if (text[i] === "*") {
      const close = text.indexOf("*", i + 1);
      if (close > i + 1) {
        flush();
        inlines.push({ text: text.slice(i + 1, close), bold: false, italic: true });
        i = close + 1;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return inlines;
}

/**
 * Line-based, no nesting (ponytail: a bullet holding a sub-list or a blockquote is out of
 * scope — it reads as one flat list item, which is what the product spec's plain text box
 * promises). Blank lines separate blocks; consecutive text lines join into one paragraph with a
 * single space; switching between text and bullets starts a new block of the other kind.
 */
export function parseSummaryMarkdown(markdown: string): Block[] {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  const blocks: Block[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: "paragraph", inlines: parseInline(paragraphLines.join(" ")) });
    paragraphLines = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push({ type: "list", items: listItems.map(parseInline) });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = classifyLine(rawLine);
    if (line.kind === "blank") {
      flushParagraph();
      flushList();
    } else if (line.kind === "heading") {
      flushParagraph();
      flushList();
      const level = Math.min(line.level, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, inlines: parseInline(line.text) });
    } else if (line.kind === "bullet") {
      flushParagraph(); // text, then a bullet: the paragraph ends and a list begins
      listItems.push(line.text);
    } else {
      flushList(); // bullets, then text: the list ends and a paragraph begins
      paragraphLines.push(line.text);
    }
  }
  flushParagraph();
  flushList();

  return blocks;
}

function plainTextOfInlines(inlines: readonly Inline[]): string {
  return inlines.map((inline) => inline.text).join("");
}

export type StructureCheck = { ok: true } | { ok: false; problem: string };

/**
 * Checks the model's draft against the five fixed section headings, in order, each with
 * content (P5). Only the model's own output goes through this — once saved, the user may
 * rename or delete headings freely (Appendix A §5, I-34).
 */
export function checkSummaryStructure(markdown: string): StructureCheck {
  const blocks = parseSummaryMarkdown(markdown);

  if (blocks.some((block) => block.type === "heading" && block.level === 1)) {
    return { ok: false, problem: "Contains a level-1 heading." };
  }

  const h2Indices: number[] = [];
  blocks.forEach((block, index) => {
    if (block.type === "heading" && block.level === 2) h2Indices.push(index);
  });

  if (h2Indices.length === 0) {
    return { ok: false, problem: "No section headings found." };
  }
  if (h2Indices[0] !== 0) {
    return { ok: false, problem: "Content appears before the first section heading." };
  }
  if (h2Indices.length !== SUMMARY_SECTION_TITLES.length) {
    return {
      ok: false,
      problem: `Expected ${SUMMARY_SECTION_TITLES.length} section headings, found ${h2Indices.length}.`,
    };
  }

  for (let i = 0; i < h2Indices.length; i += 1) {
    const block = blocks[h2Indices[i]] as Extract<Block, { type: "heading" }>;
    const title = plainTextOfInlines(block.inlines).trim();
    if (title !== SUMMARY_SECTION_TITLES[i]) {
      return {
        ok: false,
        problem: `Section ${i + 1} is "${title}", expected "${SUMMARY_SECTION_TITLES[i]}".`,
      };
    }

    const sectionEnd = i + 1 < h2Indices.length ? h2Indices[i + 1] : blocks.length;
    // A level-3 heading alone doesn't count as content — only a paragraph or a list does.
    const hasContent = blocks
      .slice(h2Indices[i] + 1, sectionEnd)
      .some((b) => b.type === "paragraph" || b.type === "list");
    if (!hasContent) {
      return { ok: false, problem: `Section "${title}" has no content.` };
    }
  }

  return { ok: true };
}

/** Headings and paragraphs as their own line, bullets as "• text", blocks separated by a blank
 *  line — no `#`/`*` markers survive from the parsed syntax (unmatched/literal ones did, same
 *  as everywhere else). Used by the clipboard's plain-text part. */
export function toPlainText(markdown: string): string {
  const blocks = parseSummaryMarkdown(markdown);
  return blocks
    .map((block) => {
      if (block.type === "list") {
        return block.items.map((item) => `• ${plainTextOfInlines(item)}`).join("\n");
      }
      return plainTextOfInlines(block.inlines);
    })
    .join("\n\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(inlines: readonly Inline[]): string {
  return inlines
    .map((inline) => {
      let html = escapeHtml(inline.text);
      if (inline.bold) html = `<strong>${html}</strong>`;
      if (inline.italic) html = `<em>${html}</em>`;
      return html;
    })
    .join("");
}

/** `<h1>`–`<h3>`, `<p>`, `<ul><li>`, `<strong>`, `<em>` — no attributes ever emitted, and every
 *  text node is escaped, so nothing a user typed can execute as markup (P6). Used only by Copy
 *  text's HTML part; the summary itself is never rendered as HTML anywhere else in the app. */
export function toHtml(markdown: string): string {
  const blocks = parseSummaryMarkdown(markdown);
  return blocks
    .map((block) => {
      if (block.type === "heading") {
        return `<h${block.level}>${inlineHtml(block.inlines)}</h${block.level}>`;
      }
      if (block.type === "list") {
        return `<ul>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join("")}</ul>`;
      }
      return `<p>${inlineHtml(block.inlines)}</p>`;
    })
    .join("");
}

/* ------------------------------------------------------------------- Phase 11 review #8: Tiptap */

/**
 * A narrow, local shape of the ProseMirror JSON document `@tiptap/react`'s `getJSON()`/
 * `setContent` speak — deliberately not imported from `@tiptap/core`: this module stays pure and
 * tiptap-free, so the rich editor is the only place that package is ever loaded (P6/SSR).
 */
export type EditorMark = { type: "bold" } | { type: "italic" };
export type EditorTextNode = { type: "text"; text: string; marks?: EditorMark[] };
type EditorParagraphNode = { type: "paragraph"; content?: EditorTextNode[] };
type EditorHeadingNode = { type: "heading"; attrs: { level: 1 | 2 | 3 }; content?: EditorTextNode[] };
type EditorListItemNode = { type: "listItem"; content: [EditorParagraphNode] };
type EditorBulletListNode = { type: "bulletList"; content: EditorListItemNode[] };
export type EditorBlockNode = EditorParagraphNode | EditorHeadingNode | EditorBulletListNode;
export type EditorDoc = { type: "doc"; content: EditorBlockNode[] };

function inlinesToTextNodes(inlines: readonly Inline[]): EditorTextNode[] {
  return inlines
    .filter((inline) => inline.text !== "")
    .map((inline) => {
      const marks: EditorMark[] = [];
      if (inline.bold) marks.push({ type: "bold" });
      if (inline.italic) marks.push({ type: "italic" });
      return marks.length > 0 ? { type: "text", text: inline.text, marks } : { type: "text", text: inline.text };
    });
}

function textNodesOrUndefined(inlines: readonly Inline[]): EditorTextNode[] | undefined {
  const nodes = inlinesToTextNodes(inlines);
  return nodes.length > 0 ? nodes : undefined;
}

/**
 * Markdown → the editor's ProseMirror doc (PR #18 review #8). The inverse of
 * `serializeSummaryMarkdown` below — same three block types `parseSummaryMarkdown` understands,
 * nothing else, since a Tiptap document can't hold what this parser can't read back.
 */
export function toEditorDoc(markdown: string): EditorDoc {
  const blocks = parseSummaryMarkdown(markdown);

  const content: EditorBlockNode[] = blocks.map((block) => {
    if (block.type === "heading") {
      return { type: "heading", attrs: { level: block.level }, content: textNodesOrUndefined(block.inlines) };
    }
    if (block.type === "list") {
      return {
        type: "bulletList",
        content: block.items.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: textNodesOrUndefined(item) }],
        })),
      };
    }
    return { type: "paragraph", content: textNodesOrUndefined(block.inlines) };
  });

  // ProseMirror's schema never allows a doc with zero block children — ` an empty summary is one
  // empty paragraph, same as a freshly opened editor.
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

/** Every literal `\` doubled, then every literal `*` escaped — in that order, so the backslash
 *  inserted for a `*` is never itself re-escaped (PR #18 review #8). A Tiptap text node's `.text`
 *  never carries Markdown syntax itself (bold/italic are marks, not `**`/`*` characters), so
 *  every `\`/`*` it holds is always the user's own literal character, never ambiguous. */
function escapeRunText(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
}

function serializeInlineRun(nodes: readonly EditorTextNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((node) => {
      const text = escapeRunText(node.text);
      const bold = node.marks?.some((mark) => mark.type === "bold") ?? false;
      const italic = node.marks?.some((mark) => mark.type === "italic") ?? false;
      if (bold && italic) return `***${text}***`;
      if (bold) return `**${text}**`;
      if (italic) return `*${text}*`;
      return text;
    })
    .join("");
}

const LEADING_MARKER_RE = /^(#{1,3}|-)\s/;

/**
 * The editor's ProseMirror doc → Markdown (PR #18 review #8). A paragraph whose composed text
 * would itself misparse as a heading or a bullet — because the user typed a literal leading `#`
 * or `-` — carries one escaping `\` so `classifyLine` reads it back as the plain text it is. A
 * heading's `##` and a list item's `- ` are never ambiguous this way: `parseSummaryMarkdown`
 * matches those from the line's own required prefix, not from what follows it, so nothing inside
 * a heading or list item ever needs this particular escape (a literal `*` anywhere still gets
 * `escapeRunText`'s per-character one, same as a paragraph's).
 */
export function serializeSummaryMarkdown(doc: EditorDoc): string {
  const chunks = doc.content.map((node) => {
    if (node.type === "heading") {
      // An empty heading (created, never typed into) has nothing `HEADING_RE` could read back —
      // dropped, same as an empty paragraph, rather than saving a line no parse can round-trip.
      const text = serializeInlineRun(node.content);
      return text === "" ? "" : `${"#".repeat(node.attrs.level)} ${text}`;
    }
    if (node.type === "bulletList") {
      // Same reasoning per item: an empty bullet has no text `BULLET_RE` could read back.
      return node.content
        .map((item) => serializeInlineRun(item.content[0].content))
        .filter((text) => text !== "")
        .map((text) => `- ${text}`)
        .join("\n");
    }
    const line = serializeInlineRun(node.content);
    return LEADING_MARKER_RE.test(line) ? `\\${line}` : line;
  });

  return chunks.filter((chunk) => chunk !== "").join("\n\n");
}
