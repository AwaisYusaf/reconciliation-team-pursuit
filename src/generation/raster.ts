import "server-only";

/**
 * Turning uploads into packet pages (packet-pdf-spec §Rasterization).
 *
 * A month's proofs can be hundreds of pages, so nothing here ever holds a whole document's
 * images in memory: `pdftoppm` writes pages to a temp directory and the caller is handed
 * one page at a time, each file removed as soon as it has been consumed. Every run is
 * bounded by a wall-clock timeout that kills the child process, and the temp directory is
 * removed in `finally` whether the run succeeded, failed or timed out.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

/** DPI and JPEG quality, stepped down when a packet overshoots the size ceiling. */
export type RasterQuality = { dpi: number; jpegQuality: number };

/**
 * The downgrade ladder (packet-pdf-spec §Size). A packet is rebuilt at the next step only
 * when the previous one exceeded 25 MB; the last step is delivered regardless of size,
 * because a large packet is more useful than no packet.
 */
export const RASTER_LADDER: readonly RasterQuality[] = [
  { dpi: 150, jpegQuality: 80 },
  { dpi: 120, jpegQuality: 70 },
  { dpi: 100, jpegQuality: 60 },
];

export const DEFAULT_QUALITY = RASTER_LADDER[0];

/** Generous enough for a long scanned statement, short enough to fail a hung child. */
const RASTER_TIMEOUT_MS = 120_000;

export type RasterPage = {
  /** 1-based, matching the source document's page numbering. */
  pageNumber: number;
  jpeg: Buffer;
  widthPx: number;
  heightPx: number;
};

export class RasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterError";
  }
}

/**
 * Run a command with a hard wall-clock bound.
 *
 * `SIGTERM` first so the child can clean up, then `SIGKILL` — a wedged `pdftoppm` that
 * ignores the first signal must not keep a generation request alive forever.
 */
function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new RasterError(
              `${command} is not installed. The application container ships poppler-utils; install it locally with \`brew install poppler\`.`,
            )
          : error,
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new RasterError(`${command} timed out after ${Math.round(timeoutMs / 1000)}s.`));
      } else if (code !== 0) {
        reject(new RasterError(`${command} failed (exit ${code}): ${stderr.trim().slice(0, 400)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Page count without loading the document into the heap. */
export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "ngo-pdfinfo-"));
  try {
    const file = path.join(dir, "input.pdf");
    await writeFile(file, pdf);
    const info = await run("pdfinfo", [file], 30_000);
    const match = /^Pages:\s+(\d+)$/m.exec(info);
    if (!match) throw new RasterError("Could not read that PDF's page count.");
    return Number(match[1]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Rasterise every page of a PDF, handing them to `onPage` in order.
 *
 * The callback is awaited before the next page is read, so a caller that streams pages into
 * an assembled document never accumulates them. Returns the number of pages produced.
 */
export async function rasterizePdf(
  pdf: Buffer,
  onPage: (page: RasterPage) => Promise<void> | void,
  quality: RasterQuality = DEFAULT_QUALITY,
): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "ngo-raster-"));
  try {
    const input = path.join(dir, "input.pdf");
    await writeFile(input, pdf);

    await run(
      "pdftoppm",
      [
        "-jpeg",
        "-jpegopt",
        `quality=${quality.jpegQuality}`,
        "-r",
        String(quality.dpi),
        input,
        path.join(dir, "page"),
      ],
      RASTER_TIMEOUT_MS,
    );

    // pdftoppm zero-pads the page number to the width of the highest page, so "page-10.jpg"
    // and "page-9.jpg" can appear as "page-10" and "page-09" — sorting numerically on the
    // parsed number avoids depending on that padding.
    const files = (await readdir(dir))
      .filter((name) => name.startsWith("page-") && name.endsWith(".jpg"))
      .map((name) => ({ name, pageNumber: Number(/page-(\d+)\.jpg$/.exec(name)?.[1] ?? 0) }))
      .filter((entry) => entry.pageNumber > 0)
      .sort((a, b) => a.pageNumber - b.pageNumber);

    if (files.length === 0) throw new RasterError("That PDF produced no pages.");

    for (const file of files) {
      const absolute = path.join(dir, file.name);
      const jpeg = await readFile(absolute);
      const { width, height } = await sharp(jpeg).metadata();

      await onPage({
        pageNumber: file.pageNumber,
        jpeg,
        widthPx: width ?? 0,
        heightPx: height ?? 0,
      });

      // Released as soon as it has been consumed, so peak disk stays near one page.
      await rm(absolute, { force: true });
    }

    return files.length;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Normalise an uploaded image for embedding.
 *
 * `rotate()` with no argument applies the EXIF orientation and drops the tag, so a photo
 * taken sideways on a phone is upright in the packet — PDF viewers do not honour EXIF, so
 * without this a receipt would be submitted to the City on its side.
 */
export async function normalizeImage(
  image: Buffer,
  quality: RasterQuality = DEFAULT_QUALITY,
): Promise<{ jpeg: Buffer; widthPx: number; heightPx: number }> {
  const pipeline = sharp(image, { failOn: "none" }).rotate();
  const jpeg = await pipeline.jpeg({ quality: quality.jpegQuality }).toBuffer();
  const { width, height } = await sharp(jpeg).metadata();
  return { jpeg, widthPx: width ?? 0, heightPx: height ?? 0 };
}
