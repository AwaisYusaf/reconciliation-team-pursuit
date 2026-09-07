import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  formatBytes,
  MAX_PACKET_BYTES,
  oversizeWarning,
  stampFooters,
} from "./packet-footer";
import { hasPdftotext, pdftotext } from "./pdftotext.test-helper";

/** A document with mixed page sizes, so centring is actually exercised. */
async function makePdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    const page = pdf.addPage(index === 2 ? [792, 612] : [612, 792]);
    page.drawText(`Body ${index}`, { x: 72, y: 400, size: 12, font });
  }
  return Buffer.from(await pdf.save());
}

async function pageText(pdf: Buffer, page: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ngo-footer-"));
  try {
    const file = path.join(dir, "doc.pdf");
    await writeFile(file, pdf);
    return pdftotext(["-f", String(page), "-l", String(page), file, "-"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("stampFooters (R10.5)", () => {
  it("keeps the page count and the existing content", async () => {
    const stamped = await stampFooters(await makePdf(3), "Team Pursuit", "February 2026");
    const pdf = await PDFDocument.load(stamped);
    expect(pdf.getPageCount()).toBe(3);
  });

  it("preserves each page's own size", async () => {
    const stamped = await stampFooters(await makePdf(3), "Team Pursuit", "February 2026");
    const pages = (await PDFDocument.load(stamped)).getPages();
    expect(Math.round(pages[0].getWidth())).toBe(612);
    // The landscape page must not be forced to portrait by stamping.
    expect(Math.round(pages[1].getWidth())).toBe(792);
  });
});

describe.skipIf(!hasPdftotext())("footer text", () => {
  it("numbers every page against the final total", async () => {
    const stamped = await stampFooters(await makePdf(3), "Team Pursuit", "February 2026");

    expect(await pageText(stamped, 1)).toContain("Team Pursuit — February 2026 — Page 1 of 3");
    expect(await pageText(stamped, 2)).toContain("Team Pursuit — February 2026 — Page 2 of 3");
    expect(await pageText(stamped, 3)).toContain("Team Pursuit — February 2026 — Page 3 of 3");
    // Three real `pdftotext` round trips — same headroom reasoning as D-70 below.
  }, 20_000);

  it("stamps the first page too — the summary is not exempt", async () => {
    const stamped = await stampFooters(await makePdf(1), "Team Pursuit", "February 2026");
    expect(await pageText(stamped, 1)).toContain("Page 1 of 1");
  });

  it("names the expense a page documents, and only those pages (D-70)", async () => {
    // The traceability the funder approved: a reviewer holding this page can read which claim
    // it supports, and find that reference in the index.
    const stamped = await stampFooters(await makePdf(4), "Team Pursuit", "February 2026", [
      null, // summary — belongs to no single expense
      "2026-02-014",
      "2026-02-014", // a two-page receipt: both pages carry it
      null, // a month document, e.g. the bank statement
    ]);

    expect(await pageText(stamped, 1)).toContain("Team Pursuit — February 2026 — Page 1 of 4");
    expect(await pageText(stamped, 1)).not.toContain("2026-02");

    expect(await pageText(stamped, 2)).toContain(
      "Team Pursuit — February 2026 — 2026-02-014 — Page 2 of 4",
    );
    expect(await pageText(stamped, 3)).toContain("2026-02-014 — Page 3 of 4");

    // A bank statement documents the month, not one expense; claiming otherwise would be wrong.
    expect(await pageText(stamped, 4)).not.toContain("2026-02-014");
    // Five real `pdftotext` round trips (one per assertion above) routinely land right at the
    // 5000ms default — not hung, just genuinely that much real subprocess I/O, worse on a
    // slower pdftotext build. Explicit headroom, same as the calibration tests elsewhere in
    // this file's siblings that shell out to a real renderer.
  }, 20_000);

  it("falls back to the footer it always had when no owners are given", async () => {
    // Every existing caller and every already-delivered packet keep the exact same footer.
    const stamped = await stampFooters(await makePdf(2), "Team Pursuit", "February 2026");
    expect(await pageText(stamped, 1)).toContain("Team Pursuit — February 2026 — Page 1 of 2");
  });

  it("leaves the page's own content intact", async () => {
    const stamped = await stampFooters(await makePdf(2), "Team Pursuit", "February 2026");
    const text = await pageText(stamped, 1);
    expect(text).toContain("Body 1");
    expect(text).toContain("Page 1 of 2");
  });
});

describe("size ceiling (packet-pdf-spec §Size)", () => {
  it("uses DocuSign's 25 MB envelope limit", () => {
    expect(MAX_PACKET_BYTES).toBe(26_214_400);
  });

  it("reports megabytes the way a person reads them", () => {
    expect(formatBytes(26_214_400)).toBe("25.0 MB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });

  /**
   * The warning must say the packet was delivered anyway. A message that reads like a
   * failure would make the organisation think it has nothing to submit, when it does.
   */
  it("warns without implying the download failed", () => {
    const warning = oversizeWarning(30 * 1024 * 1024);
    expect(warning).toContain("30.0 MB");
    expect(warning).toContain("25.0 MB");
    expect(warning).toContain("downloaded anyway");
    expect(warning).toContain("DocuSign may reject it");
  });

  /**
   * The warning travels in an HTTP header, and header values are ByteStrings: a raw em dash
   * or curly apostrophe makes constructing the Response throw. That throw happened after the
   * packet was built and pinned, so the one path the spec says must always deliver was the
   * only one that could never deliver.
   */
  it("survives being put in a response header", () => {
    const warning = oversizeWarning(30 * 1024 * 1024);
    expect(warning).toMatch(/[^\x00-\xff]/); // it really does contain non-Latin-1 text

    expect(
      () => new Response("x", { headers: { "X-Packet-Warning": warning } }),
    ).toThrow();

    // Encoded, it is pure ASCII and round-trips back to the original.
    const encoded = encodeURIComponent(warning);
    expect(encoded).toMatch(/^[\x20-\x7e]*$/);
    expect(
      () => new Response("x", { headers: { "X-Packet-Warning": encoded } }),
    ).not.toThrow();
    expect(decodeURIComponent(encoded)).toBe(warning);
  });
});
