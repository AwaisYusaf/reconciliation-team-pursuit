import { describe, expect, it } from "vitest";

import {
  canPreviewInline,
  inlineSrc,
  INLINE_SAFE_TYPES,
  isPdf,
  isPreviewableImage,
  thumbnailSrc,
} from "./preview";

describe("canPreviewInline", () => {
  it("allows exactly the three types ingestion produces", () => {
    expect(INLINE_SAFE_TYPES).toEqual(["image/jpeg", "image/png", "application/pdf"]);
    for (const type of INLINE_SAFE_TYPES) expect(canPreviewInline(type)).toBe(true);
  });

  it("refuses types that would execute in this origin", () => {
    // The reason the list is an allowlist: either of these served inline would run its own
    // script against a signed-in session.
    expect(canPreviewInline("text/html")).toBe(false);
    expect(canPreviewInline("image/svg+xml")).toBe(false);
  });

  it("refuses anything ingestion never stores", () => {
    for (const type of ["image/heic", "image/webp", "application/octet-stream", ""]) {
      expect(canPreviewInline(type)).toBe(false);
    }
  });
});

describe("thumbnailSrc", () => {
  it("returns null for a PDF, which has no stored thumbnail", () => {
    // Asking for one 404s, so an <img> pointed at it renders permanently broken.
    expect(thumbnailSrc("abc", "application/pdf")).toBeNull();
  });

  it("returns the thumbnail URL for images", () => {
    expect(thumbnailSrc("abc", "image/jpeg")).toBe("/api/files/abc?thumb=1");
    expect(thumbnailSrc("abc", "image/png")).toBe("/api/files/abc?thumb=1");
  });
});

describe("isPreviewableImage", () => {
  it("accepts the two stored image types", () => {
    expect(isPreviewableImage("image/jpeg")).toBe(true);
    expect(isPreviewableImage("image/png")).toBe(true);
  });

  it("rejects HEIC, which a queued file can still be before ingestion converts it", () => {
    expect(isPreviewableImage("image/heic")).toBe(false);
  });

  it("does not claim a PDF is an image", () => {
    expect(isPreviewableImage("application/pdf")).toBe(false);
    expect(isPdf("application/pdf")).toBe(true);
  });
});

describe("inlineSrc", () => {
  it("asks for the inline rendering of a stored document", () => {
    expect(inlineSrc("abc")).toBe("/api/files/abc?inline=1");
  });
});
