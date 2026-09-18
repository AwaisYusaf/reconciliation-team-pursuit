/**
 * Upload inspection against real file bytes (R4.6).
 *
 * Fixtures are generated in-process rather than committed, so the suite carries no binary
 * blobs and no client documents. One exception: `__fixtures__/receipt.heic`, a 12 KB public
 * sample receipt, because nothing installed here can *encode* HEVC to generate one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { inspectUpload } from "./inspect";
import { makeEncryptedPdf } from "./pdf-fixtures.test-helper";

function hasPoppler(): boolean {
  try {
    execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let jpeg: Buffer;
let png: Buffer;
let webp: Buffer;
let pdf: Buffer;
let multipagePdf: Buffer;

beforeAll(async () => {
  const base = sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 240, g: 240, b: 235 } },
  });
  jpeg = await base.clone().jpeg().toBuffer();
  png = await base.clone().png().toBuffer();
  webp = await base.clone().webp().toBuffer();

  const single = await PDFDocument.create();
  single.addPage([612, 792]);
  pdf = Buffer.from(await single.save());

  const many = await PDFDocument.create();
  for (let i = 0; i < 11; i += 1) many.addPage([612, 792]);
  multipagePdf = Buffer.from(await many.save());
});

describe("images", () => {
  it("accepts a JPEG and records its dimensions", async () => {
    const result = await inspectUpload({ body: jpeg, declaredMimeType: "image/jpeg" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.widthPx).toBe(600);
    expect(result.heightPx).toBe(400);
    expect(result.pageCount).toBe(1);
    expect(result.thumbnail).not.toBeNull();
  });

  it("stores JPEG and PNG untouched rather than re-encoding them", async () => {
    const asJpeg = await inspectUpload({ body: jpeg, declaredMimeType: "image/jpeg" });
    const asPng = await inspectUpload({ body: png, declaredMimeType: "image/png" });
    expect(asJpeg.ok && asJpeg.body).toBe(jpeg);
    expect(asPng.ok && asPng.body).toBe(png);
    expect(asPng.ok && asPng.mimeType).toBe("image/png");
  });

  it("converts WebP to JPEG so the document generators can embed it", async () => {
    const result = await inspectUpload({ body: webp, declaredMimeType: "image/webp" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.body).not.toBe(webp);
    expect(result.body.subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });

  it("produces a thumbnail no wider than the preview size", async () => {
    const result = await inspectUpload({ body: jpeg, declaredMimeType: "image/jpeg" });
    if (!result.ok || !result.thumbnail) throw new Error("expected a thumbnail");
    const meta = await sharp(result.thumbnail).metadata();
    expect(meta.width).toBeLessThanOrEqual(320);
  });
});

describe("PDFs", () => {
  it("accepts a PDF and records its real page count", async () => {
    const single = await inspectUpload({ body: pdf, declaredMimeType: "application/pdf" });
    expect(single.ok && single.pageCount).toBe(1);

    const many = await inspectUpload({ body: multipagePdf, declaredMimeType: "application/pdf" });
    expect(many.ok && many.pageCount).toBe(11);
  });

  it("records page size, which the packet uses for its estimates", async () => {
    const result = await inspectUpload({ body: pdf, declaredMimeType: "application/pdf" });
    expect(result.ok && result.widthPx).toBe(612);
    expect(result.ok && result.heightPx).toBe(792);
  });

  it("rejects a corrupt PDF with a message a user can act on", async () => {
    const corrupt = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("not really a pdf")]);
    const result = await inspectUpload({ body: corrupt, declaredMimeType: "application/pdf" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/damaged/i);
  });

  it("rejects a password-protected PDF (an ordinary upload, no owner-password allowance)", async () => {
    const userLocked = makeEncryptedPdf({ ownerPassword: "ownersecret", userPassword: "opensesame" });
    const result = await inspectUpload({ body: userLocked, declaredMimeType: "application/pdf" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/password-protected/i);
  });
});

/**
 * Owner-password-only PDFs (permissions restrictions, empty user password) open in every
 * viewer without a password, so `allowOwnerPasswordPdf` — used only by the signed-packet lock
 * upload — accepts them while a genuinely password-protected PDF is still refused. Both cases
 * go through `pdfinfo`, which is what tells the two apart, so these skip cleanly when poppler
 * is not on PATH (the application container always ships it).
 */
