# Phase 12 — Share the month's packet and summary with a link

Status: **planned, not started** (2026-09-19). The product spec is Appendix A, copied word for
word from `docs/tickets/share-packet-link.md`. §2 records where this plan departs from it and why.
Every build phase in §9 names its sources and its own checks, so each can run in a fresh chat.

This is the app's **first public, unauthenticated surface** and its first bearer URL. It qualifies
D-30/D-41, which held that a session-checked download is "strictly stronger than a bearer URL".
The reasoning is in D-112.

---

## 1. What this is, in one paragraph

On the Month-End Packet tab an admin or manager presses **Share link**, picks Packet (PDF) or
Summary (Excel), optionally sets a password, and gets a short link such as
`https://stayfunded360.com/s/k7Qm2xPa9Xy1`. Anyone with the link can open it without an account.
The PDF opens in the browser's own viewer, where the packet's clickable references work, which
Google Drive's viewer ignores. The Excel link downloads the file. Each funding source and month has
at most one PDF link and one Excel link. A link always serves the file saved when it was shared,
read from storage and never rebuilt. When records change afterwards, the row says so, and
**Update shared file** puts the new file behind the same link. A link can be password protected,
its password changed, and it can be turned off at any time. It also stops working while the
organization is paused or cancelled.

---

## 2. Decisions

### 2.1 Changes to Appendix A

| # | Appendix A says | Changed to | Source |
|---|---|---|---|
| C1 | The link is "short and hard to guess", e.g. `k7Qm2xPa9` (9 characters) | **12 base62 characters** (~71 bits). Nine characters is ~53 bits, which is thin for a public link with no account behind it; twelve is still short enough to read out or type. | Plan (P3) |
| C2 | "The browser tab shows the file name, e.g. `Team_Pursuit_March_2026_Packet.pdf`" | Chrome and Edge show the packet's own title ("Team Pursuit March 2026 Packet"), because the packet sets its PDF `/Title` (`packet-pdf.ts:206`). The viewer's Save still uses the exact file name, sent in `Content-Disposition`. The packet file is not changed. | User, 2026-09-19 |
| C3 | "Shared on 04/08/2026" | `formatDateUS`, e.g. `4/8/2026`, the same format as "Submitted {date}" on the same page. | Plan |
| C4 | "the organization's access is paused or cancelled" | As written: paused (`suspended_at`) **or** `subscription_status = 'cancelled'`. Cancelled blocks nothing else in the app today, so a cancelled organization can still sign in. Its Shared links box therefore adds one line saying the links won't open while the plan is cancelled. | User, 2026-09-19 |

### 2.2 Taken by this plan (with the reason)

