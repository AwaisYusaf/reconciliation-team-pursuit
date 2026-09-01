/**
 * Cover sheet ("Breakdown") document — implements docs/02-outputs/cover-sheet-spec.md.
 *
 * Pure: takes composed rows and already-decoded images, returns bytes. Nothing here reads
 * the database or storage, so the layout is testable against fixtures and the same function
 * serves the download, the packet and the preview.
 *
 * The docx is the canonical artifact; the PDF is converted from it, so every visual decision
 * lives here and the two formats cannot drift.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertInchesToTwip,
} from "docx";

import type { CoverSheetRow } from "@/src/domain/cover-sheet";
import { formatMoney } from "@/src/domain/format";
import { SEE_BELOW } from "@/src/domain/strings";

import { COVER_IMAGE_BOX, COVER_MARGIN_IN, COVER_TEXT_WIDTH_IN, fitWithin } from "./layout-constants";

/**
 * Aptos is the golden documents' theme font.
 *
 * OOXML names one family per run — there is no fallback list — so what a converter does with
 * a font it lacks is entirely the container's business. This comment used to claim Carlito
 * covered that, which was false: fontconfig ships Carlito as a substitute for *Calibri*, so
 * `fc-match Aptos` returned DejaVu Sans and every converted cover sheet was set in it, about
 * a quarter wider per digit. The Dockerfile now aliases Aptos to Carlito explicitly (D-78);
 * the alias, not the package, is what makes the PDF break lines where Word does.
 */
const FONT = "Aptos";

const YELLOW = "FFFF00";
/** Word border widths are in eighths of a point; the spec asks for 0.5 pt. */
const BORDER_SIZE = 4;
/** 11 pt and 12 pt, in half-points. */
// 10 pt, in half-points. Matches the body text of the client's approved sheets, which
// override their own 11 pt docDefaults on every run — see review-2026-08-20-february (D-58).
const BODY_SIZE = 20;
const TITLE_SIZE = 24;
/** 6 pt and 12 pt, in twips. */
const PARAGRAPH_AFTER = 120;
const BEFORE_HEADING = 240;

const TEXT_WIDTH_TWIPS = convertInchesToTwip(COVER_TEXT_WIDTH_IN);
/**
 * Name 24% · Role 58% · Amount 18%.
 *
 * Amount was 15%, which fit the bold total with almost nothing to spare: rendered, a
 * seven-figure amount began breaking mid-number just under 14%, so the margin was a single
 * percentage point. Aptos is wider than the Carlito this container substitutes for it, which
 * is why the client saw the last digit and the cents drop to the next line on a sheet that
 * looked correct in our own PDFs. 18% clears the measured threshold by about a third, which
 * covers the font difference and a negative seven-figure refund (R1.4) — the longest string
 * the column can hold.
 *
 * The 3% comes from Role, which is free text and wraps deliberately; Name is untouched.
 */
const COLUMN_WIDTHS = [
  Math.round(TEXT_WIDTH_TWIPS * 0.24),
  Math.round(TEXT_WIDTH_TWIPS * 0.58),
  Math.round(TEXT_WIDTH_TWIPS * 0.18),
];

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: BORDER_SIZE, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: BORDER_SIZE, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: BORDER_SIZE, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: BORDER_SIZE, color: "000000" },
};

/** ~4 pt of padding inside every cell. */
const CELL_MARGINS = { top: 80, bottom: 80, left: 80, right: 80 };

export type CoverImage = {
  data: Buffer;
  widthPx: number;
  heightPx: number;
};

export type CoverSheetInput = {
  /** `{docName} {Month YYYY} {Line Item} Breakdown` (R6.1). */
  title: string;
  rows: CoverSheetRow[];
  totalCents: number;
  /** Proof images per row, in upload order, index-aligned with `rows` (R6.4). */
  images: CoverImage[][];
};

function cell(options: {
  children: Paragraph[];
  width: number;
  shaded?: boolean;
}): TableCell {
  return new TableCell({
    children: options.children,
    width: { size: options.width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    ...(options.shaded
      ? { shading: { type: ShadingType.CLEAR, fill: YELLOW, color: "auto" } }
      : {}),
  });
}

/** Every cell in the table is centered, matching the golden documents. */
function cellText(text: string, bold = false): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
    children: [new TextRun({ text, bold, font: FONT, size: BODY_SIZE })],
  });
}

