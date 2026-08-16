import "server-only";

/**
 * Upload inspection — the "process and attach" step (R4.6, data-model §Upload processing).
 *
 * Because uploads go straight to storage, the server never sees the bytes until here.
 * This is the only place a file is proven to be what it claims: magic bytes are checked
 * against the declared type, PDFs are opened (which rejects corrupt and encrypted files),
 * page counts and pixel dimensions are recorded for the packet page estimates, and HEIC
 * is converted to something the document generators can embed.
 *
 * Catching all of this at attach time is what stops a broken file surfacing at month-end,
 * which is the worst possible moment to discover it.
 */
import sharp from "sharp";

export type InspectionSuccess = {
  ok: true;
  /** Normalised bytes to store — HEIC/WebP arrive here converted to JPEG. */
  body: Buffer;
  mimeType: string;
  pageCount: number;
  widthPx: number | null;
  heightPx: number | null;
  /** JPEG preview for lists and cover-sheet previews. */
  thumbnail: Buffer | null;
};

export type InspectionFailure = { ok: false; error: string };
export type InspectionResult = InspectionSuccess | InspectionFailure;

/** Refuse absurd rasters before sharp allocates for them. */
const MAX_PIXELS = 80_000_000;
const THUMBNAIL_WIDTH = 320;

/** Formats the generators can embed directly; everything else is converted. */
const PASSTHROUGH_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

function sniff(body: Buffer): string | null {
  if (body.length >= 4 && body.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 8 && body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (
    body.length >= 12 &&
    body.subarray(0, 4).toString("latin1") === "RIFF" &&
    body.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  // HEIC/HEIF: ISO-BMFF box with an `ftyp` brand.
  if (body.length >= 12 && body.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = body.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

/** Inspect and normalise an uploaded file. Never throws — failures are returned. */
export async function inspectUpload(input: {
  body: Buffer;
  declaredMimeType: string;
}): Promise<InspectionResult> {
  const { body, declaredMimeType } = input;

  if (body.length === 0) return { ok: false, error: "That file is empty." };

  const actual = sniff(body);
  if (!actual) {
    return { ok: false, error: "That file type is not supported. Upload a PNG, JPG, HEIC or PDF." };
  }

  // A declared type that disagrees with the bytes is either a mistake or an attack; both
  // deserve the same refusal.
  const declaredFamily = declaredMimeType === "image/heif" ? "image/heic" : declaredMimeType;
  if (actual !== declaredFamily) {
    return {
      ok: false,
      error: "That file's contents do not match its type. Try exporting it again.",
    };
  }

  return actual === "application/pdf" ? inspectPdf(body) : inspectImage(body, actual);
}

async function inspectPdf(body: Buffer): Promise<InspectionResult> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    // Encrypted documents throw here rather than silently producing blank pages later.
    const document = await PDFDocument.load(body, { ignoreEncryption: false });
    const pageCount = document.getPageCount();
    if (pageCount === 0) return { ok: false, error: "That PDF has no pages." };

    const [first] = document.getPages();
    const { width, height } = first.getSize();

    return {
      ok: true,
      body,
      mimeType: "application/pdf",
      pageCount,
      widthPx: Math.round(width),
      heightPx: Math.round(height),
      // PDF thumbnails need rasterisation (poppler), which the packet pipeline owns.
      thumbnail: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/encrypt/i.test(message)) {
      return {
        ok: false,
        error: "That PDF is password-protected. Save an unprotected copy and upload that.",
      };
    }
    return { ok: false, error: "That PDF could not be read — it may be damaged." };
  }
}

async function inspectImage(body: Buffer, mimeType: string): Promise<InspectionResult> {
  try {
    const image = sharp(body, { limitInputPixels: MAX_PIXELS });
    const metadata = await image.metadata();

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width === 0 || height === 0) {
      return { ok: false, error: "That image could not be read — it may be damaged." };
    }

    // HEIC (iPhone photos) and WebP are converted so Word, Excel and the packet can embed
    // them; JPEG and PNG are stored untouched to avoid a needless re-encode.
    const convert = !PASSTHROUGH_IMAGE_TYPES.has(mimeType);
    const normalised = convert
      ? await sharp(body, { limitInputPixels: MAX_PIXELS }).rotate().jpeg({ quality: 90 }).toBuffer()
      : body;

    const thumbnail = await sharp(normalised, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();

    return {
      ok: true,
      body: normalised,
      mimeType: convert ? "image/jpeg" : mimeType,
      pageCount: 1,
      widthPx: width,
      heightPx: height,
      thumbnail,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/pixel|limit/i.test(message)) {
      return { ok: false, error: "That image is too large to process. Try a smaller export." };
    }
    return { ok: false, error: "That image could not be read — it may be damaged." };
  }
}
