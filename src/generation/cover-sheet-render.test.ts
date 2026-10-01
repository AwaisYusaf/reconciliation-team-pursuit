/**
 * The packet's colours as they are actually drawn (D-137).
 *
 * `cover-sheet-docx.test.ts` proves the XML asks for the brown band, the tinted total and the
 * tinted notes. It cannot prove the converter honours them: the XML was right for the grid under
 * the band too, and LibreOffice still drew a grey hairline there that Word would not. The pdf-lib
 * summary and index drew the same hairline for their own reason. So this renders real pages,
 * rasterises them, and reads pixels at points located by the pages' own words. The cover sheet
 * needs LibreOffice; every block needs Poppler. Skipped without them, as the other render tests are.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import type { CoverSheetRow } from "@/src/domain/cover-sheet";
import { FEB, FEB_EXPENSES, LINE_ITEMS, SETTINGS } from "@/src/domain/fixtures";
import { TAX_NOTE } from "@/src/domain/strings";

import { buildCoverSheetDocx } from "./cover-sheet-docx";
import { DOCUMENT_THEME as THEME, channels } from "./document-theme";
import { conversionAvailable, convertDocxToPdf } from "./docx-to-pdf";
import { COVER_MARGIN_IN, inchesToPoints } from "./layout-constants";
import type { MonthSnapshot, SnapshotExpense } from "./month-snapshot";
import { buildIndexSectionPdf } from "./packet-index-pdf";
import { buildSummarySectionPdf } from "./packet-summary-pdf";
import { bboxLayoutSupported, coverSheetAnchors, wordsOf, type Word } from "./pdf-anchors";
import { hasPdftotext } from "./pdftotext.test-helper";

const hasPdftoppm = () => {
  const probe = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" });
  return !probe.error && /pdftoppm version/i.test(`${probe.stdout ?? ""}${probe.stderr ?? ""}`);
};
const canRaster = hasPdftotext() && hasPdftoppm() && bboxLayoutSupported();
const canConvert = canRaster && (await conversionAvailable());

/** 300 DPI, so a 0.5 pt border is about two whole pixels. */
const DPI = 300;
const toPx = (points: number) => Math.round((points * DPI) / 72);

type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => channels(hex).map((c) => Math.round(c * 255)) as Rgb;
const near = (a: Rgb, b: Rgb, tolerance = 12) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

type Page = { words: Word[]; pixel: (xPt: number, yPt: number) => Rgb };

