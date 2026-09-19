/**
 * Where things are on a converted cover sheet (R10.5a, D-83).
 *
 * The sheet is laid out by LibreOffice, so nothing here predicts positions: it measures them,
 * with `pdftotext -bbox-layout`, on the converted bytes — before the sheet is copied into the
 * packet, because the copy keeps the page's geometry and only its identity changes.
 *
 * Two anchors per expense:
 * - the **heading**, found by its `(2026-02-014):` token, which is unique on the sheet
 *   by construction (R6.4) and is the only string that is — two pay periods for one person print
 *   identical rows;
 * - the **table row**, which prints no reference (R2.6) and so cannot be found by text. Rows are
 *   the sequence of money tokens in the Amount column between the header and the total, in
 *   reading order; the n-th is the n-th expense. That is positional, so it is cross-checked: the
 *   n-th token must print exactly the n-th row's amount, or this throws. The generator emits
 *   rows in expense order and LibreOffice reads a fixed-layout table top to bottom, so a
 *   mismatch is a regression in one of them, not something to paper over with a wrong link.
 *
 * This is the one place `pdftotext`'s top-origin coordinates become PDF's bottom-origin ones.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatMoney } from "@/src/domain/format";

import type { Rect } from "./pdf-links";

export class AnchorError extends Error {}

/** One word as `pdftotext -bbox-layout` reports it: page-relative, y measured from the top. */
export type Word = {
  /** 0-based within the document measured. */
  page: number;
  pageWidth: number;
  pageHeight: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  text: string;
};

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Every word on every page, in reading order. */
export function wordsOf(pdf: Buffer): Word[] {
  const dir = mkdtempSync(path.join(tmpdir(), "ngo-anchors-"));
  try {
    const file = path.join(dir, "sheet.pdf");
    writeFileSync(file, pdf);
    const xml = execFileSync("pdftotext", ["-enc", "UTF-8", "-bbox-layout", file, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const words: Word[] = [];
    const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
    const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
    let page = 0;
    for (const p of xml.matchAll(pageRe)) {
      const [, w, h, body] = p;
      for (const m of body.matchAll(wordRe)) {
        words.push({
          page,
          pageWidth: Number(w),
          pageHeight: Number(h),
          xMin: Number(m[1]),
          yMin: Number(m[2]),
          xMax: Number(m[3]),
          yMax: Number(m[4]),
          text: decode(m[5]),
        });
      }
      page += 1;
    }
    return words;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether the installed `pdftotext` understands `-bbox-layout` (Poppler does; Xpdf does not). */
export function bboxLayoutSupported(): boolean {
  const probe = spawnSync("pdftotext", ["-bbox-layout", "-v"], { encoding: "utf8" });
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  return !probe.error && /pdftotext version/i.test(output) && !/unknown option|Usage:/i.test(output);
}

/** The single coordinate flip: a top-origin box on a page of `pageHeight` → a PDF rectangle. */
export function toPdfRect(
  box: { xMin: number; yMin: number; xMax: number; yMax: number },
  pageHeight: number,
): Rect {
  return { x: box.xMin, y: pageHeight - box.yMax, width: box.xMax - box.xMin, height: box.yMax - box.yMin };
}

export type CoverAnchor = {
  /** The invisible click target over the table row. */
  row: { page: number; rect: Rect };
  /** The heading line, and the y (PDF coordinates) to scroll it to the top of the viewport. */
  heading: { page: number; rect: Rect; top: number };
};

const MONEY = /^-?\$[\d,]+\.\d{2}$/;
/** Words on the same line: identical baselines within LibreOffice's rounding. */
const SAME_LINE = 1.5;
/** Breathing room above a heading when it is scrolled to the top. */
const HEADING_PADDING = 6;

/**
 * Anchors for every row of one converted cover sheet, in row order.
 *
 * `rows` are what the sheet was built from; their amounts are the cross-check and their
 * references the heading tokens. Throws `AnchorError` rather than returning a guess.
 */
export function coverSheetAnchors(
  pdf: Buffer,
  rows: readonly { reference: string; amountCents: number }[],
): CoverAnchor[] {
  const words = wordsOf(pdf);
  if (words.length === 0) throw new AnchorError("The cover sheet has no extractable text.");
  const pages = new Set(words.map((w) => w.page)).size;

  // The Amount column is wherever the header says it is, on each page the table reaches.
  const amountColumnLeft = new Map<number, number>();
  const headerBottom = new Map<number, number>();
  for (const w of words) {
    if (w.text !== "Amount" || amountColumnLeft.has(w.page)) continue;
    const role = words.find((r) => r.page === w.page && r.text === "Role" && Math.abs(r.yMin - w.yMin) < SAME_LINE);
    if (!role) continue;
    const mid = ((role.xMin + role.xMax) / 2 + (w.xMin + w.xMax) / 2) / 2;
    amountColumnLeft.set(w.page, mid);
    headerBottom.set(w.page, w.yMax);
  }
  if (amountColumnLeft.size === 0) throw new AnchorError("No table header found on the cover sheet.");

  const amounts = words.filter((w) => {
    const left = amountColumnLeft.get(w.page);
    return left !== undefined && MONEY.test(w.text) && (w.xMin + w.xMax) / 2 > left && w.yMin > (headerBottom.get(w.page) ?? 0);
  });
  // The last money token in the column is the shaded total; everything before it is a row.
  const rowAmounts = amounts.slice(0, -1);
  if (rowAmounts.length !== rows.length) {
    throw new AnchorError(`Expected ${rows.length} table rows on the cover sheet, found ${rowAmounts.length}.`);
  }
  rowAmounts.forEach((token, index) => {
    const expected = formatMoney(rows[index].amountCents);
    if (token.text !== expected) {
      throw new AnchorError(`Row ${index + 1} prints ${token.text} but the expense's amount is ${expected}.`);
    }
  });

  const tableLeft = Math.min(...words.filter((w) => amountColumnLeft.has(w.page)).map((w) => w.xMin));

  return rows.map((row, index) => {
    const token = rowAmounts[index];
    const prev = rowAmounts[index - 1];
    const next = amounts[index + 1];
    const top =
      prev && prev.page === token.page ? (prev.yMax + token.yMin) / 2 : (headerBottom.get(token.page) ?? token.yMin);
    const bottom =
      next && next.page === token.page ? (token.yMax + next.yMin) / 2 : token.pageHeight - 72;
    const rowRect = toPdfRect({ xMin: tableLeft, yMin: top, xMax: token.xMax + 4, yMax: bottom }, token.pageHeight);

    // Only the heading's own `(ref):` token. A bare reference also matched a name or role that
    // quotes another expense ("Office Depot invoice 2026-02-002"), which failed the whole packet.
    const matches = words.filter((w) => w.text === `(${row.reference}):`);
    if (matches.length !== 1) {
      throw new AnchorError(
        `Reference ${row.reference} appears ${matches.length} times on the cover sheet; the heading must be unique.`,
      );
    }
    const ref = matches[0];
    const line = words.filter((w) => w.page === ref.page && Math.abs(w.yMin - ref.yMin) < SAME_LINE && w.xMin <= ref.xMax);
    const box = {
      xMin: Math.min(...line.map((w) => w.xMin)),
      yMin: Math.min(...line.map((w) => w.yMin)),
      xMax: ref.xMax,
      yMax: Math.max(...line.map((w) => w.yMax)),
    };
    return {
      row: { page: token.page, rect: rowRect },
      heading: {
        page: ref.page,
        rect: toPdfRect(box, ref.pageHeight),
        top: Math.min(ref.pageHeight, ref.pageHeight - box.yMin + HEADING_PADDING),
      },
    };
  }).map((anchor) => {
    if (anchor.row.page >= pages || anchor.heading.page >= pages) throw new AnchorError("Anchor page out of range.");
    return anchor;
  });
}
