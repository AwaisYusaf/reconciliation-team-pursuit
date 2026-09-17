/**
 * Monthly summary docx → PDF conversion against the real LibreOffice, and the extracted text
 * against the real `pdftotext` (Phase 11 §7.4, P13, PHASE-11.md §10 I-36).
 *
 * Same pattern as `docx-to-pdf.test.ts` — skipped when LibreOffice is absent — plus `pdftotext`
 * for the text-fidelity assertion, skipped independently when that binary is absent (shared
 * probe in `pdftotext.test-helper.ts`, which also documents why probing matters).
 *
 * Emoji are deliberately excluded from the text-fidelity assertions: font substitution during
 * PDF rendering does not reliably keep emoji glyphs, so the docx builder test
 * (`monthly-summary-docx.test.ts`) is the one place emoji survival is asserted.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMonthlySummaryDocx } from "./monthly-summary-docx";
import { conversionAvailable, convertDocxToPdf } from "./docx-to-pdf";
import { hasPdftotext, pdftotext } from "./pdftotext.test-helper";

const conversionOk = await conversionAvailable();
const pdftotextOk = hasPdftotext();

const TITLE = "Team Pursuit City of Detroit March 2026 Monthly Summary";

const MARKDOWN = [
  "## Overview",
  "This month the café hosted a résumé workshop — attendance was strong.",
  "",
  "## Spending by line item",
  "- **Salary**: on track, nothing unusual.",
  "- *Travel*: slightly under budget this month.",
  "- ***Supplies***: fully spent.",
  "",
  "## Budget position",
  "The grant remains on pace against its schedule.",
  "",
  "## Changes from last month",
  "No changes to report since the last draft.",
  "",
  "## Items to note",
  "Please review the attached receipts before the next site visit.",
].join("\n");

describe.skipIf(!conversionOk || !pdftotextOk)("monthly summary PDF text fidelity (I-36)", () => {
  it("every text run from the docx (title, headings, paragraphs, bullets, bold/italic) appears in the extracted PDF text", async () => {
    const docx = await buildMonthlySummaryDocx({ title: TITLE, markdown: MARKDOWN });
    const pdf = await convertDocxToPdf(docx);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const dir = await mkdtemp(path.join(tmpdir(), "ngo-summary-pdftotext-"));
    try {
      const file = path.join(dir, "out.pdf");
      await writeFile(file, pdf);
      const raw = pdftotext([file, "-"]);
      // Collapse whitespace/newlines and normalise the bullet glyph pdftotext may substitute,
      // so line-wrapping in the rendered page doesn't break a substring match.
      const text = raw.replace(/\s+/g, " ").replace(/[•●]/g, "•");

      const expectedFragments = [
        TITLE,
        "Overview",
        "This month the café hosted a résumé workshop",
        "attendance was strong",
        "Spending by line item",
        "Salary",
        "on track, nothing unusual",
        "Travel",
        "slightly under budget this month",
        "Supplies",
        "fully spent",
        "Budget position",
        "The grant remains on pace against its schedule",
        "Changes from last month",
        "No changes to report since the last draft",
        "Items to note",
        "Please review the attached receipts before the next site visit",
      ];
      for (const fragment of expectedFragments) {
        expect(text, `expected PDF text to contain: ${fragment}`).toContain(fragment);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 200_000);
});