| # | Decision | Why |
|---|---|---|
| P1 | **Links use `APP_URL`, and production refuses to start without it** (`REQUIRED_IN_PRODUCTION` in `instrumentation.ts`, validated as an http(s) URL). | A link is built once and emailed. A wrong or missing domain would only show up in the City's inbox; a boot failure shows up at deploy. User, 2026-09-19. |
| P2 | **Wrong passwords are counted per link and visitor IP** (`sharePassword`: 5 per 15 minutes, in-process like the login limits). The count is taken *before* checking, so the sixth try is refused even when it is right, and a right password resets it. | D-44: an attacker's wrong guesses must never lock the real user out. Per link alone, anyone holding the link could block the City for 15 minutes. User, 2026-09-19. |
| P3 | **Token: 12 characters of `[0-9A-Za-z]`** from `crypto.randomBytes` with rejection sampling (bytes ≥ 248 are dropped, so every character is equally likely). Unique across all rows, including stopped ones. | See C1. The unique index over every row means a stopped link's token can never come back. |
| P4 | **The token is stored as written**, not hashed. | The Shared links box shows the link again for Copy link. Sessions hash their token because nobody needs to read it back. Anyone who can read this table can already read the files themselves from storage. |
| P5 | **Passwords: 6–128 characters, argon2id** (`hashPassword`/`verifyPassword`), never sent to the browser. Only a `hasPassword` boolean leaves the server. | 6 is the ticket's minimum. 128 bounds argon2's input on an unauthenticated path. |
| P6 | **"For a while" is 12 hours.** After the right password, a signed cookie (`share_unlock`, `__Secure-` prefix in production, `Path=/s/<token>`, HttpOnly, SameSite=Lax) holds `expiry.HMAC(share id, password hash, expiry)` keyed by `AUTH_SECRET`. | Binding the password hash means changing, adding or removing a password invalidates every earlier unlock at once (Appendix A §3: "The old password stops working straight away"). Revoking the link needs nothing extra, because every request looks the share up again. |
| P7 | **The password form posts to a route handler, not a Server Action.** | In Next 16, setting a cookie in a Server Action re-renders the current page in the same round trip (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, "Cookie Behavior in Server Functions"). The re-rendered `/s/<token>` would run its own "unlocked, go to the file" redirect inside the action response, and the client router would try to fetch a PDF as a page. A plain form POST answered with a 303 avoids that, and also works without JavaScript. |
| P8 | **Sharing pins the artifact** (`generated_artifacts.downloaded_at`), exactly as a download does. | Pinning records what the City received (R10.6), and a shared file is exactly that. Pinned rows are never swept, so a link's file can't disappear under it. |
| P9 | **The link points at one `generated_artifacts` row through a five-column foreign key**: `(artifact_id, org_id, funding_source_id, month, artifact_type)` → `generated_artifacts(id, org_id, funding_source_id, month, type)`. | Appendix A: "A link must never give access to anything else in the organization: only its one file." With this key, a row pointing at another org's, source's, month's or kind's file can't be stored at all. |
| P10 | **Opening a link streams the saved object and never calls a generator.** The storage driver gains `stream(key)`. The file is sent whole with `Accept-Ranges: none`. | A 73 MB packet read into a Buffer per open would sit in memory on a 3.7 GB box shared with Postgres. pdf-lib's output isn't linearized, so Chrome's viewer gains little from range requests. One request per open also keeps the per-IP backstop (`shareOpen`, 60 per 15 minutes) meaningful. |
| P11 | **Downloads and sharing share one gate-and-build path.** The deletions check, snapshot, filename rule and R4.3 gate move from the two download routes into `prepareMonthOutput` (`src/modules/packet/month-output.ts`). Generator versions move to `src/generation/versions.ts`. | Two copies of a gate drift, and this project's escaped defects were exactly that. The download routes keep their own session, cross-site, rate-limit and response code, and must behave byte for byte as before. |
| P12 | **Creating and updating a shared file run in POST route handlers** that wrap Server Actions (`app/api/shared-links/{create,update}/route.ts`), like `app/api/monthly-summary/write/route.ts`. Change password and Stop sharing are ordinary Server Actions. | A packet can take a minute or two to build. A Server Action that long blocks every other action in the tab. |
| P13 | **One build at a time per file** (org, source, month, kind), with an in-process set like `monthly-summary/single-flight.ts`. The database's active-row index settles any race that slips past it. | A double click or two people sharing together must not build a 70 MB packet twice. |
| P14 | **"Records changed" compares the shared artifact's `inputs_hash` with the hash the month would have now**, from `loadMonthSnapshot`, which only reads the database. It is computed on page load only when the month has a shared link. | It is the same hash that decides whether a download rebuilds, so the notice appears exactly when a download would give a different file. That includes a changed month document, budget, prior month or organization name. A generator version bump also triggers it (§8). |
| P15 | **"Shared on … by …" shows the last share or update.** Update moves `shared_at` and `shared_by`. | Appendix A §4: "The 'Shared on' line then shows the new date." |
| P16 | **Stop sharing soft-revokes the row** (`revoked_at`, `revoked_by`) instead of deleting it. | The token stays reserved forever, and who stopped it is kept. |
| P17 | **Unavailable pages return 404** through `app/s/[token]/not-found.tsx`, with one wording for every cause. All of `/s/*` carries `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`. `robots.txt` is unchanged. | A 404 and noindex keep links out of search results. A `robots.txt` Disallow would stop crawlers from ever seeing the noindex. `no-referrer` keeps the token out of any Referer header. |
| P18 | **No `Sec-Fetch-Site` check on the public routes.** | Links arrive from webmail, which is exactly the cross-site navigation the download routes refuse. |
| P19 | **Packet tour copy:** the "Download" step now reads "Download the packet PDF for signing and the Excel summary, or share either with a link." | The Share link button sits inside that step's highlighted row. |

