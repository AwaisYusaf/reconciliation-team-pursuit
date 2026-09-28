# Mobile app: the application on iOS and Android

**Status (2026-09-28): plan, rewritten after two review rounds.** Round 1 checked the first draft
against the code under four lenses (fact-check, security, feature parity, phone platform and store
rules) plus a health check of the web app. Round 2 added database, usability, domain rules and
testing/release, and tried to disprove round 1 (nothing it claimed was wrong). Phase 18 (each person
keeps their own month, D-131) was split out and is live on `main` (`10a9835`). Next: the user reads
this plan (workflow step 3).

The application does everything a grant reconciliation needs: expenses, budgets, month end
packets, cover sheets, summaries and the settings behind them. This plan puts it on a phone and a
tablet as one React Native app for iOS and Android, for organizations that already use the website.

---

## 1. Decisions

| # | Decision | Who, why |
|---|---|---|
| M1 | **The app holds no rules and no database.** It asks the website for everything. An expense saved on a phone is the same row as one typed on the website | Original plan. One place every figure comes from |
| M2 | **Sign up and payment stay on the website.** The app only signs in to organizations that already exist. Stripe stays the only billing system | The user, 2026-09-28. Apple and Google require their own payment for a subscription sold inside an app; an app that lets you create an account you cannot unlock is a common rejection; in-app sign up would also require in-app account deletion (Apple 5.1.1(v)), which the website does not have. Selling to organizations fits Apple's 3.1.3(c) enterprise exemption. *Store rules are from memory as of mid-2026: re-read App Store 3.1 and Google Play payments before submitting* |
| M3 | **Billing is read-only in the app.** It shows the plan, what is due and past invoices. No buy, change, cancel or card buttons, no Stripe portal link, and neutral wording: "Your organization's plan is managed by your administrator." | The user, 2026-09-28. The portal lets people change their card, which counts as buying |
| M4 | **No super admin in the app.** Super admin accounts (our own team, `staff_users`, who use the `/a` dashboard) are refused at mobile sign in and keep using the website. Customer admins and managers are not affected | The user, 2026-09-28. A super admin can see every organization, suspend one, change plans and grant free access, and these accounts cannot be deactivated (`staff_users` has no such column), so a lost phone would expose every organization |
| M5 | **A phone stays signed in while it is used.** No 90-day cap for phone keys; 30 days without use still signs it out | The user, 2026-09-28. Needs one column on `sessions` (§3.2) |
| M6 | **The month and funding source are each person's own** and the phone switches them exactly as the web does | The user, 2026-09-28. Built as Phase 18 (D-131) |
| M7 | **The full expense form**, the same as the web, narrative required. No "photo now, finish later" in the first version | The user, 2026-09-28. The alternative needs a new kind of draft and a database change. Revisit after testing |
| M8 | **Build the whole app, then test it** on production with the existing demo account (a complimentary organization with fake data). No staging server | The user, 2026-09-28 |
| M9 | **The web app's colours, type and UI rules** (`docs/03-modules/design-language.md`, `docs/redesign-brief.md`). Light only | The user, 2026-09-28. The website has no dark mode |
| M10 | **Addresses are built screen by screen** with the app, not all 83 up front | Round 1. The sign-in key, error format and versioning get proven by the first screen that uses them, and no address is built that nothing calls |

---

## 2. Before the app: fix the base (Phase 0)

Found by the reviews in the web app as it is today. Each is a web fix that ships on its own, with a
test that fails without it.

**Status (2026-09-28): all ten fixed** on branch `fix/phase-0-base`. The user decided B1 (a decimal
comma reads as cents: "12,50" is $12.50) and B10 (month documents on an archived source stay
refused; R14.3 now says so). Run against `main`'s code, the new tests fail (B3 to B8: 11 of 15, the
other 4 pin behaviour that must not change; B1 and B2 each fail). An independent review found a
deadlock in the first B8 fix (reorder vs an invoice import), fixed and pinned by a test.

