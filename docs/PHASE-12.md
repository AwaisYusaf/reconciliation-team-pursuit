# Phase 12 — Share the month's packet and summary with a link

Status: **Phases 1–4 built, reviewed and browser-tested** (2026-09-19; the adversarial review and
its fixes are in §9 after Phase 4). Phase 5's large-packet run (B-7) and the Edge and Safari passes
are not done. The product spec is Appendix A, copied word for
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
| P2 | **Wrong passwords are counted per link and visitor** (`sharePasswordPerLinkIp`: 5 per 15 minutes, in-process like the login limits). Every limit is checked *before* the password is, so a sixth try is refused even when it is right; the fifth wrong try already answers "Too many tries…", since nothing is left of that visitor's budget. A right password resets that visitor's count. A second limit, `sharePasswordPerIp` (30 per 15 minutes across all links), bounds argon2 work from one address, as `loginPerIp` does for sign-in. There is deliberately **no** per-link limit across addresses. **Review round:** a visitor is keyed by `rateLimitSubject` — an IPv4 address whole, an IPv6 address by its /64, an IPv4 address written as IPv6 by the IPv4 part — and a guess no password could match (empty, under 6 or over 128 characters) costs no try and no hash. | D-44: an attacker's wrong guesses must never lock the real user out. A per-link cap would let anyone holding the link, from enough addresses, block the City. User, 2026-09-19: "that visitor only". One IPv6 subscriber holds a whole /64, which keyed on full addresses would be billions of fresh budgets. |
| P3 | **Token: 12 characters of `[0-9A-Za-z]`** from `crypto.randomBytes` with rejection sampling (bytes ≥ 248 are dropped, so every character is equally likely). Unique across all rows, including stopped ones. | See C1. The unique index over every row means a stopped link's token can never come back. |
| P4 | **The token is stored as written**, not hashed. | The Shared links box shows the link again for Copy link. Sessions hash their token because nobody needs to read it back. Anyone who can read this table can already read the files themselves from storage. |
| P5 | **Passwords: 6–128 characters, argon2id** (`hashPassword`/`verifyPassword`), never sent to the browser. Only a `hasPassword` boolean leaves the server. | 6 is the ticket's minimum. 128 bounds argon2's input on an unauthenticated path. |
| P6 | **"For a while" is 12 hours.** After the right password, a signed cookie (`share_unlock`, `__Secure-` prefix in production, `Path=/s/<token>`, HttpOnly, SameSite=Lax) holds `expiry.HMAC(share id, password hash, expiry)` keyed by `AUTH_SECRET`. | Binding the password hash means changing, adding or removing a password invalidates every earlier unlock at once (Appendix A §3: "The old password stops working straight away"). Revoking the link needs nothing extra, because every request looks the share up again. |
| P7 | **The password form posts to a route handler, not a Server Action.** It is a real `<form method="post" action="/s/<token>/unlock">`: with the page's script loaded, the submit is sent as JSON and answered in place (errors inline; on success `location.replace` for the PDF, so Back doesn't land on a page that immediately redirects, and `location.assign` for Excel, then "Your download has started."). Posted before the script loaded, it arrives urlencoded and is answered with a 303 — to the file with the cookie, or back to `/s/<token>?e=wrong` / `?e=wait` / `?e=refused` (review round). | In Next 16, setting a cookie in a Server Action re-renders the current page in the same round trip (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, "Cookie Behavior in Server Functions"). The re-rendered `/s/<token>` would run its own "unlocked, go to the file" redirect inside the action response, and the client router would fetch the PDF as page data. The browser pass found the second half: a form with no `method` pressed before hydration would have done a native GET, with the password in the URL. |
| P8 | **Sharing pins the artifact** (`generated_artifacts.downloaded_at`), exactly as a download does. | Pinning records what the City received (R10.6), and a shared file is exactly that. Pinned rows are never swept, so a link's file can't disappear under it. |
| P9 | **The link points at one `generated_artifacts` row through a five-column foreign key**: `(artifact_id, org_id, funding_source_id, month, artifact_type)` → `generated_artifacts(id, org_id, funding_source_id, month, type)`. | Appendix A: "A link must never give access to anything else in the organization: only its one file." With this key, a row pointing at another org's, source's, month's or kind's file can't be stored at all. |
| P10 | **Opening a link streams the saved object and never calls a generator.** The storage driver gains `stream(key)` and `stat(key)`. The file is sent whole with `Accept-Ranges: none`. `HEAD` is exported explicitly and answers from `stat` alone. A refused GET (too many opens, or the object unreadable) goes back to the link's page with `?e=busy` / `?e=unreadable` — shown there instead of redirecting to the file again — while a HEAD gets the bare 429 / 503 (review round). | A 73 MB packet read into a Buffer per open would sit in memory on a 3.7 GB box shared with Postgres. pdf-lib's output isn't linearized, so Chrome's viewer gains little from range requests, and with ranges Firefox's pdf.js would make hundreds of 64 KB requests. Next answers `HEAD` by running `GET` when no `HEAD` is exported, so every link preview would otherwise open a 70 MB stream. A City reviewer should see the same card and wording on every refusal, not a bare text page. |
| P11 | **Downloads and sharing share one gate-and-build path.** The deletions check, snapshot, filename rule and R4.3 gate move from the two download routes into `prepareMonthOutput` (`src/modules/packet/month-output.ts`). Generator versions move to `src/generation/versions.ts`. | Two copies of a gate drift, and this project's escaped defects were exactly that. The download routes keep their own session, cross-site, rate-limit and response code, and must behave byte for byte as before. |
| P12 | **Creating and updating a shared file run in POST route handlers** that wrap Server Actions (`app/api/shared-links/{create,update}/route.ts`), like `app/api/monthly-summary/write/route.ts`. Change password and Stop sharing are ordinary Server Actions. | A packet can take a minute or two to build. A Server Action that long blocks every other action in the tab. |
| P13 | **One build at a time per file** (org, source, month, kind), with an in-process set like `monthly-summary/single-flight.ts`. The database's active-row index settles any race that slips past it. | A double click or two people sharing together must not build a 70 MB packet twice. |
| P14 | **"Records changed" compares a stored `records_hash` with the records the file is built from.** `monthOutputRecordsHash(kind, snapshot)` (`month-output.ts`) hashes the snapshot without any generator version — the whole snapshot for the packet, and for the summary the snapshot with every expense's documents and the month documents left out, since the workbook prints none (review round). It is stored on the row at share and at Update, and compared on page load (the snapshot reads only the database, about six queries, and only when the month has a shared link). | The message says "Your records changed", so it must only appear when the file would. Comparing the file's cache key would show it on every shared row after any release that bumps a generator version, and hashing documents for the summary flagged a shared workbook after every late receipt although its figures hadn't moved. |
| P15 | **"Shared on … by …" shows the last share or update.** Update moves `shared_at` and `shared_by`. | Appendix A §4: "The 'Shared on' line then shows the new date." |
| P16 | **Stop sharing soft-revokes the row** (`revoked_at`, `revoked_by`) and clears `password_hash`. The row is kept. The database enforces both halves: `shared_links_revoked_password_ck` and `shared_links_revoked_by_ck` (review round). | The token stays reserved forever, and who stopped it is kept. A dead link has no reason to keep a password hash. |
| P17 | **Unavailable pages return 404** through `app/s/[token]/not-found.tsx`, with one wording for every cause. All of `/s/*` carries `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`. `robots.txt` is unchanged. | A 404 and noindex keep links out of search results. A `robots.txt` Disallow would stop crawlers from ever seeing the noindex. `no-referrer` keeps the token out of any Referer header. |
| P18 | **No `Sec-Fetch-Site` check on the public routes.** | Links arrive from webmail, which is exactly the cross-site navigation the download routes refuse. |
| P19 | **Packet tour copy:** the "Download" step now reads "Download the packet PDF for signing and the Excel summary, or share either with a link." | The Share link button sits inside that step's highlighted row. |
| P20 | **The public route also checks `keyBelongsToOrg(s3Key, orgId)`**, ignores the `[filename]` path segment and reads no query parameters. | Defence in depth behind P9: the key comes from the database, but a check that costs nothing makes a future bug fail closed. |
| P21 | **The row keeps `created_by`** (who first shared it) as well as `shared_by` (who put the current file there). | Update moves `shared_by`. Without `created_by` the first sharer would be lost. |
| P22 | **Sharing counts as delivery in the staff dashboard.** Its "packets downloaded" figure counts pinned packet rows, and sharing pins (P8). | Accepted: a shared packet has reached the City. Recorded so the number isn't read as downloads only. |

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
| token | text | `shared_links_token_uq` over every row; `shared_links_token_ck` `^[0-9A-Za-z]{12}$` |
| password_hash | text, null | argon2id |
| filename | text | the file name when last shared or updated (R10.3; carries the source name once the org has more than one) |
| records_hash | text | `recordsHash(snapshot)` when last shared or updated (P14) |
| created_by | uuid, null | → users, set null (P21) |
| shared_by | uuid, null | → users, set null |
| shared_at | timestamptz | moves on Update |
| revoked_at | timestamptz, null | Stop sharing |
| revoked_by | uuid, null | → users, set null |
| created_at, updated_at | timestamptz | helpers |

