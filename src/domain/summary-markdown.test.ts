/**
 * Unit tests for the summary Markdown parser (Phase 11, D-107, P6). PHASE-11.md §10 U-18.
 */
import { describe, expect, it } from "vitest";

import {
  checkSummaryStructure,
  editorBaseline,
  realChange,
  parseSummaryMarkdown,
  serializeSummaryMarkdown,
  toEditorDoc,
  toHtml,
  toPlainText,
} from "./summary-markdown";
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

describe("backslash escapes (PR #18 review #8 — the Tiptap round trip)", () => {
  it("a leading \\# is read as literal text, not a heading", () => {
    const blocks = parseSummaryMarkdown("\\## not a heading");
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ text: "## not a heading", bold: false, italic: false }] },
    ]);
  });

  it("a leading \\- is read as literal text, not a bullet", () => {
    const blocks = parseSummaryMarkdown("\\- not a bullet");
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ text: "- not a bullet", bold: false, italic: false }] },
    ]);
  });

  it("\\* is a literal * — a lone escaped star never opens emphasis, and two escaped stars never pair", () => {
    expect(parseSummaryMarkdown("a lone \\*")).toEqual([
      { type: "paragraph", inlines: [{ text: "a lone *", bold: false, italic: false }] },
    ]);
    expect(parseSummaryMarkdown("\\*\\*not bold\\*\\*")).toEqual([
      { type: "paragraph", inlines: [{ text: "**not bold**", bold: false, italic: false }] },
    ]);
  });

  it("\\\\ is a literal \\", () => {
    expect(parseSummaryMarkdown("a literal \\\\")).toEqual([
      { type: "paragraph", inlines: [{ text: "a literal \\", bold: false, italic: false }] },
    ]);
  });

  it("an escaped marker still returns to normal emphasis parsing for the rest of the line", () => {
    const blocks = parseSummaryMarkdown("\\# **bold** after");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        inlines: [
          { text: "# ", bold: false, italic: false },
          { text: "bold", bold: true, italic: false },
          { text: " after", bold: false, italic: false },
        ],
      },
    ]);
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

  it("fails when only the last section heading is missing — every other title still matches its position, so this only fails via the section-count check, not a title mismatch", () => {
    const withoutLast = SUMMARY_SECTION_TITLES.slice(0, -1)
      .map((title) => `## ${title}\n\ncontent`)
      .join("\n\n");
    const result = checkSummaryStructure(withoutLast);
    expect(result).toEqual({ ok: false, problem: expect.stringContaining("Expected") });
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

describe("toEditorDoc / serializeSummaryMarkdown (PR #18 review #8 — the Tiptap round trip)", () => {
  it("round-trips a document with all three block types, bold, italic and bold+italic", () => {
    const original =
      "## Heading Two\n\n" +
      "A plain paragraph with **bold**, *italic* and ***both***.\n\n" +
      "- first item\n- second **bold** item\n- third *italic* item";

    const roundTripped = serializeSummaryMarkdown(toEditorDoc(original));
    expect(roundTripped).toBe(original);
    // Structural equality too, not just the same string by coincidence.
    expect(parseSummaryMarkdown(roundTripped)).toEqual(parseSummaryMarkdown(original));
  });

  it("round-trips a heading at each level (1-3)", () => {
    const original = "# One\n\n## Two\n\n### Three";
    expect(serializeSummaryMarkdown(toEditorDoc(original))).toBe(original);
  });

  it("round-trips text that looks like Markdown, escaped on both sides of the trip", () => {
    const original = [
      "\\## not a heading",
      "\\- not a bullet",
      "\\*\\*not bold\\*\\*",
      "a lone \\*",
      "a literal \\\\",
    ].join("\n\n");

    const roundTripped = serializeSummaryMarkdown(toEditorDoc(original));
    expect(roundTripped).toBe(original);
    expect(parseSummaryMarkdown(roundTripped)).toEqual(parseSummaryMarkdown(original));

    // And the editor doc itself really does hold the literal, unescaped text — the escaping is
    // only ever a Markdown-file concern, never visible inside the editor.
    const doc = toEditorDoc(original);
    expect(doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "## not a heading" }] },
      { type: "paragraph", content: [{ type: "text", text: "- not a bullet" }] },
      { type: "paragraph", content: [{ type: "text", text: "**not bold**" }] },
      { type: "paragraph", content: [{ type: "text", text: "a lone *" }] },
      { type: "paragraph", content: [{ type: "text", text: "a literal \\" }] },
    ]);
  });

  it("an empty summary becomes one empty paragraph, and serializes back to an empty string", () => {
    const doc = toEditorDoc("");
    expect(doc).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(serializeSummaryMarkdown(doc)).toBe("");
  });

  it("bold and italic marks survive independently — editing one run never drops the other's mark", () => {
    const doc = toEditorDoc("**bold** and *italic* and ***both***");
    expect(doc.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          { type: "text", text: "italic", marks: [{ type: "italic" }] },
          { type: "text", text: " and " },
          { type: "text", text: "both", marks: [{ type: "bold" }, { type: "italic" }] },
        ],
      },
    ]);
    expect(serializeSummaryMarkdown(doc)).toBe("**bold** and *italic* and ***both***");
  });
});