### 2.3 Answers from the user (2026-09-19)

| Question | Answer |
|---|---|
| Who does the 5-try lockout apply to? | That visitor only: per link and IP (P2). |
| What should "cancelled" do to links? | Paused or cancelled both stop links, with a note in the box for cancelled orgs (C4). |
| Which domain do links use? | `APP_URL`, required in production (P1). |
| The PDF tab shows the packet's title, not the file name | Keep the packet's title (C2). |

---

## 3. Data model (one migration, `0031`)

### `shared_links`

| Field | Type | Notes |
|---|---|---|
| id | uuid | `id()`, v7 |
| org_id | uuid | → organizations, cascade |
| funding_source_id | uuid | composite FK `(funding_source_id, org_id)` → `funding_sources(id, org_id)` |
| month | char(7) | `shared_links_month_ck` |
| artifact_type | `artifact_type` | `shared_links_artifact_type_ck`: `packet_pdf` or `summary_xlsx` |
| artifact_id | uuid | five-column FK to `generated_artifacts` (P9), NO ACTION |
| token | text | `shared_links_token_uq` over every row |
| password_hash | text, null | argon2id |
| filename | text | the file name when last shared or updated (R10.3; carries the source name once the org has more than one) |
| shared_by | uuid, null | → users, set null |
| shared_at | timestamptz | moves on Update |
| revoked_at | timestamptz, null | Stop sharing |
| revoked_by | uuid, null | → users, set null |
| created_at, updated_at | timestamptz | helpers |

- `shared_links_active_uq` on (org_id, funding_source_id, month, artifact_type) where
  `revoked_at is null`. This is the "one PDF link and one Excel link" rule.
- `generated_artifacts` gains `generated_artifacts_scope_id_uq` on
  (id, org_id, funding_source_id, month, type), which the five-column FK needs as its target.

---

## 4. One gate-and-build path

- **`src/generation/versions.ts`:** `PACKET_GENERATOR_VERSION` (`packet-12`) and
  `SUMMARY_GENERATOR_VERSION` (`summary-3`), with their bump-history comments moved from the routes.
- **`src/modules/packet/month-output.ts`** (server-only):
  - `prepareMonthOutput({ orgId, source, month, kind, confirmedDeletions })` returns either a
    refusal `{ status, message }` with today's texts and statuses, or `{ snapshot, hash, filename }`.
  - It holds the per-kind details: artifact type, extension, generator version, builder and
    filename.
- **`resolveArtifact`** also returns the artifact's id. With `withBody: false`, a cache hit only
  checks the object exists and pins it, instead of reading 73 MB.
- **`storage().stream(key)`** returns `{ body: ReadableStream, size }`. S3 uses
  `transformToWebStream`; local uses `createReadStream`, keeping the root-escape guard.
- **Other helpers:**
  - `inlineHeader(filename)` beside `attachmentHeader`;
  - `clientIp` and `clientIpFrom(headers)` in `src/services/client-ip.ts`, moved out of the
    `"use server"` auth actions;
  - `signWithAuthSecret(purpose, data)` in `tokens.ts`;
  - `siteOrigin()` in `src/lib/site-url.ts`.

---

## 5. Server surface

