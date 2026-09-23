/**
 * Pages sent to OpenAI in one read.
 *
 * OpenAI bills a PDF per page — it sends each page as text *and* as an image — so a 25 MB PDF of
 * near-empty pages costs orders of magnitude more than the receipt this feature is for, and the
 * hourly limit is a limit on requests, not on pages. A receipt, invoice or timesheet is a handful
 * of pages; anything longer is a bank statement or a scan dump, which the feature refuses to read
 * anyway (Phase 10 §1). `inspectUpload` already counted the pages, and attached documents carry
 * the count from ingestion.
 *
 * Shared by `read-amounts/route.ts` and `read-invoice/route.ts` (Phase 14 §2) so the two limits
 * cannot drift apart.
 */
export const MAX_PAGES_READ = 10;