- `shared_links_active_uq` on (org_id, funding_source_id, month, artifact_type) where
  `revoked_at is null`. This is the "one PDF link and one Excel link" rule.
- `generated_artifacts` gains `generated_artifacts_scope_id_uq` on
  (id, org_id, funding_source_id, month, type), which the five-column FK needs as its target.
- The five-column FK is named explicitly, `shared_links_artifact_fk`: drizzle's generated name
  would pass Postgres's 63-character limit.
- **Ordering in the migration:** drizzle-kit writes foreign keys before `CREATE INDEX` statements
  (see 0029 and 0030). This FK needs `generated_artifacts_scope_id_uq` to exist first, so that
  index statement is moved above it by hand, as 0023 did. A migration test in the style of
  `src/db/migration-0027.test.ts` pins the order.

---

## 4. One gate-and-build path

- **`src/generation/versions.ts`:** `PACKET_GENERATOR_VERSION` (`packet-12`) and
  `SUMMARY_GENERATOR_VERSION` (`summary-3`), with their bump-history comments moved from the routes.
- **`src/modules/packet/month-output.ts`** (server-only):
  - `prepareMonthOutput({ orgId, source, month, kind, confirmedDeletions })` returns either a
    refusal `{ status, message }` with today's texts and statuses, or `{ snapshot, hash, filename }`.
  - It holds the per-kind details: artifact type, extension, generator version, builder and
    filename.