| # | Problem | Where | Fix |
|---|---|---|---|
| B1 | "12,50" saves as $1,250.00: commas are stripped as thousands separators | `src/domain/money.ts:38` | Refuse a comma that is not in a thousands position ("Use a dot for cents") instead of guessing. *Decision for the user: refuse, or read it as a decimal* |
| B2 | Adding a recurring item to a month, and removing it, write no audit history | `src/modules/recurring/actions.ts` (insert ~212, soft delete ~333) | Go through `insertExpenseWithAudit` and write the "deleted" event, like every other path |
| B3 | Saving a vendor stores whatever default line item the browser sends, even another organization's, and a malformed id is a 500 | `src/modules/settings/actions.ts:184` | Check the line item belongs to the org (`isUuid` + org-scoped lookup) |
| B4 | Two people deactivating payment sources at once can leave none active, and then no expense can be saved | `src/modules/settings/actions.ts:129-141` | Check and update inside one transaction holding `lockOrg` |
| B5 | Deleting a line item counts, then deletes, outside a transaction: a racing expense is a 500, and recurring items added meanwhile are deleted without confirmation | `src/modules/line-items/actions.ts:121-172` | One transaction with the line item row locked |
| B6 | Two people saving the same name at once is a 500 instead of a message (line items, payment and document labels, vendors) | `line-items/actions.ts:56-94`, `settings/actions.ts:76-104`, `saveVendorAction` | Catch unique violation 23505, as `funding-sources/actions.ts:59-63` already does |
| B7 | Every expense list loads every document in the organization, then filters in JavaScript | `src/modules/expenses/queries.ts:130-157` | Filter by the expense ids in the query (the index exists) |
| B8 | Reordering line items accepts part of the list, and two reorders at once can deadlock or silently overwrite | `src/modules/line-items/actions.ts:193-208` | Require the full list; lock the source's rows in id order first |
| B9 | Three tests fail at random only when the whole suite runs at once | `src/generation/raster.test.ts:93` (shared temp folder), `src/services/auth/store.integration.test.ts` (sweep count), `src/db/create-staff.integration.test.ts` (30 s subprocess) | Own temp folder; assert on rows, not the swept count; call `tsx` directly or allow 60 s. Cap integration workers if new mobile tests make it worse |
| B10 | The rules say month documents may be added on an archived source ("finishing its last months", R14.3); the code refuses them, and its comment calls that a deliberate review fix | `docs/01-domain/domain-rules.md:215`, `app/api/files/upload/route.ts:95-100` | *Decision for the user:* allow them (fix the code) or refuse them (fix the rule). Either way the rule and the code must agree |

---

## 3. Part 1: the website's front door

All of it is additive. Existing screens and behaviour do not change.

### 3.1 What exists and what does not

- 83 server actions in 17 files, and 18 routes (Appendix A). The actions are plain functions taking
  typed objects (not form data), so a JSON wrapper is straightforward. Sign in, sign out, sign up
  and onboarding are the exceptions: they take form data, write cookies and redirect.
- Every page, action and route reads the session through one place (`resolveSession`), which is
  what makes wrapping possible. But **most screens have no read address**: they are loaded inside
  pages. Reads are the larger half of Part 1.
- Two pages calculate their figures inside the page (`app/r/contract-summary/page.tsx`,
  `app/r/cover-sheets/page.tsx`). Those calculations move into shared loaders first, so the page
  and the address call the same code. This is a refactor, not wrapping.
- Sign in limits already exist (per IP and per email+IP, `src/services/rate-limit.ts`) and are
  reused. They are kept in process memory; many phones behind one carrier address share the
  30-per-15-minutes budget. Acceptable at this size, named here as the ceiling.

### 3.2 Sign in for the app

- **A key, not a cookie.** Mobile sign in returns a key in the response body. It is a row in the
  existing `sessions` table (hashed, like a cookie), so every existing way of ending access ends it:
  revoking a person, suspending an organization, a password change, an admin password reset.