describe("PR #18 round 2, #2: nothing typed in the editor is lost or multiplied on save", () => {
  const text = (value: string) => ({ type: "text" as const, text: value });
  const para = (value: string) => ({ type: "paragraph" as const, content: [text(value)] });

  it("a nested list (Tab, or pasted) is flattened into lines, not dropped", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "bulletList" as const,
          content: [
            {
              type: "listItem" as const,
              content: [
                para("Salary"),
                { type: "bulletList" as const, content: [{ type: "listItem" as const, content: [para("Payroll 1")] }] },
              ],
            },
            { type: "listItem" as const, content: [para("Rent")] },
          ],
        },
      ],
    };
    expect(serializeSummaryMarkdown(doc)).toBe("- Salary\n- Payroll 1\n- Rent");
  });

  it("a list item holding two paragraphs keeps both", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "bulletList" as const, content: [{ type: "listItem" as const, content: [para("First"), para("Second")] }] },
      ],
    };
    expect(serializeSummaryMarkdown(doc)).toBe("- First\n- Second");
  });

  it("escaped characters inside bold and italic stay the same across repeated saves", () => {
    const start = String.raw`**5 \* 3 and a \\ path** then *a \* b*`;
    let markdown = start;
    for (let save = 0; save < 5; save += 1) markdown = serializeSummaryMarkdown(toEditorDoc(markdown));
    expect(markdown).toBe(start);
    expect(toPlainText(markdown)).toBe(String.raw`5 * 3 and a \ path then a * b`);
  });

  it("an escaped star never closes a bold run early", () => {
    const [block] = parseSummaryMarkdown(String.raw`**a\*\*b**`);
    expect(block).toMatchObject({ type: "paragraph", inlines: [{ text: "a**b", bold: true }] });
  });
});

describe("realChange: only a real edit is reported to autosave (PR #18 round 2, #3; round 3, #2)", () => {
  // Stored the way the model writes it: `*` bullets, a paragraph wrapped over two lines. Its
  // serialized form differs, though nobody has edited anything.
  const stored = "## Overview\n\nSpending was\nconcentrated in Salary.\n\n* Salary: $39,700.00\n* Rent: $1,200.00";

  it("opening a summary is not a change, even when its stored text serializes differently", () => {
    expect(editorBaseline(stored)).not.toBe(stored);
    expect(realChange(toEditorDoc(stored), editorBaseline(stored))).toBeNull();
  });

  it("an edit is a change, and returns the new Markdown", () => {
    const edited = toEditorDoc(`${stored}\n\nA new line.`);
    expect(realChange(edited, editorBaseline(stored))).toContain("A new line.");
  });

  it("undoing back to the original after an edit is a change too (compared with the last text known)", () => {
    const afterEdit = serializeSummaryMarkdown(toEditorDoc(`${stored}\n\nA new line.`));
    expect(realChange(toEditorDoc(stored), afterEdit)).toBe(editorBaseline(stored));
  });
});

describe("indented markers stay text (PR #18 round 3, #4)", () => {
  const para = (text: string) => ({
    type: "doc" as const,
    content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
  });

  for (const text of ["  - not a bullet", "\t## not a heading", "   # not a heading either"]) {
    it(`${JSON.stringify(text)} saves and reads back as a paragraph`, () => {
      const [block] = parseSummaryMarkdown(serializeSummaryMarkdown(para(text)));
      expect(block).toMatchObject({ type: "paragraph", inlines: [{ text: text.trimStart() }] });
    });
  }
});
