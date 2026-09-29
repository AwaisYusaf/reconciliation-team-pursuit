/**
 * Rasterization against real binaries and real files.
 *
 * These build an actual multi-page PDF and push it through `pdftoppm`, because the failures
 * that matter here — wrong page order, a page silently dropped, temp files left behind —
 * only appear against the real tool. Skipped when poppler is absent so the suite still runs
 * on a machine without it; the application container always ships it.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { normalizeImage, pdfPageCount, rasterizePdf, RASTER_LADDER } from "./raster";

function hasPoppler(): boolean {
  try {
    execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A PDF whose pages are visually distinguishable, so page order is observable. */
async function makePdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    // Deliberately different sizes so a reordering changes the reported dimensions.
    const page = pdf.addPage(index % 2 === 0 ? [612, 792] : [792, 612]);
    page.drawText(`Page ${index}`, { x: 60, y: 300, size: 48, font });
  }
  return Buffer.from(await pdf.save());
}

describe.skipIf(!hasPoppler())("rasterizePdf", () => {
  it("counts pages", async () => {
    expect(await pdfPageCount(await makePdf(3))).toBe(3);
  });

  it("yields every page exactly once, in source order", async () => {
    const seen: number[] = [];
    const count = await rasterizePdf(await makePdf(12), (page) => {
      seen.push(page.pageNumber);
    });

    expect(count).toBe(12);
    // Page 10 must not sort before page 9: pdftoppm zero-pads to the widest page number,
    // so a lexical sort of the filenames would get this wrong.
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("preserves each page's orientation", async () => {
    const shapes: string[] = [];
    await rasterizePdf(await makePdf(4), (page) => {
      shapes.push(page.widthPx > page.heightPx ? "landscape" : "portrait");
    });
    // makePdf alternates: odd pages landscape, even pages portrait.
    expect(shapes).toEqual(["landscape", "portrait", "landscape", "portrait"]);
  });

  it("produces real JPEG bytes at roughly the requested DPI", async () => {
    const pages: { jpeg: Buffer; widthPx: number }[] = [];
    await rasterizePdf(await makePdf(1), (page) => {
      pages.push({ jpeg: page.jpeg, widthPx: page.widthPx });
    });

    // JPEG magic bytes — proof this is an image and not an error page.
    expect(pages[0].jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    // 11in wide (landscape Letter) at 150 DPI ≈ 1650px.
    expect(pages[0].widthPx).toBeGreaterThan(1600);
    expect(pages[0].widthPx).toBeLessThan(1700);
  });

  it("rasterises smaller at a lower ladder step", async () => {
    const widths: number[] = [];
    for (const quality of [RASTER_LADDER[0], RASTER_LADDER[2]]) {
      await rasterizePdf(
        await makePdf(1),
        (page) => {
          widths.push(page.widthPx);
        },
        quality,
      );
    }
    expect(widths[1]).toBeLessThan(widths[0]);
  });

  it("leaves no temp directory behind, even when the caller throws", async () => {
    // A temp root of its own (Phase 0 B9), as `docx-to-pdf.test.ts` does. Counting `ngo-raster-`
    // in the shared temp folder also counted other test files' live directories, so it failed
    // at random whenever the whole suite ran at once. `os.tmpdir()` reads these variables on each
    // call, and each test file runs in its own process, so only this test is redirected.
    const root = await mkdtemp(path.join(tmpdir(), "ngo-rastercheck-"));
    // `vi.stubEnv`, never a plain assignment: writing `undefined` back to `process.env` stores the
    // string "undefined", so on Linux (no TMPDIR set) the next temp folder landed in a relative
    // directory named "undefined" and the tests after this one failed (PR #25 review).
    vi.stubEnv("TMPDIR", root);
    vi.stubEnv("TEMP", root);
    vi.stubEnv("TMP", root);

    try {
      await expect(
        rasterizePdf(await makePdf(2), () => {
          throw new Error("caller exploded");
        }),
      ).rejects.toThrow("caller exploded");

      expect(await readdir(root)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a file that is not a PDF rather than producing a broken page", async () => {
    await expect(rasterizePdf(Buffer.from("this is not a pdf"), () => {})).rejects.toThrow();
  });

  /**
   * `pdftoppm` can exit zero having rendered fewer pages than the document holds. Without
   * this check the packet would simply not contain that page — no error, no log, gate
   * satisfied — which is the worst outcome the system has.
   */
  it("refuses when fewer pages are rendered than the document is known to have", async () => {
    const pdf = await makePdf(3);
    await expect(rasterizePdf(pdf, () => {}, RASTER_LADDER[0], 5)).rejects.toThrow(
      /Expected 5 page\(s\) but rendered 3/,
    );
  });

  it("accepts a render that matches the expected page count", async () => {
    const seen: number[] = [];
    await rasterizePdf(await makePdf(3), (page) => void seen.push(page.pageNumber), RASTER_LADDER[0], 3);
    expect(seen).toEqual([1, 2, 3]);
  });

  /**
   * An absurd page geometry makes pdftoppm emit a 1x1 pixel image and exit zero. Embedded at
   * scale that is an invisible speck on an otherwise blank page — a page of evidence
   * replaced by nothing at all.
   */
  it("refuses a degenerate render rather than embedding an invisible speck", async () => {
    const pdf = await PDFDocument.create();
    // 14400pt is the PDF format maximum, 200 inches square.
    pdf.addPage([14400, 14400]);
    const huge = Buffer.from(await pdf.save());

    await expect(rasterizePdf(huge, () => {})).rejects.toThrow(
      /not a readable page|Expected|exceeds/,
    );
  }, 120_000);
});

describe("normalizeImage", () => {
  it("returns JPEG bytes and the resulting dimensions", async () => {
    const png = await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();

    const result = await normalizeImage(png);

    expect(result.jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(result.widthPx).toBe(120);
    expect(result.heightPx).toBe(80);
  });

  /**
   * PDF viewers ignore EXIF orientation, so a photo taken sideways would be submitted to
   * the City on its side unless the rotation is baked into the pixels here.
   */
  it("applies EXIF orientation, swapping the axes for a quarter turn", async () => {
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#eeeeee" },
    })
      .withMetadata({ orientation: 6 }) // 90° clockwise
      .jpeg()
      .toBuffer();

    const result = await normalizeImage(rotated);

    expect(result.widthPx).toBe(100);
    expect(result.heightPx).toBe(200);
  });
});
