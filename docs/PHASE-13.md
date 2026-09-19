# Phase 13: No dashes, and a copy review

Status: **built, reviewed and browser-tested** (2026-09-19). Build phases are in §8, results in §10, and the
questions still open for Awais in §11.

---

## 1. What this is

Awais (2026-09-19):

> Remove all the em dashes from the whole application. Whether it's in any monthly packet title or
> any other part of the application on the user side, there should be no em dash inside any month
> and package, inside any expense or any downloadable thing, and also in the application which the
> user is going to use. Also, I want you to review the application copy content. I want this to be
> professionally excellent.

Two pieces of work, done together because they touch the same strings:

1. **No em dashes (and no en dashes) in anything the app writes:** every screen, toast, dialog,
   tour, browser tab title, the packet PDF, cover sheets (Word and PDF), the Excel summary, the
   monthly summary drafts the AI writes, and error messages a user can see.
2. **A copy review** of every user-facing string against one set of rules (§3), applied directly,
   with every change listed before and after in §9 for Awais to read before commit.

Today there are about 140 dashes in strings the app shows or prints, spread over ~60 files, and
~1,400 prose strings to review (the landing page's ~250 excluded, §2.2).

## 2. Decisions

### 2.1 Awais's answers (2026-09-19)

| Question | Answer |
|---|---|
| What replaces dashes on documents the City sees | **Vertical bars** between the parts of the packet footer; titles become plain phrases that match the packet's own title; the cover sheet heading puts the reference in brackets (§4) |
| An empty table cell that shows "—" today | **A plain hyphen**, "-" |
| Text people type (expense names, descriptions, narratives, vendor names) | **Left exactly as typed.** Only the app's own words and the AI's drafts change |
| How the copy review is applied | **Apply, then show the list:** every change goes into §9, before and after, for review before commit. City-approved document wording keeps its words; only its dashes change |

### 2.2 Taken by this plan (overridable at review)

- **En dashes go too.** In most fonts a user can't tell "–" from "—". Number and date ranges read
  "to" ("1 to 10 of 45", "3/1/2026 to 3/31/2026").
- **Screens keep " · " as their separator.** The app already uses it ("Reconciled · Locked on …",
  "Password protected · Shared on …"), so a label and its detail on a screen use " · ", or ": "
  when the second part explains the first. Documents use " | " (Awais's answer). Browser tab titles
  use " | " too, the web convention: `Expenses | Stay Funded 360`.
- **The landing page loses its dashes but is not reviewed for copy.** Awais is rewriting it when
  development finishes (said 2026-09-16).
- **Saved monthly summaries are not rewritten.** A saved summary may hold a person's edits, which
  count as typed text. New drafts, including Write again, come out clean (§5).
- **Staff-only and operator text is cleaned too.** That covers the `/a` admin screens, boot
  errors in `instrumentation.ts`, seed and staff scripts. None of it is customer-facing, but one
  rule with no exceptions is what lets a test guard it (§7).
- **AI prompts lose their dashes but keep their wording.** Rewording a prompt changes what the
  model does, which a copy review can't test. The monthly summary prompt gains one rule (§5).
- **Code comments and docs prose are out of scope.** Users never read them. The docs that quote a
  changed string (domain-rules §12, the output specs) are updated, because they are the spec.
- **"Contact Mantaq" becomes "contact support".** Stay Funded 360's customers have never heard of
  Mantaq. The messages point to support using the same `UI.supportEmail` as the login page, so the
  pending support-email decision changes one constant.
- **A generator version bump for the packet (`packet-13`) and the cover sheet (`cover-9`).** Their
  bytes change for a reason the snapshot doesn't carry. The Excel summary has no dashes and
  keeps `summary-3`.

### 2.3 Consequences worth knowing before deploy

- **Locked months** re-download in the new format. The signed copy the City returned is stored
  and doesn't change. This is the same as every earlier generator bump (D-78, D-83).
- **Shared links** keep serving the file they pinned until the next Update (PHASE-12 P14). The
  sharing feature isn't live in production yet, because its deploy stopped at `APP_URL`. If it
  goes live before this does, a packet shared in between keeps its dashes until its records
  change.

## 3. The rules for app copy

These become the "Words" section of `docs/03-modules/design-language.md` in this change, so they
outlive this phase.

1. **No em or en dashes.** Two thoughts become two sentences, or a comma or colon joins them. An
   aside goes in commas or brackets. Ranges use "to". Separators: " · " on screens, " | " on
   documents and tab titles. An empty cell shows "-".
2. **Plain American English.** "Organization", and "check" or "select", never "tick". The
   status label "Cancelled" keeps its spelling.
3. **Say what happened, then what to do.** "The packet couldn't be generated. Try again, and if
   it keeps failing, contact support at …". Never blame the user. Use "Please" only when asking
   for effort, not in every error.
4. **No internal words.** No "Mantaq", "S3", "artifact", "request", "session", "server action",
   "Phase N" or rule numbers.
5. **One name per thing.** Expense (not record or item, except "records" in canonical text),
   line item, funding source, receipt, proof of payment, narrative, cover sheet, packet, month
   documents, Month-End Packet (tab names keep their Title Case). "Sign in" and "Sign out".
6. **Sentence case** for buttons, headings, labels, dialog titles and menu items. Tab names are
   proper names and keep Title Case: Dashboard, Add Expense, Expenses, Cover Sheets, Month-End
   Packet, Contract Summary, Line Items, Recurring, Settings.
7. **Full sentences end with a period**, and toasts too. Labels, buttons and headings don't.
8. **Contractions are fine in messages** ("can't", "won't"). Canonical strings keep their current
   form unless listed in §9.
9. **"…" (one character) for work in progress**: "Saving…", "Preparing the packet…".
10. **City-approved document wording keeps its words.** That covers the tax and fees notes,
    "Please see below…", cover sheet titles, the summary sheet's layout and column names, and the
    footer's parts and order. Only their dashes change.

## 4. Documents (exact before and after)

| Where | Today | After |
|---|---|---|
| Packet footer, every page (R10.5) | `Team Pursuit — March 2026 — 2026-03-014 — Page 84 of 132` | `Team Pursuit \| March 2026 \| 2026-03-014 \| Page 84 of 132` |
| Packet summary page title | `Team Pursuit — Contract Summary — March 2026` | `Team Pursuit March 2026 Contract Summary` |
| Expense index title | `Team Pursuit — Expense Index — March 2026` | `Team Pursuit March 2026 Expense Index` |
| Index, no-receipt disclosure | `2026-03-014 — Jane Doe: no receipt available — CashApp only` | `Jane Doe (2026-03-014): no receipt available. Reason: CashApp only` |
| Cover sheet heading (R6.4) | `Jane Doe — 2026-03-014:` | `Jane Doe (2026-03-014):` |
| No-receipt note (R6.7) | `(Note: No receipt available — CashApp only)` | `(Note: No receipt available. Reason: CashApp only)` |
| Packet sidebar outline, one per expense | `2026-03-014 — Jane Doe` | `2026-03-014 \| Jane Doe` |
| "Packet generation failed at …" part names | `Salary — cover sheet + documents`, `Jane Doe — receipt.pdf` | `Salary cover sheet and documents`, `Jane Doe (receipt.pdf)` |

- **The packet's links still anchor on the heading.** `pdf-anchors.ts` finds a heading by its
  reference token. `pdftotext` will now read `(2026-03-014):` as one word, so the match accepts
  that form alongside the current two. Nothing else about anchoring changes.
- The PDF's own title (`Team Pursuit March 2026 Packet`) and every filename already have no dash.

## 5. The AI monthly summary

1. **The prompt stops using dashes**, since a model copies the punctuation it's shown. It also
   gains one writing rule: never use em dashes or en dashes; use a comma, colon, brackets or a new
   sentence, and write ranges with "to". The rule names the characters instead of printing them,
   so the prompt itself stays clean.
2. **Each draft is cleaned before it's checked and saved** (`replaceDashes` in
   `src/domain/dashes.ts`). The prompt rule is a request; the cleaner makes it a guarantee:
   - a dash touching a number as a minus sign (`–$145.00`) becomes `-$145.00`, so the figure
     checker sees the sign the model meant;
   - an unspaced dash between two numbers is a range: `2–3` → `2 to 3`. Between two words, an
     en dash becomes a hyphen (`January-March`), since it may join a compound such as
     `Detroit–Wayne`, and an em dash becomes a comma;
   - any other em or en dash becomes a comma, with tidy-ups for `, ,`, `, .`, a dash at the start
     or end of a line, and a dash next to a bracket or colon;
   - **names from the month's data are kept as typed**: a line item, expense, vendor or payment
     source name that contains a dash is protected before cleaning and put back after.
3. It runs **before** `checkDraft`, so the figure and structure checks judge exactly what's saved.
   The retry path is unchanged.

## 6. App screens

Every dash in an app-written string is rewritten by the rules in §3 during the copy review (§8,
Phase 3). The kinds of dash, and their usual fix:

| Kind | Example today | Usual fix |
|---|---|---|
| Two clauses | `Saved — still missing proof of payment.` | `Saved. It's still missing proof of payment.` |
| Label and detail | `2026-03-014 — Jane Doe` (dialog title), `Payroll — $1,200.00 — deleted 9/1/2026` | ` · ` |
| Sort choices | `Date — newest first` | `Date (newest first)` |
| Tab title | `Expenses — Stay Funded 360` | `Expenses \| Stay Funded 360` |
| Range | `Showing 1–10 of 45`, `3/1/2026 – 3/31/2026` | `Showing 1 to 10 of 45`, `3/1/2026 to 3/31/2026` |
| Empty cell | `—` | `-` |

## 7. The guard

`src/domain/no-dashes.test.ts` (unit) reads every tracked `.ts` and `.tsx` file under `app/`,
`src/` and `scripts/`, plus the root config files, except tests. It parses each one with the
TypeScript compiler, so comments are skipped, and fails on any string literal, template part,
JSX text or JSX attribute that contains an em dash, an en dash, `&mdash;`, `&ndash;` or their
`\u` escapes. It names the file, the line and the text.

- **Allowlist, each entry with its reason:** `src/generation/pdf-text.ts` (a character table,
  not copy) and `src/domain/dashes.ts` (the cleaner has to name what it removes).
- **Mutation-tested:** put a dash back in a JSX text node, in a template literal and in an
  attribute, then write an escaped one. Each must fail the test.
- `strings.test.ts` gains a check that no `UI` value, called with sample arguments, returns a dash,
  modeled on its existing American-spelling guard.

## 8. Build phases

Each phase: plan, review, implement, review, browser or render check, commit.

### Phase 0: this plan

`docs/PHASE-13.md`, D-113 in `decisions.md`, the README row. **Passes when** committed.

### Phase 1: documents

- `strings.ts`: `packetFooter`, `packetSummaryTitle`, `coverSheetHeading`, `noReceiptNote`,
  `pageTitle`. Also `packet-index-pdf.ts` (title and disclosure), `packet-footer.ts` (outline),
  `packet-order.ts` and `packet-pdf.ts` (failure part names).
- `pdf-anchors.ts` accepts `(ref):`.
- `versions.ts`: `packet-13`, `cover-9`, each with its bump comment.
- Docs: domain-rules §12 (cover-heading, no-receipt-note) and R6.4, R6.7 and R10.5 wherever they
  print the format; `packet-pdf-spec.md` (footer, titles, outline); `cover-sheet-spec.md`
  (heading, note).
- Tests updated to the new text: strings, packet-footer, pdf-links, pdf-anchors, packet-trace,
  cover-sheet-docx, render-smoke.

**Passes when:**
- the unit tests and the packet integration tests pass;
- a packet, a cover sheet (Word and PDF) and the Excel summary built from local data and read
  with `pdftotext` or unzipped contain no dash, except inside values people typed;
- in a generated packet, a cover sheet heading and a table row still link to the receipt, and the
  receipt's footer links back.

### Phase 2: the AI summary

- `src/domain/dashes.ts` with `replaceDashes(text, { keep })` and its unit tests: every rule in
  §5, protected names, and idempotence (cleaning twice changes nothing).
- The prompt rewritten without dashes, plus the new rule.
- `runModelAttempts` cleans each draft before `checkDraft`, keeping the names from the facts.
- An action integration test: a stubbed model reply full of dashes is saved clean, with a name
  that contains a dash kept as typed.

**Passes when** those tests pass and one real draft for a local month (Awais's OpenAI key, one
run) comes back with no dash.

### Phase 3: screens and the copy review

Four reviewers work in parallel, each owning a disjoint set of files so no two edit the same one.
Each applies §3, rewrites its dashes, updates the unit tests that pin the strings it changed, and
logs every change for §9.

| Reviewer | Owns |
|---|---|
| A. Expenses | `app/r/expenses/**`, `app/r/recurring/**`, `src/modules/{expenses,recurring}/**`, `src/services/storage/**`, `app/api/files/**`, `src/components/audit/**`, `src/components/ui/{document-viewer,download-button}.tsx`, `src/domain/{gate,recurring-rules,line-item-rules,name}.ts` |
| B. Month end | `app/r/{packet,cover-sheets,contract-summary,line-items,monthly-summary}/**`, `app/r/{page,source-budget-section}.tsx`, `src/components/monthly-summary/**`, `src/modules/{packet,sharing,line-items,monthly-summary}/**`, `app/api/{downloads,shared-links}/**`, `app/s/**`, `src/generation/**` (only the copy Phase 1 didn't touch) |
| C. Account, settings, admin, shell | `app/r/settings/**`, `app/(auth)/**`, `app/a/**`, `app/r/{layout,error,not-found}.tsx`, `src/modules/{settings,users,auth,admin,funding-sources,landing}/**` (landing: dashes only), `src/components/{app-shell,ui}/**` (except A's two files), `src/lib/**`, `src/services/{auth,openai}/**`, `src/services/*.ts`, `src/db/**`, `scripts/**`, root `.ts` files |
| D. Shared wording | `src/domain/strings.ts` (the `UI` block and the functions below it, not Phase 1's document helpers), `src/modules/tours/**` |

Reviewer D reads each `UI` entry where it's used, so the words fit their screen. Then the guard
(§7) goes in, and `design-language.md` gains the "Words" section.

**Passes when:**
- the guard passes and fails under each mutation in §7;
- the full suite, typecheck and lint are clean;
- every visible string that changed is in §9;
- domain-rules §12 matches `strings.ts`.

### Phase 4: review and browser pass

- **Adversarial review, three reviewers:**
  - **Meaning:** a rewrite that now says something false, drops a condition or changes an
    instruction.
  - **Consistency:** the same thing named two ways, tone drift, a leftover internal word.
  - **Guard and tests:** can the guard be fooled? Do the updated tests still assert something?
- **Browser pass in Chrome:** Awais signs in on `localhost:3001`. Every screen at 1280 px, with
  its dialogs, menus, tours and toasts opened. On each one, `document.body.innerText` and
  `document.title` are checked for a dash, and the words are read in place. Phone width (375 px)
  for the screens whose copy changed length the most.
- **Passes when** no dash appears outside typed values, the review's findings are fixed or
  answered, and Results are written here.

## 9. Copy changes

Before and after, grouped by area and screen, with a short reason when it isn't only a dash.
`Where` is the file and line after the change. `§12` marks a canonical string (domain-rules §12,
updated to match), and `DOC` marks text printed in the packet PDF, covered by `packet-13`. Four
reviewers wrote these, each owning a separate set of files; §9.5 is the lead's pass that
reconciled them.

### 9.1 Recording expenses (Add Expense, Expenses, Trash, Recurring, uploads)

#### Add Expense and Edit (`src/modules/expenses/expense-form.tsx`, edit page)

| Where | Before | After | Why |
|---|---|---|---|
| expense-form.tsx:533 | `Uploading 2 of 5 — waiting for the queue…` | `Uploading 2 of 5. Waiting a few seconds…` | "the queue" is internal; the code waits 6 seconds |
| expense-form.tsx:623 | `{file}: {error} — the expense was saved; add the file again from Edit.` | `{file}: {error} The expense was saved, so add the file again from Edit.` | |
| expense-form.tsx:658, 686, 1119 | toast `File removed` | `File removed.` | Toasts end with a period (rule 7) |
| expense-form.tsx:731 | `Saving with this ticked removes the 2 receipt files already attached.` | `Saving with this checked removes the 2 receipt files already attached.` | "tick" becomes "check" |
| expense-form.tsx:756 | `March 2026 was submitted on 4/2/2026 — changes will not alter the packet that was downloaded, but regenerated documents will differ.` | `March 2026 was submitted on 4/2/2026. Your changes won't alter the packet already downloaded, but documents downloaded from now on will include them.` | "regenerated documents will differ" is vague; says what actually happens |
| expense-form.tsx:884 | option `Salary — Remaining $1,200.00` | `Salary · $1,200.00 remaining` | Label and detail use " · " |
| expense-form.tsx:952 | label `Description / role — this exact text will print on the cover sheet` | `Description / role (prints on the cover sheet exactly as typed)` | Matches the form's other "(prints on the cover sheet)" label |
| expense-form.tsx:1079 | `Receipt total: $110.00 — $10.00 not reimbursed` | `Receipt total: $110.00 ($10.00 not reimbursed)` | |
| expense-form.tsx:1239 | `It moves to the trash with its 3 attached files, and can be restored.` | `It moves to the trash with its 3 attached files and can be restored.` | Comma splits a compound predicate |
| app/r/expenses/[id]/edit/page.tsx:20, 106 | heading and tab title `Edit Expense` | `Edit expense` | Sentence case; "Edit Expense" isn't a tab name (tab title now `Edit expense \| Stay Funded 360`) |

#### File uploads and previews (upload field, viewer, `/api/files`, `src/services/storage`)

| Where | Before | After | Why |
|---|---|---|---|
| upload-field.tsx:74 | `scan.pdf is 31.2 MB — the limit is 25 MB.` | `scan.pdf is 31.2 MB, over the 25 MB limit. Use a smaller copy, for example a lower-resolution scan.` | Says what to do |
| upload-field.tsx:77 | `scan.pdf is empty.` | `scan.pdf is empty. Check that it opens on your device, then add it again.` | Says what to do |
| upload-field.tsx:82 | `notes.docx is not a PNG, JPG, HEIC or PDF.` | `notes.docx can't be attached. Use a PNG, JPG, HEIC or PDF.` | Says what to do |
| upload-field.tsx:181 | `This format cannot be shown by the browser. Save the expense and it will preview here — images are converted when they upload.` | `Your browser can't show this file. Save the expense and it will preview here, because images are converted when they upload.` | |
| upload-field.tsx:322 | `{file} is deleted from this expense straight away, and Cancel will not bring it back. You would have to upload it again.` | `{file} is deleted from this expense right away. Cancel won't bring it back, so you would have to upload it again.` | "straight away" is British |
| document-viewer.tsx:123 | aria-label `receipt.jpg — attachment preview` | `Preview of receipt.jpg` | |
| app/api/files/upload/route.ts:35 | `Not signed in.` | `You're signed out. Sign in and try again.` | Says what to do |
| upload/route.ts:39 | `Bad origin.` | `This upload couldn't be verified. Reload the page and try again.` | "origin" is internal |
| upload/route.ts:45 | `Too many uploads at once. Try again shortly.` | `Too many uploads at once. Wait a minute, then try again.` | The limit is a one-minute window |
| upload/route.ts:55 | `That file is larger than 25 MB.` | `That file is larger than the 25 MB limit. Upload a smaller copy, for example a lower-resolution scan.` | Says what to do; matches precheck |
| upload/route.ts:64 | `That upload was malformed.` | `That file didn't upload completely. Try again.` | "malformed" is jargon |
| upload/route.ts:69 | `No file was received.` | `No file arrived. Choose the file and try again.` | Says what to do |
| upload/route.ts:93 | `That funding source is archived.` | `That funding source is archived. Unarchive it in Settings to add documents.` | Matches the existing pattern in line-items and packet actions |
| upload/route.ts:151 | `That file could not be saved. Try again.` | `That file couldn't be saved. Try again, and if it keeps failing, contact support at tech@teampursuit.org.` | Rule 3; uses `UI.supportEmail` |
| app/api/files/[id]/route.ts:31 | plain text `Not signed in` | `You're signed out. Sign in and open the file again.` | Shown in a browser tab (signed packet link) |
| [id]/route.ts:16 (4 uses) | plain text `Not found` | `This file isn't available. It may have been removed.` | Same |
| storage/documents.ts:74 | `This expense already holds 199 MB of its 200 MB, and this file would take it over. Split the receipts across two expenses, or remove something already attached.` | `This expense already holds 199 MB of its 200 MB limit, and this file would put it over. Split the receipts across two expenses, or remove a file already attached.` | "take it over" reads as "seize it" |
| storage/documents.ts:81 | `This expense already holds 290 pages of its 300, and this file adds 40. Every page becomes a page of the packet, so the limit is there to keep the submission readable.` | `This expense already holds 290 pages of its 300-page limit, and this file adds 40. Every page becomes a page of the packet, so the limit keeps it readable. Split the receipts across two expenses, or remove a file already attached.` | Had no "what to do" |
| storage/documents.ts:88 | `An expense can hold at most 500 files.` | `An expense can hold at most 500 files. Split them across two expenses.` | Says what to do |
| storage/documents.ts:139 | `This organization is using 5100 MB of its 5120 MB of storage, and this file would take it over. Remove some documents from an earlier month, or contact Mantaq.` | `Your organization is using 5100 MB of its 5120 MB of storage, and this file would put it over. Remove some documents from an earlier month, or contact support at tech@teampursuit.org.` | No "Mantaq"; uses `UI.supportEmail` |
| storage/documents.ts:198 | `That file is larger than 25 MB. Upload a smaller export.` | `That file is larger than the 25 MB limit. Upload a smaller copy, for example a lower-resolution scan.` | "export" is odd for a photo or scan |
| storage/documents.ts:231 | `That document type is not one of yours.` | `That document type is no longer in use. Choose another type and add the file again.` | The check is "still active in Settings" |
| storage/documents.ts:260 | `This expense is marked "No receipt available" — untick that before attaching a receipt.` | `This expense is marked "No receipt available". Uncheck it before attaching a receipt.` | "untick" |
| storage/documents.ts:285, 461 | `That file is larger than 25 MB once converted for storage. Upload a smaller export.` | `Once converted for storage, that file is larger than the 25 MB limit. Upload a smaller copy, for example a lower-resolution photo.` | Only photos (HEIC, WebP) are converted |
| storage/documents.ts:434, 508 | `A month can hold at most 50 documents.` | `A month can hold at most 50 documents. Remove one before adding another.` | Says what to do |
| storage/inspect.ts:81 | `That file is empty.` | `That file is empty. Check that it opens on your device, then upload it again.` | Says what to do |
| storage/inspect.ts:96 | `That file's contents do not match its type. Try exporting it again.` | `That file's contents don't match its file type. Save or export it again, then upload the new copy.` | |
| storage/inspect.ts:137 | `That PDF has no pages.` | `That PDF has no pages. Check that it opens on your device, then upload it again.` | Says what to do |
| storage/inspect.ts:157 | `That PDF is password-protected. Save an unprotected copy and upload that.` | `That PDF is password protected. Save a copy without the password and upload that.` | Matches "Password protected" in sharing (§12 shared-link-public) |
| storage/inspect.ts:160 | `That PDF could not be read — it may be damaged.` | `That PDF couldn't be read and may be damaged. Save a new copy, or scan the document again, and upload that.` | Says what to do (also reaches the signed-packet upload) |
| storage/inspect.ts:41 (2 uses) | `That image could not be read — it may be damaged.` | `That image couldn't be read and may be damaged. Take a new photo or scan, and upload that.` | Says what to do |
| storage/inspect.ts:225 | `That image is too large to process. Try a smaller export.` | `That image is too large to process. Upload a lower-resolution copy.` | "export" |
| storage/driver.ts:210 | throw `S3_BUCKET must be set in production — refusing to store files on local disk` | `S3_BUCKET must be set in production. Refusing to store files on local disk.` | Boot error, not user-facing |
| storage/heic.ts:38 | worker source comment `…from its own handle — never another image's.` | `…from its own handle, never another image's.` | A comment inside a template string, so the guard sees it |

#### Expenses list and change history (`app/r/expenses`, `src/components/audit`, gate)

| Where | Before | After | Why |
|---|---|---|---|
| app/r/expenses/page.tsx:148 | heading `Expenses This Month` | `Expenses this month` | Sentence case (not a tab name) |
| app/r/expenses/page.tsx:152 | `This is where your last save landed — not your active month (April 2026). Go to your active month.` | `This is the month you last saved to, not your active month (April 2026). Go to your active month.` | |
| expenses-table.tsx:48 to 54 | `Date — newest first`, `Date — oldest first`, `Name — A to Z`, `Name — Z to A`, `Amount — highest first`, `Amount — lowest first` | `Date (newest first)`, `Date (oldest first)`, `Name (A to Z)`, `Name (Z to A)`, `Amount (highest first)`, `Amount (lowest first)` | |
| expenses-table.tsx:121 | history dialog title `2026-03-014 — Jane Doe` | `2026-03-014 · Jane Doe` | |
| expenses-table.tsx:143 | `Showing the most recent changes only — this expense has more history than fits here.` | `Showing the most recent changes only. This expense has more history than fits here.` | |
| expenses-table.tsx:150, 151 | headers `Date/Time`, `Actor` | `Date and time`, `User` | "Actor" is jargon |
| expenses-table.tsx:367 to 388 | `3 records are missing documents — show only those or view Month-End Packet` (toggles to `show all records`) | `3 expenses are missing documentation. Show only those or go to the Month-End Packet.` (toggles to `Show all expenses`) | One name per thing; it counts the "Missing documentation" filter, which includes narratives, so "documents" was inaccurate |
| expenses-table.tsx:425 | `Payroll — $1,200.00. It moves to the trash with its files, and can be restored.` | `Payroll ($1,200.00) moves to the trash with its files and can be restored.` | |
| expenses-table.tsx:504 to 510 | headers `Line Item`, `Funding Source`, `Source`, `Support` | `Line item`, `Funding source`, `Payment source`, `Supporting` | Sentence case; "Source" sat beside "Funding source" and meant payment source; "Support" collides with contacting support. Table already scrolls (min width 1160) |
| expenses-table.tsx:525 | title `Open the 3 document(s) filed under 2026-03-014` | `Open the 3 documents filed under 2026-03-014` (singular for 1) | |
| expenses-table.tsx:571 | empty Supporting cell `—` | `-` | Awais's choice for empty cells |
| src/domain/gate.ts:160, 170, 188 | filter option `All records` | `All expenses` | One name per thing. It is also the filter's value; renamed everywhere it is compared (gate.ts switch, `ALL_DOCUMENTATION`, gate.test.ts) |
| src/domain/gate.ts:91 | blocking line `Stock Media — Promotional & Marketing — missing proof of payment` | `Stock Media · Promotional & Marketing · missing proof of payment` | R4.4 format. Shown on screens and in the plain-text download refusal toast, never on a document |
| src/modules/expenses/queries.ts:451 | download refusal line `• Trashed expense — A item — $10.00` | `• Trashed expense · A item · $10.00` | |
| audit/audit-diff.tsx:44 to 111 | field labels `Funding Source`, `Line Item`, `Payment Source`, `Tax Reimbursable`, `Fees Reimbursable`, `No Receipt`, `No Receipt Reason` | `Funding source`, `Line item`, `Payment source`, `Tax reimbursable`, `Fees reimbursable`, `No receipt available`, `Reason for no receipt` | Sentence case; the last two match the form's own words |

#### Trash (`app/r/expenses/trash`)

| Where | Before | After | Why |
|---|---|---|---|
| trash-table.tsx:135, 136 | headers `Line Item`, `Funding Source` | `Line item`, `Funding source` | Sentence case |
| trash-table.tsx:163 | title `Open the 2 document(s) attached to Payroll` | `Open the 2 documents attached to Payroll` (singular for 1) | |
| trash-table.tsx:184 | toast `Payroll restored` | `Payroll restored.` | Toasts end with a period |
| trash-table.tsx:195 | `Payroll — $1,200.00. Its attached files are removed too. This cannot be undone.` | `Payroll ($1,200.00) and its attached files will be deleted. This can't be undone.` | |
| trash-table.tsx:202 | toast `Payroll deleted permanently` | `Payroll deleted permanently.` | Toasts end with a period |

#### Recurring (`app/r/recurring`, `src/modules/recurring`, recurring rules)

| Where | Before | After | Why |
|---|---|---|---|
| app/r/recurring/page.tsx:153 | heading `Recurring Items` | `Recurring items` | Sentence case (the tab is "Recurring") |
| app/r/recurring/page.tsx:155 | `Vendors and salaries billed every month. Nothing is added automatically — confirm each one you want to add to March 2026.` | `Vendors and salaries billed every month. Nothing is added automatically. Confirm each one you want to add to March 2026.` | |
| recurring-manager.tsx:171, 421 | fallback `Something went wrong.` | `That didn't work. Try again.` | Vague |
| recurring-manager.tsx:192 | toast `Adobe added to March 2026` | `Adobe added to March 2026.` | Toasts end with a period |
| recurring-manager.tsx:275 | helper `Used as the cover-sheet role when this item is added to a month.` | `Becomes the expense's description, which prints on the cover sheet, when this item is added to a month.` | Names the field it fills |
| recurring-manager.tsx:354 | toasts `Recurring item saved`, `Recurring item added` | `Recurring item saved.`, `Recurring item added.` | Toasts end with a period |
| recurring-manager.tsx:380 | toast `Removed from the recurring list` | `Removed from the recurring list.` | Same |
| recurring-manager.tsx:420 | toast `Removed from this month` | `Removed from this month.` | Same |
| recurring-manager.tsx:478, 479 | headers `Line Item`, `Funding Source` | `Line item`, `Funding source` | Sentence case |
| recurring-manager.tsx:567 | `Showing 1–25 of 40` | `Showing 1 to 25 of 40` | Ranges use "to" |
| src/domain/recurring-rules.ts:112 | Remove dialog body `Remove Quincy Smith? This deletes the expense and 2 attached files.` | `This moves the Quincy Smith expense and its 2 attached files to the trash. You can restore it from there.` | **Was false.** Remove now moves the expense to the trash (soft delete, files kept); the dialog still said it deleted them. Also repeated the title's question |
| src/domain/recurring-rules.ts:124 | `Enter an amount.` (shown for $0.00) | `Enter an amount other than $0.00.` | The person did enter an amount |
| src/modules/recurring/actions.ts:62 | `That funding source is archived.` | `That funding source is archived. Unarchive it in Settings to save recurring items on it.` | Says what to do; existing pattern |
| src/modules/recurring/actions.ts:157 | `That funding source is archived.` | `That funding source is archived. Unarchive it in Settings to add expenses to it.` | Same |

#### Expense server messages (`src/modules/expenses/actions.ts`)

| Where | Before | After | Why |
|---|---|---|---|
| actions.ts:238 | `That funding source is archived.` (new expense) | `That funding source is archived. Unarchive it in Settings to add expenses to it.` | Says what to do; existing pattern |
| actions.ts:402 | `That funding source is archived.` (moving an expense) | `That funding source is archived. Unarchive it in Settings to move expenses into it.` | Same |

#### Other files in my list

| Where | Before | After | Why |
|---|---|---|---|
| download-button.tsx:37 | fallback toast `That download is not available right now.` | `That download isn't available right now. Try again, and if it keeps failing, contact support at tech@teampursuit.org.` | Rule 3 |
| download-button.tsx:52 | `Download failed — check your connection and try again.` | `The download failed. Check your connection and try again.` | |
| src/domain/line-item-rules.ts:57 | Delete line item dialog `Its name and budget figures are deleted. This cannot be undone.` | `Its name and budget figures will be deleted. This can't be undone.` | It is a confirmation, so the future tense fits |
| src/domain/name.ts:14 | `That name is too long.` | `That name is too long. Use 120 characters or fewer.` | Says what to do |

Left as they are, on purpose: the `app/api/files/read-amounts` route's errors (the client turns every failure into "No amount found", so they never reach a screen), `MISSING` in the list (R4.4's red marker), `missing both` (legacy R4.4 phrase), `Ref / Date` (two stacked labels), `Unknown document kind.` (unreachable from the app), and `That file is already gone.` / `That expense is already gone.` (plain, and `src/modules/packet/actions.ts` uses the same words).

### 9.2 Month end (Dashboard, Cover Sheets, Month-End Packet, Contract Summary, Line Items, monthly summary, packet text)

#### Dashboard

| Where | Before | After | Why |
|---|---|---|---|
| app/r/page.tsx:59 | No active funding sources — add one in Settings. | No active funding sources. Add one in Settings. | |
| app/r/source-budget-section.tsx:53 | These categories now differ from it: | These line items now differ from it: | One name per thing: the rows are line items |
| app/r/source-budget-section.tsx:63 | Opening balance — submitted at $X, now $Y (+$Z) | Opening balance: submitted at $X, now $Y (+$Z) | |
| app/r/source-budget-section.tsx:96 | The whole grant to date, across every month — 45.2% of the approved budget committed. | These totals cover the whole grant to date, across every month: 45.2% of the approved budget is committed. | Was a fragment; now a full sentence |
| app/r/source-budget-section.tsx:104 | No line items yet — set up your budget in Line Items. | No line items yet. Set up your budget in Line Items. | |

#### Month-End Packet

| Where | Before | After | Why |
|---|---|---|---|
| app/r/packet/page.tsx:169 | No line items yet — set up your budget in Line Items. | No line items yet. Set up your budget in Line Items. | |
| app/r/packet/page.tsx:181 | Records (column header) | Expenses | One name per thing ("records" only in canonical text) |
| app/r/packet/page.tsx:202 | — (line item with no expenses) | - | Empty cell |
| app/r/packet/page.tsx:207 | Grand Total | Total | Sentence case; matches the "Total" row of Packet contents on the same page |
| app/r/packet/packet-download-buttons.tsx:134 | Download Packet (PDF) | Download packet (PDF) | Sentence case for buttons |
| app/r/packet/packet-download-buttons.tsx:142 | Download Summary (Excel) | Download summary (Excel) | Sentence case for buttons |
| app/r/packet/packet-download-buttons.tsx:119 | {name} restored (toast) | {name} restored. | Toasts end with a period |
| app/r/packet/packet-download-buttons.tsx:194 | {n} expenses were deleted from this reporting period. Restore anything that shouldn't have gone, or continue if the rest were intentional. | {n} expenses were deleted from this month. Restore any that were deleted by mistake, then continue. | Matches the dialog title ("Deleted from this month"); plainer |
| app/r/packet/packet-download-buttons.tsx:204 | Payroll — $1,200.00 — deleted 9/1/2026 | Payroll · $1,200.00 · deleted 9/1/2026 | |
| app/r/packet/month-documents.tsx:76 | That file could not be uploaded. | That file couldn't be uploaded. Try again. | Say what to do |
| app/r/packet/month-documents.tsx:87 | Upload failed — check your connection and try again. | Upload failed. Check your connection and try again. | |
| app/r/packet/month-documents.tsx:134 | Operating account — statement.pdf | Operating account · statement.pdf | |
| app/r/packet/month-documents.tsx:138 | · 3 page(s) | · 3 pages (· 1 page) | Real plural |
| app/r/packet/month-documents.tsx:150 | **X** is deleted from March 2026 and will no longer appear in the packet. You would have to upload it again. | **X** will be deleted from March 2026 and won't appear in the packet. To get it back, you'd have to upload it again. | Confirmation describes what will happen, in future tense |
| app/r/packet/submitted-marker.tsx:53 | This also discards the figures captured when the month was marked submitted, which are what later changes are compared against. Marking it submitted again captures the month as it stands then, not as it stood before. | This also discards the figures saved when the month was marked as submitted, which later changes are compared against. If you mark it as submitted again, the figures are saved as they stand at that time, not as they stood before. | Clearer, same meaning |
| src/modules/packet/actions.ts:36 | That funding source is archived. | That funding source is archived. Unarchive it in Settings to remove documents. | Say what to do (Unarchive is in Settings) |

#### Cover Sheets

| Where | Before | After | Why |
|---|---|---|---|
| app/r/cover-sheets/page.tsx:58, :88, :108 | Breakdown documents for March 2026. | Cover sheets for March 2026, one for each line item. | One name per thing (cover sheet) |
| app/r/cover-sheets/page.tsx:90 | No line items yet — set up your budget in Line Items. | No line items yet. Set up your budget in Line Items. | |
| app/r/cover-sheets/line-item-select.tsx:44 | All Line Items | All line items | Sentence case; the cover sheets tour already says "All line items" |
| app/r/cover-sheets/cover-sheet-preview.tsx:110 | proof of payment missing | Proof of payment missing | Sentence case (screen-only placeholder) |
| app/r/cover-sheets/cover-sheet-proofs.tsx:52 | receipt.pdf — every page appears in the downloaded document | receipt.pdf (every page appears in the downloaded document) | |

#### Contract Summary

| Where | Before | After | Why |
|---|---|---|---|
| app/r/contract-summary/page.tsx:96 | No line items yet — set up your budget in Line Items. | No line items yet. Set up your budget in Line Items. | |
| app/r/contract-summary/page.tsx:205 | Download Summary (Excel) | Download summary (Excel) | Sentence case; same label as the packet page |
| app/r/contract-summary/page.tsx:265 | — (reporting period with no details) | - | Empty cell |

#### Line Items

| Where | Before | After | Why |
|---|---|---|---|
| app/r/line-items/line-items-manager.tsx:94 | Something went wrong. (fallback error) | That change couldn't be saved. Try again. | Vague error |
| app/r/line-items/line-items-manager.tsx:212 | Something went wrong. (fallback on delete) | The line item couldn't be deleted. Try again. | Vague error |
| app/r/line-items/line-items-manager.tsx:135, 145, 178, 183, 211, 464, 600 | Performance saved / Order updated / Performance added / Performance removed / Line item deleted / Line item saved / Line item added (toasts) | Same, each ending with a period | Toasts end with a period |
| app/r/line-items/line-items-manager.tsx:228 | Manage — Salary (dialog title) | Manage Salary | |
| app/r/line-items/line-items-manager.tsx:328 | — (performance with no date) | - | Empty cell |
| app/r/line-items/line-items-manager.tsx:347 | Part of the contract value. Delete and re-add to change. | Part of the contract value. To change it, delete it and add it again. | "re-add" is jargon |
| app/r/line-items/line-items-manager.tsx:387 | $500.00 is removed from Salary's Scheduled Value. This cannot be undone. | $500.00 will be removed from Salary's scheduled value. This can't be undone. | Confirmation in future tense; the field is labeled "Scheduled value" |
| app/r/line-items/line-items-manager.tsx:518 | — (no performances) | - | Empty cell |
| src/modules/line-items/actions.ts:80 | That funding source is archived. | That funding source is archived. Unarchive it in Settings to add line items. | Say what to do |
| src/modules/line-items/actions.ts:190, :200 | That list is out of date — reload the page. | This list is out of date. Reload the page and try again. | |

#### Monthly summary

| Where | Before | After | Why |
|---|---|---|---|
| app/r/monthly-summary/page.tsx:13 | Monthly Summary \| Stay Funded 360 (browser tab) | Monthly summary \| Stay Funded 360 (now `pageTitle(UI.summaryTitle)`) | Matches the screen's own heading; not a tab name, so sentence case |
| app/api/downloads/monthly-summary/route.ts:63 | No summary for this month | There is no summary for March 2026 yet. (reuses `UI.summaryNotFound`) | Same message the save action already uses |

#### Downloads and errors (shown as toasts or in the share dialog)

| Where | Before | After | Why |
|---|---|---|---|
| src/modules/packet/month-output.ts:124 | 1 record is missing documentation: • … | 1 expense is missing documentation: • … | One name per thing. Also shown by Share link and Update shared file |
| app/api/downloads/cover-sheet/route.ts:92 | 1 record is missing documentation: • … | 1 expense is missing documentation: • … | Same |
| src/modules/packet/month-output.ts:170 | The summary could not be generated just now. Please try again — if it keeps failing, contact Mantaq. | The summary couldn't be generated. Try again, and if it keeps failing, contact support at tech@teampursuit.org. | No internal words; rule 3's own example |
| src/modules/packet/month-output.ts:174 | Packet generation failed at {part}. Please try again — if it keeps failing, contact Mantaq. | The packet couldn't be generated. It failed at {part}. Try again, and if it keeps failing, contact support at tech@teampursuit.org. | Same |
| src/modules/packet/month-output.ts:175 | The packet could not be generated just now. Please try again — if it keeps failing, contact Mantaq. | The packet couldn't be generated. Try again, and if it keeps failing, contact support at tech@teampursuit.org. | Same |
| app/api/downloads/cover-sheet/route.ts:141 | The Salary cover sheet could not be generated just now. Please try again — if it keeps failing, contact Mantaq. | The Salary cover sheet couldn't be generated. Try again, and if it keeps failing, contact support at tech@teampursuit.org. | Same |
| app/api/downloads/{packet,summary,cover-sheet,monthly-summary}/route.ts (the 401 line, :26 to :35) | Not signed in | You've been signed out. Sign in and try again. | The realistic case (session expired) shows this as a toast; say what to do |

The support address comes from `UI.supportEmail`, so the pending support-email decision still changes one constant.

#### Packet PDF (DOC: the City sees these)

| Where | Before | After | Why |
|---|---|---|---|
| src/generation/packet-index-pdf.ts:205 `DOC` | 12 expenses · every receipt, invoice and proof of payment in this packet is filed under its reference below | 12 expenses. Every receipt, invoice and proof of payment in this packet is filed under its reference below. | Two sentences; " · " is the screen separator. Same width on the page |
| src/generation/packet-index-pdf.ts:264 `DOC` | These expenses carry no supporting document, for the reason stated: | Expenses with no receipt available: | Plainer. The old line could be false: a no-receipt expense may still have supporting documents. Each line under it already says "no receipt available. Reason: …" |
| src/domain/contract-context.ts:92 `DOC` | Contract 6007211  ·  Contract total: $940,000.00  ·  Base PO 3086984  ·  … | Contract 6007211  \|  Contract total: $940,000.00  \|  Base PO 3086984  \|  … | Rule 1: documents use bars. Only the packet summary page prints this line; the Contract Summary screen lays the items out separately **Reverted by Awais (§11 Q7): the line keeps its middle dots.** |

"This month has no expenses." (index and packet page) is already good and is unchanged. The Excel summary is unchanged, so it stays `summary-3`.

#### Deliberately left alone

- **Table headers** (`<Th>`: "Line Item", "Opening Balance", "Amount This Month", "Documentation Complete" and the rest): they render in uppercase through CSS, so case changes wouldn't show. The packet tour's step title quotes "Documentation Complete". The Contract Summary headers mirror the City's workbook.
- "That file is already gone." (packet actions): plain and correct. Reviewer A's expense actions use the same words.
- Route guard bodies that only a hand-edited URL can reach ("Unknown month", "Unknown funding source", "Not found", "Unknown format", "Cross-site downloads are not allowed"). The integration tests pin them.
- "Unknown" for a deleted user in the lock history and shared links (D-89 chose this literal).
- "Assembling…" on the packet button, and "That file is larger than 25 MB once converted for storage. Upload a smaller export." in `lock.ts`.

### 9.3 Account, Settings, staff admin, app shell

#### Sign in, sign up, onboarding

| Where | Before | After | Why |
|---|---|---|---|
| app/(auth)/signup/page.tsx:25 | This system is set up for a single organization. Contact Mantaq if you need access. | This app is set up for a single organization. If you need access, contact support at {UI.supportEmail} (mailto link). | No internal names; support via `UI.supportEmail`, and says what to do |
| app/(auth)/onboarding/contract/page.tsx:21 | This appears on the summary sheet you send for review. | These details appear on the summary sheet you send for review. | "This" had no clear subject |
| src/modules/auth/actions.ts:208 | You are already signed in. Log out first to create another organization. | You are already signed in. Sign out first to create another organization. | Rule 5: "Sign out" |
| src/modules/auth/actions.ts:218 | You are signed in as AB Solutions staff. Log out first to create an organization. | You are signed in as AB Solutions staff. Sign out first to create an organization. | Rule 5: "Sign out" (staff-sign-in test still matches /AB Solutions staff/) |
| src/modules/auth/actions.ts:300, :358 | Onboarding is already complete. | Your organization is already set up. | "Onboarding" is jargon; matches the "Finish setup" button |

#### App shell and error pages

| Where | Before | After | Why |
|---|---|---|---|
| app/r/layout.tsx:76 | Log out | Sign out | Rule 5 |
| app/r/error.tsx:21 | DangerPanel title "This screen failed to load." | (panel title removed) | Repeated the subtext directly above it |
| app/r/error.tsx:23 | Try again. If it keeps happening, contact Mantaq with the time this occurred. | Try again. If it keeps happening, contact support at {UI.supportEmail} and say what time it happened. | No internal names; support via `UI.supportEmail` |
| src/lib/action-result.ts:33 (`SESSION_EXPIRED`, shown on every form and toast when the sign-in has lapsed) | Signed out — sign in and resubmit. | You've been signed out. Sign in again, then resubmit. | Full sentences |
| src/lib/json-request.ts:77 (401 body of the summary write and sharing routes; the summary editor shows it) | Not signed in. | `SESSION_EXPIRED` (the line above) | Same situation, same words as the server actions |

#### Settings: organization, funding sources, lists

| Where | Before | After | Why |
|---|---|---|---|
| app/r/settings/settings-sections.tsx:51 (sidebar) | Funding Sources | Funding sources | Rule 6: sentence case |
| app/r/settings/settings-sections.tsx:53 (sidebar) | Vendor Library | Vendor library | Rule 6; the section heading already said "Vendor library" |
| app/r/settings/settings-sections.tsx:228 (toast, the read-amounts switch) | Organization saved | Setting saved. | Names what changed; rule 7 |
| app/r/settings/settings-sections.tsx:295 (toast) | Organization saved | Organization saved. | Rule 7 |
| app/r/settings/settings-sections.tsx:321 (heading) | Funding Sources | Funding sources | Rule 6 |
| app/r/settings/settings-sections.tsx:352 (Lists helper) | Payment sources are only how something was paid — "Paid by us", "Paid directly by fiduciary". Tax and fee reimbursement rules now live on each funding source, in the Funding Sources section. Renames apply to menus going forward; saved expenses keep the label they were entered with, which is what keeps their documents reproducible. | A payment source only records how something was paid, such as "Paid by us" or "Paid directly by fiduciary". Tax and fee reimbursement rules are set on each funding source, in the Funding sources section. Renamed labels show in menus from now on. Saved expenses keep the label they were saved with, so their documents stay the same. | "Reproducible" is jargon; run-on split |
| app/r/settings/settings-sections.tsx:400 (App guide helper) | …use the (i) button next to Log out to replay… | …use the (i) button next to Sign out to replay… | Matches the renamed button |
| app/r/settings/settings-sections.tsx:409 (toast) | App guide will show again | The app guide will show again. | Rule 7 |
| app/r/settings/settings-sections.tsx:448 (contract period tile) | 3/1/2026 – 3/31/2026 | 3/1/2026 to 3/31/2026 | |
| app/r/settings/settings-sections.tsx:589 (toasts) | Funding source added / Funding source saved | Funding source added. / Funding source saved. | Rule 7 |
| app/r/settings/settings-sections.tsx:669 (toast) | Funding source unarchived | Funding source unarchived. | Rule 7 |
| app/r/settings/settings-sections.tsx:679 (toast) | Funding source archived | Funding source archived. | Rule 7 |
| app/r/settings/settings-sections.tsx:787 (helper) | Leave blank to use the organization's document name. | Leave blank to use the organization's document display name. | Names the field by its label on the Organization section |
| app/r/settings/settings-sections.tsx:838 (helper) | Leave at 0.00 to use the sum of scheduled values. | Leave at 0.00 to use the total of the line items' scheduled values. | Says whose scheduled values |
| app/r/settings/settings-sections.tsx:878 (checkbox) | Does this funder reimburse sales tax? | This funder reimburses sales tax | A checkbox label states what is true when checked |
| app/r/settings/settings-sections.tsx:889 (checkbox) | Does this funder reimburse fees? | This funder reimburses fees | Same |
| app/r/settings/settings-sections.tsx:954 (toast) | Label saved | Payment source saved. / Document type saved. | Names the thing; "label" is internal |
| app/r/settings/settings-sections.tsx:976 (toasts) | Deactivated / Reactivated | Payment source deactivated. / Document type reactivated. (and the other two pairs) | Names the thing; rule 7 |
| app/r/settings/settings-sections.tsx:1001 (placeholder) | New label | New payment source / New document type | Names the thing |
| app/r/settings/settings-sections.tsx:1010 (toast) | Added | Payment source added. / Document type added. | Names the thing; rule 7 |
| src/modules/settings/actions.ts:71 | Enter a label. | Enter a name. | "Label" is internal |
| src/modules/settings/actions.ts:81 | That label already exists. | That payment source already exists. / That document type already exists. | Names the thing |
| src/modules/funding-sources/actions.ts:103 | This figure cannot be negative. | Advances received cannot be negative. | Says which figure (the toast has no field next to it) |
| src/modules/funding-sources/actions.ts:115 | The contract ends before it starts. | The contract end date is before the start date. | Names the fields to fix |

#### Settings: vendor library

| Where | Before | After | Why |
|---|---|---|---|
| app/r/settings/settings-sections.tsx:1052, app/r/settings/vendors/vendor-library-full.tsx:96 | No vendors learned yet — they appear as you save expenses. | No vendors learned yet. They appear as you save expenses. | |
| app/r/settings/vendor-table.tsx:70, :139, :169, :182 (empty cells) | — | - | |
| app/r/settings/vendor-table.tsx:164 (option suffix) | (retired) | (deactivated) | One name: the Lists buttons say Deactivate/Reactivate, and the settings tour now says "Deactivate" |
| app/r/settings/vendor-table.tsx:193 (placeholders) | subtotal / tax / fees | Subtotal / Tax / Fees | Capitalized like every other field |
| app/r/settings/vendor-table.tsx:224 (toast) | Vendor saved | Vendor saved. | Rule 7 |
| app/r/settings/vendor-table.tsx:247 (delete dialog) | {name} and everything remembered about it — line item, description, payment source and amounts — are deleted. | {name} and everything remembered about it (line item, description, payment source and amounts) will be deleted. | A confirm question describes what will happen |
| app/r/settings/vendor-table.tsx:252 (toast) | Vendor removed | Vendor deleted. | One name: the button and dialog say Delete |
| app/r/settings/vendors/vendor-library-full.tsx:103 (pager) | 21–40 of 45 | 21 to 40 of 45 | |

#### Settings: users and password

| Where | Before | After | Why |
|---|---|---|---|
| app/r/settings/users/page.tsx:26 | Everyone signed in under this organization. | Everyone who can sign in to this organization. | Read as "currently signed in" |
| app/r/settings/users/users-manager.tsx:45 | Hand it over out of band. It cannot be shown again. | Give it to the user yourself, for example by text. It can't be shown again. | "Out of band" is jargon; example matches the sharing dialog's "for example by text" |
| app/r/settings/users/users-manager.tsx:115 (toast) | Name updated | Name updated. | Rule 7 |
| app/r/settings/users/users-manager.tsx:161 (toast) | Password reset | Password reset. | Rule 7 |
| app/r/settings/users/users-manager.tsx:168 (button) | Set password | Reset password | The admin doesn't choose it; one name with the toast "Password reset." |
| app/r/settings/users/users-manager.tsx:210 (toast) | User added | User added. | Rule 7 |
| app/r/settings/settings-sections.tsx:1143 (toast) | Password changed — other devices signed out | Password changed. Your other devices were signed out. | Full sentences |

#### Staff admin (/a)

| Where | Before | After | Why |
|---|---|---|---|
| app/a/layout.tsx:29 | Log out | Sign out | Rule 5 |
| app/a/page.tsx:22 (tab title) | Organizations — AB Solutions admin | Organizations \| AB Solutions admin | |
| app/a/orgs/[id]/page.tsx:28 (tab title) | {name} — AB Solutions admin / Organization — AB Solutions admin | {name} \| AB Solutions admin / Organization \| AB Solutions admin | |
| app/a/orgs/[id]/page.tsx:293, :294, :298 (History lines) | {date} – {event} – {note} | {date} · {event} · {note} | |

#### Landing (dashes only)

| Where | Before | After | Why |
|---|---|---|---|
| src/modules/landing/landing-page.tsx:384 | 4–6 Wk Payment Holds | 4 to 6 Wk Payment Holds | |

#### Operator and log text (dashes only)

| Where | Before | After | Why |
|---|---|---|---|
| instrumentation.ts:51 | `  NAME — why` | `  NAME: why` | |
| instrumentation.ts:60 | Refusing to start: APP_URL is unusable — {problem}. | Refusing to start: APP_URL is unusable ({problem}). | |
| src/lib/site-url.ts:42 | APP_URL is unusable in production — {problem}. | APP_URL is unusable in production: {problem}. | |
| src/services/auth/tokens.ts:62 | AUTH_SECRET must be set in production — it keys… | AUTH_SECRET must be set in production. It keys… | |
| src/services/client-ip.ts:58 | TRUSTED_PROXY_HOPS must be set in production — without it login… | TRUSTED_PROXY_HOPS must be set in production. Without it, login… | |
| src/db/index.ts:18 | DATABASE_URL is not set — copy .env.example to .env.local | DATABASE_URL is not set. Copy .env.example to .env.local. | |
| src/db/backup-fetch.ts:34 | …custom-format archive — refusing to pipe it. | …custom-format archive. Refusing to pipe it. | |
| src/db/backup-upload.ts:54 | No dump received on stdin — did pg_dump fail? … | No dump received on stdin. Did pg_dump fail? … | |
| src/db/backup-upload.ts:59 | Nothing was uploaded — check the pg_dump command uses -Fc. | Nothing was uploaded. Check the pg_dump command uses -Fc. | |
| src/db/create-staff.ts:48 | No STAFF_EMAIL configured — no staff account to create. | No STAFF_EMAIL configured, so there is no staff account to create. | |
| src/db/create-staff.ts:101 | …already exists — left unchanged. | …already exists. Left unchanged. | |
| src/db/create-staff.ts:152, src/db/reset-password.ts:82, :108 | (shown once — hand it over out of band) | (shown once, hand it over out of band) | |
| src/db/seed.ts:69 | …in production — the development default is… | …in production. The development default is… | |
| src/db/seed.ts:94 | Organisation already seeded ({id}) — refreshing configuration. | Organisation already seeded ({id}). Refreshing configuration. | |
| src/db/dev-fixture.ts:51, :52 (dev fixture expense names) | Payroll — Pay Period 1 / 2 | Payroll - Pay Period 1 / 2 | Hyphen keeps the typed-name shape |
| src/db/dev-fixture.ts:161, :276, :304, :311 | … — run … / … — nothing to do. | … . Run … / … . Nothing to do. | |

### 9.4 Shared wording and the guided tours

#### Sign in and sign up

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:137 | `An organization with that email already exists — sign in instead.` | `An organization with that email already exists. Sign in instead.` | §12 |

#### Add Expense and Edit Expense

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:135 | `Upload failed — try again.` | `Upload failed. Try again.` | §12. Also shown on the lock upload (Month-End Packet). |
| src/domain/strings.ts:142 | `Please enter a name, choose a line item, and choose a payment source.` | `Enter a name, choose a line item, and choose a payment source.` | "Please" only for real effort (rule 3); matches its neighbours ("Choose a funding source.") |
| src/domain/strings.ts:151 | `Saved — still missing proof of payment.` | `Expense saved. It's still missing proof of payment.` | Toast; the other branch of the same toast says "Expense saved." |
| src/domain/strings.ts:154 | `Tax is more than the subtotal — double-check this entry.` | `Tax is more than the subtotal. Double-check this entry.` | §12 |
| src/domain/strings.ts:157 | `Subtotal is $0.00 — double-check this entry.` | `Subtotal is $0.00. Double-check this entry.` | §12 |
| src/domain/strings.ts:360 | `That document has {pages} pages — only the first {limit} would be read. Enter the amounts yourself.` | `That document has {pages} pages. Amounts can only be read from documents of up to {limit} pages. Enter the amounts yourself.` | The route refuses the whole file; "would be read" read as if part of it was |
| src/domain/strings.ts:366 | `The amounts on this receipt don't add up. Please check them.` | `The amounts on this receipt don't add up. Check them before saving.` | "Please" rule; now says when, like the proofs warning next to it ("Check the amounts before saving.") |

#### Month lock (Month-End Packet, Contract Summary)

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:177 | `Unlocked {date} by {name} — "{reason}"` | `Unlocked {date} by {name}: "{reason}"` | §12. ": " because the reason explains the unlock (brief's label/detail rule) |

#### Cover Sheets and Contract Summary

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:127 | `Downloads unavailable for this line item.` | `This cover sheet cannot be downloaded yet.` | §12. Was a fragment; now worded like the packet's own panel title ("This packet cannot be downloaded yet.") |
| src/domain/strings.ts:648 (`downloadBlockedReason`) | `Blocked — {n} record(s) is/are missing documents. See Month-End Packet.` | `Blocked: {n} expense(s) is/are missing documentation. See the Month-End Packet tab.` | "Expense", not "record" (rule 5; this one isn't §12). "Documentation" matches the Expenses banner (reviewer A), and a missing narrative isn't a document. Names the tab as a tab. |

#### Monthly summary

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:424 | `A summary for {month} is already being written.` | `A summary for {month} is already being written. Wait for it to finish, then reload the page.` | Says what to do (rule 3) |
| src/domain/strings.ts:428 | `The summary couldn't be written right now. Please try again.` | `The summary couldn't be written right now. Try again.` | "Please" rule |
| src/domain/strings.ts:433 | `Too many summaries at once. Try again shortly.` | `Too many summaries were written in the past hour. Try again later.` | The limit is 30 per hour per organization, not "at once" |
| src/domain/strings.ts:444 | `Pick a funding source to write its monthly summary.` | `Choose a funding source to write its monthly summary.` | The app says "Choose a funding source" everywhere else |
| src/domain/strings.ts:453 | `Writing your summary… this can take up to a minute.` | `Writing your summary… This can take up to a minute.` | Capital after the ellipsis |
| src/domain/strings.ts:494 | `The summary couldn't be prepared right now. Please try again.` | `The summary couldn't be prepared right now. Try again.` | "Please" rule |

#### Sharing (Month-End Packet, and the public `/s/` pages)

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:545 | `Link copied` | `Link copied.` | §12. Toasts end with a period (rule 7); "Summary copied." already does |
| src/domain/strings.ts:577 | `That file is already shared.` | `That file is already shared. Reload the page to see its link.` | Says what to do (the Shared links list shows it after a reload) |
| src/domain/strings.ts:579 | `This file is already being prepared.` | `This file is already being prepared. Wait for it to finish, then reload the page.` | Says what to do |
| src/domain/strings.ts:587 | `Couldn't reach the server — check your connection and try again.` | `Couldn't connect. Check your internet connection and try again.` | "server" is an internal word |
| src/domain/strings.ts:589 | `Something went wrong. Please try again — if it keeps failing, contact Mantaq.` | `The file couldn't be shared. Try again, and if it keeps failing, contact support at tech@teampursuit.org.` | No "Mantaq"; says what failed (it's only used by the create and update share routes); built from `SUPPORT_EMAIL` |
| src/domain/strings.ts:603 | `Too many requests. Please wait a few minutes and try again.` | `Too many files opened in a short time. Please wait a few minutes and try again.` | "requests" is an internal word. The limit is per visitor address across all files, so it doesn't say "this file". "Please" kept: an outside reader sees it, next to the canonical "Too many tries. Please wait…" |

#### Shared by several screens

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:414 | `That request couldn't be completed. Reload the page and try again.` | `That couldn't be completed. Reload the page and try again.` | "request" is an internal word |

#### Staff screens (`/a`)

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:505 | `at least: some runs ran before prices were set on the server` | `a minimum: some runs happened before prices were set` | "ran… ran", and "server" is an internal word. Shown after " · " in the cost tile caption |

#### Tours: Add Expense (text lives in `strings.ts`)

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:372 | `Enter the amounts from the receipt. If there's tax or fees, you'll be asked whether the funder pays for them.` | `Enter the amounts from the receipt. If it includes tax or fees, you'll be asked whether the funder pays for them.` | "there's … fees" is ungrammatical |
| src/domain/strings.ts:375 | `Enter the amounts from the receipt, or use the amounts we find in the receipt you added above. If there's tax or fees, …` | `Enter the amounts from the receipt, or use the ones AI finds in the receipt you added above. If it includes tax or fees, …` | Grammar as above; "AI", as every other Plus step says, not "we" |
| src/domain/strings.ts:395 | `… If there isn't one, tick No receipt available and give a reason. …` | `… If there isn't one, check No receipt available and give a reason. …` | "check", never "tick" (rule 2) |
| src/domain/strings.ts:400 | `… If there isn't a receipt, tick No receipt available and give a reason. …` | `… If there isn't a receipt, check No receipt available and give a reason. …` | Same |

#### Tours: Settings (read-amounts step text lives in `strings.ts`)

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts:404 | `… When it's on, receipts and proofs of payment added to an expense are read by AI to suggest the amounts. …` | `… When it's on, AI reads the receipts and proofs of payment added to an expense and suggests the amounts. …` | Active voice, shorter |
| src/modules/tours/settings-tour.ts:23 | `Six sections, switched instantly without changing the page — refreshing or sharing a link won't keep the same one open.` | `Switch between sections here. Refreshing the page or opening a shared link starts again on Organization.` | A manager sees five sections, not six; says what actually happens |
| src/modules/tours/settings-tour.ts:29 | `This name, not the organization name above it, is what prints on cover sheets and the packet — unless a funding source overrides it.` | `Cover sheets and the packet print this name, not the organization name above it. A funding source can set its own instead.` | Two sentences |
| src/modules/tours/settings-tour.ts:43 | `… Archive one instead of deleting it — its history stays intact and viewable.` | `… Archive one you no longer use. Its history stays intact and can still be viewed.` | A funding source can't be deleted, so there's no "instead of deleting" |
| src/modules/tours/settings-tour.ts:48 (title) | `Payment sources & document types` | `Payment sources and document types` | "and", not "&", in a title |
| src/modules/tours/settings-tour.ts:49 | `These labels appear throughout the app — on the expense form, filters, and printed documents. Retire one instead of deleting it once it's ever been used, so past expenses keep the label they were entered with.` | `These labels appear on the expense form, in filters and on printed documents. Deactivate one you no longer use. Past expenses keep the label they were entered with.` | Labels can't be deleted, and the button says "Deactivate", not "Retire" |
| src/modules/tours/settings-tour.ts:55 | `Every vendor you've billed before, remembered here. Typing a name on the expense form pulls its usual line item and payment source from this list automatically.` | `Every vendor you've used before is remembered here. Type a vendor's name on the expense form and its usual line item and payment source fill in automatically.` | A vendor bills you, you don't bill it; "used" matches the Add Expense Name step; full sentence |
| src/modules/tours/settings-tour.ts:61 | `Everyone with access to this organization's data. Only an admin can add, remove, or change another user's role.` | `Everyone with access to this organization's data. Only an admin can add users, edit their names or set their passwords.` | **Meaning fix:** the screen can't remove users or change roles (its only actions are Add, Edit name, Set password). See Questions |
| src/modules/tours/settings-tour.ts:67 | `Bring back every walkthrough at once from here — or use the (i) button next to Log out to replay just the one for the screen you're on.` | `Bring back every walkthrough from here. To replay just the one for the screen you're on, use the (i) button next to Sign out.` | "Sign out" (reviewer C renames the button) |

#### Tours: other tabs

| Where | Before | After | Why |
|---|---|---|---|
| src/modules/tours/dashboard-tour.ts:15 | `… Pick one, or choose All to see them side by side.` | `… Pick one, or choose All funding sources to see them side by side.` | The option is called "All funding sources" |
| src/modules/tours/dashboard-tour.ts:19 (title) | `Closing Balance` | `Closing balance` | Sentence case (the column header is uppercase by CSS, so it still matches) |
| src/modules/tours/expenses-tour.ts:13 | `Search, and filter by line item, documentation status or payment source — they combine, so narrowing one keeps the others in effect.` | `Search, and filter by line item, documentation or payment source. Filters work together, so changing one keeps the others in place.` | Matches the filter labels ("Filter by documentation") |
| src/modules/tours/expenses-tour.ts:24 | `Open the ⋮ menu on a row to edit it, delete it, or — for admins — see its full history.` | `Open the ⋮ menu on a row to edit or delete it. Admins can also see its full history.` | |
| src/modules/tours/cover-sheets-tour.ts:10 | `See one line item's cover sheet, or All line items to view every one stacked together.` | `See one line item's cover sheet, or choose All line items to see them all on one page.` | The sentence was missing its verb |
| src/modules/tours/cover-sheets-tour.ts:20 | `This is exactly what downloads — the same figures, in the same order, as the Word and PDF versions.` | `This is exactly what downloads: the same figures, in the same order, as the Word and PDF files.` | |
| src/modules/tours/packet-tour.ts:18 (title) | `Documentation Complete` | `Documentation complete` | Sentence case (the column header is uppercase by CSS) |
| src/modules/tours/contract-summary-tour.ts:15 | `A separate figure from the totals above — this tracks advance payments received against what's been reconciled so far.` | `This is separate from the totals above. It tracks advance payments received against what's been reconciled so far.` | |
| src/modules/tours/line-items-tour.ts:10 | `This order isn't just cosmetic — it's the order line items print in on cover sheets, the packet, and the dashboard.` | `This order matters. Line items appear in it on cover sheets, the packet and the dashboard.` | Shorter; "cosmetic" is a vaguer word for the same point |
| src/modules/tours/line-items-tour.ts:15 | `Manage opens both the line item's own fields and its performances — milestone billing amounts — in one place.` | `Manage opens the line item's own fields and its performances (milestone billing amounts) in one place.` | |
| src/modules/tours/line-items-tour.ts:21 | `Once a performance is saved, its amount can't always be edited in place — delete and re-add it if the amount needs to change.` | `A saved performance's amount can't always be edited. If it needs to change, delete the performance and add it again.` | |
| src/modules/tours/recurring-tour.ts:21 | `Added items still need their proof of payment. Open each one from the Expenses tab to attach it.` | `Each added expense still needs its proof of payment. Open it on the Expenses tab to attach it.` | "Expense", not "item" (rule 5): once added, it is an expense |

#### Left as they are, on purpose

- `UI.blockedIntro` ("records", canonical), `UI.supportEmail`, `SUMMARY_SECTION_TITLES` (the summary checker compares against them).
- `Balance to Finish` in the Contract Summary step names the Excel column, which the City approved.
- All other `UI` entries read well where they are used and were left alone.

### 9.5 Reconciled across areas (lead)

| Where | Before (as the reviewers left it) | After | Why |
|---|---|---|---|
| src/lib/action-result.ts `SESSION_EXPIRED` | You've been signed out. Sign in again, then resubmit. | You've been signed out. Sign in and try again. | One wording for being signed out, everywhere |
| app/api/downloads/{packet,summary,cover-sheet,monthly-summary}/route.ts, app/api/files/upload/route.ts, app/api/files/read-amounts/route.ts (401) | Three spellings ("You've been signed out. Sign in and try again.", "You're signed out. …", "Not signed in.") | `SESSION_EXPIRED` | The same message from one constant |
| app/api/files/[id]/route.ts (401, shown in a browser tab) | You're signed out. Sign in and open the file again. | You've been signed out. Sign in and open the file again. | Same opening as every other signed-out message |
| src/modules/expenses/expense-form.tsx (payment source option) | (retired) | (deactivated) | Settings says Deactivate; the vendor table already says "(deactivated)" |
| src/modules/expenses/queries.ts `deletedItemsRefusal` | 1 expense was deleted from this reporting period and has not been confirmed: | 1 expense was deleted from this month and hasn't been confirmed: | Matches the packet's "Deleted from this month" dialog |
| src/modules/tours/settings-tour.ts (Users step) | …or set their passwords. | …or reset their passwords. | The button is now "Reset password" |
| src/modules/landing/landing-page.tsx (badge, dashes only) | 4 to 6 Wk Payment Holds | 4-6 Wk Payment Holds | "4 to 6 Wk" read badly in a badge; the landing page isn't reviewed for copy |

### 9.6 Fixed after the adversarial review (lead)

| Where | Before | After | Why |
|---|---|---|---|
| src/domain/strings.ts `shareUpdateUnexpected` (new), route-failure.ts, `postShareRoute` | A failed Update shared file said "The file couldn't be shared." | "The shared file couldn't be updated. The link still gives the older file. Try again, and if it keeps failing, contact support at …" | The old words could make someone think the City's link was gone |
| src/modules/expenses/expense-form.tsx (payment source option) | (deactivated) | (no longer in use) | It also shows for a renamed label, which nobody deactivated |
| expense-form.tsx, expenses-table.tsx, trash-table.tsx (delete dialogs) | "…with its 0 attached files…" / "…with its files…" | The files are mentioned only when there are some | Recurring expenses start with none |
| expense-form.tsx (a file fails to upload after the expense is saved) | The message was set on a form that unmounts on the way to Edit, so it never showed | A toast: "{file}: {error} The expense was saved. Add the file again below." | The user landed on Edit with no explanation (it was already like this before) |
| src/modules/tours/settings-tour.ts | …opening a shared link starts again on Organization. | …following a link to Settings starts again on Organization. | "Shared link" is another feature's name |
| src/services/openai/write-summary.ts `SUMMARY_PROMPT_VERSION` | 2026-09-18.1 | 2026-09-19.1 | The prompt's wording changed |
| src/modules/packet/month-output.ts | The summary couldn't be generated. | The Excel summary couldn't be generated. | Easy to confuse with the monthly summary |
| app/r/settings/settings-sections.tsx | Document name · Contract start · Contract end | Document display name · Contract start date · Contract end date | Same names as the Organization section and onboarding |
| expense-form.tsx (label) | Budget line item | Line item | Its own placeholder and error say "line item" |
| app/r/source-budget-section.tsx | These totals cover the whole grant to date… | These totals cover this funding source to date… | A source can be a donation or a line of credit |
| line-items-manager.tsx, recurring-manager.tsx, submitted-marker.tsx (toasts) | Performance removed. · Removed from the recurring list. · Submission mark removed. | Performance deleted. · Recurring item deleted. · Month no longer marked as submitted. | Each now names what its button did |
| line-items-manager.tsx (confirm) | Delete anyway | Delete line item | Shown even when there is no warning to override |
| packet-download-buttons.tsx (busy label) | Assembling… | Preparing the packet… | The share button's wording for the same wait |
| app/api/downloads/cover-sheet/route.ts (reaches a toast) | Not found | That line item no longer exists. Reload the page. | The real case is a line item deleted in another tab |
| recurring-manager.tsx (fallback errors) | That didn't work. Try again. | That change couldn't be saved. Try again. · That expense couldn't be removed from this month. Try again. | Says what failed |
| app/r/packet/month-documents.tsx (archived source) | …nothing can be added or removed. | …nothing can be added or removed. Unarchive it in Settings to change them. | Like every other archived-source message |
| app/r/not-found.tsx · line-items-manager.tsx · trash/page.tsx | That page or record does not exist… · …using this system. · …delete it for good. | That page doesn't exist, or it has been deleted. · …using this app. · …delete it permanently. | Internal words; one word for permanent delete |
| app/r/error.tsx | Try again. If it keeps happening, contact support at … and say what time it happened. | Try again, and if it keeps failing, contact support at …. Say what time it happened. | Same pattern as every other support line |
| src/domain/strings.ts `shareNetworkFailed` | …Check your internet connection and try again. | …Check your connection and try again. | Same words as the other connection errors |
| src/modules/tours/expenses-tour.ts | Tap the reference number… | Press the reference number… | Every other tour says "Press" |
| src/domain/strings.ts `orgAccessPausedWithReason` | "…paused: Invoice unpaid.. Please contact support." | A closing period in the staff's reason is dropped | Doubled period |
| deploy.sh (two warnings printed to the operator) | …was not created — nobody can open /a… · …failed — the app is serving… | …was not created, so nobody can open /a… · …failed. The app is serving… | The guard now reads shell scripts |

## 10. Results

### Phase 1: documents (2026-09-19)

- Built as §4. `packetIndexTitle` joined `packetSummaryTitle` in `strings.ts`, so both titles
  have one home. The oversize warning now reads "It has been downloaded anyway, but DocuSign may
  reject it."
- `pdf-anchors.ts` matches `(ref):` or a bare `ref`. The old `ref:` form is gone, since nothing
  prints it. **Mutation:** without the `(ref):` match, 4 anchor tests fail.
- **Found while testing:** the index's no-receipt line now prints the same `Name (ref):` form as
  the heading, so the trace test's "find the heading token" picked up the index copy first. The
  test now looks only on cover sheet pages. Packet anchoring was never affected, because it
  measures each converted cover sheet on its own.
- The oversize-warning header test used the em dash as its example of non-Latin-1 text. It now
  uses a curly quote, and still proves why the route encodes the header.
- **Render check:** the local Mantaq August 2026 packet (8 pages) and workbook, built from the
  database, contain no dash. The footer reads `Mantaq | August 2026 | 2026-08-006 | Page 5 of 8`,
  the titles `Mantaq August 2026 Contract Summary` and `… Expense Index`, and the heading
  `Review Vendor C (2026-08-006):`. `render-smoke.ts` passes.
- Unit tests for domain and generation pass (603), as do the generation, packet and sharing
  integration tests (276). Typecheck and lint are clean.
- `scenarios.md` S10 still quotes the old note. It's a record of a past run, so it's left as is.

### Phase 2: the AI summary (2026-09-19)

- `src/domain/dashes.ts`: `replaceDashes` judges each dash by what touches it (§5), and
  `textsWithDashes` collects the typed strings in the month's facts that must keep theirs. It
  has 13 unit tests, covering every rule, a never-leaves-one input, idempotence and overlapping
  kept names.
- `runModelAttempts` cleans both attempts before `checkDraft`. I-8a (integration): a stubbed reply
  with an em dash aside and en dash bullets is saved clean, keeps `Groceries — Eastern Market` as
  typed, and needs no retry. **Mutations:** skipping the clean fails I-8a, and so does dropping
  `keep`.
- The prompt lost its six dashes (including the data delimiter's) and gained the no-dashes rule.
  **One addition beyond dashes:** the prompt said "organisation", and the real draft below wrote
  "totalled", so the prompt now says "organization" and asks for American English spelling. The
  read-amounts prompt lost its one dash, and its wording is otherwise unchanged.
- **Real draft (one call, local Mantaq August 2026, 1,656 in and 819 out tokens):** no dashes
  even before cleaning, structure and figures pass. Nothing was saved.

### Phase 3: screens and the copy review (2026-09-19)

- Four reviewers, each on its own files, changed about 250 user-facing strings (§9.1 to §9.4).
  That covered the ~120 dashes left after Phases 1 and 2, and the copy rules everywhere else.
  Each logged every change; the logs are merged into §9 as written.
- **Real bugs found on the way:**
  - The Recurring "Remove" dialog said the expense and its files would be deleted, but they go
    to the trash.
  - Three settings tour steps promised things the app can't do: removing users, changing roles,
    deleting labels or funding sources.
  - The upload route's 401 answered "Not signed in." while the actions said something else.
- **Lead's pass (§9.5):** one signed-out message everywhere, from `SESSION_EXPIRED`
  ("You've been signed out. Sign in and try again."), and the fixes the reviewers passed across
  to each other's files.
- **The guard, `src/domain/no-dashes.test.ts`, found nothing across 261 files.**
  - **Mutations:** a dash put back as JSX text, in a template literal, in an attribute and as an
    escaped `\u2014` each fail it.
  - Reviewer D's second guard in `strings.test.ts`, over every `UI` value, fails on a plain and
    a function-built dash.
- Docs synced: domain-rules (R4.4, R10.6, §12), m00, m02 to m10, both output specs and
  design-language.
- The full suite passed (146 files, 1,894 tests), and typecheck and lint were clean.

### Phase 4: adversarial review and browser pass (2026-09-19)

- **Meaning review:** six findings, two of them real: the Update shared file failure message,
  and "(deactivated)" on a renamed label. Every rewrite was traced to its code, including each
  number in the text (25 MB, 120 characters, 10 pages, 30 summaries an hour, a minute, six
  seconds). All six are fixed (§9.6).
- **Consistency review:** thirty findings. The clear ones are fixed (§9.6). The rest are
  deliberate, or a product call listed in §11. "Plus" in badges and "Reconciliation + AI" in
  plan text stays, by D-110.
- **Guard and cleaner review:** eight findings, all fixed.
  - **Cleaner:** a typed value that was only a dash (a description of "—") switched the cleaner
    off. `textsWithDashes` now keeps only values with real words, at least 3 characters.
  - **Cleaner:** a spaced en dash made a range of unlike figures (`$5,000.00 – 40%`), and a dash
    between a digit and a word became a comma (`January 1–March 31`). Now "to" joins only like
    figures, and digit-to-word reads "to" (word-to-digit reads "-", as in `W-2`).
  - **Cleaner:** a minus after a colon was dropped. It is kept now. Dash runs, thin spaces, list
    numbers, bold closers and heading marks are tidied. The private marks are stripped from the
    input first. The look around each dash is bounded, so a digit-padded reply stays fast (tested
    at 1.2 million characters).
  - **Packet (already there before this branch):** an expense whose name contained another
    expense's reference failed the whole packet build, because the bare reference counted as a
    second heading. Anchors now match only the `(ref):` token. A new LibreOffice test covers it,
    and it fails with the bare match put back.
  - **Guard gaps:** numeric entities with leading zeros, CSS escapes (a Tailwind `content-[…]`
    class), `String.fromCharCode` and `fromCodePoint`, `app/globals.css` and the shell scripts.
    `deploy.sh` had two real dashes, which are fixed. The two allowlisted files now have exact
    counts. **Mutations:** a dash in `deploy.sh`, in CSS, via `fromCharCode`, and one extra in
    an allowlisted file each fail the guard.
  - **Tests that couldn't fail:** I-8a now starts from a heading that fails the structure check
    until cleaned. Checking before cleaning fails it (mutation). The idempotence test now runs
    with kept names, so a second pass has dashes to see.
- **Browser pass, Chrome pane, signed in as the local Mantaq admin:** every app route, plus the
  two public share pages, a 404 and an app 404, fetched and scanned for dashes in text, titles and
  attributes. The only hit was a vendor name someone typed ("Lyft rides — outreach"), which stays
  by D-113.
  - Every tab title reads `Section | Stay Funded 360`.
  - Read in place: the Expenses list (headers, sort choices, the filter's "All expenses"), the
    Month-End Packet (readiness table, contents, buttons, Shared links, lock history
    `Unlocked … by Awais: "…"`), the Settings funding source form (new helper and checkbox
    labels), the Settings tour, the password page with its lockout message, and Cover Sheets
    (heading `Review Vendor C (2026-08-006):`).
  - At 375 px, the packet buttons and Shared links fit with no sideways scroll.
- **Render check:** a local packet built from the database has no dashes. The index subtitle and
  heading and the bar-separated contract line all read correctly, and `render-smoke.ts` passes.
- **Final:** full suite 146 files and 1,904 tests pass; typecheck and lint are clean.

## 11. Questions for Awais

Product calls the reviewers raised and deliberately didn't make. **Answered 2026-09-19:**

- **Q1 support mailbox:** keep tech@teampursuit.org for now.
- **Q2 sign-in wording:** yes. The login field is "Email". The errors are "We couldn't find an
  account with that email. Check the address and try again.", "That password doesn't match this
  email." and "Enter your email and password." (staff sign-in shares them).
- **Q3 "the City":** keep it.
- **Q7 contract line:** keep the middle dots. `contractContextLine` is back to " · ", and the
  Words rule notes the exception.

Still open: Q4 to Q6 and Q8 to Q12.

1. **Support mailbox.** Every "contact support" line now names `UI.supportEmail`,
   tech@teampursuit.org. That's right for Team Pursuit, wrong for any other customer. It's
   already a pending decision, and it's one constant.
2. **Sign-in wording.** The login page says "Organization email", and its errors say "…this
   organization email" and "Create an account to get started". But each user signs in with their
   own email, and sign-ups are closed. Change these to "Email" and "Check the address and try
   again."?
3. **"The City"** appears in the lock dialog and the unlock-reason example. Another customer's
   funder may not be a city. Use "your funder"?
4. **Monthly summary dates** read "18 Sep 2026" (PHASE-11 chose it), while the rest of the app
   uses 9/18/2026. Keep it?
5. **A deleted user** shows as "by Unknown" in lock history and shared links (D-89). Would "by a
   former user" be better?
6. **Cover Sheets subtext:** "Breakdown documents for March 2026" became "Cover sheets for March
   2026, one for each line item." Put it back if staff know them as "Breakdown".
7. **Packet summary contract line** now uses bars (`Contract 6007211 | Contract total: …`),
   following the documents rule. Go back to the middle dots the City has seen so far?
8. **Expenses filter:** "All records" is now "All expenses". Keep it?
9. **Recurring:** the Remove dialog's button still says "Remove anyway". "Remove" would do now
   that it only moves the expense to the trash.
10. **`reimburseHint` (§12):** "Sales tax is excluded. The funder does not reimburse it." It is
    unused and no longer always true (D-67). Delete it?
11. **Deleting an expense:** the menu says "Delete", while the dialog says "Move this expense to
    the trash?" with the button "Move to trash". The consistency reviewer suggests "Delete" all
    the way through. I kept it as is, because the dialog says exactly what happens.
12. **"Cancelled"** is the pinned status label. US spelling is "Canceled".

