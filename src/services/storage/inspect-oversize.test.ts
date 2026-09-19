/**
 * An image over the pixel limit gets its own message, not "may be damaged" (PR #18 round 3, #3).
 * The HEIC decoder is stubbed to report its limit; `heic.test.ts` proves the real one does.
 */
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("./heic", () => ({ decodeHeic: vi.fn(async () => Promise.reject(new Error("pixel limit exceeded"))) }));

const { inspectUpload } = await import("./inspect");

const TOO_LARGE = "That image is too large to process. Upload a lower-resolution copy.";
// Just enough for the sniffer to call it HEIC; the stubbed decoder never reads past it.
const HEIC_HEADER = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(12)]);

describe("oversized images", () => {
  it("a HEIC over the decoder's limit says it is too large", async () => {
    const result = await inspectUpload({ body: HEIC_HEADER, declaredMimeType: "image/heic" });
    expect(result).toEqual({ ok: false, error: TOO_LARGE });
  });

  it("a PNG over sharp's 80 MP limit says it is too large", async () => {
    // 9,000 x 9,000 = 81 MP of one colour: tiny as a file, over the limit as pixels.
    const png = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#fff" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const result = await inspectUpload({ body: png, declaredMimeType: "image/png" });
    expect(result).toEqual({ ok: false, error: TOO_LARGE });
  }, 60_000);
});
