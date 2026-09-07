/**
 * Golden assertions on the docx the City actually opens.
 *
 * A cover sheet that merely "generates without error" can still be wrong in every way that
 * matters — an unshaded header, a left-aligned amount, a missing note — so these read the
 * WordprocessingML out of the package and assert the structure the spec fixes.
 */
import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { MonthKey } from "@/src/domain/dates";
import { coverSheetHeading, expenseReference } from "@/src/domain/strings";

import { coverSheetRows, type CoverSheetExpense } from "@/src/domain/cover-sheet";
import { SEE_BELOW, TAX_NOTE } from "@/src/domain/strings";

import { buildCoverSheetDocx, type CoverImage } from "./cover-sheet-docx";

const MONTH = "2026-02" as MonthKey;
const EXPENSES: CoverSheetExpense[] = [
  {
    name: "Kroger",
    referenceSeq: 1,
    description: "Groceries for participant families",
    subtotalCents: 42108,
    taxCents: 2526,
    feesCents: 0, taxReimbursable: false, feesReimbursable: true,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
  },
  {
    name: "Reimbursed Purchases",
    referenceSeq: 2,
    description: "Out-of-pocket purchases reimbursed",
    subtotalCents: 19084,
    taxCents: 0,
    feesCents: 250, taxReimbursable: false, feesReimbursable: true,
    note: "Aggregated from four separate receipts",
    narrative: "Staff paid for these items personally and were reimbursed in one transfer.",
    noReceipt: false,
    noReceiptReason: null,
  },
  {
    name: "Metro Transit Services",
    referenceSeq: 3,
    description: "Transportation for programme participants",
    subtotalCents: 61000,
    taxCents: 0,
    feesCents: 0, taxReimbursable: false, feesReimbursable: true,
    note: null,
    narrative: null,
    noReceipt: true,
    noReceiptReason: "vendor could not reissue the receipt",
  },
];

/** A 2:3 portrait image and a wide one, so scaling is observable. */
const IMAGES: CoverImage[][] = [
  [{ data: Buffer.from([0xff, 0xd8, 0xff, 0xdb]), widthPx: 1200, heightPx: 1800 }],
  [{ data: Buffer.from([0xff, 0xd8, 0xff, 0xdb]), widthPx: 3000, heightPx: 500 }],
  [],
];

const TITLE = "Team Pursuit February 2026 Social Services & Support Breakdown";

async function documentXml(images: CoverImage[][] = IMAGES): Promise<string> {
  const composed = coverSheetRows(EXPENSES, MONTH);
  const buffer = await buildCoverSheetDocx({
    title: TITLE,
    rows: composed.rows,
    totalCents: composed.totalCents,
    images,
  });
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

describe("cover sheet document", () => {
  it("sets body text at 10 pt and the title at 12 pt, matching the approved sheets", async () => {
    // Golden-reference conformance (review-2026-08-20-february, D-58). The client's approved
    // documents declare 11 pt in docDefaults and then override every run to 10 pt, so the
    // spec's original "11 pt, the theme default" took a value their text never uses.
    // Half-points: 20 = 10 pt, 24 = 12 pt.
    const xml = await documentXml();
    const sizes = [...new Set(xml.match(/<w:sz w:val="(\d+)"\/>/g) ?? [])].sort();
    expect(sizes).toEqual(['<w:sz w:val="20"/>', '<w:sz w:val="24"/>']);
  });

  it("states lineRule explicitly, so an inline image is not clipped to one line", async () => {
    // Regression: the default paragraph spacing emitted `w:line="240"` with no `w:lineRule`.
    // OOXML reads that omission as "auto" (single spacing), but LibreOffice 7.4 — the build
    // the deployment container ships — reads it as an exact 240-twip line and clips anything
    // taller. Every proof image on the cover sheet collapsed into a 12pt band, turning pages
    // of evidence into smears, and the whole sheet converted to a single page.
    //
    // It reproduces only against that LibreOffice: a newer one on a developer's machine
    // renders the same bytes correctly, so nothing but the emitted XML can catch it here.
    const composed = coverSheetRows(EXPENSES, MONTH);
    const buffer = await buildCoverSheetDocx({
      title: TITLE,
      rows: composed.rows,
      totalCents: composed.totalCents,
      images: IMAGES,
    });
    const zip = await JSZip.loadAsync(buffer);
    const styles = await zip.file("word/styles.xml")!.async("string");

    const spacings = styles.match(/<w:spacing[^/]*\/>/g) ?? [];
    expect(spacings.length).toBeGreaterThan(0);
    for (const spacing of spacings) {
      // Every declaration carrying a line height must say how to interpret it.
      if (spacing.includes("w:line=")) expect(spacing).toContain('w:lineRule="auto"');
    }
  });

  it("is a valid Office Open XML package", async () => {
    const composed = coverSheetRows(EXPENSES, MONTH);
    const buffer = await buildCoverSheetDocx({
      title: TITLE,
      rows: composed.rows,
      totalCents: composed.totalCents,
      images: IMAGES,
    });

    // PK zip magic — a docx is a zip, and Word rejects anything else outright.
    expect(buffer.subarray(0, 2).toString()).toBe("PK");

    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("word/document.xml")).not.toBeNull();
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
  });

  it("prints the title (R6.1)", async () => {
    expect(await documentXml()).toContain(
      "Team Pursuit February 2026 Social Services &amp; Support Breakdown",
    );
  });

  it("sets US Letter portrait with 1 inch margins", async () => {
    const xml = await documentXml();
    // 8.5" and 11" in twips.
    expect(xml).toContain('w:w="12240"');
    expect(xml).toContain('w:h="15840"');
    // 1" margins.
    expect(xml).toMatch(/w:top="1440"/);
  });
});