- **Header only.** Mobile addresses accept `Authorization: Bearer` and never a cookie, and a request
  with a key is never also read as a cookie request. One guard, `mobileSession()` in `src/lib/`,
  checks the key, the app version and paid access; every mobile address calls it.
- **The functions that assume a cookie get key versions:** sign out deletes the key's row; password
  change keeps the phone's own key and ends every other session (today it would end the phone's
  own); renewal never sends back a cookie.
- **Super admins are refused** at mobile sign in (M4).
- **No 90-day cap for phones (M5):** `sessions.kind text NOT NULL DEFAULT 'web' CHECK (kind IN
  ('web','mobile'))`; the cap applies to `web` only. 30 days without use still ends a phone key.
- **On the phone:** the key lives in the Keychain/Keystore (`expo-secure-store`), never in plain
  storage or logs.
- **Origin checks:** nine file routes refuse a request with no `Origin` header, which is every
  native request (`src/lib/same-origin.ts`). The mobile file addresses skip that check only when the
  request was signed in with a key; a cookie request with no origin is still refused. A key cannot
  be sent by another site's page, so this opens nothing.
- **Oldest supported version:** every request carries the app version; below `MIN_APP_VERSION` the
  answer is 426 and the app shows an update screen. Unset means no gate.

### 3.3 The error format

`ActionResult` (`src/lib/action-result.ts`) is kept and given a `code`. One mapping turns it into
an HTTP answer:

| Case | Status | Code |
|---|---|---|
| No key, bad key, expired, revoked, suspended | 401 | `signed_out` |
| Unpaid organization (today it reuses the "signed out" key, `src/lib/action-session.ts:48`) | 403 | `plan_required` |
| Not allowed for this role | 403 | `forbidden` |
| Month locked, source archived, other rule refusals | 409 | `locked`, `archived`, … |
| Bad input | 422 | `invalid`, with the same field messages as the web |
| App too old | 426 | `update_required` |
| Anything else | 500 | `server_error`, with a request id also written to the log |

Every address checks its input's shape with a zod schema before calling the action, so bad JSON
is a 422 and never a crash.

### 3.4 Retries never duplicate

Phones retry on weak signal. Creates carry an `Idempotency-Key`; the same key returns the saved
answer instead of creating again. Covered: create expense, add recurring to month, uploads, invoice
reading (a paid AI call), create user and set user password (both return a one-time password that
would otherwise be lost).

Table `idempotency_keys (user_id, key, route, request_hash, response_status, response_body,
created_at)`, primary key `(user_id, key)`, rows older than 24 hours ignored and deleted. Same key
with a different body is 422; a request still running is 409. 5xx answers are never stored.

The monthly summary's autosave also treats a retry of its own last save as success, instead of the
false "changed by someone else" it gives today (`monthly-summary/actions.ts:379-392`).

### 3.5 Addresses

Under `app/api/mobile/v1/`, each a thin wrapper over an existing action or loader, built with the
phase that needs it (§6). Every write takes the **month and funding source the screen showed** as
parameters and never falls back to the stored choice, so another tab switching month cannot move
where the phone's work lands.

