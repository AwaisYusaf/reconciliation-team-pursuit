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
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
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
 * Aptos is the golden documents' theme font. The fallback chain matters for the conversion
 * container, which has no Aptos: Carlito is metric-compatible with Calibri, so line breaks
 * land in the same places and the PDF matches the docx.
 */
const FONT = "Aptos";

const YELLOW = "FFFF00";
/** Word border widths are in eighths of a point; the spec asks for 0.5 pt. */
const BORDER_SIZE = 4;
/** 11 pt and 12 pt, in half-points. */
const BODY_SIZE = 22;
const TITLE_SIZE = 24;
/** 6 pt and 12 pt, in twips. */
const PARAGRAPH_AFTER = 120;
const BEFORE_HEADING = 240;

const TEXT_WIDTH_TWIPS = convertInchesToTwip(COVER_TEXT_WIDTH_IN);
/** Name 24% · Role 61% · Amount 15%. */
const COLUMN_WIDTHS = [
  Math.round(TEXT_WIDTH_TWIPS * 0.24),
  Math.round(TEXT_WIDTH_TWIPS * 0.61),
  Math.round(TEXT_WIDTH_TWIPS * 0.15),
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
          paragraph: { spacing: { line: 240, after: PARAGRAPH_AFTER } },
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