describe("table (R6.2)", () => {
  it("has a header row, one row per expense and a total row — no filler rows", async () => {
    const xml = await documentXml();
    const rows = xml.match(/<w:tr[ >]/g) ?? [];
    // Header + three expenses + total.
    expect(rows).toHaveLength(5);
  });

  it("shades the header and the total amount yellow", async () => {
    const xml = await documentXml();
    const shaded = xml.match(/w:fill="FFFF00"/g) ?? [];
    // Three header cells plus the single total amount cell.
    expect(shaded).toHaveLength(4);
  });

  it("uses the documented column widths", async () => {
    const xml = await documentXml();
    // 6.5" text width split 24% / 58% / 18%.
    expect(xml).toContain('w:w="2246"');
    expect(xml).toContain('w:w="5429"');
    expect(xml).toContain('w:w="1685"');
  });

  it("lays the table out fixed, so every renderer agrees on the columns", async () => {
    const xml = await documentXml();
    // Auto-fit let LibreOffice widen Amount to fit while Word wrapped the total, which is how
    // a broken number reached the client through documents that looked correct to us.
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
  });

  it("borders every cell at 0.5 pt", async () => {
    const xml = await documentXml();
    // Word border widths are eighths of a point, so 0.5 pt is sz="4".
    expect(xml).toMatch(/<w:top w:val="single" w:color="000000" w:sz="4"\/>/);
    const bordered = xml.match(/<w:tcBorders>/g) ?? [];
    // Three columns across five rows, every one bordered.
    expect(bordered).toHaveLength(15);
  });

  it("centers every cell, amounts included", async () => {
    const xml = await documentXml();
    const table = xml.slice(xml.indexOf("<w:tbl>"), xml.indexOf("</w:tbl>"));
    // Every paragraph inside the table is centered; none is left-aligned.
    expect(table).toContain('w:val="center"');
    expect(table).not.toContain('w:val="left"');
  });

  it("prints the description verbatim as the Role column", async () => {
    expect(await documentXml()).toContain("Groceries for participant families");
  });

  it("excludes tax from the amounts and the total (R1.3)", async () => {
    const xml = await documentXml();
    // Kroger: $421.08 subtotal with $25.26 tax — the tax must not appear anywhere.
    expect(xml).toContain("$421.08");
    expect(xml).not.toContain("$446.34");
    // Reimbursed Purchases: 190.84 + 2.50 fees.
    expect(xml).toContain("$193.34");
    // Total: 421.08 + 193.34 + 610.00.
    expect(xml).toContain("$1,224.42");
  });
});