- **`resolveArtifact`** also returns the artifact's id, and **`ensureArtifact`** pins an output
  without reading it back: a cache hit only checks the object exists, instead of reading 73 MB.
  Both share one build per exact output while it runs (review round), so a download and a share of
  the same packet at the same moment assemble it once.
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
| `POST /api/shared-links/create` → `createSharedLinkAction({ fundingSourceId, month, kind, password, confirmedDeletions })` | Session and body checks (`readSignedInJson`), then `buildSharedFile`: the cancelled-plan refusal, single-flight, the `generate` budget, `prepareMonthOutput`, and `ensureMonthOutput` (`ensureArtifact`, which pins without reading the body; concurrent builds of the same output share one). Inside the claim it inserts the row with a new token and the hashed password. Returns `{ url, kind, hasPassword }`. An unexpected error answers a JSON 500 (`unexpectedShareFailure`). | Signed out; bad origin; body too large; "Files can't be shared while your organization's plan is cancelled."; the download routes' own refusals (missing documentation, deletions not confirmed, rate limit); "That file is already shared."; "This file is already being prepared."; password too short or long |
| `POST /api/shared-links/update` → `updateSharedFileAction({ shareId, confirmedDeletions })` | The same gates; points the row at the new artifact and moves `filename`, `shared_at` and `shared_by`. The token and password don't change. | As above, plus a stopped or foreign link ("That link is no longer shared.") |
| `changeSharedLinkPasswordAction({ shareId, password })` | Sets, replaces or (with `null`) removes the password. Uses the `sharePasswordSet` budget, 20 per hour per user. | Stopped or foreign link; password rules; rate limit |
| `stopSharedLinkAction({ shareId })` | Sets `revoked_at` and `revoked_by`, clears the password. | Stopped or foreign link |
| `loadSharedLinks(orgId, sourceId, month)` | Active rows for the packet tab, packet first: kind, URL, `hasPassword`, shared date and name, `recordsChanged`, plus `orgCancelled`. | — |
| `GET /s/<token>` (page) | Malformed or unavailable → 404 page. No password, or a valid unlock cookie → redirect to the file. Otherwise the password form. | — |
| `POST /s/<token>/unlock` | The password form. JSON from the page's script: checks the limits, then the password (P2); on success sets the unlock cookie and answers `{ ok: true, url }`. Urlencoded from a form posted before the script loaded: the same check, answered with a 303 to the file or back to the page with `?e=` (P7). The body is read with a 1,000-byte cap whatever `Content-Length` says. | 403 / 413 / 400 with "That request couldn't be completed…" (or `?e=refused`); `{ ok: false, error }` with "That password isn't right.", "Too many tries. Please wait 15 minutes and try again." (429) or the unavailable wording (404) |
| `GET` / `HEAD /s/<token>/<filename>` | `shareOpen` budget per visitor, looks the share up again, checks the cookie when a password is set, and streams the saved object. PDF is `inline`, Excel is `attachment`. `no-store`, `nosniff`, `Accept-Ranges: none`; `X-Robots-Tag` and `Referrer-Policy` from `next.config.ts`. `HEAD` answers from `stat` without opening the object. | Unavailable or locked → 303 to `/s/<token>`; too many opens → 303 to `?e=busy` (HEAD: 429); storage failure → 303 to `?e=unreadable` (HEAD: 503) — never a rebuild |

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
  sign-in), "This file is password protected.", and the password form (`unlock-form.tsx`, a small
  client component: the field, **Open file**, errors inline with `role="alert"`). There is no
  `loading.tsx` and no Suspense under `app/s`: a 404 status only survives if `notFound()` runs
  before streaming starts.
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
| Generator version bump | No "records changed" (P14): a shared file keeps its older format until the next Update, which only a real record change offers. Accepted: the link gives the file as it was shared, which is what Appendix A promises. |
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
- **First, tests that pin today's download behaviour**: every refusal and the 200 response of
  `/api/downloads/packet` and `/summary`, meaning status, body and headers. They are proven
  against the pre-refactor routes before the refactor lands.
- §4 in full, with the two download routes switched to `prepareMonthOutput`.
- The migration.
- The token and unlock-cookie helpers.
- The APP_URL boot check.

Checks: U-1..U-8; the existing download-route and login tests pass untouched; db-migration review.