| Entry | What it does | Refuses with |
|---|---|---|
| `POST /api/shared-links/create` → `createSharedLinkAction({ fundingSourceId, month, kind, password, confirmedDeletions })` | Checks, `generate` budget, single-flight, `prepareMonthOutput`, `resolveArtifact({ withBody: false })`, inserts the row with a new token and the hashed password. Returns `{ url, kind, hasPassword }`. | Signed out; bad origin; body too large; the download routes' own refusals (missing documentation, deletions not confirmed, rate limit); "That file is already shared."; "This file is already being prepared."; password too short or long |
| `POST /api/shared-links/update` → `updateSharedFileAction({ shareId, confirmedDeletions })` | The same gates; points the row at the new artifact and moves `filename`, `shared_at` and `shared_by`. The token and password don't change. | As above, plus a stopped or foreign link ("That link is no longer shared.") |
| `changeSharedLinkPasswordAction({ shareId, password })` | Sets, replaces or (with `null`) removes the password. Uses the `sharePasswordSet` budget, 20 per hour per user. | Stopped or foreign link; password rules; rate limit |
| `stopSharingAction({ shareId })` | Sets `revoked_at` and `revoked_by`. | Stopped or foreign link |
| `loadSharedLinks(orgId, sourceId, month)` | Active rows for the packet tab: kind, URL, `hasPassword`, shared date and name, `changed`, plus `orgCancelled`. | — |
| `GET /s/<token>` (page) | Malformed or unavailable → 404 page. No password, or a valid unlock cookie → redirect to the file. Otherwise the password form. | — |
| `POST /s/<token>/unlock` | Same-origin form post: checks the password (P2), sets the unlock cookie, 303 to the file. Otherwise 303 back with `?e=wrong` or `?e=wait`. | — |
| `GET /s/<token>/<filename>` | `shareOpen` budget, looks the share up again, checks the cookie when a password is set, and streams the saved object. PDF is `inline`, Excel is `attachment`. `no-store`, `nosniff`, `Accept-Ranges: none`. | Unavailable or locked → 303 to `/s/<token>`; storage failure → 503 "This file can't be opened right now. Please try again in a few minutes." |

Every action starts with `actionSession()`, then `requireOwnedFundingSource`. Every lookup by
`shareId` is scoped to the session's org and to active rows. Both roles, every plan, locked months
and archived sources are allowed (Appendix A §1). The public lookup `loadPublicShare(token)`
treats a share as unavailable when it is revoked, its org is suspended, or its org's
`subscription_status` is `cancelled`.

---

## 6. Public side

- **`proxy.ts`:** paths starting `/s/` are public. The check is not `/s`, which would also match
  `/signup`.
- **`next.config.ts` `headers()`:** the P17 headers for `/s/:path*`. The page metadata sets the
  same robots and referrer rules.
- **`app/s/layout.tsx`:** the sign-in page's centred paper shell.
- **`app/s/[token]/page.tsx`:** the Stay Funded 360 logo (`/brand/stayfunded-logo.png`, as on
  sign-in), "This file is password protected.", a password field and **Open file**. It is a plain
  form, with the error message from `?e=` shown inline.
- **`app/s/[token]/not-found.tsx`:** the logo and "This link is no longer available. Please ask
  the sender for a new one."
- **Redirects use relative `Location` headers**, so nothing depends on the host Next sees behind
  Caddy.

---

## 7. UI (Month-End Packet tab)

- **Share link** sits in the download row as a secondary button, disabled while the red panel
  shows.
- The existing "Deleted from this month" dialog gates all four entries: two downloads, Share link
  and Update shared file. Its confirm button keeps the label "Continue to download".
- **The share dialog:**
  - "Share {Month YYYY} files".
  - Two choices with the ticket's hints; a shared one reads "Already shared" and shows that row
    instead.
  - "Require a password" reveals the field.
  - **Create link** / **Cancel**, showing "Preparing the packet…" or "Preparing…" while it works.
  - When done: the link, **Copy link** (toast "Link copied"), and the password note if one was set.
- **The "Shared links" box** sits inside the Packet contents card, below the buttons, with one row
  per shared file:
  - kind · password state;
  - "Shared on {date} by {name}";
  - the link and **Copy link**;
  - **Change password** · **Stop sharing**;
  - when the file is out of date, the changed notice and **Update shared file**.
