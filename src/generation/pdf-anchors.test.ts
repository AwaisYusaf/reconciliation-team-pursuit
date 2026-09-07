/**
 * Anchor location on real converted cover sheets (D-83).
 *
 * Needs LibreOffice and a Poppler `pdftotext`: these measure what LibreOffice actually laid out,
 * which is the whole point — a test on synthetic coordinates would prove nothing about the sheet.
 */
import { beforeAll, describe, expect, it } from "vitest";

import type { CoverSheetRow } from "@/src/domain/cover-sheet";
import { formatMoney } from "@/src/domain/format";

import { buildCoverSheetDocx } from "./cover-sheet-docx";
import { conversionAvailable, convertDocxToPdf } from "./docx-to-pdf";
import { AnchorError, bboxLayoutSupported, coverSheetAnchors, toPdfRect, wordsOf } from "./pdf-anchors";
import { hasPdftotext } from "./pdftotext.test-helper";

const canRun = hasPdftotext() && bboxLayoutSupported() && (await conversionAvailable());

function row(reference: string, name: string, amountCents: number, role = "Program Director"): CoverSheetRow {
  return { reference, name, role, amountCents, notes: [], narrative: null };
}

async function sheet(rows: CoverSheetRow[]): Promise<Buffer> {
  const docx = await buildCoverSheetDocx({
    title: "Team Pursuit Global February 2026 Salary Breakdown",
    rows,
    totalCents: rows.reduce((sum, r) => sum + r.amountCents, 0),
    images: rows.map(() => []),
  });
  return convertDocxToPdf(docx);
}

const contains = (outer: { x: number; y: number; width: number; height: number }, inner: typeof outer) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

describe("toPdfRect", () => {
  it("flips the y axis using the page height it is given, not an assumed one", () => {
    expect(toPdfRect({ xMin: 10, yMin: 100, xMax: 30, yMax: 110 }, 1000)).toEqual({ x: 10, y: 890, width: 20, height: 10 });
  });
});

describe.skipIf(!canRun)("coverSheetAnchors on a converted sheet", () => {
  // Two expenses for the same person: identical rows and identical names, the case a name-based
  // anchor gets wrong. Only the reference tells them apart.
  const rows = [
    row("2026-02-001", "Jordan Ellis", 45_869_246),
    row("2026-02-002", "Jordan Ellis", 100_000, "Program Director (second pay period)"),
    row("2026-02-003", "Priya Natarajan", 325_000, "Outreach Lead"),
  ];
  let pdf: Buffer;
  beforeAll(async () => {
    pdf = await sheet(rows);
  }, 180_000);

  it("finds one heading per expense, distinguished by reference not by name", () => {
    const anchors = coverSheetAnchors(pdf, rows);
    expect(anchors).toHaveLength(3);
    const ys = anchors.map((a) => a.heading.rect.y);
    expect(new Set(ys).size).toBe(3);
    // Headings follow table order down the page (PDF y grows upward).
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
  });

  it("puts every heading rectangle over its own reference token", () => {
    const anchors = coverSheetAnchors(pdf, rows);
    const words = wordsOf(pdf);
    anchors.forEach((anchor, index) => {
      const token = words.find((w) => w.text === `${rows[index].reference}:`)!;
      expect(anchor.heading.page).toBe(token.page);
      expect(contains(anchor.heading.rect, toPdfRect(token, token.pageHeight))).toBe(true);
      // Scrolling to `top` shows the heading at the top of the viewport, not just below it.
      expect(anchor.heading.top).toBeGreaterThanOrEqual(anchor.heading.rect.y + anchor.heading.rect.height);
    });
  });

  it("puts every row rectangle over that row's amount, in order, and rows do not overlap", () => {
    const anchors = coverSheetAnchors(pdf, rows);
    const words = wordsOf(pdf);
    const amounts = words.filter((w) => /^-?\$[\d,]+\.\d{2}$/.test(w.text));
    anchors.forEach((anchor, index) => {
      const token = amounts.find((w) => w.text === formatMoney(rows[index].amountCents))!;
      expect(contains(anchor.row.rect, toPdfRect(token, token.pageHeight))).toBe(true);
    });
    for (let i = 1; i < anchors.length; i += 1) {
      const above = anchors[i - 1].row.rect;
      const below = anchors[i].row.rect;
      expect(below.y + below.height).toBeLessThanOrEqual(above.y + 0.01);
    }
  });

  it("refuses a sheet whose rows do not print the amounts it was told", () => {
    const wrong = [rows[0], { ...rows[1], amountCents: 999 }, rows[2]];
    expect(() => coverSheetAnchors(pdf, wrong)).toThrow(AnchorError);
  });

  it("refuses a sheet that prints the same reference twice", async () => {
    // Only a sheet that really prints a reference twice is ambiguous — lying about the input
    // rows changes nothing on the page. So build one that does, and refuse it.
    const duplicated = [rows[0], { ...rows[1], reference: rows[0].reference }, rows[2]];
    const twice = await sheet(duplicated);
    expect(() => coverSheetAnchors(twice, duplicated)).toThrow(/unique/);
  }, 180_000);
});

describe.skipIf(!canRun)("coverSheetAnchors on a sheet that spans pages", () => {
  it("finds headings on later pages and reports the right page for each", async () => {
    const many = Array.from({ length: 28 }, (_, i) =>
      row(`2026-02-${String(i + 1).padStart(3, "0")}`, `Person ${i + 1}`, 100_000 + i, `Role ${i + 1} with a long enough description to wrap once`),
    );
    const pdf = await sheet(many);
    const anchors = coverSheetAnchors(pdf, many);
    expect(anchors).toHaveLength(28);
    expect(Math.max(...anchors.map((a) => a.heading.page))).toBeGreaterThanOrEqual(1);
    const words = wordsOf(pdf);
    for (const [index, anchor] of anchors.entries()) {
      const token = words.find((w) => w.text === `${many[index].reference}:`)!;
      expect(anchor.heading.page).toBe(token.page);
    }
  }, 180_000);
});
