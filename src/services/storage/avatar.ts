import "server-only";

import sharp from "sharp";

/**
 * A profile photo as it is stored: always a JPEG, at most `AVATAR_PX` square, with no metadata
 * (D-119).
 *
 * The declared type on an upload is whatever the client says, so it proves nothing. An SVG sent
 * as `image/png` used to be stored as-is under a `.png` key: `nosniff` kept it from running, but
 * the photo was then permanently broken, arbitrary bytes sat in the organisation's storage, and
 * a phone photo's EXIF, GPS position included, was served to every colleague who saw the face.
 * Decoding here settles all three. Only the formats sharp actually decodes as PNG, JPEG or WebP
 * get through, and re-encoding writes new bytes, so nothing the client sent survives but pixels.
 *
 * The browser's cropper already sends a 512px square, so for the normal path this is a
 * re-encode at the same size. The resize is for everyone else: anything posted straight to the
 * route is cut down to the same square the cropper would have produced.
 */
export const AVATAR_PX = 512;

/**
 * Decode limit. A small file can declare a vast canvas (a decompression bomb), and the byte cap
 * cannot see that; this refuses it before any pixels are allocated. Generous for a phone photo,
 * which is 12–48 megapixels.
 */
const MAX_AVATAR_PIXELS = 50_000_000;

/** The formats a profile photo may be, by what the bytes actually are. */
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

const WRONG_TYPE = "Profile photos can be PNG, JPG or WebP.";

export type NormalisedAvatar =
  | { ok: true; body: Buffer; mimeType: "image/jpeg" }
  | { ok: false; error: string };

export async function normaliseAvatar(input: Buffer): Promise<NormalisedAvatar> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS }).metadata());
  } catch (error) {
    return { ok: false, error: decodeError(error) };
  }
  // sharp reads SVG, GIF, HEIF and more; only three are profile photos. Checked on the decoded
  // format, never on the declared one.
  if (!format || !ALLOWED_FORMATS.has(format)) return { ok: false, error: WRONG_TYPE };

  try {
    const body = await sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS })
      // Apply the EXIF orientation before it is dropped, or a portrait photo lands sideways.
      .rotate()
      .resize(AVATAR_PX, AVATAR_PX, { fit: "cover", withoutEnlargement: true })
      // JPEG has no transparency; a see-through PNG would otherwise turn black behind the face.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { ok: true, body, mimeType: "image/jpeg" };
  } catch (error) {
    return { ok: false, error: decodeError(error) };
  }
}

function decodeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/pixel|limit/i.test(message)) {
    return "That photo is too large to process. Choose a smaller one.";
  }
  return "That photo couldn't be read. Choose a PNG, JPG or WebP photo.";
}
