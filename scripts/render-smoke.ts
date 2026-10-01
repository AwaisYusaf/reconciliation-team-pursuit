/**
 * Deploy-time render smoke test (TASKS.md T1).
 *
 *   npx tsx --conditions=react-server scripts/render-smoke.ts
 *
 * Builds every generated document from fixture data and asserts the properties that only
 * exist in a real render. This project's defects have overwhelmingly been invisible to unit
 * tests: LibreOffice crushing proof images, a cover sheet at the wrong point size, an eager
 * database connection that only failed under `next build`, and twice now a stale
 * GENERATOR_VERSION serving pre-change bytes from cache. None of those were type errors and
 * none failed a test — they failed only when something was actually rendered, in a container.
 *
 * Exits non-zero on the first failure so a deploy can gate on it.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PDFDocument } from "pdf-lib";

import { FEB, FEB_EXPENSES, LINE_ITEMS, SETTINGS } from "@/src/domain/fixtures";
import { TAX_NOTE } from "@/src/domain/strings";
import { buildIndexSectionPdf } from "@/src/generation/packet-index-pdf";
import { buildSummarySectionPdf } from "@/src/generation/packet-summary-pdf";
import { buildCoverSheetDocx } from "@/src/generation/cover-sheet-docx";
import { convertDocxToPdf } from "@/src/generation/docx-to-pdf";
import { bboxLayoutSupported, coverSheetAnchors } from "@/src/generation/pdf-anchors";
import { buildSummaryWorkbook } from "@/src/generation/summary-xlsx";
import { stampFooters } from "@/src/generation/packet-footer";
import type { MonthSnapshot, SnapshotExpense } from "@/src/generation/month-snapshot";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function expense(overrides: Partial<SnapshotExpense> & { referenceSeq: number }): SnapshotExpense {
  return {
    id: `e-${overrides.referenceSeq}`,
    lineItemId: LINE_ITEMS[0].id,
    lineItemName: LINE_ITEMS[0].name,
    name: `Expense ${overrides.referenceSeq}`,
    description: "Role text",
    date: "2026-02-10",
    paymentSource: "Paid by us, reimbursement requested",
    subtotalCents: 10_000,
    taxCents: 600,
    feesCents: 125,
    taxReimbursable: false,
    feesReimbursable: true,
    note: null,
    narrative: null,
    noReceipt: false,
    noReceiptReason: null,
    sortOrder: overrides.referenceSeq,
    documents: [],
    ...overrides,
  };
}

const snapshot: MonthSnapshot = {
  orgId: "smoke",
  docName: "Team Pursuit",
  month: FEB,
  lineItems: LINE_ITEMS,
  amounts: FEB_EXPENSES,
  monthDocuments: [],
  expenses: [
    expense({ referenceSeq: 1, name: "Documented expense" }),
    expense({
      referenceSeq: 2,
      name: "ATM Withdrawal",
      noReceipt: true,
      noReceiptReason: "Cash for participant stipends; no vendor receipt exists",
    }),
    expense({ referenceSeq: 3, name: "Whole receipt", taxReimbursable: true }),
  ],
  settings: {
    ...SETTINGS,
    projectName: "Community Violence Intervention",
    contractNumber: "6007211",
    basePoNumber: "3086984",
    performancePoNumber: "3089749",
    fiduciaryName: "Detroit Crime Commission",
  },
};

async function textOf(pdf: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "smoke-"));
  try {
    const file = path.join(dir, "doc.pdf");
    await writeFile(file, pdf);
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("render smoke test\n");

  console.log("contract summary");
  const summary = await buildSummarySectionPdf(snapshot);
  const summaryText = await textOf(summary);
  check("renders as real text", summaryText.includes("Description of Work"));
  check("carries this month's figures", summaryText.includes("This Period"));
  // Asserted on the figure, not the header: "Balance to Finish" wraps across two lines and
  // pdftotext interleaves the halves, so no string match on it can work. The number is the
  // better check regardless — it proves the arithmetic reached the page.
  check(
    "carries remaining budget",
    summaryText.includes("$63,051.34"),
    "expected Salary's balance to finish (458,692.46 - 350,000 - 45,641.12)",
  );
  check("names the contract", summaryText.includes("6007211"));

  console.log("\nexpense index");
  const index = await buildIndexSectionPdf(snapshot);
  const indexText = await textOf(index);
  check("every reference is searchable text", ["001", "002", "003"].every((n) => indexText.includes(`2026-02-${n}`)));
  check("discloses an undocumented expense (D-74)", indexText.includes("Expenses with no receipt available:"));
  check("gives its stated reason", indexText.includes("participant stipends"));

  console.log("\npage footers");
  const stamped = await stampFooters(index, "Team Pursuit", "February 2026", ["2026-02-014"]);
  const stampedText = await textOf(stamped);
  check("carries the expense reference (D-70)", stampedText.includes("2026-02-014 | Page 1 of"));

  console.log("\ncover sheet");
  // The client saw the yellow total break mid-number in Word while our own PDFs looked fine,
  // because the table was auto-fit and each renderer sized the columns its own way. This
  // renders the sheet for real and asserts the amount comes back as one unbroken string. It
  // only means anything because the table is fixed-layout: under auto-fit the renderer would
  // widen the column to fit and the check could never fail.
  //
  // The figure is deliberately one digit longer than the longest real amount (a seven-figure
  // refund, R1.4), so the column is asked for more than it will ever really need.
  //
  // That margin makes this a font check as well as a width check. The container has no Aptos;
  // it must resolve to Carlito via the alias the Dockerfile installs (D-78). When it fell back
  // to DejaVu Sans instead — a quarter wider per digit — this check failed at the shipped 18%,
  // which is exactly how the wrong font was caught. Measured in the real image: DejaVu wraps
  // this at 18% and Carlito does not.
  const WIDEST = -1_234_567_890;
  const coverDocx = await buildCoverSheetDocx({
    title: "Team Pursuit Global February 2026 Salary Breakdown",
    rows: [
      {
        reference: "2026-02-014",
        name: "Marcus Wainwright-Delacroix",
        role: "Community Violence Intervention Outreach Specialist and Team Lead",
        amountCents: WIDEST,
        // A tinted note on the heading line (D-137), so the anchor is found beside one here too.
        notes: [TAX_NOTE],
        narrative: null,
      },
    ],
    totalCents: WIDEST,
    images: [[]],
  });
  const coverPdf = await convertDocxToPdf(coverDocx);
  const coverText = await textOf(coverPdf);
  // The packet's links are measured with `pdftotext -bbox-layout` at assembly time, so this is a
  // runtime dependency of the container, not only of the tests (D-83).
  check("pdftotext supports -bbox-layout", bboxLayoutSupported());
  try {
    const [anchor] = coverSheetAnchors(coverPdf, [{ reference: "2026-02-014", amountCents: WIDEST }]);
    check("locates the heading and the table row (D-83)", anchor.heading.rect.height > 0 && anchor.row.rect.height > 0);
  } catch (error) {
    check("locates the heading and the table row (D-83)", false, String(error));
  }
  check(
    "the total prints on one line (D-76)",
    coverText.includes("-$12,345,678.90"),
    "the amount column is too narrow, so the number wrapped",
  );

  console.log("\nExcel workbook");
  const workbook = await buildSummaryWorkbook(snapshot);
  check("produces a non-trivial file", workbook.byteLength > 5_000);

  console.log("\ndocument integrity");
  const loaded = await PDFDocument.load(await stampFooters(summary, "Team Pursuit", "February 2026"));
  check("summary is a valid, non-empty PDF", loaded.getPageCount() > 0);

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