- **`GET /me`** at start and on return to the app: role, organization, paid status and reason, plan
  features (invoice and receipt reading, monthly summary view and write), the person's month and
  source resolved as `loadSourceContext` does (source list with archived flags, single-source,
  the plan's active-source limit), **today** in America/Detroit, whether the welcome banner is
  dismissed, and the oldest supported app version.
- **Reads per screen** (dashboard, expense list, trash, history, drafts, line items, recurring,
  packet, cover sheets, contract summary, monthly summary, share links, settings sections, users,
  plan and invoices, feature requests).
- **Writes** as listed in Appendix A.
- **Downloads in two steps:** "prepare" starts the build and answers at once; the phone asks until
  it is ready, then downloads the cached file with its key. Packet generation can take up to 10
  minutes (`downloads/packet/route.ts:20`), and a phone cuts a single long request when the app goes
  to the background. The "some expenses are in the trash, continue?" confirmation is a step of its
  own (see §5, two-step actions).
- **Invoices for the plan screen:** a new read listing the organization's Stripe invoices and
  receipts, reusing what the super admin's billing card already does (`staffPayments`).
- **`GET /health`** for monitoring; never gated.

### 3.6 Keeping the two repositories in step

Response schemas live in `src/modules/mobile/contract.ts` (zod). A test writes them out as JSON
Schema (`z.toJSONSchema`) to `contract/mobile-v1.json` and fails if a field was removed. The app
generates its types from that file. Every mobile test checks its answer against the schema. No
package to publish.

### 3.7 Logs and monitoring

- An `onRequestError` hook that removes `authorization` and `cookie` before anything is logged, and
  a test that a key never reaches a log line.
- A request id in every error answer and the matching log line.
- Log rotation in `docker-compose.prod.yml`.
- In the app, Sentry with personal data off and request headers scrubbed.

### 3.8 Database changes

One migration, additive: `sessions.kind` (§3.2) and `idempotency_keys` (§3.4). Written like
0040 to 0043 (`SET LOCAL lock_timeout = '5s'`, rollback in the decision entry). The nightly
clean-up of expired sessions that `store.ts` describes does not exist; mobile sign in runs the sweep
for sessions and old idempotency rows, and a crontab entry next to the billing reconcile job is the
fallback.

### 3.9 Tests for Part 1

- A shared helper `src/modules/mobile/mobile.test-helper.ts`: two organizations, real keys, a
  `call(route, { key, body, idempotencyKey, appVersion })` that builds a real request. It never
  mocks `getSession`, so the key path is what runs. Tests live under `src/` (the suite does not run
  tests beside routes under `app/`).
- **Header only:** key gives 200; cookie without a key gives 401; missing, malformed, revoked,
  expired and suspended keys give 401 in the error format.
- **Organization isolation:** a table of every mobile address called with organization B's key on
  organization A's ids; each must answer 404 and leave A's row unchanged. The table is checked
  against the actual route files, so a new address without a probe fails.
- **Retries:** same key twice, one row; two at once, one row; same key and different body, 422;
  another organization's key never replays A's answer.
- **Version gate:** 426 below the minimum, compared as numbers (1.10.0 is newer than 1.9.0).
- **Guard coverage:** `src/lib/guard-coverage.test.ts` gains a rule that every method under
  `app/api/mobile/` calls `mobileSession()` and never a cookie guard, and that no mobile route reads
  a key from the address bar.
- `no-free-use.integration.test.ts` gains the key-signed-in case.

---

## 4. Part 2: the app

React Native, one codebase for iOS and Android, in its own repository, laid out for a phone and
usable on a tablet.

### 4.1 Tools

Expo (managed, with EAS Build, Submit and Update), expo-router, TanStack Query, react-hook-form with
zod, expo-secure-store, expo-image-picker and expo-document-picker, a maintained document-scanner
library (VisionKit on iOS, ML Kit on Android), expo-image-manipulator, expo-file-system with
expo-sharing, a chart library (victory-native unless Phase 2 finds a reason otherwise), and
`@sentry/react-native`. Development points the app at a laptop's `next dev` through
`EXPO_PUBLIC_API_URL`.

### 4.2 Every screen, and how it lands on a phone

| Screen | On the phone |
|---|---|
| Sign in | Email and password; an update screen below the oldest supported version. No sign up (M2) |
| Month and funding source | Shown in every screen's header, switched from a panel, exactly as on the web (M6). Re-read from `/me` whenever the app returns to the front |
| Welcome banner | On the dashboard until that person dismisses it |
| Dashboard | The month's figures and the spend chart, stacked; a text version of the chart for screen readers |
| Expenses | The month's list as cards, search and filters, edit, delete, trash and restore, history (admins) |
| Add or edit an expense | The full form (M7) with receipts from the camera, photos, Files or another app's share sheet; add and remove files on a saved expense; AI amount reading where the plan and setting allow; the duplicate invoice warning |
| Add from invoice | Upload, read, then the draft queue: check, edit, approve, approve all ready, discard, undo; remove a draft's file |
| Recurring items | The list, add to the month, edit, delete |
| Line items | The list and budgets, add, edit, delete, performances; reorder with move up and down, not drag |
| Month-end packet | Its figures, what is missing, month documents (add, remove), lock by picking the City's signed PDF from Files, unlock, mark submitted and clear it |
| Downloads | Packet, Excel summary, cover sheets and the monthly summary (Word and PDF) open in the phone's own viewer and can be shared or saved |
| Cover sheets | Per line item, with their proofs |
| Monthly summary | Read, write, edit; a conflict with the web is shown, never overwritten |
| Contract summary | The contract's figures and position table |
| Share links | Create, see, change file or password, stop |
| Settings | Organization, funding sources, payment and document labels, vendor library, AI switch (admins), users (admins), own name, photo and password |
| Plan and billing | Read only (M3) |
| Feature requests | Suggest, vote, read and reply |
| First-run guidance | Short intro cards per screen and hints on empty screens, remembered on the device. The web's spotlight tours are attached to page elements and cannot be carried across |

### 4.3 Where a phone is honestly different

- **Wide tables** become cards with the figures stacked.
- **Documents** are made by the website exactly as today and opened in the phone's viewer. They
  are not built on the phone: the tools are server software, the packet merges every file stored
  for the month, and the funder must receive the same file the app shows.
- **Long writing:** the monthly summary can be edited on a phone and is easier on a tablet.

### 4.4 Photos and files

- A photo is saved to the app's own storage the moment it is taken and kept until the server
  confirms the upload. A failed upload is retried from that copy, and an unfinished form is
  restored when the app reopens. Today's web form keeps files only in memory.
- Several pages of one receipt are joined into **one PDF per document** by the scanner before
  upload. Amount reading adds up every file (`src/domain/amount-suggestion.ts`), so two photos of one
  receipt would be counted twice.
- Photos are sent as JPEG, about 2000 px on the long side. iPhone HEIC is never sent: the server's
  HEIC decoder never returns its memory (D-111), which was accepted only because browsers convert
  first.
- The same limits as the web: 25 MB a file, 10 pages read per document.
- A failed read says "Couldn't read, check your signal", separately from "No amount found" (the web
  shows the second for both).

### 4.5 No signal

The app needs a connection and says so plainly. A form keeps what was typed and every photo taken.
Nothing is saved behind the person's back: when signal returns the app reloads the record and asks
before overwriting a newer change.

### 4.6 Accessibility

Text scales with the phone's setting up to 200% without clipping; screen reader labels on every
icon button; tap targets at least 44 pt (iOS) and 48 dp (Android); reduced motion respected; red
figures also carry a word, never colour alone.

---

## 5. Rules

The same rules as the website, because it is the same system. These are the ones a phone is most
likely to break; each is enforced on the server, and the app must not undo it.

- **Two-step actions are two calls.** Saving with "no receipt" deletes the receipts (R4.2); the
  packet's trashed-expense exclusion; removing a recurring item that has documents (D-79); deleting a
  line item that recurring items use (R9.3). The phone shows the server's list, then resends with the
  confirmation. It never sends the confirmation up front.
- **Tax and fee "reimbursable" flags** follow the funding source's rules on create and on a source
  change, and an existing expense keeps its own on edit (R1.3, D-67, D-71). The form address returns
  each source's rules and the phone shows the same Include-in-reimbursement toggles. The server
  stores what it is sent, so a wrong default is a wrong claim.
- **Money:** amounts are sent as typed text and cleaned exactly as the web cleans them; the keypad
  offers a dot only (B1). Saved figures always come from the server. The form's live preview (the
  reimbursable amount as you type, the receipt total, the low-budget warning) uses a generated copy
  of `src/domain/money.ts` and `budget-math.ts` run against the same tests; the server's figure
  replaces it on save.
