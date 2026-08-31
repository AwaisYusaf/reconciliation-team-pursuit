/**
 * The expense index is what makes a reference findable, so these assert on the text actually
 * extractable from the rendered PDF — that the references reached the page as real text a
 * reviewer can search, not an image of them.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { FEB, FEB_EXPENSES, LINE_ITEMS, SETTINGS } from "@/src/domain/fixtures";

import { INDEX_COLUMNS, INDEX_CONTENT_WIDTH, buildIndexSectionPdf } from "./packet-index-pdf";
import type { MonthSnapshot, SnapshotExpense } from "./month-snapshot";

function expense(overrides: Partial<SnapshotExpense> & { referenceSeq: number }): SnapshotExpense {
  return {
    id: `e-${overrides.referenceSeq}`,
    lineItemId: LINE_ITEMS[0].id,
    lineItemName: LINE_ITEMS[0].name,
    name: `Expense ${overrides.referenceSeq}`,
    description: "",
    date: "2026-02-10",
    paymentSource: "Paid by us, reimbursement requested",
    subtotalCents: 10_000,
    taxCents: 0,
    feesCents: 0, taxReimbursable: false, feesReimbursable: true,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
    sortOrder: overrides.referenceSeq,
    documents: [],
    ...overrides,
  };
}

function snapshotWith(expenses: SnapshotExpense[]): MonthSnapshot {
  return {
    orgId: "org",
    docName: "Team Pursuit",
    month: FEB,
    lineItems: LINE_ITEMS,
    amounts: FEB_EXPENSES,
    monthDocuments: [],
    expenses,
    settings: {
      ...SETTINGS,
      projectName: "Community Violence Intervention",
      contractNumber: "6007211",
      basePoNumber: "3086984",
      performancePoNumber: "3089749",
      fiduciaryName: "Detroit Crime Commission",
    },
  };
}

function hasPdftotext(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function extractText(pdf: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ngo-index-pdf-"));
  try {
    const file = path.join(dir, "index.pdf");
    await writeFile(file, pdf);
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("packet expense index", () => {
  it("spans exactly the content width", () => {
    // Columns are laid out from fixed widths, so a change to one silently shifts the table
    // off the margin unless they still sum to the printable width.
    const total = INDEX_COLUMNS.reduce((sum, column) => sum + column.width, 0);
    expect(total).toBe(INDEX_CONTENT_WIDTH);
  });

  it("is a US Letter portrait PDF", async () => {
    const pdf = await PDFDocument.load(await buildIndexSectionPdf(snapshotWith([expense({ referenceSeq: 1 })])));
    const [page] = pdf.getPages();
    expect(Math.round(page.getWidth())).toBe(612);
    expect(Math.round(page.getHeight())).toBe(792);
  });

  it("still produces a page for a month with no expenses", async () => {
    // A packet that silently drops a section it claims to have is worse than one saying none.
    const pdf = await PDFDocument.load(await buildIndexSectionPdf(snapshotWith([])));
    expect(pdf.getPageCount()).toBe(1);
  });

  it.skipIf(!hasPdftotext())("prints every expense's reference as real text", async () => {
    const bytes = await buildIndexSectionPdf(
      snapshotWith([
        expense({ referenceSeq: 1, name: "Canva" }),
        expense({ referenceSeq: 2, name: "ClickUp" }),
        expense({ referenceSeq: 14, name: "Zoom" }),
      ]),
    );
    const text = await extractText(bytes);

    expect(text).toContain("2026-02-001");
    expect(text).toContain("2026-02-002");
    // Padded to three digits, so references sort as text in the order they were entered.
    expect(text).toContain("2026-02-014");
    for (const name of ["Canva", "ClickUp", "Zoom"]) expect(text).toContain(name);
  });

  it.skipIf(!hasPdftotext())("lists expenses in reference order, not the order given", async () => {
    const bytes = await buildIndexSectionPdf(
      snapshotWith([
        expense({ referenceSeq: 3, name: "Third" }),
        expense({ referenceSeq: 1, name: "First" }),
        expense({ referenceSeq: 2, name: "Second" }),
      ]),
    );
    const text = await extractText(bytes);
    expect(text.indexOf("First")).toBeLessThan(text.indexOf("Second"));
    expect(text.indexOf("Second")).toBeLessThan(text.indexOf("Third"));
  });

  it.skipIf(!hasPdftotext())("repeats the column header when the list runs onto another page", async () => {
    // A continuation sheet of bare figures with no column names is unreadable alone, and
    // packet pages get separated.
    const many = Array.from({ length: 60 }, (_, index) => expense({ referenceSeq: index + 1 }));
    const bytes = await buildIndexSectionPdf(snapshotWith(many));

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);

    const text = await extractText(bytes);
    const headers = text.split("Reimbursable").length - 1;
    expect(headers).toBe(pdf.getPageCount());
    // Nothing is dropped at a page boundary.
    expect(text).toContain("2026-02-001");
    expect(text).toContain("2026-02-060");
  });

  it.skipIf(!hasPdftotext())("shows the reimbursable amount, which excludes tax (R1.3)", async () => {
    const bytes = await buildIndexSectionPdf(
      snapshotWith([
        expense({ referenceSeq: 1, name: "Taxed", subtotalCents: 10_000, taxCents: 600, feesCents: 125 , taxReimbursable: false, feesReimbursable: true}),
      ]),
    );
    // 100.00 + 1.25 fees, tax excluded.
    expect(await extractText(bytes)).toContain("$101.25");
  });
});