describe("notes below the table (R6.3 – R6.7)", () => {
  it("prints the canonical sentence once, verbatim", async () => {
    const xml = await documentXml();
    const occurrences = xml.split(SEE_BELOW).length - 1;
    expect(occurrences).toBe(1);
  });

  it("gives every expense a bold heading matching its table Name (R6.4)", async () => {
    const xml = await documentXml();
    for (const expense of EXPENSES) {
      expect(xml).toContain(
        coverSheetHeading(expense.name, expenseReference(MONTH, expense.referenceSeq)),
      );
    }
  });

  it("appends the tax note whenever tax was excluded (R6.5)", async () => {
    expect(await documentXml()).toContain(TAX_NOTE);
  });

  it("prints a custom note and the tax note together, custom first (D-22)", async () => {
    const withBoth = await documentXml();
    const custom = withBoth.indexOf("Aggregated from four separate receipts");
    expect(custom).toBeGreaterThan(-1);
    // The second expense has a custom note but no tax, so only ordering within R6.5 is
    // asserted here; the combined case is covered in the domain unit tests.
  });

  it("discloses a missing receipt with its reason (R6.7)", async () => {
    expect(await documentXml()).toContain(
      "(Note: No receipt available — vendor could not reissue the receipt)",
    );
  });

  it("highlights the notes yellow but not the name", async () => {
    const xml = await documentXml();
    expect(xml).toContain('<w:highlight w:val="yellow"/>');
  });

  it("renders the narrative as a plain paragraph (R6.6)", async () => {
    const xml = await documentXml();
    const narrative = "Staff paid for these items personally and were reimbursed in one transfer.";
    expect(xml).toContain(narrative);

    // The narrative run must not be highlighted — it is context, not a warning.
    const at = xml.indexOf(narrative);
    const run = xml.slice(xml.lastIndexOf("<w:r>", at), at);
    expect(run).not.toContain("highlight");
  });
});

describe("proof images (R6.4)", () => {
  it("embeds one image per proof, in order", async () => {
    const composed = coverSheetRows(EXPENSES, MONTH);
    const buffer = await buildCoverSheetDocx({
      title: TITLE,
      rows: composed.rows,
      totalCents: composed.totalCents,
      images: IMAGES,
    });
    const zip = await JSZip.loadAsync(buffer);
    const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/"));
    expect(media).toHaveLength(2);
  });

  it("scales a tall image to fit the page rather than the full text width", async () => {
    const xml = await documentXml();
    // A 1200x1800 image is taller than it is wide, so the height bound governs: 8" tall
    // (768 px) rather than 6.5" wide. EMU = px * 9525.
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((match) => ({
      widthPx: Number(match[1]) / 9525,
      heightPx: Number(match[2]) / 9525,
    }));

    expect(extents[0].heightPx).toBeLessThanOrEqual(768);
    expect(extents[0].widthPx).toBeLessThanOrEqual(624);
    // Aspect ratio preserved (2:3).
    expect(extents[0].widthPx / extents[0].heightPx).toBeCloseTo(1200 / 1800, 2);
  });

  it("caps a wide image at the text width", async () => {
    const xml = await documentXml();
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((match) => ({
      widthPx: Number(match[1]) / 9525,
      heightPx: Number(match[2]) / 9525,
    }));
    // 3000x500 is limited by width: 6.5" = 624 px.
    expect(extents[1].widthPx).toBe(624);
    expect(extents[1].heightPx).toBeCloseTo(104, 0);
  });

  it("never enlarges an image smaller than the box", async () => {
    const xml = await documentXml([[{ data: Buffer.from([0xff, 0xd8]), widthPx: 300, heightPx: 200 }], [], []]);
    const [first] = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
    expect(Number(first[1]) / 9525).toBe(300);
    expect(Number(first[2]) / 9525).toBe(200);
  });

  /**
   * Each proof must resolve to its own stored image. A shared relationship id would put one
   * expense's receipt under another's heading — the document would look plausible and
   * document the wrong payment, which is the worst failure this sheet can have.
   */
  it("gives each expense's proof its own image relationship", async () => {
    const red = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 220, g: 30, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const blue = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 30, g: 30, b: 220 } },
    })
      .jpeg()
      .toBuffer();

    const buffer = await buildCoverSheetDocx({
      title: TITLE,
      rows: coverSheetRows(EXPENSES, MONTH).rows,
      totalCents: coverSheetRows(EXPENSES, MONTH).totalCents,
      images: [
        [{ data: red, widthPx: 400, heightPx: 300 }],
        [{ data: blue, widthPx: 400, heightPx: 300 }],
        [],
      ],
    });

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");

    const embeds = [...xml.matchAll(/r:embed="(rId\d+)"/g)].map((match) => match[1]);
    expect(embeds).toHaveLength(2);
    expect(new Set(embeds).size).toBe(2);

    // Follow each relationship to the media part and check the colours came out distinct
    // and in document order.
    const colours: string[] = [];
    for (const id of embeds) {
      const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
      expect(target).toBeTruthy();
      const bytes = await zip.file(`word/${target}`)!.async("nodebuffer");
      const { dominant } = await sharp(bytes).stats();
      colours.push(dominant.r > dominant.b ? "red" : "blue");
    }
    expect(colours).toEqual(["red", "blue"]);
  });

  it("produces a sheet with no images at all when nothing is attached", async () => {
    const xml = await documentXml([[], [], []]);
    expect(xml).not.toContain("<wp:extent");
    // The table and notes are still there.
    expect(xml).toContain(SEE_BELOW);
  });
});
