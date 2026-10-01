import "server-only";

import sharp from "sharp";

/** Below this on the long side a photo is enlarged before it is read; at or above, sent as is. */
export const SMALL_PHOTO_LONG_SIDE = 1500;
const ENLARGED_LONG_SIDE = 2000;

/**
 * The copy of a small receipt or invoice photo that the model reads (PHASE-20 §2, D-136). The
 * stored file is never touched: only what goes to OpenAI changes.
 *
 * Enlarged to 2000px on the long side, grayscale, local contrast (CLAHE), then a 3px median
 * to smooth the grain that contrast brings up. Tested 2026-10-01 on a lightly blurred receipt
 * photo, 5 reads each: as is, 2 of 3 reads had wrong amounts; this, 4 correct, 1 "not found",
 * none wrong. Contrast without the median gave a wrong total, and sharpening changed the date's
 * digits, so neither is used.
 *
 * A PDF, a WebP, a large photo, or one sharp cannot decode is returned unchanged: preparing a photo
 * must never cost the read itself.
 */
export async function preparePhotoForReading(
  body: Buffer,
  mimeType: string,
): Promise<{ body: Buffer; mimeType: string }> {
  // The two photo types both readers accept. Anything else, WebP included, goes through as it
  // came, so a type a reader refuses is still refused rather than quietly becoming a JPEG.
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") return { body, mimeType };
  try {
    const { width, height } = await sharp(body).metadata();
    if (!width || !height || Math.max(width, height) >= SMALL_PHOTO_LONG_SIDE) {
      return { body, mimeType };
    }
    const prepared = await sharp(body)
      .rotate() // Honour the phone's orientation flag; "inside" then keeps the shape either way.
      .resize({ width: ENLARGED_LONG_SIDE, height: ENLARGED_LONG_SIDE, fit: "inside", kernel: "lanczos3" })
      .grayscale()
      .clahe({ width: 64, height: 64, maxSlope: 3 })
      .median(3)
      .jpeg({ quality: 92 })
      .toBuffer();
    return { body: prepared, mimeType: "image/jpeg" };
  } catch {
    return { body, mimeType };
  }
}