**Results (2026-09-19).**
- **Built:**
  - `src/generation/versions.ts` holds all three generator versions, the cover sheet's too, so a
    reader never finds two of three there. The copied `"packet-12"` in
    `funding-sources/isolation.integration.test.ts` now imports it.
  - `src/modules/packet/month-output.ts`: `prepareMonthOutput`, `MONTH_OUTPUTS`,
    `monthOutputHash`, `resolveMonthOutput`, `ensureMonthOutput`, `monthOutputFailureMessage`.
    The two download routes now call it; the cover-sheet route only takes its version from the
    new module.
  - `resolveArtifact` returns `artifactId`. The new `ensureArtifact` pins without reading the
    object, and a conflicting insert falls back to the winning row and pins it.
  - Storage gained `stream` and `stat` on both drivers. `http.ts` gained `inlineHeader`.
  - `src/services/client-ip.ts` (`clientIp`, `clientIpFrom`) is moved out of the sign-in
    actions. `signWithAuthSecret` is in `tokens.ts`.
  - `src/lib/site-url.ts` (`siteOrigin`, `appUrlProblem`); `instrumentation.ts` now requires a
    valid `APP_URL` in production.
  - `recordsHash` in `cache-key.ts`.
  - `src/modules/sharing/token.ts` and `unlock-cookie.ts`.
  - Schema `shared_links`, plus `generated_artifacts_scope_id_uq`. Migration
    `0031_shared_links` has its index statement moved above the foreign key by hand.
  - `data-model.md`, `.env.example`, `.env.production.example` and `deploy-ec2.md` are updated.
- **Tests:**
  - `packet/download-routes.integration.test.ts` (21) pins both routes: every refusal's status
    and literal text, the refusal order, the 200 headers, pinning and cache reuse, the
    second-source filename, and 429. It was run against the pre-refactor routes (all 21 passed)
    before the refactor, then after it (all 21 passed).
  - `artifacts.integration.test.ts` (8), `client-ip.test.ts` (5), `site-url.test.ts` (5),
    `token.test.ts` (12), `unlock-cookie.test.ts` (12), `migration-0031.test.ts` (3), and
    additions to `http.test.ts` and `cache-key.test.ts`.
  - Full suite 1713 passed, none failed. Typecheck and lint are clean.
- **Mutation checks**, each caught and restored:
  - the source-name filename rule dropped;
  - the deletions and documentation gates swapped;
  - the token's bias guard removed;
  - the password hash dropped from the cookie signature;
  - `ensureArtifact` reading the object instead of checking it exists. The first run of this
    one was **not** caught: the test called `mockRestore()` before asserting, which clears the
    spy's calls. It is fixed and now fails as it should.
- **Migration:** applied to the local database. The down script below was rehearsed inside a
  rolled-back transaction. Postgres truncates the source foreign key's generated name to 63
  characters, as it already does for every sibling table's.
- **Deviations:**
  - `month-output.ts` sits in `src/modules/packet/`, as planned; the design pass had suggested
    `src/generation/`, but it reads the database, which `src/generation` must not.
  - The planned `withBody` flag became a second function, `ensureArtifact`, so the download
    routes keep a non-null `body` type.
- **Not verified:** anything from Phase 2 onward. There is no browser pass, because Phase 1 has
  no screen change; downloads are covered by the pinned route tests.

Down script for `0031`. **Superseded in the review round:** it must also remove the migration's
row, or a redeploy would skip 0031 (drizzle only runs migrations newer than the last one recorded).
Run for real on the local database on 2026-09-19, when 0031 was regenerated with its CHECKs.
0031 is purely additive, so a code-only rollback (`git reset` + `./deploy.sh --no-pull`) needs
none of this — the old code never reads the new table.

```sql
BEGIN;
DROP TABLE "shared_links";
DROP INDEX "generated_artifacts_scope_id_uq";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789796379003; -- 0031_shared_links "when"
COMMIT;
```

### Phase 2 — Sharing server surface
- `src/modules/sharing/`: `queries.ts`, `actions.ts`, `single-flight.ts`, `public.ts`
  (`loadPublicShare`, `unlockSharedFile`).
- The two create and update routes.
- The rate limits.

Checks: I-1..I-12.

**Results (2026-09-19).**
- **Built:**
  - `src/modules/sharing/`:
    - `actions.ts`: `createSharedLinkAction`, `updateSharedFileAction`,
      `changeSharedLinkPasswordAction`, `stopSharingAction`. Input is validated with zod, and
      every lookup by id goes through one `activeShareScope(orgId, id)`.
    - `queries.ts`: `loadSharedLinks`, `shareUrl`.
    - `public.ts`: `loadPublicShare`, `openShare`, `unlockSharedFile`, `sharedFileUrl`.
    - `single-flight.ts`.
  - `app/api/shared-links/{create,update}/route.ts`.
  - The four `LIMITS` entries (`sharePasswordPerLinkIp`, `sharePasswordPerIp`, `shareOpen`,
    `sharePasswordSet`) and the "Sharing (PHASE-12)" block in `UI`.
  - `generationBudgetMessage` in `month-output.ts`, now used by both download routes and
    sharing, so the 429 text exists once.