- **A cancelled plan** adds the C4 note at the top of the box.
- **Layouts:** phone, tablet and desktop.

---

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Month with no expenses | Shareable, as it is downloadable. |
| "All" sources in the header | The page shows the source picker, so there is no Share link button. |
| Two people share the same file at once | Single-flight refuses the second while the first builds; the active-row index refuses a late duplicate; the UI refreshes to show the row. |
| Generator version bump | Every shared row shows "records changed" although no record moved. Update gives the new format behind the same link. Accepted. |
| A prior month, budget, source setting, organization name or month document changes | "Records changed": the snapshot covers all of them, and the file would differ. |
| The org goes from one source to two | The filename rule changes but the hash doesn't. The shared file keeps its name until the next Update. |
| Update on a locked month or archived source | Allowed. Sharing changes no record. |
| Someone opens the link during an Update | They get the old file until the row switches, which is one UPDATE. |
| The sharer's account is deleted | "by Unknown", as in the lock history. |
| Email link scanners (Outlook Safe Links, Gmail) | May fetch a no-password link. `shareOpen` bounds it; they can't get past a password. |
| The stored object is missing | 503 message. Never a partial file, never a rebuild. |
| Org paused, then reinstated | "No longer available", then working again, with the same link. |

---

## 9. Build phases

Each phase ends with typecheck, lint and the **full** suite green, plus its own checks. Each
follows plan → review → implement → review → browser test → commit.

### Phase 1 — Foundations (no screen changes)
- §4 in full, with the two download routes switched to `prepareMonthOutput`.
- The migration.
- The token and unlock-cookie helpers.
- The APP_URL boot check.

Checks: U-1..U-8; the existing download-route and login tests pass untouched; db-migration review.

### Phase 2 — Sharing server surface
- `src/modules/sharing/`: `queries.ts`, `actions.ts`, `single-flight.ts`, `public.ts`
  (`loadPublicShare`, `unlockSharedFile`).
- The two create and update routes.
- The rate limits.

Checks: I-1..I-12.

### Phase 3 — Public side
The proxy change, the headers, the `/s` layout, page and not-found page, and the unlock and file
routes.

Checks: I-13..I-20, U-9, U-10; first browser pass (B-2, B-3).

### Phase 4 — Packet tab
The Share link button, the dialog, the Shared links box, the update flow and the tour copy.

Checks: B-1, B-4..B-6, B-8 at 1280, 768 and 375 px.

### Phase 5 — Finish
- Docs: m06, data-model, architecture, README, deploy.
- `npm run db:fixture -- large` and B-7 in Chrome, Edge and Safari.
- An adversarial review of security, code structure and database, and usability.
- Results written here.

---

## 10. Tests and verification

### Unit (U) — pure, no database
- U-1 Token: length 12, alphabet, uniform rejection bound, `isShareToken` accepts and refuses.
- U-2 Unlock cookie: valid, tampered, expired, other share, password changed, password removed.
- U-3 `inlineHeader`: injection characters, length cap, RFC 8187 form.
- U-4 `siteOrigin` and the APP_URL boot check (missing, not http(s), trailing path).
- U-5 `clientIpFrom`: the same answers as today's login cases.
- U-6 `prepareMonthOutput` refusals keep today's texts and statuses. The two download routes'
  existing tests pass unchanged.
- U-7 `resolveArtifact` returns the id on hit, miss and conflicting insert; `withBody: false`
  never reads the object.
- U-8 Storage `stream` (local driver): bytes equal `get`, size correct, root escape refused.
- U-9 Proxy: `/s/x` public, `/signup` unaffected, `/sx` not public.
- U-10 Isolation (source-reading, after `download-isolation.test.ts`): nothing under `app/s/**` or
  in `modules/sharing/public.ts` imports a generator, `resolveArtifact` or `getSession`.

