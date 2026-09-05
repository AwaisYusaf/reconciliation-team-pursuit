/**
 * The packet's first page is the one a City reviewer reads first, so these assert on the
 * text actually extractable from the rendered PDF — proof the figures reached the page and
 * that it is real text rather than an image.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { FEB, FEB_EXPENSES, LINE_ITEMS, SETTINGS } from "@/src/domain/fixtures";

import type { MonthSnapshot } from "./month-snapshot";
import { buildSummarySectionPdf } from "./packet-summary-pdf";

const snapshot: MonthSnapshot = {
  orgId: "org",
  docName: "Team Pursuit",
  month: FEB,
  lineItems: LINE_ITEMS,
  amounts: FEB_EXPENSES,
  monthDocuments: [],
  expenses: [],
  settings: {
    ...SETTINGS,
    projectName: "Community Violence Intervention",
    contractNumber: "6007211",
    basePoNumber: "3086984",
    performancePoNumber: "3089749",
    fiduciaryName: "Detroit Crime Commission",
  },
};

function hasPdftotext(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function extractText(pdf: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ngo-summary-pdf-"));
  try {
    const file = path.join(dir, "summary.pdf");
    await writeFile(file, pdf);
    // -layout keeps columns apart, so a number cannot be read out of the wrong column.
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("packet summary section", () => {
  it("is a US Letter portrait PDF", async () => {
    const pdf = await PDFDocument.load(await buildSummarySectionPdf(snapshot));
    const [page] = pdf.getPages();
    expect(Math.round(page.getWidth())).toBe(612);
    expect(Math.round(page.getHeight())).toBe(792);
  });

  it("fits the published February figures on one page", async () => {
    const pdf = await PDFDocument.load(await buildSummarySectionPdf(snapshot));
    expect(pdf.getPageCount()).toBe(1);
  });

  it("stays small, because it is text rather than an image", async () => {
    const pdf = await buildSummarySectionPdf(snapshot);
    expect(pdf.byteLength).toBeLessThan(50_000);
  });
});

describe.skipIf(!hasPdftotext())("packet summary text", () => {
  it("prints the title and the R7.3 context line", async () => {
    const text = await extractText(await buildSummarySectionPdf(snapshot));
    expect(text).toContain("Team Pursuit — Contract Summary — February 2026");
    expect(text).toContain("Contract 6007211");
    expect(text).toContain("Base PO 3086984");
    expect(text).toContain("Invoice period: 2/1/2026 to 2/28/2026");
  });

  it("omits settings the organisation has not filled in", async () => {
    const text = await extractText(
      await buildSummarySectionPdf({
        ...snapshot,
        settings: { ...snapshot.settings, contractNumber: "", basePoNumber: "" },
      }),
    );
    expect(text).not.toContain("Contract 6007211");
    expect(text).not.toContain("Base PO");
    // The period needs no configuration, so it is always there.
    expect(text).toContain("Invoice period");
  });

  it("carries every column header", async () => {
    const text = await extractText(await buildSummarySectionPdf(snapshot));
    for (const header of [
      "Description of Work",
      "Scheduled",
      "Previously",
      "This Period",
      "Total Billed",
      "Complete",
      "Balance",
    ]) {
      expect(text).toContain(header);
    }
  });

  it("reproduces the published figures exactly (R10.2)", async () => {
    const text = await extractText(await buildSummarySectionPdf(snapshot));

    // Salary row, straight from the approved February packet.
    expect(text).toContain("$458,692.46");
    expect(text).toContain("$45,641.12");
    expect(text).toContain("$395,641.12");
    expect(text).toContain("$63,051.34");

    // Totals — the only bottom-line row now (no separate "Base subtotal" to also check).
    expect(text).toContain("$854,916.67");
    expect(text).toContain("$616,627.93");
    expect(text).toContain("$238,288.74");
  });

  it("prints the section divider, the totals row, and Performance Grant 1 as an ordinary line item", async () => {
    const text = await extractText(await buildSummarySectionPdf(snapshot));
    expect(text).toContain("BASE");
    // No longer its own divider section (R7.2 retired, m08) — just a base row's name now.
    expect(text).toContain("Performance Grant 1");
    expect(text).not.toContain("PERFORMANCE GRANT 1");
    // No "Base subtotal" row either: it would only ever repeat Totals now that every line
    // item is a base row.
    expect(text).not.toContain("Base subtotal");
    expect(text).toContain("Totals");
  });

  it("prints the four reconciliation lines (R7.4)", async () => {
    const text = await extractText(await buildSummarySectionPdf(snapshot));
    expect(text).toContain("Total advances received");
    expect(text).toContain("$665,000.00");
    expect(text).toContain("Total reconciled to date");
    expect(text).toContain("Balance remaining to reconcile");
    expect(text).toContain("$48,372.07");
    expect(text).toContain("Percentage of advance payments reconciled");
    expect(text).toContain("93%");
  });

  it("agrees with the workbook and the screen on percentages", async () => {
    const text = await extractText(await buildSummarySectionPdf(snapshot));
    // The same ten values the Contract Summary screen shows.
    for (const percent of ["86%", "89%", "103%", "98%", "46%", "22%", "85%", "72%", "93%"]) {
      expect(text).toContain(percent);
    }
  });

  /**
   * A long roster of line items must paginate rather than run off the page, and each page's
   * table has to be readable on its own — so the header repeats.
   */
  it("paginates with a repeated header when line items overflow", async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `item-${index}`,
      name: `Line Item Number ${index} With A Deliberately Long Name`,
      scheduledValueCents: 1_000_00,
      openingBilledCents: 100_00,
      sortOrder: index,
    }));

    const bytes = await buildSummarySectionPdf({ ...snapshot, lineItems: many, amounts: [] });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);

    const text = await extractText(bytes);
    const headers = text.split("Description of Work").length - 1;
    expect(headers).toBe(pdf.getPageCount());

    // Nothing was dropped in the overflow.
    expect(text).toContain("Line Item Number 0 ");
    expect(text).toContain("Line Item Number 39 ");
    expect(text).toContain("Totals");
  });

  it("renders a month with no expenses without inventing figures", async () => {
    const text = await extractText(
      await buildSummarySectionPdf({ ...snapshot, amounts: [], expenses: [] }),
    );
    expect(text).toContain("Team Pursuit — Contract Summary — February 2026");
    expect(text).toContain("$0.00");
  });
});