describe.skipIf(!hasPoppler())("owner-password-only PDFs", () => {
  it("accepts an owner-password-only PDF when allowOwnerPasswordPdf is set", async () => {
    const ownerOnly = makeEncryptedPdf({ ownerPassword: "ownersecret", userPassword: "" });
    const result = await inspectUpload({
      body: ownerOnly,
      declaredMimeType: "application/pdf",
      allowOwnerPasswordPdf: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pageCount).toBe(1);
    expect(result.widthPx).toBe(200);
    expect(result.heightPx).toBe(200);
    // The stored bytes are the original encrypted file, not a decrypted copy.
    expect(result.body).toBe(ownerOnly);
  });

  it("still refuses a PDF that genuinely needs a password, even with allowOwnerPasswordPdf", async () => {
    const userLocked = makeEncryptedPdf({ ownerPassword: "ownersecret", userPassword: "opensesame" });
    const result = await inspectUpload({
      body: userLocked,
      declaredMimeType: "application/pdf",
      allowOwnerPasswordPdf: true,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/password-protected/i);
  });

  it("still refuses an owner-password-only PDF for an ordinary (non-signed-packet) upload", async () => {
    const ownerOnly = makeEncryptedPdf({ ownerPassword: "ownersecret", userPassword: "" });
    const result = await inspectUpload({ body: ownerOnly, declaredMimeType: "application/pdf" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/password-protected/i);
  });
});

describe("refusals", () => {
  it("rejects an empty file", async () => {
    const result = await inspectUpload({ body: Buffer.alloc(0), declaredMimeType: "image/png" });
    expect(result.ok === false && result.error).toMatch(/empty/i);
  });

  it("rejects an unsupported type by its bytes, not its label", async () => {
    const zip = Buffer.from("504b0304000000000000", "hex");
    const result = await inspectUpload({ body: zip, declaredMimeType: "application/pdf" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not supported/i);
  });

  it("rejects a file whose contents disagree with the declared type", async () => {
    // A PNG uploaded while claiming to be a PDF: either a mistake or an attack.
    const result = await inspectUpload({ body: png, declaredMimeType: "application/pdf" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/do not match/i);
  });

  it("rejects an HTML file dressed as an image", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const result = await inspectUpload({ body: html, declaredMimeType: "image/png" });
    expect(result.ok).toBe(false);
  });

  it("treats image/heif as the same family as image/heic", async () => {
    // Bytes still have to agree; this only proves the declared alias is accepted.
    const result = await inspectUpload({ body: png, declaredMimeType: "image/heif" });
    expect(result.ok === false && result.error).toMatch(/do not match/i);
  });
});

describe("HEIC (iPhone photos)", () => {
  const heic = readFileSync(new URL("./__fixtures__/receipt.heic", import.meta.url));

  it("decodes a real HEVC-compressed HEIC to JPEG — sharp's npm build alone refused it as damaged", async () => {
    for (const declaredMimeType of ["image/heic", "image/heif"]) {
      const result = await inspectUpload({ body: heic, declaredMimeType });
      expect(result.ok, declaredMimeType).toBe(true);
      if (!result.ok) return;
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.body.subarray(0, 3).toString("hex")).toBe("ffd8ff");
      expect([result.widthPx, result.heightPx]).toEqual([412, 484]);
      expect(result.thumbnail?.subarray(0, 3).toString("hex")).toBe("ffd8ff");
      // The stored JPEG is a real image of the same size, not a blank buffer.
      const stats = await sharp(result.body).stats();
      expect(stats.isOpaque).toBe(true);
      expect(stats.channels[0].stdev).toBeGreaterThan(10);
    }
  });

  // Chrome on Windows gives a .heic the type "", which reaches the server as the multipart
  // default `application/octet-stream` — both mean "undeclared", and the bytes decide.
  for (const undeclared of ["", "application/octet-stream"]) {
    it(`with an undeclared type (${JSON.stringify(undeclared)}), the bytes decide`, async () => {
      const result = await inspectUpload({ body: heic, declaredMimeType: undeclared });
      expect(result.ok && result.mimeType).toBe("image/jpeg");
    });

    it(`an undeclared type (${JSON.stringify(undeclared)}) still refuses unsupported bytes`, async () => {
      const html = Buffer.from("<html><script>alert(1)</script></html>");
      const result = await inspectUpload({ body: html, declaredMimeType: undeclared });
      expect(result.ok === false && result.error).toMatch(/not supported/i);
    });
  }

  it("a declared type that is neither undeclared nor matching is still refused", async () => {
    const result = await inspectUpload({ body: heic, declaredMimeType: "image/png" });
    expect(result.ok === false && result.error).toMatch(/do not match/i);
  });

  it("a truncated HEIC is refused as unreadable, never thrown", async () => {
    const result = await inspectUpload({ body: heic.subarray(0, 2000), declaredMimeType: "image/heic" });
    expect(result.ok === false && result.error).toMatch(/could not be read/i);
  });
});