### Integration (I) — real Postgres
- I-1 Create each kind as a manager and as an admin; on a locked month; on an archived source.
- I-2 A second create of the same kind is refused; the database refuses a second active row.
- I-3 A blocked month is refused; deletions without confirmation are refused, with the download
  routes' texts.
- I-4 Sharing pins the artifact and reuses a downloaded one: no second object is written.
- I-5 Update after an expense edit: `changed` turns true; after the update, same token, new
  artifact, `shared_at` moved, `changed` false.
- I-6 A month-document upload and a prior-month edit also turn `changed` true.
- I-7 Change password: set, replace, remove.
- I-8 Stop sharing, then share again: a new token; the old one stays dead.
- I-9 Another org's `shareId` is refused by every action.
- I-10 The five-column FK refuses a row pointing at another org's, month's or kind's artifact.
- I-11 Single-flight: a concurrent second create or update is refused.
- I-12 `loadSharedLinks` never returns the password hash.
- I-13 The file route serves bytes equal to the stored object, with the right headers (PDF
  `inline`, Excel `attachment`).
- I-14 Opening a link N times leaves `generated_artifacts` and storage untouched, and no builder
  is called.
- I-15 Password: wrong → `?e=wrong`; the sixth try → `?e=wait`, even when right; another IP is
  unaffected; right → cookie → file.
- I-16 After a password change, the old password fails and the old cookie is refused. After
  removal, the link opens directly.
- I-17 A stopped link: the file and unlock routes 303 to `/s/<token>`, and `loadPublicShare` is
  null.
- I-18 Org suspended → unavailable; reinstated → available; cancelled → unavailable.
- I-19 A cross-origin unlock post is refused.
- I-20 `shareOpen` refuses past its budget.

### Mutation checks (break it, see a test fail, restore)
- Drop the `revoked_at` filter.
- Drop the org-status filter.
- Drop the password hash from the cookie signature.
- Count wrong tries after checking instead of before.
- Skip the reset on success.
- Remove `/s/` from the proxy.
- Let the file route ignore the cookie.
- Scope a `shareId` lookup without `org_id`.

### Browser (B) — 1280, 768 and 375 px, real app
- **B-1:** the button sits beside unchanged downloads; it is disabled by the red panel; the
  deletions dialog leads to the share dialog; create both kinds; Copy link; both rows; "Already
  shared".
- **B-2:** in a private window, the Excel link downloads with the Download Summary file name. The
  PDF asks for the password, refuses a wrong one, locks after five, and opens inline with the
  right one. References jump to receipts and back; a reload doesn't re-ask; Save and Print work.
- **B-3:** the unavailable page's wording and 404 status; the `X-Robots-Tag` and `Cache-Control`
  headers.
- **B-4:** change password (the old tab asks again); Stop sharing; share again with a new URL.
- **B-5:** edit an expense, and both rows show the notice; Update each, and the same URL gives the
  new file.
- **B-6:** suspend and reinstate from `/a`; cancelled status and the note.
- **B-7:** a packet of 70 MB or more opens in Chrome, Edge and Safari, and navigation works.
  Server memory stays flat while it streams.
- **B-8:** the dialog, the box and the password page at all three widths.

---

## 11. Env (`.env.example` + deploy note)

`APP_URL` is now **required in production**: the origin share links are built from, e.g.
`https://stayfunded360.com`. Set it in the production `.env` before deploying, or the app refuses
to start and `deploy.sh`'s health check fails. In development it falls back to
`http://localhost:3000`, so set `APP_URL=http://localhost:3001` in `.env.local` when the dev server
runs on 3001.

---

## 12. Strings (UI, in `src/domain/strings.ts`)

From Appendix A, verbatim:
- "Share link", "Share {Month YYYY} files", "Packet (PDF)", "Summary (Excel)" and their hints;
- "Already shared", "Require a password", "Create link", "Preparing the packet…";
- "Copy link", "Link copied", the password-protected note;
- "Shared links", "Password protected" / "No password", "Shared on {date} by {name}";
- "Change password", "Stop sharing", the Stop sharing question and body;
- the records-changed notice, "Update shared file";
- "This file is password protected.", "Open file", "That password isn't right.",
  "Too many tries. Please wait 15 minutes and try again.";