- **Dates:** "today", the default expense date, the month list and every date shown come from the
  server in America/Detroit (R2.5, D-26). The phone's clock and time zone are never used.
- **Locked and submitted are different.** A locked month refuses changes but still allows viewing,
  downloads, sharing, history and summary edits (R10.7, D-107). A submitted month shows the R10.6
  warning and refuses nothing. Locking needs the signed PDF (a photo is refused) and an empty
  missing-documents list.
- **Archived funding source:** refused for new expenses, new line items, recurring items, adding to
  a month and moving an expense in; editing saved records, marking submitted and locking still work
  (R14.3).
- **"All" funding sources:** the packet, cover sheets, contract summary, line items and monthly
  summary ask the person to pick a source; add expense uses the first active source; totals are
  never added across sources. A one-source organization never sees "All" (R14.2).
- **Plan features:** invoice and receipt reading follow the plan and the organization's AI switch;
  the monthly summary follows the plan and the server's AI configuration, not the switch (D-107,
  `src/modules/ai/access.ts`). Where the web shows a plan note instead of hiding a feature, the phone
  shows the note without a link to buy (M3).
- **Roles:** admins and managers keep exactly today's permissions. Admin-only on the phone: users,
  expense history, the AI switch, billing.
- **Unpaid organization:** a `plan_required` answer, never "signed out". The app says access is
  paused, names the admins to a manager, and offers no link to buy.
