# Design Review — Claude Design project fetch (2026-08-16)

**Source of truth for visuals:** Claude Design project `Grant Expense Reconciliation System`, projectId `3e45af6d-56de-4ac4-974d-a1bae86a7c10`. Ten screens as `.dc.html` Design Components + shared `support.js` runtime + the design-language preamble as project CLAUDE.md. **Do not copy the files into this repo** — when building module X, refetch its file fresh: `DesignSync { method: "get_file", projectId: "3e45af6d-56de-4ac4-974d-a1bae86a7c10", path: "<Screen>.dc.html" }` (paths: Auth and Onboarding, Dashboard, Add Expense, Expenses, Cover Sheets, Recurring, Month-End Packet, Contract Summary, Line Items, Settings — all `.dc.html`).

## How the screens are built (dc format)

- Each file: `<x-dc>` declarative template — plain HTML, **inline styles only**, `{{ }}` bindings, `sc-if`/`sc-for` control flow, `style-hover` for hover — plus a `data-dc-script` defining `class Component extends DCLogic { state; renderVals() }`, rendered by `support.js` (dc-runtime on React).
- Screens are **galleries**: the main state plus labeled variants (`data-screen-label` sections) — m00 stacks 5 sub-screens (sign in / create / onboarding 1–2 / shell); others embed variants (blocked, empty, form-open, no-receipt checked).
- The app chrome (header, Month select, 9-tab nav) is duplicated verbatim in every file with an identical `TABS` array → becomes **one layout component** in Next.
- Demo data everywhere = our corrected spec fixtures (review B-series numbers all present and consistent: $94,281.62 / $19,890.83 / "missing both" / Cornelius just-added, etc.). Interactions genuinely work (filters, toggles, autofill dropdown, inline edit).

## Verdict per screen

All ten: **✅ spec-conformant, no behavioral conflicts** — the designs were generated from the post-review prompts and it shows. Design-side additions we ADOPT (visuals/copy, design wins):

| Screen | Adopted from design |
|---|---|
| m00 | Sign-in error as bordered danger panel (spec had plain text); divider-separated footer links |
| m02 | Autofill helper line "Filled in from {name}'s last expense."; `$`-adorned money input composite; upload areas as dashed drop-zones with "Add files" + hint "PNG, JPG or PDF. You can attach more than one." |
| m03 | Filtered-empty state "No expenses match these filters." |
| m05 | Per-row quiet "Edit" link placement; truncation row style |
| m06 | Line under disabled downloads: "Downloads unlock when every record above has both documents." |
| m09 | Toggle-switch pattern (green track, Active/Off label) for list items; read-only email field styling |

Build must ADD (spec wins, absent from static designs — expected):

- m00: month-selector rolling window + "Earlier month…" (design hardcodes 4 months); SIGNUP_ENABLED gating; onboarding-resume redirect.
- m02: edit mode (prefill + Delete + edit-projection formula + Submitted-month warning); no-receipt ⇄ receipt-files mutual exclusion on save; upload progress/status chips (design shows attached state only).
- m03/m08/m05: confirm dialogs (delete expense / delete line item with recurring cascade / Remove documented recurring expense) — none shown in static designs.
- m04: "All Line Items" mode with per-sheet download buttons (design shows single-sheet mode + blocked variant); real proof thumbnails replacing placeholder strips.
- m06: "Mark as submitted" post-download action + Submitted state; no-bank-statement soft reminder; generation progress/failure panel.
- m07: gated/disabled Excel-button state with explanation.
- m09: add/edit dialogs for list items and vendors (design shows rows + buttons only); org-name save reflected in header.

## Implementation conventions derived from the fetched markup

- Extract the palette/typography into Tailwind 4 `@theme` tokens (values already 1:1 with `design-language.md`); translate repeated inline-style patterns into ~12 shared components: `Button` (primary/secondary/quiet-link/disabled), `Input`, `MoneyInput` ($ prefix, right-aligned tabular), `Select`, `Field` (label+helper+error), `Card`, `DataTable` (uppercase headers, 2px ink header border), `DangerPanel`, `EmptyState` (dashed), `FileChip`, `UploadZone`, `ToggleSwitch`, `SavedTick`.
- Keep the design's exact pixel values (padding 14–16px cells, 44/48px controls, 3–4px radii, 24px nav gap, 200px month select, 1100px content max) — they are consistent across all ten files.
- Document preview (m04) uses `font-family: Aptos, Calibri, 'Segoe UI', Arial` and all-centered document tables — matches cover-sheet-spec; the preview component and the docx generator share `layout-constants.ts`.