- "This link is no longer available. Please ask the sender for a new one."

Added by this plan (wording to review):
- "Preparing…" (Excel);
- "Use at least 6 characters." / "Use at most 128 characters.";
- "That file is already shared." / "This file is already being prepared.";
- "That link is no longer shared.";
- "Password changed." / "Password added." / "Password removed.";
- "Shared file updated.";
- "Couldn't copy the link. Select it and copy it yourself.";
- "These links don't open while your organization's plan is cancelled." (C4);
- "This file can't be opened right now. Please try again in a few minutes.";
- "Too many requests. Please wait a few minutes and try again.";
- the packet tour step (P19).

---

## Appendix A — Product spec (verbatim)

### Background

At month end the team downloads the packet PDF and the Excel summary and sends them to the City. The packet is often too big to email (one real month was 73 MB), so they upload files to Google Drive and send the Drive link.

The packet has clickable navigation: clicking an expense reference on a cover letter jumps to its receipt, and the receipt's footer jumps back. **Google Drive's viewer ignores these links.** The City reviewer has to download the file and open it in Chrome or Acrobat before navigation works.

### Goal

The team shares the month's files straight from the app with a link, for either file:

- **Packet (PDF):** the link opens the PDF in the browser's own PDF viewer, where all the navigation works.
- **Summary (Excel):** the link downloads the Excel file.

Each link can have a password and can be turned off at any time.

Each funding source and month can have **one PDF link and one Excel link**. A link keeps working until someone turns it off. It always gives the file as it was when it was last shared or updated. That file is saved, so opening the link never builds it again.

---

### 1. The Share link button (Month-End Packet tab)

"Download Packet (PDF)" and "Download Summary (Excel)" stay as they are. Add a third button next to them: **Share link**.

Share link follows the same rules as the downloads:

- While the red "missing documentation" message is showing, the button is disabled.
- If expenses were deleted from the month, the "Deleted from this month" dialog appears first. After the user presses "Continue to download", the share dialog opens.

Admins and managers can both share, on every plan. Sharing works on locked months and archived funding sources too, because it doesn't change any records.

### 2. Sharing a file

Pressing **Share link** opens a dialog:

- **Title:** "Share March 2026 files"
- **Which file:** two choices
  - **Packet (PDF)**: "Opens in the browser. Clickable references work in Chrome, Edge and Safari."
  - **Summary (Excel)**: "Downloads the Excel file."

  If a file already has a link, its choice says "Already shared". Picking it shows that file's link row instead (section 3).
- **Password:** a checkbox "Require a password", which shows a password field (at least 6 characters) when ticked.
- Buttons: **Create link** and **Cancel**.

Pressing **Create link** saves the chosen file as it is right now and makes its link. For a big month the packet can take a minute or two, like a download does, so show "Preparing the packet…" on the button while it works.

When it's ready, the dialog shows:

- The link, e.g. `https://stayfunded360.com/s/k7Qm2xPa9` (short and hard to guess)
- A **Copy link** button ("Link copied" toast)
- If a password was set: "Password protected. Send the password separately, for example by text."

Example: Misty shares the March packet with a password. Then she opens Share link again and shares the March summary without one. She now has two separate links.

### 3. Once a file has a link

The Month-End Packet tab shows a **"Shared links"** box below the buttons, with one row per shared file:

> **Packet (PDF)** · Password protected
> Shared on 04/08/2026 by Misty
> `https://stayfunded360.com/s/k7Qm2xPa9` **Copy link**
> **Change password** · **Stop sharing**
>
> **Summary (Excel)** · No password
> Shared on 04/08/2026 by Misty
> `https://stayfunded360.com/s/Rt4nW8cLe` **Copy link**
> **Change password** · **Stop sharing**

Each row only affects its own link:

