/**
 * Unit tests for the summary Markdown parser (Phase 11, D-107, P6). PHASE-11.md §10 U-18.
 */
import { describe, expect, it } from "vitest";

import { checkSummaryStructure, parseSummaryMarkdown, toHtml, toPlainText } from "./summary-markdown";
import { SUMMARY_SECTION_TITLES } from "./strings";

function validDoc(): string {
  return SUMMARY_SECTION_TITLES.map((title) => `## ${title}\n\nSome content for ${title}.`).join("\n\n");
}

describe("parseSummaryMarkdown", () => {
  it("parses headings level 1-3", () => {
    const blocks = parseSummaryMarkdown("# One\n\n## Two\n\n### Three");
    expect(blocks).toEqual([
      { type: "heading", level: 1, inlines: [{ text: "One", bold: false, italic: false }] },
      { type: "heading", level: 2, inlines: [{ text: "Two", bold: false, italic: false }] },
      { type: "heading", level: 3, inlines: [{ text: "Three", bold: false, italic: false }] },
    ]);
  });

  it("a level-4+ heading marker is capped at level 3 (not a heading collapse bug, an explicit min)", () => {
    const blocks = parseSummaryMarkdown("#### Four");
    // Four #'s doesn't match HEADING_RE (only 1-3 captured), so it's a plain paragraph starting with "#".
    expect(blocks).toEqual([{ type: "paragraph", inlines: [{ text: "#### Four", bold: false, italic: false }] }]);
  });

  it("joins consecutive text lines into one paragraph with a single space", () => {
    const blocks = parseSummaryMarkdown("Line one\nLine two\nLine three");
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ text: "Line one Line two Line three", bold: false, italic: false }] },
    ]);
  });

  it("both bullet markers (- and *) produce list items", () => {
    const blocks = parseSummaryMarkdown("- first\n* second");
    expect(blocks).toEqual([
      {
        type: "list",
        items: [
          [{ text: "first", bold: false, italic: false }],
          [{ text: "second", bold: false, italic: false }],
        ],
      },
    ]);
  });

  it("bold, italic and both together", () => {
    const blocks = parseSummaryMarkdown("**bold** *italic* ***both***");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        inlines: [
          { text: "bold", bold: true, italic: false },
          { text: " ", bold: false, italic: false },
          { text: "italic", bold: false, italic: true },
          { text: " ", bold: false, italic: false },
          { text: "both", bold: true, italic: true },
        ],
      },
    ]);
  });

  it("an unmatched ** marker is left as literal text", () => {
    const blocks = parseSummaryMarkdown("half **bold here");
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ text: "half **bold here", bold: false, italic: false }] },
    ]);
  });

  it("links, images, tables, code fences, inline code and raw HTML all come out as literal text", () => {
    const raw = "[a link](http://x) ![alt](img.png) | a | table | ```code``` `inline` <script>alert(1)</script>";
    const blocks = parseSummaryMarkdown(raw);
    expect(blocks).toEqual([{ type: "paragraph", inlines: [{ text: raw, bold: false, italic: false }] }]);
  });

  it("switching from paragraph text to a bullet starts a new list block", () => {
    const blocks = parseSummaryMarkdown("A paragraph.\n- a bullet");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list"]);
  });

  it("switching from a bullet list back to text starts a new paragraph block", () => {
    const blocks = parseSummaryMarkdown("- a bullet\nplain text");
    expect(blocks.map((b) => b.type)).toEqual(["list", "paragraph"]);
  });

  it("blank lines separate blocks", () => {
    const blocks = parseSummaryMarkdown("Para one.\n\nPara two.");
    expect(blocks).toHaveLength(2);
  });

  it("empty markdown yields no blocks", () => {
    expect(parseSummaryMarkdown("")).toEqual([]);
  });
});