- **Wording** comes from `src/domain/strings.ts` (R12), copied into the app by the contract step,
  never typed by hand. About 15 strings are worded for a browser ("Reload the page", "Press Enter",
  "click", "choose one in Plan & billing", "Update your card") and get phone versions in the same
  file. The app repository runs the same no-dash test.
- **Access:** revoked on the website, the phone's next request lands on sign in.

---

## 6. Phases

| Phase | What | Finished when (each is a check someone can run) |
|---|---|---|
| 0 | Base fixes, §2 | Each fix has a test that fails without it; the full suite passes three runs in a row |
| 1 | Front door: key sign in and out, `mobileSession()`, error format, retries, version gate, `/me`, `/health`, logging, test helper, contract file, the migration | With curl: sign in, `GET /me` is 200; after revoking the person on the web, 401; a cookie without a key, 401; an old version, 426. Guard coverage and the full suite pass |
| 2 | App shell: repository, tools, sign in, navigation, month and source switcher, dashboard, update screen | On an iOS and an Android build, a person signs in; the dashboard's figures match the web for the same month and source; revoked on the web, the next request lands on sign in |
| 3 | Daily work: expenses, camera and files, drafts and invoice reading, recurring items, line items | Every address has its isolation and retry tests; an expense saved on the phone reads back on the web with identical fields; locked-month refusals use the same strings |
| 4 | Month end: packet, month documents, lock and unlock, submitted, downloads, cover sheets, monthly summary, share links, contract summary | A month is locked and unlocked from the phone; the packet the phone downloads is the same file (same artifact id) as the web's |
| 5 | The rest: settings, users, plan and invoices, feature requests, first-run guidance, accessibility pass | Every row of §4.2 has an address, a test and a screen; the plan screen has no way to buy |
| 6 | Testing and release: full test on production with the demo account (M8), store accounts and listings, builds, submission | Internal testers sign off on both platforms; approved in both stores; `MIN_APP_VERSION` set; a test crash from a release build reaches Sentry |

Phases 1 and 3 carry most of the work. Apple review takes days and can reject a first submission,
so Phase 6 is not a same-week step.

### 6.1 Release checklist (Phase 6)

- **Demo account** for Apple's and Google's reviewers: the existing demo organization, on
  complimentary access, with fake data only; credentials in the review notes.
