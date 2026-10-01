import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { preparePhotoForReading, SMALL_PHOTO_LONG_SIDE } from "./prepare-photo";

function photo(width: number, height: number, format: "jpeg" | "png" | "webp" = "jpeg") {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .toFormat(format)
    .toBuffer();
}

describe("preparePhotoForReading", () => {
  it("a small JPEG is enlarged to 2000px on the long side, grayscale, as a JPEG", async () => {
    const result = await preparePhotoForReading(await photo(335, 597), "image/jpeg");
    expect(result.mimeType).toBe("image/jpeg");
    const meta = await sharp(result.body).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(2000);
    expect(meta.height! > meta.width!).toBe(true); // the shape is kept
    // Gray: every colour channel the same (the orange source had red far above blue).
    const [r, g, b] = (await sharp(result.body).stats()).channels;
    expect(Math.abs(r.mean - b.mean)).toBeLessThan(2);
    expect(Math.abs(r.mean - g.mean)).toBeLessThan(2);
  });

  it("a small PNG is prepared too", async () => {
    const result = await preparePhotoForReading(await photo(400, 300, "png"), "image/png");
    expect(result.mimeType).toBe("image/jpeg");
    expect((await sharp(result.body).metadata()).width).toBe(2000);
  });

  it("a photo already at the size limit is sent as it came", async () => {
    const body = await photo(SMALL_PHOTO_LONG_SIDE, 800);
    const result = await preparePhotoForReading(body, "image/jpeg");
    expect(result).toEqual({ body, mimeType: "image/jpeg" });
  });

  it("a PDF and a WebP are sent as they came", async () => {
    const pdf = Buffer.from("%PDF-1.4 not really");
    expect(await preparePhotoForReading(pdf, "application/pdf")).toEqual({ body: pdf, mimeType: "application/pdf" });
    const webp = await photo(300, 300, "webp");
    expect(await preparePhotoForReading(webp, "image/webp")).toEqual({ body: webp, mimeType: "image/webp" });
  });

  it("bytes sharp cannot decode are sent as they came, never thrown", async () => {
    const broken = Buffer.from("img-bytes");
    expect(await preparePhotoForReading(broken, "image/jpeg")).toEqual({ body: broken, mimeType: "image/jpeg" });
  });

  it("a phone photo stored sideways is turned upright, not stretched", async () => {
    // Stored 600 wide by 300 tall, flagged "rotate 90°": upright it is 300 wide by 600 tall.
    const sideways = await sharp(await photo(600, 300)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const meta = await sharp((await preparePhotoForReading(sideways, "image/jpeg")).body).metadata();
    expect([meta.width, meta.height]).toEqual([1000, 2000]);
  });
});