/** Every page of a PDF, as its words and a pixel reader in the same top-left point space. */
async function pagesOf(pdf: Buffer): Promise<Page[]> {
  const words = wordsOf(pdf);
  const count = Math.max(...words.map((w) => w.page)) + 1;
  const dir = mkdtempSync(path.join(tmpdir(), "ngo-render-colours-"));
  try {
    writeFileSync(path.join(dir, "doc.pdf"), pdf);
    spawnSync("pdftoppm", ["-r", String(DPI), "-png", "doc.pdf", "page"], { cwd: dir });
    const pages: Page[] = [];
    for (let index = 0; index < count; index += 1) {
      const file = path.join(dir, `page-${String(index + 1).padStart(String(count).length, "0")}.png`);
      const { data, info } = await sharp(readFileSync(file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      pages.push({
        words: words.filter((w) => w.page === index),
        pixel: (xPt, yPt) => {
          const offset = (toPx(yPt) * info.width + toPx(xPt)) * 3;
          return [data[offset], data[offset + 1], data[offset + 2]];
        },
      });
    }
    return pages;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const middle = (w: Word) => (w.yMin + w.yMax) / 2;

/**
 * Grid-grey pixels in the 3 pt under a header band, read at `x` from the label `label` down.
 *
 * Starts at the band's last brown pixel rather than stopping at the first white one: LibreOffice
 * leaves an anti-aliased pixel between the band and a hairline, which a stop-at-white walk steps
 * over. One grey-ish pixel is a half-covered edge; a drawn 0.5 pt line is two or more.
 */
function greyUnderBand(page: Page, label: Word, x: number): number {
  let y = middle(label);
  while (near(page.pixel(x, y), rgbOf(THEME.accent))) y += 72 / DPI;
  let grey = 0;
  for (let step = 0; step < toPx(3); step += 1) {
    if (near(page.pixel(x, y + (step * 72) / DPI), rgbOf(THEME.line), 10)) grey += 1;
  }
  return grey;
}

const ROWS: CoverSheetRow[] = [
  { reference: "2026-02-001", name: "Kroger", role: "Groceries for participant families", amountCents: 42108, notes: [TAX_NOTE], narrative: null },
  { reference: "2026-02-002", name: "Metro Transit Services", role: "Transportation for participants", amountCents: 61000, notes: [], narrative: null },
];

async function coverSheet(rows: CoverSheetRow[]): Promise<Buffer> {
  const docx = await buildCoverSheetDocx({
    title: "Team Pursuit February 2026 Social Services Breakdown",
    rows,
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    images: rows.map(() => []),
  });
  return convertDocxToPdf(docx);
}

describe.skipIf(!canConvert)("cover sheet colours, as rendered by LibreOffice", () => {
  let pdf: Buffer;
  let page: Page;

  beforeAll(async () => {
    pdf = await coverSheet(ROWS);
    [page] = await pagesOf(pdf);
  }, 120_000);

  const word = (text: string) => {
    const found = page.words.find((w) => w.text === text);
    expect(found, `"${text}" on the sheet`).toBeDefined();
    return found!;
  };

  it("fills the header band brown", () => {
    const role = word("Role");
    // Well left of the centred label, inside the Role column's header cell.
    expect(page.pixel(role.xMin - 40, middle(role))).toSatisfy((c: Rgb) => near(c, rgbOf(THEME.accent)));
  });

  it("draws no grey line under the band: brown runs straight into the first row", () => {
    const role = word("Role");
    expect(greyUnderBand(page, role, role.xMin - 40)).toBeLessThan(2);
  });

  it("tints the total row across its empty cells", () => {
    // The total is the last money token on the page; its row's Name cell is empty, and the
    // table starts at the left margin.
    const total = page.words.filter((w) => /^\$[\d,]+\.\d{2}$/.test(w.text)).at(-1)!;
    expect(page.pixel(inchesToPoints(COVER_MARGIN_IN) + 12, middle(total))).toSatisfy((c: Rgb) =>
      near(c, rgbOf(THEME.section), 8),
    );
  });

  it("tints the note but not the name before it", () => {
    const open = word("(Note:");
    const next = page.words.find((w) => w.text === "Statement" && Math.abs(w.yMin - open.yMin) < 1.5)!;
    // The space between two words of the note is the run's background, not a glyph.
    expect(page.pixel((open.xMax + next.xMin) / 2, middle(open))).toSatisfy((c: Rgb) => near(c, rgbOf(THEME.section), 8));
    // Between "Kroger" and "(2026-02-001):" is the heading's own space: plain white.
    const name = page.words.filter((w) => w.text === "Kroger").at(-1)!;
    const ref = word("(2026-02-001):");
    expect(page.pixel((name.xMax + ref.xMin) / 2, middle(name))).toSatisfy((c: Rgb) => near(c, [255, 255, 255], 6));
  });

  it("rules the title in brown just under it", () => {
    const title = word("Breakdown");
    const x = (title.xMin + title.xMax) / 2;
    let found = false;
    for (let y = title.yMax; y < title.yMax + 14; y += 0.25) {
      if (near(page.pixel(x, y), rgbOf(THEME.accent))) found = true;
    }
    expect(found, "a brown rule within 14 pt under the title").toBe(true);
  });

  it("still anchors every row and heading, tinted note included (D-83)", () => {
    const anchors = coverSheetAnchors(pdf, ROWS);
    expect(anchors).toHaveLength(2);
    expect(anchors.every((anchor) => anchor.heading.page === 0)).toBe(true);
  });

  it("keeps the band's edge brown on every page a long table reaches", async () => {
    // The header repeats on each page; the first row under it has no top edge of its own there
    // either, so a continuation page must look like page one.
    const rows = Array.from({ length: 60 }, (_, i) => ({
      reference: `2026-02-${String(i + 1).padStart(3, "0")}`,
      name: `Vendor ${i + 1}`,
      role: "Environment and tools to support initiatives and events",
      amountCents: 10_000 + i,
      notes: [],
      narrative: null,
    }));
    const pages = (await pagesOf(await coverSheet(rows))).filter((p) => p.words.some((w) => w.text === "Role"));
    expect(pages.length, "pages carrying the header").toBeGreaterThan(1);
    for (const [index, p] of pages.entries()) {
      const role = p.words.find((w) => w.text === "Role")!;
      expect(greyUnderBand(p, role, role.xMin - 40), `page ${index + 1}`).toBeLessThan(2);
    }
  }, 120_000);
});

function expense(seq: number): SnapshotExpense {
  return {
    id: `e-${seq}`,
    lineItemId: LINE_ITEMS[0].id,
    lineItemName: LINE_ITEMS[0].name,
    name: `Expense ${seq}`,
    description: "",
    date: "2026-02-10",
    paymentSource: "Paid by us, reimbursement requested",
    subtotalCents: 10_000,
    taxCents: 0,
    feesCents: 0,
    taxReimbursable: false,
    feesReimbursable: true,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
    sortOrder: seq,
    referenceSeq: seq,
    documents: [],
  };
}

const SNAPSHOT: MonthSnapshot = {
  orgId: "org",
  docName: "Team Pursuit",
  month: FEB,
  lineItems: LINE_ITEMS,
  amounts: FEB_EXPENSES,
  monthDocuments: [],
  // Enough rows that the index continues onto a second page under a repeated header.
  expenses: Array.from({ length: 60 }, (_, i) => expense(i + 1)),
  settings: { ...SETTINGS, projectName: "", contractNumber: "6007211", basePoNumber: "", performancePoNumber: "", fiduciaryName: "" },
};

describe.skipIf(!canRaster)("summary and index colours, as drawn by pdf-lib (hidden, D-114)", () => {
  it("the index's band is brown with no grey under it, on every page", async () => {
    const pages = (await pagesOf(await buildIndexSectionPdf(SNAPSHOT))).filter((p) => p.words.some((w) => w.text === "Ref"));
    expect(pages.length, "pages carrying the header").toBeGreaterThan(1);
    for (const [index, p] of pages.entries()) {
      const label = p.words.find((w) => w.text === "Name")!;
      expect(p.pixel(label.xMax + 20, middle(label)), `page ${index + 1} band`).toSatisfy((c: Rgb) => near(c, rgbOf(THEME.accent)));
      expect(greyUnderBand(p, label, label.xMax + 20), `page ${index + 1}`).toBeLessThan(2);
    }
  });

  it("the summary's band is brown with no grey under it", async () => {
    const [page] = await pagesOf(await buildSummarySectionPdf(SNAPSHOT));
    const label = page.words.find((w) => w.text === "Scheduled")!;
    expect(page.pixel(label.xMin - 6, middle(label))).toSatisfy((c: Rgb) => near(c, rgbOf(THEME.accent)));
    expect(greyUnderBand(page, label, label.xMin - 6)).toBeLessThan(2);
  });
});