function buildTable(input: CoverSheetInput): Table {
  const header = new TableRow({
    tableHeader: true,
    children: ["Name", "Role", "Amount"].map((label, index) =>
      cell({ children: [cellText(label, true)], width: COLUMN_WIDTHS[index], shaded: true }),
    ),
  });

  const body = input.rows.map(
    (row) =>
      new TableRow({
        children: [
          cell({ children: [cellText(row.name)], width: COLUMN_WIDTHS[0] }),
          cell({ children: [cellText(row.role)], width: COLUMN_WIDTHS[1] }),
          cell({ children: [cellText(formatMoney(row.amountCents))], width: COLUMN_WIDTHS[2] }),
        ],
      }),
  );

  // Name and Role are empty but keep their borders, so the grid closes cleanly under the
  // last row; only the Amount cell is filled and shaded.
  const total = new TableRow({
    children: [
      cell({ children: [cellText("")], width: COLUMN_WIDTHS[0] }),
      cell({ children: [cellText("")], width: COLUMN_WIDTHS[1] }),
      cell({
        children: [cellText(formatMoney(input.totalCents), true)],
        width: COLUMN_WIDTHS[2],
        shaded: true,
      }),
    ],
  });

  return new Table({
    rows: [header, ...body, total],
    width: { size: TEXT_WIDTH_TWIPS, type: WidthType.DXA },
    // Without this the table is auto-fit, and each renderer redistributes the columns to suit
    // its own font metrics — so LibreOffice quietly widened Amount to fit while Word wrapped
    // it, and the defect could not be seen in anything we generated. Fixed layout makes the
    // PDF in the packet and the docx the client opens lay out identically, and lets the
    // render smoke test actually catch a column that is too narrow.
    layout: TableLayoutType.FIXED,
    columnWidths: COLUMN_WIDTHS,
  });
}

/**
 * The bold `{Name}:` heading with its yellow notes on the same line (R6.4, R6.5).
 *
 * Notes are separate runs rather than one concatenated string so only the note text carries
 * the highlight — the name itself stays unhighlighted, as in the golden documents.
 */
function headingParagraph(row: CoverSheetRow): Paragraph {
  const children = [
    new TextRun({ text: `${row.name}:`, bold: true, font: FONT, size: BODY_SIZE }),
  ];

  for (const note of row.notes) {
    children.push(
      new TextRun({
        text: ` ${note}`,
        bold: true,
        highlight: "yellow",
        font: FONT,
        size: BODY_SIZE,
      }),
    );
  }

  return new Paragraph({
    spacing: { before: BEFORE_HEADING, after: PARAGRAPH_AFTER },
    keepNext: true,
    children,
  });
}

function imageParagraph(image: CoverImage): Paragraph {
  const size = fitWithin(image, COVER_IMAGE_BOX);
  return new Paragraph({
    spacing: { after: PARAGRAPH_AFTER },
    children: [
      new ImageRun({
        type: "jpg",
        data: image.data,
        transformation: { width: size.widthPx, height: size.heightPx },
      }),
    ],
  });
}

/** Build the cover sheet for one line item. */
export async function buildCoverSheetDocx(input: CoverSheetInput): Promise<Buffer> {
  // `images` is index-aligned with `rows`. A short array would render headings with no
  // proofs beneath them — a sheet that looks finished while documenting nothing — so the
  // alignment is asserted rather than assumed.
  if (input.images.length !== input.rows.length) {
    throw new Error(
      `Cover sheet has ${input.rows.length} rows but ${input.images.length} image groups.`,
    );
  }

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      spacing: { after: PARAGRAPH_AFTER },
      children: [new TextRun({ text: input.title, bold: true, font: FONT, size: TITLE_SIZE })],
    }),
    // One empty line between the title and the table.
    new Paragraph({ children: [], spacing: { after: 0 } }),
    buildTable(input),
    new Paragraph({ children: [], spacing: { after: 0 } }),
    new Paragraph({
      spacing: { after: PARAGRAPH_AFTER },
      children: [new TextRun({ text: SEE_BELOW, font: FONT, size: BODY_SIZE })],
    }),
  ];

  input.rows.forEach((row, index) => {
    children.push(headingParagraph(row));

    if (row.narrative) {
      children.push(
        new Paragraph({
          spacing: { after: PARAGRAPH_AFTER },
          children: [new TextRun({ text: row.narrative, font: FONT, size: BODY_SIZE })],
        }),
      );
    }

    for (const image of input.images[index] ?? []) {
      children.push(imageParagraph(image));
    }
  });

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE, color: "000000" },
          // `lineRule` is stated explicitly, not left to the default.
          //
          // OOXML says a `w:line` with no `w:lineRule` means "auto" — single spacing — but
          // LibreOffice 7.4 reads the omission as an exact 240-twip line and clips anything
          // taller to it. Inline images are anything taller: every proof on the cover sheet
          // collapsed to a 12pt (0.167in) horizontal band, so a page of evidence rendered as
          // a smear. It reproduces only against the LibreOffice the container ships; the
          // newer build on a developer's machine renders the same file correctly, which is
          // why this survived local testing (D-52).
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