- **Deviation, a new shared helper:**
  - The two new routes would have been the second and third copies of the monthly-summary write
    route's guard block (session → origin → size → JSON). `src/lib/json-request.ts`
    (`readSignedInJson`) now holds it, and all three routes use it.
  - The write route's behaviour is unchanged: `write-route.test.ts` still passes (7).
  - Its source-reading wiring test (`screen.test.ts`) now follows the call into the helper.
- **Addition, Stop sharing beats a running Update:** "Update shared file" re-checks that the link is
  still active in the same `UPDATE` that moves the file. A Stop sharing that lands while a packet
  is building wins, rather than being silently undone.
- **Tests:**
  - `actions.integration.test.ts` (20): I-1..I-12, I-15, I-16, I-18, I-22, and a right password
    resetting that visitor's count.
  - `routes.test.ts` (10): both routes' guards.
  - `strings.test.ts` now pins the Appendix A wordings.
  - Full suite 1744 passed. Typecheck and lint are clean.
- **Mutation checks**, each caught and restored:
  - `revoked_at` filter dropped (I-8);
  - cancelled filter dropped (I-18);
  - password checked before the limits are consumed (I-7, I-15 and the reset test);
  - reset skipped on a right password;
  - `activeShareScope` without `org_id` (I-9).
  - The first attempt at the "check before consuming" mutation was built wrong (it still consumed
    first) and passed. It was rebuilt and caught.
- **Not verified:** the public routes and screen (Phases 3–4). There is no browser pass yet,
  since nothing is on screen.

### Phase 3 — Public side
The proxy change, the headers, the `/s` layout, page and not-found page, and the unlock and file
routes.

Checks: I-13..I-20, U-9, U-10; first browser pass (B-2, B-3).

**Results (2026-09-19).**
- **Built:**
  - `proxy.ts` treats `/s/` as public (not `/s`, which would match `/signup`).
  - `next.config.ts` sends `X-Robots-Tag: noindex, nofollow, noarchive` and
    `Referrer-Policy: no-referrer` on `/s/:path*`.
  - `app/s/layout.tsx` carries the metadata robots and referrer rules. `app/s/share-card.tsx` is
    the sign-in card with the logo.
  - `app/s/[token]/page.tsx` redirects to the file or shows the password card.
    `not-found.tsx` shows the unavailable message. `unlock-form.tsx` is the client form.
  - `app/s/[token]/unlock/route.ts` (POST, JSON) and `app/s/[token]/[filename]/route.ts`
    (GET and HEAD, streamed, cookie read from the request).
  - `CONTENT_TYPES` moved to `src/generation/content-types.ts`, so the public route doesn't import
    `artifacts.ts`.
- **Tests:**
  - `public-routes.integration.test.ts` (10): I-13, I-14, I-15 over HTTP, I-17, I-19, I-20, I-21,
    I-23, and a missing object answered with a 503 without a rebuild.
  - `public-isolation.test.ts` (42): no file under `app/s` and not `public.ts` imports a
    generator, the packet output path, the sharing actions or a session; the route streams.
  - `proxy.test.ts` (+3).
  - Full suite 1799 passed. Typecheck and lint are clean.
- **Mutation checks**, each caught and restored:
  - the file route ignoring a locked link (I-15);
  - the unlock route skipping the origin check (I-19);
  - serving through `get` instead of `stream` (I-14);
  - the route importing `artifacts.ts` (isolation).
- **Browser (dev server on :3100, fixture org "Share Browser Test", 2079-03):**
  - B-3:
    - An unknown token answers 404 with `X-Robots-Tag` and `Referrer-Policy`, plus
      `<meta name="robots" content="noindex, nofollow">`, and shows the unavailable card.
    - The no-password Excel link answers 307 to
      `/s/…/Team_Pursuit_March_2079_Summary.xlsx`, which answers 200 as an attachment with the
      Download Summary name.
    - The password link answers 200 with the password card.
  - B-2 in Chrome:
    - A wrong password shows "That password isn't right."
    - The right one moves the tab to `…/Team_Pursuit_March_2079_Packet.pdf`, and Chrome's own
      PDF viewer opens it inline. The tab reads "Team Pursuit March 2079 Packet" (C2), with
      8 pages and the viewer's download and print buttons.
  - Over real HTTP with curl:
    - The unlock sets `share_unlock` (`Path=/s/<token>`, HttpOnly, SameSite=Lax, 12 h).
    - With the cookie, the file is served inline with every P10/P17 header. Without it, a 303
      goes back to the link's page. HEAD answers with the length only.
  - The served PDF carries 12 internal go-to links and the outline (checked with pdf-lib).
  - The password and unavailable cards are also checked at 375 px.
- **Fix found in the browser:** the title-size overrides on `PageTitle` did nothing useful. `cn`
  doesn't merge Tailwind classes, so both sizes rendered and CSS order decided. The overrides are
  gone, and the unavailable message is now body text.
- **Not verified:**
  - Clicking a reference inside Chrome's viewer. The extension's capture of the PDF plugin stayed
    stale, so the click is left for B-7 on the large packet. The links are present in the served
    bytes.
  - Edge and Safari.
  - No file was downloaded in the browser; the Excel download is verified by headers.

