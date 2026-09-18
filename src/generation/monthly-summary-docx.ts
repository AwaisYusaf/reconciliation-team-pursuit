/**
 * Monthly summary Word document (Phase 11 §7.4, docs/PHASE-11.md). Pure: takes the saved
 * Markdown, returns bytes. The PDF is this file converted by `convertDocxToPdf` (P13), so the
 * layout only ever lives here.
 *
 * Reads Markdown through `parseSummaryMarkdown` (`src/domain/summary-markdown.ts`) — the one
 * parser P6 requires — and turns its blocks into headings, paragraphs and one bulleted list
 * style. Anything the parser treats as literal text (links, images, tables, code, HTML) is
 * already plain text by the time it gets here.
 */
import {
  AlignmentType,
  convertInchesToTwip,
  Document,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import { parseSummaryMarkdown, type Block, type Inline } from "@/src/domain/summary-markdown";

import { COVER_MARGIN_IN } from "./layout-constants";

/**
 * Calibri, not the cover sheet's Aptos.
 *
 * The cover sheet is a submitted document whose approved rendering is Aptos (D-78), and the
 * container maps Aptos to Carlito for it. A monthly summary is opened on the user's own machine,
 * where Aptos is often missing: Word then substitutes whatever it likes — a heavy serif on the
 * reviewer's Windows machine, which read as broken. Calibri is present on Windows and macOS Word,
 * and the container's fontconfig already treats Carlito as its metric substitute, so the PDF is
 * unchanged while the Word file stops depending on a font the reader may not have.
 */
const FONT = "Calibri";

/** 10 pt body, as the cover sheet. The title is 16 pt (the cover sheet's is 12 pt, but it has no
 *  headings under it) so it stays above the 14/12/11 pt headings, in half-points. */
const BODY_SIZE = 20;
const TITLE_SIZE = 32;
const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 28, 2: 24, 3: 22 };
const BLACK = "000000";

const PARAGRAPH_AFTER = 120;
const BEFORE_HEADING = 240;

const BULLET_REFERENCE = "monthly-summary-bullets";

const HEADING_LEVEL: Record<1 | 2 | 3, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

/**
 * XML 1.0 forbids most C0 control characters and U+FFFE/U+FFFF, and `docx` writes text as-is, so
 * one of them in the saved Markdown (text pasted from Word carries U+000B as a line break) makes
 * the file one Word calls corrupt and LibreOffice may refuse. Vertical tab and form feed become a
 * space; the rest are dropped. Tab, LF and CR are legal and left alone.
 */
function xmlSafe(text: string): string {
  return text.replace(/[\u000B\u000C]/g, " ").replace(/[\u0000-\u0008\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function inlineRuns(inlines: readonly Inline[], heading = false, size = BODY_SIZE): TextRun[] {
  // An empty block (shouldn't happen — the parser only emits blocks with inlines — but a
  // heading/paragraph with no text would otherwise render as a truly empty paragraph) still
  // gets one run so the line takes up space like Word expects.
  if (inlines.length === 0) return [new TextRun({ text: "", font: FONT, size })];
  return inlines.map(
    (inline) =>
      new TextRun({
        text: xmlSafe(inline.text),
        bold: heading || inline.bold,
        italics: inline.italic,
        font: FONT,
        size,
        // The `docx` package's built-in Heading styles are blue and not bold; the run overrides
        // keep headings black and bold like the rest of the app's documents.
        ...(heading ? { color: BLACK } : {}),
      }),
  );
}

function blockToParagraphs(block: Block): Paragraph[] {
  if (block.type === "heading") {
    return [
      new Paragraph({
        heading: HEADING_LEVEL[block.level],
        spacing: { before: BEFORE_HEADING, after: PARAGRAPH_AFTER },
        // Word falls back to the theme's heading font for any run that doesn't name one
        // explicitly, so the heading font is stated the same as every other run here.
        children: inlineRuns(block.inlines, true, HEADING_SIZES[block.level]),
      }),
    ];
  }

  if (block.type === "paragraph") {
    return [
      new Paragraph({
        spacing: { after: PARAGRAPH_AFTER },
        children: inlineRuns(block.inlines),
      }),
    ];
  }

  // One Paragraph per list item, all at the same (only) numbering level — the parser has no
  // nesting (P6), so neither does the document.
  return block.items.map(
    (item) =>
      new Paragraph({
        numbering: { reference: BULLET_REFERENCE, level: 0 },
        spacing: { after: PARAGRAPH_AFTER },
        children: inlineRuns(item),
      }),
  );
}

type MonthlySummaryDocxInput = {
  /** `monthlySummaryTitle(docName, monthLabel, sourceName?)` — built by the caller. */
  title: string;
  /** The saved Markdown, as typed (P6). */
  markdown: string;
};

/** Build the monthly summary Word document. */
export async function buildMonthlySummaryDocx(input: MonthlySummaryDocxInput): Promise<Buffer> {
  const blocks = parseSummaryMarkdown(input.markdown);

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      spacing: { after: PARAGRAPH_AFTER },
      children: [new TextRun({ text: xmlSafe(input.title), bold: true, font: FONT, size: TITLE_SIZE, color: BLACK })],
    }),
    ...blocks.flatMap(blockToParagraphs),
  ];

  const document = new Document({
    numbering: {
      config: [
        {
          reference: BULLET_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE, color: "000000" },
          // Same reasoning as the cover sheet (D-52): stated explicitly so the container's
          // LibreOffice doesn't read the omission as an exact line height.
          paragraph: {
            spacing: { line: 240, lineRule: LineRuleType.AUTO, after: PARAGRAPH_AFTER },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
            margin: {
              top: convertInchesToTwip(COVER_MARGIN_IN),
              bottom: convertInchesToTwip(COVER_MARGIN_IN),
              left: convertInchesToTwip(COVER_MARGIN_IN),
              right: convertInchesToTwip(COVER_MARGIN_IN),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
