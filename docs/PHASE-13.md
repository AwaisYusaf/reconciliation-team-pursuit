# Phase 13: No dashes, and a copy review

Status: **planned** (2026-09-19). Build phases are in §8. Each names its own passing checks.

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
   - an unspaced en dash between two numbers, or two words, is a range: `2–3` → `2 to 3`,
     `January–March` → `January to March`;
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

## 9. Copy changes (filled in during Phase 3)

Before and after, grouped by screen, with a short reason when it isn't only a dash.

## 10. Results

(Filled in as each phase finishes.)