### Phase 4 — Packet tab
The Share link button, the dialog, the Shared links box, the update flow and the tour copy.

Checks: B-1, B-4..B-6, B-8 at 1280, 768 and 375 px.

**Results (2026-09-19).**
- **Built:**
  - `packet-download-buttons.tsx`: a Share link button in the download row. It is disabled by
    the red panel and goes through the same "Deleted from this month" dialog as the downloads.
  - `share-link-dialog.tsx`: the dialog.
  - `shared-links.tsx`: the Shared links box. Each row offers Copy link, an inline Change
    password, Stop sharing (with a confirm), and Update shared file when records changed.
  - The packet tour's download step mentions sharing.
- **Tests:** `screen.test.ts` covers the wiring in the repo's source-reading style for screens.
- **Browser:** not run before the commit. It was run in the review round below, which also
  rewrote much of this UI.

### Adversarial review (2026-09-19)
Five reviewers read the branch against the ticket, the docs and the repo's review checklist:
- security and tenancy;
- red-team production failures;
- testing adequacy, which mutation-tested the guards;
- architecture, database and migration;
- docs, contract and UI fidelity.

Every finding was fixed, or kept with a reason recorded below. The full suite afterwards: 1870
tests in 143 files pass, and typecheck and lint are clean.

**Security and production failures — fixed:**
- **Chunked bodies skipped the size cap.** The public unlock route and the signed-in JSON routes
  checked only `Content-Length`. `readCappedText` in `src/lib/json-request.ts` now stops reading
  at the cap whatever the header says. It serves both `readJsonBody` (the public unlock) and
  `readSignedInJson` (session first).
- **IPv6 visitors could reset their budget.** A visitor could step through the addresses in their
  /64 and get a fresh 5-try budget each time. The share limits are now keyed on
  `rateLimitSubject(ip)`: IPv6 by /64, and IPv4-mapped IPv6 by its IPv4 address, so IPv4
  visitors don't all share one bucket.
- **Short guesses no longer cost tries.** A password under 6 or over 128 characters can't be
  right, so it is refused before any try is counted or any argon2 work is spent. An empty Enter
  on the password card sends nothing.
- **Two 70 MB builds of the same packet could run at once.** A download and a share started
  together each built the file. `buildOnce` in `src/generation/artifacts.ts` now makes concurrent
  builds of the same output share one promise, so downloads and shares build once.
- **Stale cleanup could delete a just-pinned artifact.** The delete now re-checks
  `downloaded_at is null` in the same statement, and the object is removed only when a row came
  back.
- **`APP_URL`:**
  - Production now requires https.
  - `deploy.sh` refuses to deploy without an https `APP_URL` in `.env`, before anything is
    replaced, and prints "Shared links will use …" on every deploy.
  - Confirming it names the permanent domain stays with the operator (§11).
- **Cancelled organisations** can't create or update a link (`UI.shareCancelledRefused`). The
  Share link button is disabled, and a note explains why. Before, such a link was created and
  never opened.
- **Unexpected server errors** in create and update now come back as a JSON 500 with a plain
  message (`unexpectedShareFailure`). The screen tells a dropped connection (`shareNetworkFailed`)
  apart from an expired session and from an unexpected answer (`shareUnexpected`).
- **Refusals from the file route are now shown on the link's own card.** Too many opens sends
  the visitor to `?e=busy`, and an unreadable object to `?e=unreadable`. Both show a message and
  an Open file link, with no redirect loop. HEAD still gets the bare status.
- **The form still works if the script hasn't loaded yet.** The unlock form is a real
  `<form method="post">`, so a slow phone can still post it. The route answers the urlencoded
  post with 303s (the file plus the cookie, or `?e=wrong`/`wait`/`refused`). The password never
  appears in a URL.

**Data model — fixed:**
- New CHECKs:
  - `shared_links_revoked_password_ck`: a stopped link holds no password hash.
  - `shared_links_revoked_by_ck`: `revoked_by` only alongside `revoked_at`.
- Migration 0031:
  - Regenerated, keeping the hand-ordered index before the FK.
  - `SET LOCAL lock_timeout = '5s'` added, so a blocked deploy fails fast instead of queueing
    sign-ins.
- The rollback script now also deletes 0031's `drizzle.__drizzle_migrations` row inside
  BEGIN/COMMIT. Without that, a redeploy would skip the migration.

**Records changed — fixed:**
- The summary's hash ignores documents. A late receipt or month document no longer flags the
  shared Excel, whose figures don't change (`monthOutputRecordsHash`).
- The `versions.ts` comment is corrected: a generator-version bump does not flag shared rows.

**Structure — fixed:**
- **Password bounds, one supplier.** The password bounds and the kind ↔ artifact-type mapping
  live in one pure module, `src/domain/shared-links.ts`. The actions, the public check, the
  screen and the strings read it.
- **Create and Update share `buildSharedFile`.** One private helper runs the cancelled check,
  single-flight, the budget, the download gates and the pinned build. The row write runs inside
  the claim.