describe("toPlainText / toHtml", () => {
  it("toPlainText renders bullets as '• text' and leaves no # or ** markers", () => {
    const text = toPlainText("## Heading\n\n**bold** para\n\n- one\n- two");
    expect(text).toBe("Heading\n\nbold para\n\n• one\n• two");
    expect(text).not.toContain("#");
    expect(text).not.toContain("**");
  });

  it("toHtml escapes &, <, >, \" and ' in text nodes", () => {
    const html = toHtml('Tom & Jerry <b>"quoted"</b> it\'s');
    expect(html).toBe("<p>Tom &amp; Jerry &lt;b&gt;&quot;quoted&quot;&lt;/b&gt; it&#39;s</p>");
  });

  it("toPlainText leaves no #, **, *, or - markers across all three heading levels and both bullet markers (U-23)", () => {
    const text = toPlainText(
      "# H1\n\n## H2\n\n### H3\n\n**bold** and *italic*\n\n- dash bullet\n* star bullet",
    );
    expect(text).not.toContain("#");
    expect(text).not.toMatch(/\*/);
    expect(text).not.toMatch(/^-\s/m);
    expect(text).toBe("H1\n\nH2\n\nH3\n\nbold and italic\n\n• dash bullet\n• star bullet");
  });

  it("toHtml renders headings, lists, bold and italic with the right tags, and never executes a <script>", () => {
    const html = toHtml("## Title\n\n- **bold item**\n\n<script>alert(1)</script>");
    expect(html).toBe(
      "<h2>Title</h2><ul><li><strong>bold item</strong></li></ul><p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });
});

describe("checkSummaryStructure", () => {
  it("passes a valid document with the five titled sections in order, each with content", () => {
    expect(checkSummaryStructure(validDoc())).toEqual({ ok: true });
  });

  it("fails when a section heading is missing", () => {
    const withoutOne = SUMMARY_SECTION_TITLES.slice(1)
      .map((title) => `## ${title}\n\ncontent`)
      .join("\n\n");
    const result = checkSummaryStructure(withoutOne);
    expect(result.ok).toBe(false);
  });

  it("fails when a section heading is duplicated", () => {
    const titles = [...SUMMARY_SECTION_TITLES, SUMMARY_SECTION_TITLES[0]];
    const md = titles.map((title) => `## ${title}\n\ncontent`).join("\n\n");
    const result = checkSummaryStructure(md);
    expect(result.ok).toBe(false);
  });

  it("fails when a section heading is renamed", () => {
    const md = SUMMARY_SECTION_TITLES.map((title, i) =>
      i === 2 ? `## Wrong Title\n\ncontent` : `## ${title}\n\ncontent`,
    ).join("\n\n");
    const result = checkSummaryStructure(md);
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("Wrong Title") });
  });

  it("fails when sections are reordered", () => {
    const reordered = [...SUMMARY_SECTION_TITLES].reverse();
    const md = reordered.map((title) => `## ${title}\n\ncontent`).join("\n\n");
    const result = checkSummaryStructure(md);
    expect(result.ok).toBe(false);
  });

  it("fails when a section has no content (heading immediately followed by another heading)", () => {
    const titles = [...SUMMARY_SECTION_TITLES];
    const md = titles
      .map((title, i) => (i === 0 ? `## ${title}` : `## ${title}\n\ncontent`))
      .join("\n\n");
    const result = checkSummaryStructure(md);
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("no content") });
  });

  it("a level-3 heading alone does not count as a section's content", () => {
    const md = SUMMARY_SECTION_TITLES.map((title, i) =>
      i === 0 ? `## ${title}\n\n### just a subheading` : `## ${title}\n\ncontent`,
    ).join("\n\n");
    const result = checkSummaryStructure(md);
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("no content") });
  });

  it("fails on a level-1 heading (# instead of ##) anywhere in the document", () => {
    const md = `# ${SUMMARY_SECTION_TITLES[0]}\n\n` + validDoc();
    const result = checkSummaryStructure(md);
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("level-1") });
  });

  it("fails when content appears before the first section heading", () => {
    const md = `Some intro text.\n\n${validDoc()}`;
    const result = checkSummaryStructure(md);
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("before the first") });
  });

  it("fails on an empty document (no headings at all)", () => {
    const result = checkSummaryStructure("just prose, no headings");
    expect(result).toEqual({ ok: false, problem: "No section headings found." });
  });
});
