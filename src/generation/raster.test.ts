/**
 * Rasterization against real binaries and real files.
 *
 * These build an actual multi-page PDF and push it through `pdftoppm`, because the failures
 * that matter here — wrong page order, a page silently dropped, temp files left behind —
 * only appear against the real tool. Skipped when poppler is absent so the suite still runs
 * on a machine without it; the application container always ships it.
 */
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

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
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith("ngo-raster-"));

    await expect(
      rasterizePdf(await makePdf(2), () => {
        throw new Error("caller exploded");
      }),
    ).rejects.toThrow("caller exploded");

    const after = (await readdir(tmpdir())).filter((name) => name.startsWith("ngo-raster-"));
    expect(after.length).toBe(before.length);
  });

  it("refuses a file that is not a PDF rather than producing a broken page", async () => {
    await expect(rasterizePdf(Buffer.from("this is not a pdf"), () => {})).rejects.toThrow();
  });
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