- **Shared components.** `LinkField`, `PasswordFields` and `buildingLabel` are shared by the
  dialog and the box. The dialog lost its always-true `open` prop.
- **Headers.** `X-Robots-Tag` and `Referrer-Policy` come only from `next.config.ts`
  (`headers.test.ts`). The `CONTENT_TYPES` re-export is gone.
- **`share-card.tsx`** moved next to its users in `app/s/[token]/`.
- **Naming.** `stopSharingAction` is now `stopSharedLinkAction`.
- **Strings.** Every visitor-facing refusal is `UI.requestRefused`. Inline copy moved into
  `UI` (§12).
- **File hygiene.** The BOM and mojibake in `funding-sources/isolation.integration.test.ts` are
  fixed.

**Usability — fixed:**
- **Passwords.** Both password fields have a Show toggle and the "at least 6 characters" hint.
- **The dialog holds while building.** Cancel, ×, Escape and the backdrop are disabled while it
  builds (`Modal dismissDisabled`).
- **Focus:**
  - It moves to Copy link after creating.
  - After a password save it returns to Change password.
  - After Stop sharing it returns to the Share link button.
- **Update tracking.** Each row tracks its own Update (`updatingIds`), so two Updates don't
  steal each other's busy state.
- **Tap target.** Change password is a quiet Button with a 44 px target.
- **The `/a` note.** The "Packets downloaded" helper now reads "downloaded or shared" (P22).
- **Enter now submits (found in the browser pass).** Enter in a password field did nothing in
  the share dialog or in Change password, because neither was a form. Both are now forms with a
  submit-type button. The already-shared row sits outside the create form, since forms can't
  nest. `screen.test.ts` checks this, and both mutations (Save back on `onClick`, the row moved
  inside the form) were caught.

**Tests added or tightened:**
- The I-8 re-share assertion was vacuous. It is rewritten.
- New tests:
  - a stopped link leaves the box;
  - Update enforces the deletions gate;
  - a Stop landing during an Update build wins (a spy on `put`);
  - a second Update while one builds is refused;
  - the `generate` budget;
  - `sharePasswordPerIp`;
  - `sharePasswordSet`;
  - the IPv6 /64 grouping;
  - P20 through `loadPublicShare`;
  - the page's 404, redirect and notice cases (`page.test.ts`);
  - the production `__Secure-` cookie;
  - the APP_URL boot refusal (`src/lib/instrumentation.test.ts`);
  - the `/s/*` headers and no Suspense under `app/s`;
  - chunked and oversized bodies;
  - the form fallback;
  - the unlock answer's parsing (`unlock-answer.test.ts`);
  - the dialog's choice helpers (`share-choice.test.ts`);
  - packet-first ordering and "by Unknown".
- Tightened:
  - I-19 now proves cross-origin posts spend no tries.
  - I-20 checks the exact budget.
  - The database refusals assert the constraint's name.
  - The download cache test asserts no second write.
- The isolation test now resolves relative imports as well as `@/` ones.
- Mutation checks, each caught and restored:
  - no streaming cap;
  - short guesses spending a try;
  - no IPv6 grouping;
  - no embedded IPv4;
  - no shared build;
  - a cancelled org allowed;
  - the summary hash including documents;
  - a relative forbidden import;
  - http allowed in production;
  - the page ignoring a file-route notice;
  - the unlock answer trusting any URL;
  - Update ignoring a mid-build Stop;
  - the routes leaking an HTML 500;
  - the form fallback putting the password in the URL;
  - the two Enter checks.
- The reviewer's earlier uncaught mutations of the re-share, the box filter and the Update gate
  are now caught.

**Kept, with the reason:**
- **"Continue to download" still labels the deleted-items dialog** when it leads to Share link
  or Update. It is the ticket's wording. A clearer label is Awais's call.
- **The SEO pages keep their own `APP_URL` fallback.** `app/page.tsx`, `app/robots.ts` and
  `app/sitemap.ts` read `APP_URL` directly. They are prerendered by `next build` in the image,
  which has no `.env`, so `siteOrigin()` there would break the build.
- **Next still buffers each proxy-matched POST up to 10 MB** (`proxyClientMaxBodySize`). The
  route itself now reads at most 1 KB. Lowering the framework limit would affect every
  proxy-matched POST, so it is left at the default.
- **The login limiter** still keys on the full IPv6 address. It is outside this ticket; the
  share limits use `rateLimitSubject`.
- **Structure left for later:**
  - The three per-feature single-flight modules stay separate until one of them moves to an
    advisory lock.
  - The two download routes are still twin shells.
- **The reviewer checklist** (`.claude/skills/reconciliation-pr-review/references/repo-invariants.md`)
  still points generator versions at the route files; they live in `src/generation/versions.ts`.
  The main checkout has uncommitted edits to that file, so it is left to its owner.

