/**
 * The media type of each generated output, by extension. Its own module so the public share route
 * can name a file's type without importing `artifacts.ts`, which is where files get built — the
 * public side must never reach that (PHASE-12 P10).
 */
export const CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};