- **Change password:** set a new password, add one, or remove it. The old password stops working straight away. The current password is never shown again after it's saved. A user who forgot it sets a new one.
- **Stop sharing:** asks "Stop sharing the March 2026 packet? Anyone who has the link won't be able to open it." (or "summary"), with **Stop sharing** and **Cancel**. After that, the row goes away. Sharing that file again gives a **new** link, and the old link never comes back.

### 4. When records change after sharing

A link keeps giving the file as it was when shared. If the month's expenses or documents change afterwards, that file's row says:

> "Your records changed since you shared this file on 04/08/2026. The link still gives the older file."
> **Update shared file**

**Update shared file** saves the file as it is now behind the **same link**, so the City doesn't need a new email. The "Shared on" line then shows the new date. The same rules as a download apply: the missing documentation and deleted expenses checks from section 1. The PDF and Excel rows are updated separately.

Example: Misty shares March on April 8. On April 10 she fixes the amount on a Staples invoice. Both rows show the "records changed" message. She presses **Update shared file** on each, and the City's existing links give the corrected files.

### 5. Opening a link (anyone, no account needed)

**No password:**

- **PDF link:** the packet opens directly in the browser's PDF viewer, full screen. The browser tab shows the file name, e.g. `Team_Pursuit_March_2026_Packet.pdf`. Clicking a reference jumps to the receipt, like it does in a downloaded file. The viewer's own download and print buttons work.
- **Excel link:** the Excel file downloads with the same name as the file from "Download Summary (Excel)".

**With a password:** first a simple page with the Stay Funded 360 logo:

- "This file is password protected."
- Password field and **Open file** button
- Wrong password: "That password isn't right."
- After 5 wrong tries: "Too many tries. Please wait 15 minutes and try again."

After the right password, the PDF opens or the Excel file downloads as above. The visitor shouldn't have to enter the password again for a while if they reload.

**Link no longer works** (turned off, or the organization's access is paused or cancelled from the admin dashboard): a simple page that says "This link is no longer available. Please ask the sender for a new one." It doesn't say which of these happened. If paused access is restored, the link works again.

Shared links and the password page must not appear in search engines.

---

### Good to know

- Browsers can't show Excel files, so the Excel link always downloads.
- Chrome on Android phones downloads PDFs instead of showing them. That's the phone's behaviour and is fine for this ticket.
- The app already saves each packet and Excel summary in storage when someone downloads it. A shared file should reuse that saved copy when nothing changed, not build or store a second one.
- A link must never give access to anything else in the organization: only its one file.

### Not part of this ticket

- Sharing month documents, cover sheets or the signed copy.
- One link that gives both files together.
- Expiry dates on links.
- Sending the link by email from the app.
- A count of how many times a link was opened.
- Showing sharing in the month's history.

### Done when

- A **Share link** button sits next to the two download buttons, which work exactly as before.
- Share link lets the user pick Packet (PDF) or Summary (Excel), with an optional password, and shows Copy link.
- Each funding source and month has at most one PDF link and one Excel link. Sharing an already-shared file shows its existing link.
- The Shared links box shows one row per file: the date, who shared it, whether it has a password, Copy link, Change password and Stop sharing. Each row only affects its own link.
- The PDF link opens in the browser viewer in Chrome, Edge and Safari. Clicking a cover letter reference jumps to its receipt, and the footer reference jumps back.
- The Excel link downloads the same file as "Download Summary (Excel)".
- A password-protected link asks for the password, refuses a wrong one, and pauses after 5 wrong tries.
- Changing a password makes the old one stop working immediately.
- Stop sharing makes the link show "This link is no longer available." Sharing again gives a new link.
- After an expense changes, each shared file shows the "records changed" message. Update shared file puts the new file behind the same link.
- Opening a link many times never builds the file again.
- A paused or cancelled organization's links show "no longer available" and work again once access is restored.
- A link from one organization can never open another organization's file or any other file.
- Tested with a large packet (70 MB or more): it opens and navigation works.
