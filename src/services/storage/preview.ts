/**
 * What a browser may be shown directly, rather than made to download.
 *
 * One source of truth for two callers that must not drift: `/api/files/[id]` decides here
 * whether to answer with `Content-Disposition: inline`, and the viewer overlay decides here
 * how to render what comes back. If they disagreed, the viewer would frame a response the
 * browser had already been told to save.
 *
 * An allowlist, not a blocklist. Serving user-supplied bytes inline puts them in this origin,
 * so an HTML or SVG document served that way would run its own script against a signed-in
 * session. Ingestion normalises every upload to one of these three — HEIC and WebP are
 * converted to JPEG — so nothing legitimate is excluded, and anything unexpected falls
 * through to a download instead of executing.
 */
export const INLINE_SAFE_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

export function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

/**
 * An image the browser can decode.
 *
 * A *stored* image is only ever JPEG or PNG. A file still queued on the form has not been
 * through ingestion yet, so it may be HEIC — which most browsers cannot decode, and which
 * therefore gets a glyph rather than a broken `<img>`.
 */
export function isPreviewableImage(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}

/** Whether this type may be served for display instead of download. */
export function canPreviewInline(mimeType: string): boolean {
  return (INLINE_SAFE_TYPES as readonly string[]).includes(mimeType);
}

/**
 * The thumbnail URL for a stored document, or null when it has none.
 *
 * PDFs have no stored thumbnail: rasterising one needs poppler, which only the packet
 * pipeline runs. Requesting one returns 404, so pointing an `<img>` at it renders a broken
 * image — which is exactly what every PDF receipt used to show.
 */
export function thumbnailSrc(id: string, mimeType: string): string | null {
  return isPdf(mimeType) ? null : `/api/files/${id}?thumb=1`;
}

/** The URL that renders a stored document in the viewer rather than downloading it. */
export function inlineSrc(id: string): string {
  return `/api/files/${id}?inline=1`;
}