**Browser pass (Chrome, dev server on :3100, the Mantaq org, August 2026):**
- **Packet tab:**
  - The Share link button is disabled while the red panel shows, and while the plan is
    cancelled, with the box's note.
  - Create with and without a password, the hint and the Show toggle.
  - While building, × is disabled and the button reads "Preparing the packet…".
  - Focus lands on Copy link. The Copy link toast shows.
  - The records-changed notice, then Update shared file: the date moves, the notice clears, and
    the toast reads "Shared file updated."
  - Change password.
  - Stop sharing, with the confirm text.
  - Enter creates the link and saves the password. A short password shows the hint's error and
    sends nothing.
- **Public link:**
  - The password card, the wrong-password message, and the lockout after five tries.
  - The old cookie is refused after a password change.
  - A stopped link and a cancelled org both show the unavailable card.
  - The right password opens the packet inline as "Mantaq August 2026 Packet". A reference on
    the Expense Index jumps to its heading (page 2 → 6), and the evidence page's footer reference
    jumps back. This closes the Phase 3 gap.
  - With the stored object moved aside, the link shows "This file can't be opened right now…"
    with Open file. Once the object is restored, Open file opens the PDF.
- **Form fallback over curl:**
  - A wrong password answers 303 to `?e=wrong`; a cross-site post answers 303 to `?e=refused`.
  - The right password answers 303 to the file with the path-scoped cookie. With the cookie,
    the file is 200 inline with every header.
  - Without the cookie, a 303 back to the link. An unknown token gets 404, and an oversized body
    413.
- **Widths:**
  - The dialog (both views) and the box at 500 px and at 375 px, in a same-origin iframe. The
    password card at 375 px.
  - No horizontal overflow; the link field truncates, and the buttons wrap.
- **Not verified:** Edge and Safari, and the 70 MB packet (B-7, Phase 5). No file was downloaded
  in the browser.

### Phase 5 — Finish
- Docs (m06, data-model, architecture, README, deploy) and the adversarial review: done in the
  review round above.
- Still to do: `npm run db:fixture -- large` and B-7 in Chrome, Edge and Safari. Then the Results
  go here.

---

## 10. Tests and verification

### Unit (U) — pure, no database
- U-1 Token: length 12, alphabet, uniform rejection bound; `isShareToken` refuses 11 and 13 characters, `-`, `_`, `../` and non-ASCII.
- U-2 Unlock cookie: valid, tampered, expired, expiry too far ahead, malformed, other share, password changed, password removed.
- U-3 `inlineHeader`: injection characters, length cap, RFC 8187 form.
- U-4 `siteOrigin` and the APP_URL boot check (missing, not http(s), trailing path).
- U-5 `clientIpFrom`: the same answers as today's login cases.
- U-6 `prepareMonthOutput` refusals keep today's texts and statuses. The two download routes'
  existing tests pass unchanged.
- U-7 `resolveArtifact` returns the id on hit, miss and conflicting insert; `ensureArtifact`
  never reads the object.
- U-8 Storage `stream` and `stat` (local driver): bytes equal `get`, size correct, root escape refused.
- U-11 `recordsHash`: ignores key order, changes when an amount changes, ignores the generator version.
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
- I-15 Password over JSON: wrong → `{ ok: false }` with "That password isn't right."; the fifth
  wrong try → 429 "Too many tries…", and the right password after it too; another address is
  unaffected; right → cookie (`Path=/s/<token>`, HttpOnly, SameSite=Lax) → file. The form fallback
  answers the same outcomes with 303s (`?e=wrong`, `?e=wait`, `?e=refused`, or the file).
- I-16 After a password change, the old password fails and the old cookie is refused. After
  removal, the link opens directly.
- I-17 A stopped link: the file route 303s to `/s/<token>`, the unlock route answers 404 with the
  unavailable wording, and `loadPublicShare` is null.
- I-18 Org suspended → unavailable; reinstated → available; cancelled → unavailable.
- I-19 A cross-origin unlock post is refused.
- I-20 `shareOpen` refuses past its budget.
- I-21 `HEAD` never opens the object.
- I-22 Deleting an org that has shares succeeds (the NO ACTION FK checks at statement end).
- I-23 Unknown, malformed and stopped tokens get an identical status and body.

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

`APP_URL` is now **required in production, and must be https**: the origin share links are built
from, e.g. `https://stayfunded360.com`. `deploy.sh` checks it in `.env` before building and prints
"Shared links will use …" on every deploy; the app also refuses to start without it. **Confirm it
names the permanent public domain before the first real share** — production's `.env` was first
written for `reconciliation.teampursuit.org`, and every link emailed to the City bakes the domain
in. In development it falls back to
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
- "Your download has started." (after the password, Excel links);
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

Added in the review round (wording to review): "Which file" (the dialog's heading, from the
ticket) · the password hint "At least 6 characters. You'll need to send it to whoever gets the
link." · "Show" / "Hide" · "Too many password changes. Try again in {n} minutes." · "Files can't be
shared while your organization's plan is cancelled." · "Couldn't reach the server — check your
connection and try again." · "Something went wrong. Please try again — if it keeps failing, contact
Mantaq." · "That request couldn't be completed. Reload the page and try again." (every route's own
guard refusal) · generic "Save" / "Saving…" / "Done" · the staff dashboard's "Counts each packet
the first time it was downloaded or shared." (P22).

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
