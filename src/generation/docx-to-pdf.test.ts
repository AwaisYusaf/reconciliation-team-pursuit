/**
 * Conversion against the real LibreOffice.
 *
 * The PDF is what the City receives and what the packet embeds, so these run the actual
 * converter rather than mocking it — a mock would happily "convert" a document that
 * LibreOffice refuses. Skipped when LibreOffice is absent; the deployment container ships it.
 */
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { MonthKey } from "@/src/domain/dates";

import { coverSheetRows, type CoverSheetExpense } from "@/src/domain/cover-sheet";

import { buildCoverSheetDocx } from "./cover-sheet-docx";
import { conversionAvailable, convertDocxToPdf } from "./docx-to-pdf";
import { pdfPageCount } from "./raster";

const MONTH = "2026-02" as MonthKey;

const available = await conversionAvailable();

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
    name: "Metro Transit Services",
    referenceSeq: 2,
    description: "Transportation for programme participants",
    subtotalCents: 61000,
    taxCents: 0,
    feesCents: 0, taxReimbursable: false, feesReimbursable: true,
    note: null,
    narrative: "Fares for participants attending weekly sessions.",
    noReceipt: true,
    noReceiptReason: "vendor could not reissue the receipt",
  },
];

async function coverSheet(): Promise<Buffer> {
  const composed = coverSheetRows(EXPENSES, MONTH);
  return buildCoverSheetDocx({
    title: "Team Pursuit February 2026 Social Services & Support Breakdown",
    rows: composed.rows,
    totalCents: composed.totalCents,
    images: [[], []],
  });
}

describe.skipIf(!available)("convertDocxToPdf", () => {
  it("produces a real PDF from a real cover sheet", async () => {
    const pdf = await convertDocxToPdf(await coverSheet());

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(await pdfPageCount(pdf)).toBeGreaterThanOrEqual(1);
  }, 200_000);

  it("carries the document's text through, so the PDF is not a blank page", async () => {
    const pdf = await convertDocxToPdf(await coverSheet());

    // The PDF is compressed, so the text is not greppable in the raw bytes; pdftotext is
    // the honest check that the words actually reached the page.
    const { execFileSync } = await import("node:child_process");
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const path = await import("node:path");

    const dir = await mkdtemp(path.join(tmpdir(), "ngo-pdftotext-"));
    try {
      const file = path.join(dir, "out.pdf");
      await writeFile(file, pdf);
      const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });

      expect(text).toContain("Breakdown");
      expect(text).toContain("Kroger");
      expect(text).toContain("$421.08");
      // Tax was excluded, so the gross must not appear.
      expect(text).not.toContain("$446.34");
      expect(text).toContain("Please see below for additional information");
      expect(text).toContain("No receipt available");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 200_000);

  it("leaves no temp directory behind", async () => {
    const { mkdtemp: makeTemp, readdir: readDir, rm: remove } = await import("node:fs/promises");
    const path = await import("node:path");

    // This conversion gets a temp root of its own. Sampling the shared `ngo-soffice-` prefix
    // could only ever see other test files' live directories too, and "wait for them to go
    // away" was a race the suite lost whenever a sibling conversion ran longer than the wait —
    // which it does under load, since one conversion here takes 20-40 seconds.
    //
    // `os.tmpdir()` reads these variables each call, and vitest gives each test file its own
    // process, so this redirects only this test's conversion (and the soffice child it spawns).
    const previous = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    const root = await makeTemp(path.join(tmpdir(), "ngo-tempcheck-"));
    process.env.TMPDIR = root;
    process.env.TEMP = root;
    process.env.TMP = root;

    try {
      await convertDocxToPdf(await coverSheet());
      const leaked = (await readDir(root)).filter((name) => name.startsWith("ngo-soffice-"));
      expect(leaked).toEqual([]);
    } finally {
      process.env.TMPDIR = previous.TMPDIR;
      process.env.TEMP = previous.TEMP;
      process.env.TMP = previous.TMP;
      await remove(root, { recursive: true, force: true });
    }
  }, 200_000);

  /**
   * LibreOffice sniffs content rather than trusting the extension and silently treats
   * unrecognised input as plain text, so without a guard a malformed document would convert
   * into a perfectly valid PDF of garbage and be submitted as a cover sheet.
   */
  it("refuses input that is not a docx package instead of converting it to nonsense", async () => {
    await expect(convertDocxToPdf(Buffer.from("not a docx at all"))).rejects.toThrow(
      /not a \.docx package/,
    );
  }, 200_000);
});