- **Privacy:** the policy page exists (`/privacy`, D-130, still awaiting a lawyer's review). Apple's
  privacy labels and Google's data safety form declare name, email, photos and files, financial
  information and user content.
- **Permission text:** camera and photo library.
- **Environment:** `MIN_APP_VERSION` set by hand in the server's `.env` and applied with
  `./deploy.sh --env-only` (a deploy never changes the live `.env`); raised only once both stores
  have that build live. App-side: `EXPO_PUBLIC_API_URL` and the Sentry DSN as EAS secrets.
- **Account deletion:** not required while the app has no sign up (M2). Re-check Apple 5.1.1(v)
  at submission.

---

## 7. Not part of this

- **Working offline:** a store on the device, a queue of unsent changes and a rule for a change
  landing in a month that has since been locked. A project of its own, and it would end M1.
- **Sign up, buying or changing a plan, the super admin dashboard** (M2 to M4).
- **Push notifications** (month-end reminders, drafts ready).
- **Links that open the app** from email or the web. Share links and billing open in the browser.
  There is no email-based password reset on either side (D-24).
- **Photo now, finish later** (M7) and **dark mode** (M9): revisit after testing.
- **A second set of rules.** Anything the app shows is calculated by the website, apart from the
  form's live preview (§5, money), which the server's figure replaces on save.

## 8. Done when

- A person signs in on iOS or Android with the same account they use on the website; a super admin cannot.
- Every screen in §4.2 is usable on a phone.
- An expense recorded on a phone appears on the website at once, indistinguishable from one typed
  there, and the reverse.
- The same fields are required as on the website, with the same messages.
- Locked months, archived sources, "All", permissions, plan features and unpaid organizations
  behave as §5 says.
- The plan, what is due and past invoices are visible, with no way to buy.
- The packet, Excel summary, cover sheets and monthly summary open and can be shared from the phone.
- Removing a person's access stops their phone at its next request.
- No signal is reported plainly, and nothing typed or photographed is lost.
- A retried save never creates a second record.

---

## Appendix A: every web page, action and route

Each is on the phone (with its phase), web only, or left out, with the reason.

### Pages

| Page | Phone |
|---|---|
| `app/(auth)/login` | Phase 2 |
| `app/(auth)/signup`, `onboarding/contract`, `onboarding/line-items` | Web only (M2) |
| `app/r` (dashboard) | Phase 2 |
| `app/r/expenses`, `expenses/new`, `expenses/[id]/edit`, `expenses/trash` | Phase 3 |
| `app/r/expenses/drafts/[id]/edit` (and `expenses/new/from-invoice`) | Phase 3 |
| `app/r/recurring`, `app/r/line-items` | Phase 3 |
| `app/r/packet`, `cover-sheets`, `monthly-summary`, `contract-summary` | Phase 4 |
| `app/r/settings`, `settings/users`, `settings/vendors` | Phase 5 |
| `app/r/plan` | Phase 5, read only (M3) |
| `app/r/feature-requests`, `feature-requests/[id]` | Phase 5 |
| `app/a`, `a/orgs/[id]`, `a/feature-requests`, `a/feature-requests/[id]` | Left out: super admin dashboard (M4) |
| `app/s/[token]` (public share page), `app/page.tsx` (landing), `app/privacy`, `app/terms` | Web only; the app links to the privacy policy |

### Actions (83)

| File | Action | Phone |
|---|---|---|
| `auth/actions.ts` | `signInAction`, `signOutAction` | Phase 1, as key versions |
| | `signUpAction`, `saveOnboardingLineItemsAction`, `completeOnboardingAction` | Web only (M2) |
| | `setActiveMonthAction`, `setActiveFundingSourceAction`, `dismissWelcomeAction` | Phase 2 |
| `expenses/actions.ts` | `createExpenseAction`, `updateExpenseAction`, `deleteExpenseAction`, `restoreExpenseAction`, `permanentlyDeleteExpenseAction`, `removeExpenseDocumentAction`, `loadExpenseHistoryAction`, `searchVendorsAction` | Phase 3 |
| `expense-imports/draft-actions.ts` | `approveDraftAction`, `approveReadyDraftsAction`, `removeDraftDocumentAction`, `discardDraftAction`, `undoDiscardAction`, `updateDraftAction` | Phase 3 |
| `expense-imports/import-actions.ts` | `checkDuplicateInvoiceAction` | Phase 3 |
| `recurring/actions.ts` | `saveRecurringItemAction`, `deleteRecurringItemAction`, `addRecurringToMonthAction`, `removeRecurringFromMonthAction` | Phase 3 |
| `line-items/actions.ts` | `saveLineItemAction`, `deleteLineItemAction`, `reorderLineItemsAction`, `addLineItemPerformanceAction`, `saveLineItemPerformanceAction`, `deleteLineItemPerformanceAction` | Phase 3 |
| `packet/actions.ts` | `removeMonthDocumentAction`, `markMonthSubmittedAction`, `clearMonthSubmittedAction`, `unlockMonthAction` | Phase 4 (lock is the upload route) |
| `monthly-summary/actions.ts` | `writeSummaryAction`, `saveSummaryAction` | Phase 4 |
| `sharing/actions.ts` | `createSharedLinkAction`, `updateSharedFileAction`, `changeSharedLinkPasswordAction`, `stopSharedLinkAction` | Phase 4 |
| `settings/actions.ts` | `updateOrganisationAction`, `saveLabelAction`, `setLabelActiveAction`, `saveVendorAction`, `deleteVendorAction`, `changePasswordAction`, `setReadAmountsEnabledAction` | Phase 5 (`changePasswordAction` as a key version, Phase 1) |
| `funding-sources/actions.ts` | `createFundingSourceAction`, `updateFundingSourceAction`, `archiveFundingSourceAction`, `unarchiveFundingSourceAction` | Phase 5 |
| `users/actions.ts` | `createOrgUserAction`, `setUserPasswordAction`, `setUserNameAction`, `listOrgUsersAction`, `revokeUserAccessAction`, `reinstateUserAccessAction`, `deleteUserAccountAction` | Phase 5 |
| `feature-requests/actions.ts` | `suggestFeatureAction`, `setFeatureRequestVoteAction`, `replyToFeatureRequestAction` | Phase 5 |
| `feature-requests/staff-actions.ts` | `editFeatureRequestAction`, `setFeatureRequestStatusAction`, `setFeatureRequestShownAction`, `staffReplyToFeatureRequestAction` | Left out: super admin only (M4) |
| `billing/actions.ts` | `startCheckoutAction`, `quoteChangeAction`, `applyChangeAction`, `cancelPendingChangeAction`, `cancelPlanAction`, `endPlanNowAction`, `resumePlanAction`, `billingPortalAction` | Web only (M3); the plan screen uses a new read |
| `admin/actions.ts` | `changePlanAction`, `setComplimentaryAction`, `suspendOrgAction`, `reinstateOrgAction` | Left out: super admin only (M4) |
| `tours/actions.ts` | `completeTourAction`, `resetToursAction`, `replayTourAction` | Web only; the phone's intro cards are remembered on the device (§4.2) |

### Routes (18)

| Route | Phone |
|---|---|
| `api/files/upload` (receipts, month documents, the signed packet that locks a month) | Phase 3 and 4, key version without the origin check |
| `api/files/read-amounts`, `api/files/read-invoice`, `api/expenses/from-invoice` | Phase 3, key versions |
| `api/files/[id]` (open a stored file) | Phase 3 |
| `api/downloads/packet`, `summary`, `cover-sheet`, `monthly-summary` | Phase 4, as prepare and download |
| `api/monthly-summary/write` | Phase 4 |
| `api/shared-links/create`, `api/shared-links/update` | Phase 4 |
| `api/me/avatar` | Phase 5 |
| `api/users/avatar` (shows other people's photos) | Phase 5 |
| `api/stripe/webhook` | Untouched: called by Stripe, not a person |
| `r/billing/return` | Web only (M3) |
| `s/[token]/[filename]`, `s/[token]/unlock` | Web only: public share pages |
