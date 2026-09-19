# m06 — Month-End Packet

## Purpose
The month's finish line: readiness per line item, the blocking list, month-level document uploads, the two big downloads (packet PDF, summary Excel), and sharing either file by link (PHASE-12).

## Scope
Route `/r/packet`, scoped to the header's selected funding source (§14, D-93) — requires one source picked, shows `PickFundingSource` when "All" is selected. Readiness table · blocking panel · month documents manager · packet contents preview with live page counts · downloads · Share link and the Shared links box, all for that source alone.

## Data
Reads everything for the (source, month); writes `month_documents` tagged with that source, and `shared_links` (PHASE-12, D-112). Calls packet + Excel generators (`02-outputs/packet-pdf-spec.md`, `summary-excel-spec.md`), passing the source id, through one gate-and-build path shared by downloads and sharing (`src/modules/packet/month-output.ts`). Rules R4.3–R4.4, R10.6, R11.2–R11.3, §14.

## Behavior
- **Deleted-items safeguard** (only when something was deleted from this reporting period): clicking either download — or Share link, or Update shared file — opens a `Deleted from this month` dialog listing every expense soft-deleted from the active month — name, line item, amount, deleted-on date — each with an inline `Restore`, and `Continue to download` / `Cancel`. It is in addition to the documentation gate below. Nothing is remembered — the dialog opens again on every download click, so it is re-asked each time someone is actually about to download, not answered once and forgotten. A month with nothing deleted downloads straight away, same as before this existed.
- **Blocking panel** (only when incomplete records exist): red panel, R12 `blocked-title` + `blocked-intro` strings, then one row per record in the R4.4 template — one combined list covering all three gap types (proof, receipt, narrative) rather than separate lists per type — with an `Open expense` link to m02 edit. Both download buttons, Share link and every Update shared file are disabled while present.
- **Readiness table:** `Line Item | Amount This Month | Expenses | Documentation Complete` (Yes / red bold No) + Total row (Σ amount, Σ expenses). **All** line items appear; rows with no expenses show `$0.00 · 0 · -`.
- **Zero-expense month:** downloadable (summary + month documents only) with the notice `This month has no expenses.` *While the summary is hidden (D-114): month documents only, and with none, one blank page carrying just the footer.*
- **Submitted flag (R10.6):** a secondary `Mark as submitted` button sits in the page header at all times (it does not wait for a download) and is refused on a locked month; once set, it reads `Submitted {date}` with a quiet `Undo` (confirmation dialog — undoing also discards the figures captured at submission, R3.9), and the (source, month) shows `Submitted {date}` here and edit warnings elsewhere. Submitting is per source per month (D-93) — marking this source submitted never marks another source's same month.
- **Locking a reconciled month (R10.7, D-96):** a secondary `Lock month` button beside the Submitted marker opens a dialog — `Lock {Month YYYY}?`, the signed-copy text, a PDF-only picker, and `Lock month` (disabled until a file is chosen) / `Cancel`. A PDF secured with only an owner password (printing or copying restricted, opens without a password) is accepted, since the signed copy is only stored and served back; one that needs a password to open is refused. Expense and month documents still refuse any encrypted PDF, because the packet embeds them. While the blocking panel shows, `Lock month` is disabled and says `Add the missing documents before locking this month.` Locking a month that was not yet submitted marks it submitted with today's date and captures the "as submitted" figures; the first lock of a month already submitted leaves both the submitted date and those figures untouched, and a lock following an unlock is treated as a fresh submission — it moves the submitted date to today and re-captures, so the two always agree (D-96, amended by D-97/PR #16 review). Once locked, the header shows `Reconciled · Locked on {date} by {name} · View signed packet · Unlock`; `Submitted {date}` stays but its Undo is hidden, the month documents manager has no Add or Remove, and the deleted-items dialog's Restore is disabled with the locked message — downloads are unchanged. `Unlock` opens `Unlock {Month YYYY}?` with an optional reason and returns the month to Submitted, not Open. Beneath the header, the month's history, oldest first: each lock `Locked {date} by {name} · View signed packet` (an earlier copy also `Replaced on {date}`), each unlock `Unlocked {date} by {name}: "{reason}"`. Per source per month, like Submitted.
- **Month documents manager:** card listing uploads grouped by category (`Bank statement · Timesheet · Combined hours · Fiduciary invoice · Other`), each row: filename, optional title, page count, Remove. Add flow: category select + optional title + file. Soft reminder (not blocking) when no bank statement uploaded: `No bank statement attached for {Month} yet.`
- **Packet contents, in submission order:** numbered list with live page counts (uploads use stored `page_count`; cover sheets estimated via `layout-constants.ts` per packet-pdf-spec): `1. Contract summary sheet — {n} page(s)`, `2. Expense index — {n} page(s)`, then `{Line Item} — cover sheet + documents — {n} pages` per non-empty line item, and last `Month documents — {n} pages`; total row `Total: {N} pages`. The rows are **rendered from `packetContents`**, the same declaration `buildPacketPdf` assembles in — not a second hand-written list (R11.2, D-77). *Temporarily (D-114), rows 1 and 2 are commented out with the sections they describe, so the list starts at the first line item and the total leaves their pages out.*
- **Monthly summary section** (Phase 11 §7.5, PR #18 review #7), below the two-column grid, not on "All": on Reconciliation + AI, the full summary section shared with `/r/monthly-summary` (`src/components/monthly-summary/summary-section.tsx`) — write, edit with autosave, Copy text, Download Word and PDF, Write again, and the Saved summaries list; on the base plan, the note `Monthly summaries are part of the Reconciliation + AI plan.` The summary is never part of the packet (`packetContents` and the downloads are untouched). The section carries the packet tour's `data-tour="packet-monthly-summary"` target only on Reconciliation + AI; the tour's last step (Plus only) points at it and is simply dropped on the base plan, like any other absent tour target.
- **Sharing by link (PHASE-12, D-112).** A secondary `Share link` button sits after the two downloads, under the same rules: disabled by the blocking panel, behind the deleted-items dialog (whose confirm still reads `Continue to download`, per the ticket), allowed on locked months and archived sources, for admins and managers on every plan; disabled with `Files can't be shared while your organization's plan is cancelled.` for a cancelled plan. The dialog `Share {Month YYYY} files` offers `Packet (PDF)` (`Opens in the browser. Clickable references work in Chrome, Edge and Safari.`) and `Summary (Excel)` (`Downloads the Excel file.`); a file already shared reads `Already shared` and shows its row instead of the form. `Require a password` reveals a password field (6–128 characters, with Show and a hint). `Create link` saves the file as it is now (`Preparing the packet…` for a big packet; the dialog can't be closed until it finishes) and shows the link, `Copy link` (toast `Link copied.`) and, with a password, `Password protected. Send the password separately, for example by text.` Once a file has a link, a **Shared links** box below the buttons lists one row per file, packet first: kind · `Password protected`/`No password`, `Shared on {date} by {name}`, the link and `Copy link`, `Change password` (inline: set, replace or remove; the current one is never shown) · `Stop sharing` (confirm `Stop sharing the {Month YYYY} packet?`/`summary?` — `Anyone who has the link won't be able to open it.`). When the records the file is built from have changed since it was shared — for the summary, documents don't count, since it prints none — the row says `Your records changed since you shared this file on {date}. The link still gives the older file.` with `Update shared file`, which puts the current file behind the same link under the download rules. One link per file per (source, month); Stop sharing is permanent and sharing again gives a new link. The public side (`/s/{token}`) is described in PHASE-12 §6.
- **Downloads:** primary `Download packet (PDF)` + `Download summary (Excel)`; generation is a synchronous streaming request behind a single-flight lock (packet-pdf-spec §Failure handling) with an indeterminate "Preparing the packet…" state; post-download toast with file size (artifact pinned per R10.6); if the final size > 25 MB show the compression warning per packet spec; on failure, the red failure panel with Retry.

## Server surface
`POST /api/files/upload` (quota-checked, `fundingSourceId` required and verified via `findFundingSource`), `removeMonthDocumentAction(id, fundingSourceId)`, `loadPacketReadiness(orgId, fundingSourceId, month)`, `GET /api/downloads/packet?month=&source=`, `GET /api/downloads/summary?month=&source=`, `markMonthSubmittedAction(month, fundingSourceId)`, `clearMonthSubmittedAction(month, fundingSourceId)` (refused on a locked month), `POST /api/files/upload` with `target=signed-packet` (lock, R10.7), `unlockMonthAction(month, fundingSourceId, reason)`, `loadLockEvents(orgId, fundingSourceId, month)`, `GET /api/files/{id}` (serves a signed copy by its lock event's id), `loadSharedLinks(orgId, fundingSourceId, month)`, `POST /api/shared-links/create` → `createSharedLinkAction({ fundingSourceId, month, kind, password, confirmedDeletions })`, `POST /api/shared-links/update` → `updateSharedFileAction({ shareId, confirmedDeletions })`, `changeSharedLinkPasswordAction({ shareId, password })`, `stopSharedLinkAction({ shareId })` — every action/route verifies the source (or the share) belongs to the session's org (D-93, D-112).

## Acceptance
Blocking list matches m03's strip exactly and uses R4.4 wording verbatim; downloads enabled the moment the last missing doc is attached; page counts within ±2 of the generated PDF; generated files match their specs; a 130-page month generates ≤ 60 s; double-click produces one generation run; a month with no deletions shows no deleted-items dialog and downloads are gated by the documentation blocking list alone; a month with deletions opens the dialog on every download click and downloads only after `Continue to download`, restoring an item updates the list in place without a full page reload; a month with missing documents cannot be locked and says why; locking one source's month leaves another source's same month open; after unlock → lock again both signed copies download and the newest is current. Sharing (PHASE-12 Appendix A "Done when"): Share link follows the download rules; at most one packet link and one summary link per (source, month); the PDF link opens in the browser's viewer with its references working, the Excel link downloads the same file as the download button; a password-protected link refuses a wrong password and pauses a visitor after 5 wrong tries; a password change ends the old password and earlier unlocks at once; Stop sharing makes the link unavailable and sharing again gives a new one; after a records change, Update shared file puts the new file behind the same link; opening a link never builds a file; a paused or cancelled organization's links are unavailable and return when access is restored.

---

## Claude Design prompt

```
Design the MONTH-END PACKET screen inside the app chrome (month "March 2026", Month-End
Packet tab active).

h1 "Month-End Packet", subtext "March 2026".

1) BLOCKING PANEL at top (2px #8A2A22 border, #F6E7E4 background): bold red title "This
packet cannot be downloaded yet." · line "The following records are missing a
receipt/justification or proof of payment:" · three rows separated by hairlines, each with
text left and an underlined "Open expense" link right:
   "Stock Media · Promotional & Marketing · missing proof of payment"
   "JDS Silkscreen & Embroidery · Promotional & Marketing · missing both"
   "Cornelius Webb · Salary · missing proof of payment"

2) READINESS TABLE: uppercase headers Line Item | Amount This Month | Expenses | Documentation
Complete. Rows:
   Salary $45,641.12 · 9 · No (bold red)
   Analytical Support $19,890.83 · 11 · Yes
   Promotional & Marketing $11,851.65 · 11 · No (bold red)
   Social Services & Support $11,047.74 · 15 · Yes
   Community Programs & Events $4,251.28 · 3 · Yes
   Professional Development $1,599.00 · 2 · Yes
   Total row bold: $94,281.62 · 51.

3) MONTH DOCUMENTS card: h2 "Month documents", helper "Bank statements, timesheets and other
documents that belong to the whole month. They are included at the end of the packet."
Grouped rows:
   BANK STATEMENT — "chase-business-march-2026.pdf" · 11 pages · Remove
   COMBINED HOURS — "combined-hours-march.pdf" · 1 page · Remove
   TIMESHEET — "timesheets-all-staff-march.pdf" · 17 pages · Remove
   FIDUCIARY INVOICE — "dcc-invoice-1750.pdf" · 1 page · Remove
   Add row: category select + "Title (optional)" input + file button.

4) PACKET CONTENTS table: headers # | Item | Pages. Rows: 1 Contract summary sheet 1 ·
2 Expense index 2 · 3 Salary — cover sheet + documents 21 · 4 Analytical Support — cover
sheet + documents 14 · 5 Promotional & Marketing — cover sheet + documents 26 · 6 Social
Services & Support — cover sheet + documents 24 · 7 Community Programs & Events — cover
sheet + documents 8 · 8 Professional Development — cover sheet + documents 4 · 9 Month
documents 30 · bold total row "Total: 130 pages".

5) Buttons row: "Download packet (PDF)" and "Download summary (Excel)" — both rendered in
the DISABLED state (gray #C9C2B4 background, #7A7364 text, not-allowed cursor) since the
blocking panel is present.
```
