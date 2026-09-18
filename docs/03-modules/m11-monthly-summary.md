# m11 — Monthly summary

## Purpose
An AI-drafted narrative summary of one funding source's month — Overview, Spending by line
item, Budget position, Changes from last month, Items to note — written from the same figures
the Dashboard and Contract Summary use, for the team to check, edit and download.

## Scope
Route `/r/monthly-summary`, Reconciliation + AI only. Admins and managers. Follows the header's
active funding source and month, like every other tab, so one source's one month is shown at a
time — no "All" view (`PickFundingSource` when the header is on "All"). No top navigation tab:
reached from the Month-End Packet tab, which shows the same section, and a Dashboard link. It never enters the packet, never
leaves the app on its own, and works on locked and archived months/sources. Full design and
decisions: `docs/PHASE-11.md`.

## Data
Reads `src/domain/monthly-summary-facts.ts`'s `buildMonthFacts`, fed by the same loaders the
Dashboard and Contract Summary use (`loadLineItemBudgets`, `loadExpenseAmounts`,
`loadFundingSourceSettings`), so every figure matches them exactly (PHASE-11 §4, P2). Writes
`monthly_summaries`, one row per (org, funding source, month), with optimistic-concurrency
`version` and a stored `expenses_fingerprint` for the changed-records notice (PHASE-11 §3, P7,
P10) — since PR #18 round 2 a sha256 of the whole facts object the model was given, so a budget
edit or an earlier month's change raises the notice too, not only this month's expenses. Usage is logged to `ai_usage_events` (PHASE-11 §3, P12).

## Behavior
- Base plan: title, Plus badge and the plan note only — no button, no list (P15: data is kept,
  not deleted, and reappears on upgrade).
- AI plan, no summary yet: intro text plus **Write draft summary**, disabled with "Add expenses
  to this month first." when the month has none.
- Writing: a shimmer (`summary-skeleton.tsx`) replaces the whole summary card, carrying "Writing
  your summary… this can take up to a minute."; the rest of the app stays usable; leaving the
  screen doesn't cancel the run (PHASE-11 §7.1, §6, C8).
- Summary exists: month title and meta line, then **Copy text · Download Word · Download PDF** in
  one row, the changed-records notice when the stored fingerprint no longer matches, the AI
  reminder (a grey note, Appendix A's wording), and the summary itself in a **rich editor**
  (`summary-rich-editor.tsx`, Tiptap): headings, paragraphs and bullets with a Bold and Bullet list
  toolbar, stored as the same Markdown through `toEditorDoc`/`serializeSummaryMarkdown`, so Word,
  PDF and Copy text come from one representation and no raw HTML is rendered (P6, C9). Lists stay
  flat: Tab doesn't indent, and a pasted nested list is saved as one line per item. Opening a
  summary never saves it — only a real change is reported to autosave. The bottom bar holds Save
  (3-second autosave) and **Write again** (secondary, confirm, replaces the text).
- A **Saved summaries** list, newest month first, one row per month with a summary for this
  source; clicking a row calls `setActiveMonthAction` so the header, this screen and the rest of
  the app agree on the month.
- Month-End Packet tab: the **same section** — editor, downloads and Saved summaries — below
  Month documents, from one shared component (`src/components/monthly-summary/summary-section.tsx`,
  PR #18 review #7). Base plan: the plan note. The tour target is only there on Reconciliation + AI.
- Dashboard: once a summary exists for a source's active month, a quiet **Monthly summary
  ready** link after the two action buttons. From "All" (or another source's section) it first
  switches the header's active funding source, then opens the screen, since the screen follows
  the header (`app/r/monthly-summary-ready-link.tsx`, `summaryLinkNeedsSourceSwitch`).

## Server surface
- `loadMonthlySummaryScreen(orgId, sourceId, month)` — everything the screen needs: access
  state, the summary or null, the stale flag, live expense count, writer/editor names, saved
  months.
- `loadReadySummarySourceIds(orgId, sourceIds, month)` — batched for the Dashboard, one query
  for every section shown, not one per source.
- `writeSummaryAction({ sourceId, month, expectedVersion })` and
  `POST /api/monthly-summary/write` — the route adds session/origin/size checks in front of the
  action, since a run of up to about four minutes would otherwise block every other Server
  Action in the tab (PHASE-11 Phase 3 deviation).
- `saveSummaryAction({ sourceId, month, markdown, expectedVersion })` — Save and autosave.
- `GET /api/downloads/monthly-summary?source=&month=&format=docx|pdf` — Word from the saved
  Markdown, set in **Calibri** (not the cover sheet's Aptos — a summary opens on the reader's own
  machine, where Aptos is often missing, and Calibri ships with Word by default; the container's
  Calibri→Carlito mapping is asserted in the Dockerfile alongside the Aptos one, PHASE-11 §7.4),
  PDF via the existing `convertDocxToPdf` pipeline.

## Acceptance
Every figure in a summary equals the Dashboard's and Contract Summary's own figures for the same
(source, month). The five section headings are always present, in order, on a saved draft
written by the model; a user may rename or remove them afterwards. Downloads are disabled while
an edit is unsaved. The Dashboard link opens the screen for the same month the packet tab shows. Full test mapping: `docs/PHASE-11.md` §8–§10.

---

## Claude Design prompt

Not applicable — built from the existing component kit and Phase 10's Plus styling
(`PlusBadge`, `PLUS_FRAME_STYLE`), like m10's admin dashboard; no Claude Design pass was run.
