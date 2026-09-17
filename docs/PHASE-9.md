# Phase 9 — AB Solutions staff dashboard

Status: **Finished and verified — not yet deployed** (2026-09-16). All five phases are done:
Phases 1-4 are committed (`1f139ae`, `dd96b6f`, `e5ee969`, `577201b`) and Phase 5 is this
document's last Results block. Every "Done when" line in Appendix A was walked in a real
browser against an organization with real data, and every one passes; the ship gate is clean at
94 files / 1078 tests. **Releasing this needs one operator step that nothing else in the repo
needs: `npm run db:create-staff` per AB Solutions staff member, after `db:migrate`** — see
Phase 5's deploy note below and `docs/TASKS.md` S6. The product spec is Appendix A, copied word
for word.
Each build phase in §8 is written to run in a fresh chat: it names its own sources and its own checks.

---

## 1. What this is, in one paragraph

AB Solutions runs this app for every customer organization. This phase gives AB Solutions
staff their own login and their own dashboard at `/a`. On it they can see every organization
with its plan and status, open one to see account details and usage counts, and change its
plan, status, complimentary access and suspension. Every change is recorded with who made it,
when and why. Staff accounts are separate from customer accounts and are created by the
developer. Customers, including an organization's own admin, can never open `/a`.
Suspending an organization signs its users out right away and blocks sign-in. No data is changed.

---

## 2. Investigation — what already exists

| Area | Today | Source |
|---|---|---|
| `/a` guard | `session.role !== "admin"` → `/r`. **Every customer org's creator is an admin, so Misty gets in.** Guard lives only in the layout | `app/a/layout.tsx:10-15`, `app/a/page.tsx` ("Coming soon") |
| Auth | Custom (D-06). A single cookie (`SESSION_COOKIE`) holds a random token. The `sessions.id` column stores its HMAC. Revoking a session means deleting its row | `src/services/auth/tokens.ts`, `store.ts`, `session.ts` |
| Session resolve | `resolveSession` inner-joins sessions → users → organizations. All 31 `getSession()` callers (pages, actions, download/file routes) go through it | `src/services/auth/store.ts:63-121` |
| Users | `users.org_id` is NOT NULL, and roles are `admin`/`manager` only. A user outside an organization can't exist | `src/db/schema.ts:86, 145-172` |
| Sign in | Looks up the user joined to their org. On success it calls `startSession`, then redirects based on `onboardedAt` | `src/modules/auth/actions.ts:129-179` |
| Email uniqueness | Case-insensitive check, repeated in 5 places (`lower(users.email)`) | `auth/actions.ts:163,246`, `users/actions.ts:72`, `db/seed.ts:87`, `db/reset-password.ts:59` |
| Action auth | `actionSession()` / `requireAdmin()` return a typed failure, never throw | `src/lib/action-session.ts` |
| Operator scripts | `db:reset-password` copies the pattern this phase needs: load dotenv, open its own pool, print a generated password once | `src/db/reset-password.ts`, `package.json:19` |
| Organizations | `name`, `doc_name`, `onboarded_at` ("setup finished"), `created_at`. No plan, status or suspension columns | `schema.ts:114-141` |
| Last sign-in | Not stored. `sessions.created_at` disappears on logout, expiry and reset, so it can't stand in | — |
| Usage sources | `funding_sources.archived_at`, `expenses.month` / `created_at` / `deleted_at`, `month_statuses.submitted_at` / `locked_at`, `generated_artifacts.downloaded_at` (pinned on first download only), storage sum in `orgStorageError` | `schema.ts`, `src/services/storage/documents.ts:157-172` |
| Storage quota | `MAX_ORG_BYTES` = **5 GB** (R13.1). The ticket says 500 MB, and `documents.ts:110` has a stale "500 MB" comment | `documents.ts:55` |
| Audit tables | `expense_audit_events` (before/after jsonb) and `month_lock_events` (actor + reason). Both are org-scoped. There is no org-account log | `schema.ts:554-590, 725-751` |
| UI kit | `Dialog` (confirm + tone), `Modal` (forms), `Select`, `Field` / `Input` / `Textarea`, `TableCard` / `Th` / `Td`, `Card` / `PageTitle`, `reportResult` toast. No shared Badge or progress bar | `src/components/ui/*` |
| Patterns to copy | Client-side filters + table: `app/r/expenses/expenses-table.tsx:226-500`. Dialog with a reason field: `app/r/packet/month-lock.tsx:99-114, 220-250`. History list: `month-lock.tsx:256-318` | — |
| Dates | `ORG_TIME_ZONE = "America/Detroit"`, `todayIso`, `currentMonthKey`, `formatDateTimeUS`. No "16 Aug 2026" formatter | `src/domain/dates.ts` |
| Tours | Tour tests read fixed `/r` files, so new `/a` pages break nothing. **Don't add tours to `/a`** (it would need a `tour_key` enum migration and entangle `TOUR_SEQUENCE`) | `src/modules/tours/*` |
| Next 16 auth guidance | "Be cautious when doing checks in Layouts … these don't re-render on navigation". Check in the data layer or page instead | `node_modules/next/dist/docs/01-app/02-guides/authentication.md:1348-1356, 1456` |

---

## 3. Design decisions

1. **Staff live in their own tables, `staff_users` and `staff_sessions`.** Making `users.org_id`
   nullable would break the `SessionContext.orgId: string` contract that every org-scoped
   query relies on. It would also put a no-org account one missed `WHERE` away from customer
   data. Separate tables mean a staff token can never resolve through `resolveSession`, and a
   customer token can never resolve as staff.
2. **One cookie, two lookups.** The staff session uses the same `SESSION_COOKIE` and the same
   token, TTL, max-age and renewal helpers. `getSession()` looks in `sessions`, and a new
   `getStaffSession()` looks in `staff_sessions`. A token lives in exactly one table.
   `startSession`, `startStaffSession` and `endSession` delete the device's previous token from
   **both** tables, so switching account types on a shared laptop leaves nothing behind.
3. **One login form.** `signInAction` checks `users` first, then `staff_users`, and gives the
   same "unknown email" wording either way. A staff login redirects to `/a`. **Emails must be
   unique across both tables.** A shared `emailInUse(email)` helper replaces the separate copies
   of the check in signup, add-user and seed, and the staff-create script refuses any email
   already in `users`.
4. **Suspension is enforced where every request passes.** `resolveSession` adds
   `organizations.suspended_at IS NULL` to its query, so every page, server action and
   file/download route rejects a suspended org's session with no per-caller changes. Suspending
   also deletes that org's `sessions` rows in the same transaction, so users are signed out right
   away rather than on their next request.
5. **The paused message shows only after a correct password.** A wrong password on a suspended
   org gets the normal wrong-password message. Otherwise anyone could type an email and learn
   whether that organization is suspended.
6. **Every staff gate lives in a DAL helper, not just the layout (Next 16 guidance).**
   `requireStaffPage()` redirects: customer → own app, signed out → `/login`. Every `/a` page
   calls it at the top, and the layout calls it too to render the shell. `requireStaff()` is the
   action equivalent, and every admin action calls it first.
7. **Plan and status are enums on `organizations`; complimentary is a boolean plus an optional
   date; suspension is `suspended_at`.** There are no Stripe columns yet (YAGNI). Stripe will add
   its own ids and write these same fields.
8. **History is one new table, `org_account_events`,** with `before`/`after` jsonb snapshots of the
   account fields plus a `note`. The words shown on the page come from a pure
   `describeAccountEvent()`, not from stored text, so wording can change without a backfill. The
   "Organization signed up" line is built from `organizations.created_at` and has no row.
9. **Summary counts and filters share one pure function.** `summarize(rows)` produces the cards
   and `filterOrgs(rows, filter)` produces the table, from the same row list, so "counts match
   the list" holds by construction. Filtering happens on the client, as on the expenses list.
   `ponytail:` the whole directory loads in one query. Move to paginated server filtering if
   organizations reach the low thousands.
10. **Staff actions lock the org row** (`SELECT … FOR UPDATE`) inside the transaction, compare it
    with the requested change, then write the event. Two staff suspending at once give one
    success and one "Already suspended".
11. **No tours and no phone layout on `/a`.** The ticket asks for desktop and tablet.
    `TableCard` scrolls horizontally below that width.

---

## 4. Data model (one migration, `0027_*`)

```
enum org_plan                  = reconciliation | reconciliation_ai
enum subscription_status       = trial | active | past_due | cancelled
enum org_account_event_action  = plan_changed | complimentary_granted | complimentary_changed
                                 | complimentary_removed | suspended | reinstated

organizations  + plan                 org_plan            NOT NULL DEFAULT 'reconciliation'
               + subscription_status  subscription_status NOT NULL DEFAULT 'trial'
               + complimentary        boolean             NOT NULL DEFAULT false
               + complimentary_until  date                NULL      -- null = no end
               + suspended_at         timestamptz         NULL

users          + last_sign_in_at      timestamptz         NULL      -- written from ship date on

staff_users    id uuid pk · email text NOT NULL (unique lower(email)) · name text NOT NULL
               · password_hash text NOT NULL · created_at · updated_at

staff_sessions id text pk (HMAC of token) · staff_user_id uuid NOT NULL → staff_users ON DELETE CASCADE
               · expires_at timestamptz NOT NULL · created_at      (indexes: staff_user_id, expires_at)

org_account_events id uuid pk · org_id → organizations ON DELETE CASCADE
               · actor_staff_id → staff_users ON DELETE SET NULL (shows "Unknown")
               · action org_account_event_action NOT NULL
               · before jsonb NOT NULL · after jsonb NOT NULL   -- OrgAccountSnapshot
               · note text NULL · created_at                 (index: org_id, created_at)

type OrgAccountSnapshot = { plan, status, complimentary, complimentaryUntil: IsoDate|null, suspended: boolean }
```

**Backfill, added by hand to the generated SQL after the `ADD COLUMN`s:**
`UPDATE organizations SET subscription_status = 'active', complimentary = true;`
The migration runs this once, so every organization that exists at that moment becomes
Reconciliation · Active · Complimentary with no end date. Organizations created afterwards
take the column defaults (Trial, not complimentary).

**Deploy window:** old code still running between the migration and the restart inserts orgs
without these columns, so they get the defaults (Trial). That is the correct value for a new signup.

**Rollback:** drop the three new tables, the six new columns and the three enums. No existing
data is touched.

---

## 5. Server surface

| Where | What |
|---|---|
| `src/services/auth/store.ts` | `createStaffSession`, `resolveStaffSession` → `StaffSessionContext {staffId, email, name}`, `deleteStaffSession`; `resolveSession` adds the `suspended_at IS NULL` filter; `deleteSession` covers both tables |
| `src/services/auth/session.ts` | `getStaffSession = cache(...)`, `startStaffSession(staffId)`; `startSession` / `endSession` clear both tables |
| `src/lib/action-session.ts` | `requireStaff(): Promise<StaffSessionContext \| { denied }>` (signed out → `SESSION_EXPIRED`, customer → `FORBIDDEN`) |
| `src/modules/admin/guard.ts` | `requireStaffPage()`: staff → context; customer → `redirect(onboarded ? "/r" : "/onboarding/line-items")`; none → `redirect("/login")` |
| `src/modules/auth/emails.ts` | `emailInUse(email, reader?)`: checks `users` and `staff_users` |
| `src/modules/auth/actions.ts` | `signInAction`: users → staff fallback; suspended org + correct password → `fail(UI.orgAccessPaused)` with no session; on success sets `users.last_sign_in_at` |
| `src/modules/admin/queries.ts` | `loadOrgDirectory()` (one query: org fields + user count + max last sign-in), `loadOrgAccount(orgId)`, `loadOrgUsers(orgId)`, `loadOrgUsage(orgId)`, `loadOrgHistory(orgId)` |
| `src/modules/admin/directory.ts` (pure) | `complimentaryState(org, today)` → `none \| active \| ended`, `summarize(rows, today)`, `filterOrgs(rows, filter, today)`, `describeAccountEvent(event)` |
| `src/modules/admin/actions.ts` (`"use server"`) | `changePlanAction(orgId, plan, status, note)`, `setComplimentaryAction(orgId, enabled, until, note)`, `suspendOrgAction(orgId, reason)`, `reinstateOrgAction(orgId, note)` |
| `src/db/create-staff.ts` + `npm run db:create-staff -- --email --name [--password]` | Copies the `reset-password.ts` pattern. Refuses an email in either table. Prints a generated password once |
| `src/db/reset-password.ts` | Falls back to `staff_users` and deletes `staff_sessions` too, so a locked-out staff member has a recovery path |
| `src/domain/strings.ts` + domain-rules §12 | plan/status labels, `orgAccessPaused`, the suspend/reinstate dialog title and body, history templates, `ACCOUNT_NOTE_MAX_LENGTH` (700, like `UNLOCK_REASON_MAX_LENGTH`) |
| `src/domain/dates.ts` | `formatDateShort(iso)` "16 Aug 2026", `formatDateTimeShort(at)` "15 Sep 2026, 10:42" (both `ORG_TIME_ZONE`) |
| `src/domain/format.ts` | `formatBytes(n)` "212 MB" / "4.8 GB" (no existing helper) |

**Action validation (all four):**
- `orgId` must be a uuid; an unknown org returns "This organization no longer exists."
- Notes are trimmed and at most 700 characters; the suspend reason must be non-empty after trimming.
- `until` must be a valid ISO date (`isValidIsoDate`) or empty.
- The plan and status must be enum values.
- A change that changes nothing returns ok and writes no event.
- Changing plan or status never touches `suspended_at`.

---

## 6. Screens

- **`app/a/layout.tsx`**: a staff shell with the header "AB Solutions admin", the staff name,
  Log out and `AppToaster`. No month or funding-source selectors, no `AppNav`, no tour button.
- **`app/a/page.tsx`** (server) → **`directory-filters.tsx`** (client, the search box and two
  selects only). **Searching, filtering, counting and paging all run in SQL** — the first
  version narrowed an already-fetched array in the browser, so a search only ever looked at
  the rows on screen (client review, 2026-09-16). The filter lives in the URL (`q`, `plan`,
  `status`, `badge`, `page`), so a filtered view is linkable and Back works:
  - Eight summary tiles in one grid, four across (two at tablet), each carrying its group as a
    caption — Plan, Status or Access. Each is a `<Link>` that sets its filter, and the active
    one clears it. Counts come from `loadOrgSummary()`, one aggregate over **every**
    organization, never the current page (§7 Q10).
  - The search box waits **two seconds** after typing stops (client request), or Enter runs it
    at once; a line under the box says which is happening.
  - A `TableCard` with Organization (pinned) · Signed up · Plan · Status (+ badges) · Users ·
    Last sign-in, newest sign-up first, **ten per page** (`ORG_PAGE_SIZE`) with a pagination
    bar past that. The organization name is the link, and it carries the current query as
    `?back=` so the org page can return the reader to the list they came from.
- **`app/a/orgs/[id]/page.tsx`**. `params` is a Promise in Next 16. A non-uuid or unknown id →
  `notFound()`, rendered by `app/a/not-found.tsx` so the way out stays inside `/a`. A chevron
  back link sits above the first card.
  - **Account details** card: name / doc name, signed up, setup finished or "Not finished", and the plan · status · badges line. Also a users table with name, email, role and last sign-in, or "Not recorded yet" — the **first ten users** (`ORG_USERS_PREVIEW`), with "View all" raising it to `ORG_USERS_MAX`; both caps are applied in SQL.
  - **Usage** card:
    - funding sources "2 active, 1 archived"
    - expenses "412 total · 38 in September 2026"
    - last expense added
    - a storage bar "212 MB of 5 GB"
    - months submitted / locked
    - packets downloaded
  - **Actions** (client): Change plan (`Modal` with two `Select`s + note), Complimentary access (`Modal`: checkbox, `<Input type="date">`, note), Suspend (`Dialog tone="danger"`, reason required, confirm disabled until filled), Reinstate (`Dialog tone="neutral"`, optional note).
    - Errors show inside the dialog. On success: `reportResult` + `router.refresh()`, as in `month-lock.tsx:99-114`.
  - **History** card, newest first, capped at `ORG_HISTORY_LIMIT` (50). The "Organization signed up" line is always last.
- **Badge:** a local pill copied from `settings-sections.tsx:484-497`. Ended complimentary access uses the warning tone.
- **`app/(auth)/login/page.tsx` and `signup/page.tsx`:** a staff session → `redirect("/a")`.
- **Spec:** `docs/03-modules/m10-admin-dashboard.md` (Purpose / Scope / Data / Behavior / Acceptance / Claude Design prompt, per `m03-expenses-list.md`), plus a new row in the README module table.

---

## 7. Open questions — defaults applied unless told otherwise

| # | Question | Default |
|---|---|---|
| Q1 | Ticket says "212 MB of **500 MB**", but the real quota is **5 GB** (R13.1, `MAX_ORG_BYTES`) | Show the real quota from `MAX_ORG_BYTES`, and fix the stale comment at `documents.ts:110` |
| Q2 | "Packets downloaded": the app only records the *first* download of each distinct packet (`generated_artifacts.downloaded_at`) | Count packet artifacts with `downloaded_at` set ("distinct packets downloaded"). A true every-click count needs a new events table that would start empty. Say so if you want it |
| Q3 | "38 in September 2026": by reporting month or by date added? | Expenses whose reporting `month` = `currentMonthKey()`, excluding deleted. That matches what the org's own expenses list shows for the month |
| Q4 | Months submitted / locked are stored per funding source | Count funding-source months (the rows). Two sources both locking September count as 2 |
| Q5 | Complimentary card count: include ended ones? | Yes. Every org with complimentary on counts, and ended ones show in the warning colour so staff can act |
| Q6 | Does a complimentary end date of today count as ended? | No, it ends after that day. `until < todayIso()` in `ORG_TIME_ZONE` |
| Q7 | Allow an end date in the past? | Allowed. It shows as ended immediately |
| Q8 | Suspended org + wrong password | Normal wrong-password message; the paused message only after a correct password (§3.5) |
| Q9 | Should the backfill of existing orgs appear in History? | No row. The signed-up line is enough. Adding a "set at launch" system row is easy if wanted |
| Q10 | Summary cards: totals for all orgs, or for the filtered view? | All orgs (they are the filters). The table shows its own "N organizations" count |
| Q11 | Design gate: run Claude Design for m10 before building? | Write the prompt, then build directly from the existing kit. Run the design pass first only if you want it |

---

## 8. Build plan — five phases

Every phase ends at the **ship gate** (global CLAUDE.md):
- `npm run typecheck`, `npm run lint` and the **full** `npm test` all pass.
- Each guard is proven by a test that fails with the guard removed and passes with it restored.
- The diff is audited for debug leftovers.
- Phases 1, 2 and 5 touch auth and sessions, so they also get a `security-review` / `red-team-auditor` pass.

### Phase 1 — Staff accounts and the `/a` gate

**Read first:**
- `src/services/auth/{store,session,tokens}.ts`
- `src/lib/action-session.ts`
- `src/modules/auth/actions.ts:129-281`
- `app/a/layout.tsx`, `app/(auth)/login/page.tsx`
- `src/db/reset-password.ts`, `src/db/schema.ts:112-193`
- the Next 16 auth guide (lines 1348-1456)

**Build:**
1. Schema: the whole §4 migration in one go (`npm run db:generate`, then add the backfill `UPDATE` by hand). Later phases then need no migration.
2. Store and session: staff functions copied from the customer ones in the same files; `startSession` / `endSession` clear both tables.
3. `requireStaff()`, `requireStaffPage()`, `emailInUse()`. Replace the uniqueness checks in `signUpAction` and `createOrgUserAction` with it.
4. `signInAction`: staff fallback → `startStaffSession` → `redirect("/a")`; write `last_sign_in_at` for customers.
5. Login and signup pages redirect staff to `/a`. `app/a/layout.tsx` and `app/a/page.tsx` call `requireStaffPage()` (the page can stay a placeholder for now).
6. `db:create-staff` script. `reset-password` gains the staff fallback.

**Prove (integration, copying `src/services/auth/store.integration.test.ts` and `src/modules/packet/lock.integration.test.ts:19-21` mocks):**
- A staff token doesn't resolve through `resolveSession`, and a customer token doesn't resolve through `resolveStaffSession`.
- Staff sign-in creates a `staff_sessions` row and redirects to `/a`; a wrong password is refused with the normal message.
- `requireStaff()` denies signed out, customer admin and manager.
- Signup and add-user reject an email that belongs to staff; `create-staff` rejects a customer email.
- `last_sign_in_at` is set on sign-in.
- Existing orgs are backfilled to Active + complimentary; a new `signUpAction` org is Trial and not complimentary.

**Anti-patterns:**
- Don't make `users.org_id` nullable or add a `staff` role to `user_role`.
- Don't gate `/a` in the layout only.
- Don't add a second cookie.

**Results — Phase 1 (2026-09-16, branch `implementation/admin-dashboard`, not committed)**

Built as specified. Migration `drizzle/0027_easy_xavin.sql` carries the whole §4 data model with the
backfill `UPDATE` after the `ADD COLUMN`s. `staff_users` / `staff_sessions` / `org_account_events`,
`emailInUse`, `requireStaff`, `requireStaffPage`, the `signInAction` staff branch,
`users.last_sign_in_at`, `db:create-staff` and the `reset-password` staff fallback all landed.

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean (one `prefer-const` in a new test fixed) |
| `npm test` | 90 files, **989 tests**, all passing — up from 938 before this phase |
| Migration rehearsal | Throwaway database, 0000-0026 applied, org inserted, then 0027: that org came out `reconciliation` / `active` / `complimentary` with no end date and not suspended, and an org inserted afterwards came out `trial` / not complimentary. Database dropped |
| Fail-before: `emailInUse` staff branch | Neutralised → 4 tests fail (the helper, `signUpAction`, `createOrgUserAction`); restored → pass |
| Fail-before: `requireStaff` | Customers allowed through → the admin and manager refusal tests fail; restored → pass |

Security pass (staff auth): no token confusion — each resolver joins only its own tables, and
`app/api/*` plus every customer page goes through `getSession`. No redirect loops on the
staff/customer/expired paths. Accepted low-risk findings: sign-in timing already distinguishes a
known address from an unknown one (pre-existing), a staff address costs one extra small query,
`createOrgUserAction` reveals that an address belongs to staff (the spec requires the check, and it
is rate-limited), and a simultaneous signup + `db:create-staff` for one address can both succeed
(`ponytail:` note in `emails.ts` — no constraint spans two tables).

Cleanup: `src/db/migration-0027-backfill.test.ts` was a duplicate of `migration-0027.test.ts` and was
deleted.

**Not resolved:** one test failed once, on the run immediately after the Postgres container was
started, and the name was lost before it could be captured. Three later full runs all passed. Watch
for it; if it returns, capture the file and test name.

### Phase 2 — Suspension and the four account actions

**Read first:**
- this doc §3.4-3.5, §3.10, §5
- `src/modules/packet/actions.ts:176-230` (validated action with a reason field)
- `src/modules/expenses/actions.ts:298` (audit insert in a transaction)

**Build:**
1. `resolveSession` suspension filter.
2. `signInAction` paused branch.
3. `src/modules/admin/actions.ts`, with the four actions as in §5. Suspend = lock the org row, set `suspended_at`, delete the org's `sessions`, then insert the event, all in one transaction.
4. The §12 strings in `domain-rules.md` and `strings.ts`, and extend `strings.test.ts`.

**Prove:**
- Suspending org A deletes A's sessions and leaves org B's untouched; A's surviving token (created in a race) resolves to null.
- A's admin signing in with the correct password gets the paused message and no session row; with a wrong password, the wrong-password message.
- Reinstating lets the same credentials sign in, and a row count of A's expenses and funding sources is the same before suspend and after reinstate.
- A plan or status change on a suspended org leaves it suspended.
- Double suspend gives "Already suspended"; reinstating an org that isn't suspended is refused.
- An empty or whitespace reason is refused; a 701-character note is refused.
- An invalid date and an unknown or non-uuid org id are refused.
- A no-op change writes no event.
- Every event carries the actor, before/after and the note.
- Remove the suspension filter from `resolveSession` → the race test fails; restore it → it passes.

**Results — Phase 2 (2026-09-16, branch `implementation/admin-dashboard`, not committed)**

Built as specified, no migration needed (0027 already carries every column and table). `resolveSession`
gained the one `organizations.suspended_at IS NULL` filter; `signInAction` gained the paused branch
after `verifyPassword`; `src/modules/admin/actions.ts` holds the four actions, each behind
`requireStaff()` and a `SELECT … FOR UPDATE` on the org row; the §12 strings and
`ACCOUNT_NOTE_MAX_LENGTH` landed in `strings.ts` with `PLAN_LABELS` / `STATUS_LABELS`.

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 92 files, **1009 tests: 989 passing, 20 skipped**, plus the one pre-existing environmental failure below. Baseline measured on the same machine with this change stashed: 90 files, 989 tests, 969 passing, 20 skipped, the same one failing file — so this phase added 20 passing tests and zero regressions |
| Pre-existing failure | `src/generation/packet-trace.integration.test.ts` fails in `beforeAll`: this machine has Xpdf's `pdftotext` 4.00, which has no `-bbox-layout` flag (poppler-only). Identical on the stashed baseline, unrelated to this diff. Phase 1's "989 passing" figure was the **total** test count, not the passing count — the two numbers were conflated in that Results block |
| Fail-before: `resolveSession` filter | `isNull(organizations.suspendedAt)` removed → 3 tests fail (race-window resolve, `signInAction` no-session, files/download routes) → restored → 16/16 pass |
| Fail-before: suspend-time session delete | `tx.delete(sessions)` block removed → the org-A/org-B isolation test fails (`expected length 0, got 1`) → restored → pass |
| Fail-before: complimentary no-op guard | `if (row.complimentaryUntil === untilValue) return ok()` forced to always return → the `complimentary_changed` / `complimentary_removed` test fails → restored → pass |

Security pass (suspension and staff actions), run over this diff specifically:
- **No bypass path.** Every one of the five `app/api/*` route handlers calls `getSession()`, every
  `"use server"` module's exported actions call `actionSession` / `requireAdmin` / `requireStaff`, and
  the five non-`"use server"` modules that export unguarded functions (`packet/lock.ts`,
  `packet/snapshot.ts`, `expenses/references.ts`, `recurring/narrative.ts`, `settings/queries.ts`) are
  deliberately not action modules — each says so in its own header comment. `proxy.ts` only checks
  cookie *presence* and does no database work, so it neither enforces nor bypasses suspension. Only
  `app/page.tsx` and `app/layout.tsx` have no session check, and both are public by design.
- **Staff authorization:** all four actions are guarded (4 guards / 4 exports) and the denial is
  proven for both the customer (`FORBIDDEN`) and signed-out (`SESSION_EXPIRED`) cases, with nothing
  written in either.
- **Cross-org probing:** `isUuid` (anchored regex, `src/lib/ids.ts`) rejects a malformed id before it
  reaches Postgres, so no 22P02 escapes the `ActionResult` contract, and an unknown org and a non-uuid
  return the same `orgNoLongerExists`. Staff are authorized on every org by design, so distinguishing
  a real org from an absent one is not a leak here.
- **No enumeration:** the paused message is returned only after `verifyPassword` succeeds; a wrong
  password on a suspended org still gets `UI.signInWrongPassword` (asserted in the same test).
- **Injection / ReDoS:** plan and status are checked against `enumValues`, the note is length-capped
  and parameterized, `until` goes through `isValidIsoDate`'s anchored regex. No backtracking risk.
- Accepted low-risk findings: (1) a sign-in that lands in the paused branch does **not** reset the
  rate-limit buckets, so a paused org's own users can exhaust their budget while support is on the
  phone — deliberate, since resetting on a refused sign-in weakens the limiter. (2) A sign-in already
  in flight when the suspend commits can leave an orphan `sessions` row; it resolves to null forever
  and is swept on expiry. (3) `withLockedOrg` returning a `fail()` from inside `db.transaction`
  commits rather than rolls back — correct today because every refusal happens before any write, but
  fragile if a future edit writes first.

**Not verified:** no browser/UI check (Phase 4 has no screens yet); `packet-trace`'s PDF path was not
made to pass — a poppler `pdftotext` is needed on this machine; concurrency was tested only as two
simultaneous `suspendOrgAction` calls, not `changePlanAction` racing `suspendOrgAction`, and not under
load; nothing was run against production data.

### Phase 3 — Read models and pure logic

**Read first:**
- `src/services/storage/documents.ts:157-172` (storage sum, to copy)
- `src/modules/packet/queries.ts:319-364` (`userDisplay` for an actor that no longer exists)
- `src/domain/dates.ts`, `src/domain/format.ts`

**Build:** `queries.ts`, `directory.ts`, `formatDateShort` / `formatDateTimeShort` / `formatBytes`.

**Prove:**
- **Unit:**
  - `complimentaryState` edges: no date, until = today, until = yesterday.
  - `summarize` counts equal `filterOrgs(...).length` for every card, over a mixed fixture.
  - search is case-insensitive and trims; empty search = all.
  - `describeAccountEvent` for all six actions, plus a deleted actor shown as "Unknown".
  - date and byte formatters, including 0 bytes and the `ORG_TIME_ZONE` day boundary.
- **Integration:** a two-org fixture where usage counts
  - exclude deleted expenses
  - split active and archived funding sources
  - count only packet artifacts that have been downloaded
  - never include the other org's rows
  - produce a storage total equal to the `orgStorageError` sum

**Results — Phase 3 (2026-09-16, branch `implementation/admin-dashboard`, not committed)**

Built as specified. `src/modules/admin/queries.ts` holds the five read models, `src/modules/admin/directory.ts`
the four pure functions, and `formatDateShort` / `formatDateTimeShort` / `formatBytes` landed in
`src/domain/dates.ts` and `src/domain/format.ts`. The History wording strings went into `strings.ts`
and §12. No migration, no screens, no change to the Phase 2 actions.

Two deviations from the plan, both deliberate:

1. **The storage sum is shared, not copied.** The sum inside `orgStorageError` was extracted into an
   exported `orgStorageBytes(tx, orgId)` (`src/services/storage/documents.ts`), which both the quota
   check and `loadOrgUsage` now call. "The dashboard shows the number the quota enforces" therefore
   holds by construction rather than by two copies of the same SQL staying in sync by hand.
   `orgStorageError`'s behaviour and message are unchanged. The stale "500 MB" comment at
   `documents.ts:110` is fixed to 5 GB (§7 Q1).
2. **`userDisplay` was reused, not copied.** It already exists as `src/domain/user-display.ts` — the
   "Unknown" fallback for a deleted actor lives in `describeAccountEvent`, so the wording and the
   fallback sit in one pure place instead of two.

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 94 files, **1068 tests, all passing, zero skipped, zero failing**, exit 0 — up from the 1009 baseline, so this phase added 59 tests and zero regressions |
| Baseline check | The 1009 baseline was re-measured on this machine before the tests were written, with the phase's production code already in the tree: 92 files, 1009 passed, 0 skipped, 0 failed |
| Fail-before: deleted-expense exclusion | `isNull(expenses.deletedAt)` removed from `loadOrgUsage`'s expense queries → `expected 3 to be 2` at the `expensesTotal` assertion → restored → pass |
| Fail-before: cross-org scoping | `.where(eq(fundingSources.orgId, orgId))` removed from the funding-source count → `fundingSourcesActive: 13` against an expected `1`, 4 tests failing → restored → pass |
| Fail-before: `max()` fix (below) | The `toBeInstanceOf(Date)` assertions failed on the original raw-`sql` version and pass on the fixed one — the before/after was observed on the real code, not asserted |

**Bug caught in review, fixed in this phase.** `loadOrgDirectory`'s `lastSignInAt` and `loadOrgUsage`'s
`lastExpenseAt` were written as raw `` sql<Date | null>`max(...)` `` fragments. The generic on a raw
`sql` fragment is a compile-time annotation with no runtime effect: drizzle only applies a column's
type mapper for columns it recognises from the schema, so both values actually came back as the
driver's raw `"2026-02-01 00:00:00+00"` string while typechecking as `Date`. The first
`formatDateTimeShort` call on one in Phase 4 would have thrown `TypeError` on a real page. Both now
use drizzle's own `max()` (and `count()` for `userCount`, which also removes a `Number(...)` cast),
which carry the runtime mapper. The integration tests assert `instanceof Date` so this cannot return.

**Hardening added beyond the plan.** `loadOrgAccount`, `loadOrgUsers`, `loadOrgUsage` and
`loadOrgHistory` shape-check `orgId` with `isUuid` (`src/lib/ids.ts`) before it reaches a `uuid`
column, the same convention §5 already sets for the four actions. `orgId` comes from the
`/a/orgs/[id]` URL, and Postgres raises 22P02 on a malformed one — without the guard a crafted URL
would have been a 500 rather than the `notFound()` §6 calls for. `loadOrgAccount` returns `null`,
the two list loaders `[]`, and `loadOrgUsage` a zeroed `OrgUsage`.

No security pass this phase: every function added is read-only, nothing is a `"use server"` export or
otherwise callable from the client, and no new auth surface exists. `directory.ts` is pure and carries
no data, so it is safe for Phase 4 to import into a client component.

**Not verified:** nothing was run in a browser (Phase 4 has no screens yet), so the usage numbers were
proven equal to their SQL sources but not yet compared side by side against an organization's own
screens — that is Phase 5's check. `loadOrgDirectory` was measured only against a handful of
organizations, not at the scale §3.9's `ponytail:` note contemplates. Nothing was run against
production data.

### Phase 4 — Screens

**Read first:**
- §6
- `app/r/expenses/expenses-table.tsx:226-500`
- `app/r/packet/month-lock.tsx:51-114, 220-318`
- `src/components/ui/{dialog,modal,select,field,table,surfaces}.tsx`
- `app/r/layout.tsx` (shell to copy)
- `docs/03-modules/m03-expenses-list.md` (spec template)
- Next 16 docs for dynamic `params` and `notFound`

**Build:**
- `m10` spec with its design prompt.
- The staff layout shell, the directory page, the org page, the four dialogs and the badges.

**Prove:**
- Run the app (the `run` skill) with a seeded staff account, a customer admin and two orgs. Screenshot at 1280px and 768px.
- In the browser: filters and cards narrow the table; each dialog saves and adds a History line; errors show inside the dialog.
- A customer admin visiting `/a` and `/a/orgs/<id>` lands on `/r`; a staff user visiting `/r` lands on `/a`.

**Results — Phase 4 (2026-09-16, branch `implementation/admin-dashboard`, not committed)**

Built as specified: `app/a/layout.tsx` (staff shell), `app/a/page.tsx` + `org-directory.tsx`,
`app/a/badges.tsx`, `app/a/orgs/[id]/page.tsx` + `account-actions.tsx`, the `m10` spec with its
Claude Design prompt, the README module row, and eighteen new §12 strings. No migration, no change
to the Phase 2 actions (one stale comment fixed, no code), no new dependency, no tour on `/a`.
`summarize()` and `filterOrgs()` do all the counting and filtering; the only logic added to
`directory.ts` is the one-line pure `toggleFilterValue`.

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | succeeds; `/a` and `/a/orgs/[id]` both compile as dynamic (`ƒ`) routes |
| `npm test` | 94 files, **1077 tests, all passing, zero skipped, zero failing** — twice in a row. Up from the 1068 baseline: +3 `toggleFilterValue` tests and +6 string/boundary tests, so this phase added 9 tests and zero regressions |
| Fail-before: `toggleFilterValue` | `current === next ? null : next` forced to `return next` → 2 tests fail (clear-on-second-click, the falsy-value identity case) → restored → pass |
| Fail-before: American-spelling guard | one `UI` entry changed to "organisations" → the guard test fails → restored → pass |

**Browser verification.** Chrome driven over the DevTools Protocol against `next dev` (the
Playwright MCP server was not connected and this repo has no Playwright; a small CDP driver in a
scratchpad needed no dependency). A staff account was seeded with `db:create-staff` and a throwaway
customer org signed up through the real signup form; both were deleted afterwards, leaving the local
database at the 6 organizations it started with.

Verified at **1280px**, and re-checked at **768px** with zero page-level horizontal overflow on both
screens (the table itself scrolls inside `TableCard`, as §3.11 intends):

- The directory renders every organization, newest signup first, with the plan, status, badges,
  user count and last sign-in. The "N organizations" line equals the rendered row count.
- **All eight summary cards**, one at a time: each filters the table to exactly its own count and
  its own count only, sets `aria-pressed`, leaves every card's count unchanged while filtered (§7
  Q10), and clears on a second click. The four zero-count cards correctly show the empty state.
- Search narrows to matching names only, is case-insensitive, leaves the card counts alone, and
  ANDs with a card filter. A non-matching term shows "No organizations match these filters."
- Both `Select`s filter and stay in sync with the cards' pressed state.
- A row's organization link opens `/a/orgs/<id>`.
- The org page renders account details ("Setup finished: Not finished" for an org that never
  onboarded), the users table with "Not recorded yet", and every Usage line — funding sources,
  expenses with the month label, last expense, the `0 B of 5 GB` storage bar, months
  submitted/locked, and packets downloaded with its §7 Q2 helper line.
- **All four dialogs saved and each added exactly one History line** carrying the actor, the
  timestamp and the note/reason, with the "Organization signed up" line still last. Each write was
  confirmed against the database, not just the screen. Change plan → `reconciliation_ai`/`past_due`;
  complimentary with a past end date → `complimentary_until = 2020-01-31`, rendering as
  "Complimentary (ended 31 Jan 2020)" in the warning tone; suspend → `suspended_at` set and the
  Suspend button replaced by Reinstate; reinstate → `suspended_at` cleared.
- An **empty and a whitespace-only** suspend reason both keep the confirm button disabled.
- An **error renders inside the dialog**: with the Suspend dialog open, the org was suspended out
  of band (the two-staff race of §3.10) and confirming showed "This organization is already
  suspended." inside the panel.
- A non-uuid id and an unknown uuid both render the not-found page, and unauthenticated requests to
  `/a`, `/a/orgs/<uuid>` and `/a/orgs/` with a SQL-injection, path-traversal or non-uuid id all
  return 307 to `/login` — the gate fires before any database read, so none of them reaches a 500.
- **Guards, both directions:** a signed-in customer admin at `/a` and at `/a/orgs/<id>` lands on
  `/r`; a staff member at `/r`, `/r/expenses` and `/r/settings` lands on `/a`; Log out returns to
  `/login` and `/a` is then unreachable.

Two bugs were caught in review before testing and fixed in this phase:

1. **Stale dialog state after a save.** `ChangePlan` and `ComplimentaryAccess` reset their fields on
   *close*, but `router.refresh()` lands the new `org` prop asynchronously, so the reset put the
   pre-save values back and reopening the dialog showed the old plan. Both now seed their fields on
   *open*, which reads whatever props the latest render carries. The browser check asserts the
   reopened dialog shows the saved values.
2. An unused optional `today` prop on `AccountActions`, with a comment defending it — both deleted.

One visual fix after looking at the screenshots: the summary cards were `flex-1` with no maximum, so
the two-card rows stretched to the full content width while the four-card status row stayed narrow
and the three rows didn't line up. Capped at `max-w-[260px]`, matching Appendix A §3's "small cards".

**Deviations from §6, both deliberate:** (1) §6 says "clicking a row goes to the org page"; only the
organization name is the click target, as a real `<Link>` — the same sentence asks for it to be a
real link so it works from the keyboard, and a row-level `onClick` wrapping a link is the pattern
that breaks that. (2) Generic control words ("Save", "Cancel", column headers) are literals rather
than `strings.ts` entries, matching the existing convention in `expenses-table.tsx`; everything
Appendix A pins verbatim, and everything shared by more than one screen, goes through `UI`.

**Not verified:** no test renders these React components — this repo has `environment: "node"` and no
React testing library, and one was deliberately not added, so the screens are proven in a browser
rather than in the suite. The org page's Usage numbers were confirmed against their own SQL, not yet
side by side against the same organization's own screens (that is Phase 5's check), and they were
only exercised on a brand-new org where every count is 0 plus the existing seeded orgs — not against
an organization with real storage, packets or locked months. Nothing was run against production data,
no accessibility audit beyond `aria-pressed`/`aria-label`/labelled controls, and no check below
768px (desktop and tablet only, per the ticket).

### Phase 5 — Verification and docs

- The full ship gate, plus a `security-review` over the whole branch diff. Focus areas:
  - staff/customer token confusion
  - suspended-session bypass through the `app/api/*` routes
  - action auth
  - cross-org id probing on the admin actions
- A walk-through in the browser of every "Done when" line in Appendix A, with evidence recorded in a Results section here.
- Docs updated in the same change:
  - `data-model.md` (new tables and columns)
  - `domain-rules.md` §12
  - `decisions.md` D-98 (staff accounts separate from users), D-99 (suspension enforced in `resolveSession`), and the Q1-Q11 answers
  - `architecture.md` §Auth, fixing its stale `requireOrg` / `services/auth.ts` names while there
  - `m00-app-shell-auth.md` (staff login, paused message)
  - README map and module table
  - `TASKS.md`
- Deploy note: after `db:migrate` in production, run `db:create-staff` for each AB Solutions staff member. First check that the production image still ships `tsx` for it (`Dockerfile:58`).

**Results — Phase 5 (2026-09-16, branch `implementation/admin-dashboard`)**

Almost no feature code, as planned. One real security finding was fixed (below); everything
else in this phase is proof and documentation.

#### Security review of the whole feature diff (`git diff 236843a..HEAD`)

Read directly rather than delegated, over every file in the diff plus the surfaces it could
reach: `services/auth/{store,session}.ts`, `lib/action-session.ts`, `modules/admin/*`,
`modules/auth/{actions,emails}.ts`, `db/{create-staff,reset-password}.ts`, `proxy.ts`, all five
`app/api/*` route handlers, all ten `"use server"` modules, and every page under `app/a`,
`app/r` and `app/(auth)`.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | **Medium** | `signUpAction`'s "already signed in" guard is `requireSession()`, which only sees *customer* sessions. A signed-in staff member had no customer session and went straight through. The signup **page** redirects staff to `/a`, but server actions are directly invocable, and going through the action calls `startSession`, which clears **both** session tables — silently swapping the staff member onto a brand-new customer organization and leaving a junk row in the directory | **Fixed.** `signUpAction` now also refuses a `getStaffSession()`. New test `signUpAction refuses a staff session and creates no organization`; neutralising the check makes it fail with `NEXT_REDIRECT:/onboarding/line-items` and a created organization, restoring it makes it pass. Logged as D-101 |
| 2 | Low | `requireStaff()` answers a suspended organization's customer with `SESSION_EXPIRED` rather than `FORBIDDEN`, because `getSession()` already returns null for them | **Accepted.** Cosmetic: both are refusals, nothing is written either way, and no `/a` action is reachable by a customer in the first place |
| 3 | Low | A paused sign-in does not reset the rate-limit buckets, so a suspended org's own users can exhaust their login budget | **Accepted** (deliberate — resetting on a refused sign-in weakens the limiter). Recorded as TASKS P6 |
| 4 | Low | `createOrgUserAction` answers "email in use" for a staff address, so an org admin can probe whether an address belongs to AB Solutions | **Accepted.** The cross-table check is what §3.3 requires; the action is admin-only and rate-limited. TASKS P7 |
| 5 | Low | No constraint spans `users` and `staff_users`, so a signup and a `db:create-staff` run for one address at the same instant can both pass `emailInUse()` | **Accepted** (needs an operator script racing a live signup). TASKS P8 |
| 6 | Low | `withLockedOrg` returns `fail()` from inside `db.transaction`, which commits rather than rolls back | **Accepted** — correct today because every refusal precedes every write; fragile if a future edit writes first. TASKS P9 |
| 7 | Informational | Login distinguishes unknown-email from wrong-password | **Pre-existing** (TASKS P4, D-25), not introduced here. Phase 9 does not widen it: staff and customer misses return the identical string, and both do one argon2 verify |

Checked and found clean, with the evidence:
- **Token confusion.** The token hash is the primary key of exactly one of `sessions` /
  `staff_sessions`; `resolveSession` joins `sessions → users → organizations` and
  `resolveStaffSession` joins `staff_sessions → staff_users`, neither can see the other's rows,
  and `startSession`/`startStaffSession`/`endSession` all delete from **both**. Confirmed in a
  real browser: a staff session at `/r`, `/r/expenses` lands back on `/a`, and
  `GET /api/files/<uuid>` from a staff session returns **401** — staff genuinely cannot reach a
  customer's documents, as Appendix A §4 requires.
- **Nothing reaches data before the gate.** All three `/a` server files call
  `requireStaffPage()` as their first statement, before any loader; the layout calls it too
  (Next 16 layouts don't re-render on navigation). Signed out, `/a` and `/a/orgs/<id>` both
  redirect to `/login`.
- **Suspension has no bypass.** Guard coverage counted mechanically: all ten `"use server"`
  modules have at least as many guard calls as exported actions (admin 4/4, auth 8/8, expenses
  8/8, funding-sources 4/6, line-items 6/6, packet 4/4, recurring 4/4, settings 6/6, tours 3/3,
  users 4/5). All five `app/api/*` handlers call `getSession()`. Both `/onboarding` pages call
  `getSession()` and redirect on null. `proxy.ts` only checks cookie *presence* and does no
  database work, so it neither enforces nor bypasses anything. No `use cache`, no
  `unstable_cache`, no `revalidate`, and `getSession`/`getStaffSession` use React's
  per-request `cache()`, so no session survives its own request.
- **Cross-org id probing.** Staff are authorized on every organization by design, so there is
  nothing to probe *between* orgs; what matters is that a malformed id cannot escape the
  contract, and `isUuid` shape-checks it in all four actions and all four `orgId` read models
  before it reaches a `uuid` column. Verified in the browser at Phase 4: a non-uuid and an
  unknown uuid both render the not-found page rather than a 500.
- **Concurrency.** All four actions take `SELECT … FOR UPDATE` on the organization row inside
  the transaction, so plan/status/complimentary/suspend/reinstate serialize against each other,
  not just suspend against suspend. `suspendOrgAction`'s session delete is a **subquery**
  (`sessions.user_id IN (SELECT id FROM users WHERE org_id = …)`), not a JS array, so an
  organization with no users deletes nothing rather than matching everything.
- **Injection / XSS / ReDoS.** Plan and status are checked against `enumValues`, notes are
  length-capped and parameterized, `until` goes through `isValidIsoDate`'s anchored regex, and
  every History string is React-escaped. The one client-imported module, `admin/directory.ts`,
  is pure, imports no `db` and carries no data.

#### Browser walk-through — every "Done when" line in Appendix A

Chrome driven over the DevTools Protocol against `next dev`, the same approach Phase 4 used
(no Playwright in this repo, and the MCP server is not connected), extended with
`Target.createBrowserContext` so a **staff context and two customer contexts are live at the
same time** — which is what the suspension check actually needs. A staff account was seeded with
`db:create-staff` and a throwaway organization created through the real signup form.
**Crucially, and unlike Phase 4, the usage numbers were checked against Team Pursuit Global —
78 real expenses across seven months, three funding sources, 31 MB of documents, a submitted
and locked month — not against an empty new organization.** 112 assertions, all passing.

| # | Done when | Evidence | Verdict |
|---|---|---|---|
| 1 | Only AB Solutions staff open the dashboard; customer admins and managers, including Misty, can't | Signed out: `/a` and `/a/orgs/<id>` → `/login`. **The real Team Pursuit Global admin** (the Misty case — an org's own `admin`) signs in to `/r`, then `/a` → `/r` and `/a/orgs/<own id>` → `/r`, with no admin content in the HTML. Staff sign-in → `/a`, header reads "AB Solutions admin / Awais Khan / Log out" and carries no customer nav. Staff at `/r` and `/r/expenses` → `/a`; `GET /api/files/<uuid>` as staff → 401 | **PASS** |
| 2 | The list shows every org with signup date, plan, status and badges, and the summary counts match the list | 5 rows rendered = 5 rows in `organizations`; the "5 organizations" line equals the rendered rows; the two plan cards sum to 5 and the four status cards sum to 5; ordering newest-first (16 Sep, 14 Sep, 9 Sep, 24 Aug, 18 Aug); headers exactly Organization · Signed up · Plan · Status · Users · Last sign-in | **PASS** |
| 3 | Search, filters and clicking a summary card all narrow the list correctly | **All eight cards, one at a time:** each filters to exactly its own count, sets `aria-pressed`, leaves every card's count unchanged while filtered (§7 Q10), and clears on a second click — including the four zero-count cards. Search is case-insensitive, trims (`"  TEAM  "`), leaves card counts alone, ANDs with a card filter, and shows "No organizations match these filters." on a miss. Both `Select`s narrow and stay in sync with the cards' pressed state | **PASS** |
| 4 | An organization's page shows its account details and usage, and the numbers match what is in that organization's app | The side-by-side table below, read from both places in the same session | **PASS** |
| 5 | Changing the plan or status works and shows in History | Reconciliation/Trial → Reconciliation + AI/Past due with a note: fields written, page updated without a manual reload, exactly one History line ("… changed plan from Reconciliation to Reconciliation + AI and status from Trial to Past due – Upgraded after call with Misty"), `suspended_at` untouched, and reopening the dialog shows the **saved** values. Re-saving the same values writes no event | **PASS** |
| 6 | Complimentary access can be turned on with or without an end date, and an ended date shows as ended | On with no end → badge `Complimentary`. End date 2026-12-31 → badge `Complimentary until 31 Dec 2026`. End date 2026-01-31 (past) → badge `Complimentary (ended 31 Jan 2026)` in the **warning tone** (`bg-caution/10 text-caution`, `rgb(138, 90, 18)`), not the neutral one. Off → badge gone, both columns cleared. Each step added its own History line | **PASS** |
| 7 | Suspending signs everyone out and blocks sign-in with the message; reinstating lets them back in with nothing changed | Dialog title "Suspend Team Pursuit Global?" and Appendix A §7's text verbatim; confirm disabled on an empty **and** a whitespace-only reason, enabled once typed. On confirm: TPG's live session rows went **12 → 0**; the customer's already-open `/r/expenses` bounced to `/login` on its very next click; a **wrong** password still got "That password doesn't match this organization email." and the **correct** one got "Your organization's access is paused. Please contact support." with still zero sessions. After Reinstate (with a note), the same credentials signed back in to `/r` and the May 2026 list still showed its 9 rows; expenses/sources/month-statuses were `78/3/7` before and `78/3/7` after | **PASS** |
| 8 | Suspending one organization doesn't affect any other organization | A second organization's user was signed in throughout: its session rows were 2 before and 2 after TPG's suspension, and its open page still loaded afterwards | **PASS** |
| 9 | Every change shows in History with who made it, when, and the reason or note | All seven events written during the walk render as `16 Sep 2026, 03:0x – Awais Khan <what> – <note>`; History length always equalled the event count plus one, and "Organization signed up" stayed last. A 701-character note is refused **inside** the dialog ("Keep the note under 700 characters.") | **PASS** |
| 10 | Existing organizations start as Reconciliation · Active · Complimentary, and new sign-ups start as Reconciliation · Trial | All four pre-existing organizations render `Reconciliation` / `Active` + `Complimentary` (the migration backfill). A throwaway organization created through the **real signup form** came out `reconciliation \| trial \| false` in the database and rendered as `Reconciliation` / `Trial` with no badges | **PASS** |
| 11 | Screens look right on desktop and tablet | Screenshots at **1280** and **768** of the directory and the org page. Zero page-level horizontal overflow at both widths on both screens (`scrollWidth === clientWidth`); at 768 the cards reflow and only the table scrolls, inside `TableCard`, as §3.11 intends | **PASS** |

#### The usage numbers, side by side — Team Pursuit Global

The point of this phase: not "the query matches its own SQL" (Phase 3 proved that) but "the
dashboard matches the organization's own screens".

| Line | Staff dashboard says | The organization's own app says | Match |
|---|---|---|---|
| Funding sources | `3 active, 0 archived` | Settings → Funding Sources lists exactly three — Community Violence Intervention, Government, Government type Grant — none archived | ✅ |
| Expenses, total | `78 total` | `/r/expenses` with funding source = **All**, walked across every month the header offers: Feb 38 · May 9 · Jun 14 · Jul 12 · Aug 3 · Sep 1 · Oct 1, every other month 0 — **sum 78**. (The organization also has 3 soft-deleted expenses; both places show 78, not 81, so the deleted-row exclusion is proven live, not just in a unit test) | ✅ |
| Expenses, this month | `1 in September 2026` | the same list with September 2026 selected shows **1** row | ✅ |
| Last expense added | `10 Sep 2026` | no customer screen renders an expense's `created_at`, so this one is compared against its source column: `max(created_at) = 2026-09-10`. **Stated as a gap, not a match** | ⚠️ source-only |
| Storage | `31 MB of 5 GB` | no customer-facing storage screen exists either; compared against the bytes the quota itself enforces — `orgStorageBytes()` = **32,169,310**, and `formatBytes` rounds MB whole, so 31 MB is right. Since Phase 3 the dashboard and the quota call the *same function*, so these cannot drift | ⚠️ quota-only |
| Months submitted · locked | `1 · 1` | `/r/packet` month by month on the owning funding source: **May 2026** reads "Reconciled · Locked on 9/15/2026 by Team Persuit" and "Submitted 9/15/2026"; June 2026 and February 2026 read neither | ✅ |
| Packets downloaded | `0`, then `1` | proven by doing it: with the dashboard reading 0, the customer downloaded the May 2026 packet (`GET /api/downloads/packet` → **200**, a real 39-page build through LibreOffice and poppler). `generated_artifacts` packet rows with `downloaded_at` went 0 → 1 and the dashboard then read **1** | ✅ |
| Users | 4 rows, with roles and last sign-in | Settings → Users lists the same 4 | ✅ |

#### Ship gate

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | succeeds; `/a` and `/a/orgs/[id]` compile as dynamic (`ƒ`), as do `/login` and `/signup` now that they resolve a staff session |
| `npm test` | **94 files, 1078 tests, all passing, 0 skipped, 0 failing** — the 1077 baseline plus the one new test for the D-101 fix, so this phase added 1 test and zero regressions |
| Fail-before: the D-101 guard | `if (await getStaffSession())` neutralised → the new test fails (`NEXT_REDIRECT:/onboarding/line-items`, and an organization really was created — the finding was live, not theoretical) → restored → 8/8 pass |
| Diff audit | No `debugger`, no TODO/FIXME/TEMP/XXX/HACK, no `.only`/`.skip`, no stray scratch file in the repo, and lint (which fails on unused imports) is clean. The only `console.*` in the diff are the deliberate operator-CLI prints in `create-staff.ts` and `reset-password.ts` |
| Test-data cleanup | The seeded staff account, the throwaway organization, all seven `org_account_events`, the downloaded packet artifact and its file, and every session row were deleted; the customer account's password hash, `last_sign_in_at`, active month and active funding source were restored from a snapshot taken first. `diff` of the before/after dumps of `organizations` and `users` is **empty** |

**One flaky failure, investigated rather than waved off.** The first full run reported 1 failure:
`src/generation/docx-to-pdf.test.ts > leaves no temp directory behind`, expecting `[]` and
getting `['ngo-soffice-Ppt0J4']`. It is not a regression and not caused by this diff — Phase 9
touches nothing under `src/generation` except one wording string. The test snapshots the temp
directory first and then waits up to 10 s for any *new* `ngo-soffice-*` directory to clear,
because sibling test files convert concurrently and share the prefix; on a loaded machine
running 94 files in parallel a sibling conversion can outlive that window. `ngo-soffice-Ppt0J4`
was gone from the temp directory by the time it was checked, which is the definition of
concurrent rather than leaked, and the immediately following full run was 1078/1078 green.
Deliberately **not** "fixed" by widening the wait: that is pre-existing test infrastructure
outside this phase, and it deserves its own change rather than a quiet edit inside a feature
branch.

#### Docs finished in this change

`data-model.md` (the `0027` backfill and deploy-window note; `email` corrected from "citext" to
what the schema actually does, a unique index on `lower(email)`, in both `users` and
`staff_users`) · `domain-rules.md` §12 (audited every `UI.*` key used by `/a` and
`src/modules/admin` against it — complete, nothing missing) · `architecture.md` §Auth (rewritten:
the stale `requireOrg()` and `services/auth.ts` names replaced with the real
`requireSession`/`actionSession`/`requireAdmin`/`requireStaff`/`requireStaffPage`/`assertOrgAccess`
and their real files, plus the two-account-kinds and suspension models) · `m00-app-shell-auth.md`
(staff login, the paused message, and its login-error strings corrected to the American spellings
the app has used since the Phase 9 sweep) · `decisions.md` **D-100** (the Q1-Q11 answers and the
Phase 3-4 implementation choices) and **D-101** (the security fix) · `README.md` (map row for
this file, m10's Design gate marked `n/a` with the reason, and the build-progress line) ·
`TASKS.md` (deploy step S6, the four accepted Phase 9 security findings as P6-P9, the Phase 9
"recently landed" paragraph, and R6 struck through — the storage cap it calls unimplemented is
enforced, and this phase verified it live) · `deploy-ec2.md` (the deploy note below).

#### Deploy note — required with this release

There is no staff sign-up, so **until `db:create-staff` has been run at least once, `/a` is
unreachable by anyone.** That is the safe default, not a failure, but it does mean the release
is not finished when `deploy.sh` returns. After `deploy.sh` has applied migration `0027`, run
once per AB Solutions staff member:

```
docker compose -f docker-compose.prod.yml exec app \
  npm run db:create-staff -- --email <address> --name "<Full Name>"
```

With no `--password` a strong one is generated and printed **once** — hand it over out of band.
The script refuses an address that already belongs to a customer or to another staff account.
Also recorded as `docs/TASKS.md` S6 and in `deploy-ec2.md` § Operational notes.

**The `tsx` claim was verified, not repeated.** The plan said to check `Dockerfile:58`; the line
is now **`Dockerfile:60`**, `RUN npm ci --include=dev`, and the comment immediately above it
(lines 55-59) states that the flag is load-bearing precisely so `drizzle-kit` and `tsx` survive
`NODE_ENV=production`, "so `db:migrate` and `db:reset-password` would fail in the running
container" without it. `db:create-staff` is the identical `tsx --conditions=react-server`
invocation as `db:reset-password`, and `src/db/create-staff.ts` ships via `COPY . .`. One thing
the plan did not mention and that matters: `.dockerignore` excludes `.env.local`, so — exactly
as for `db:reset-password` — `DATABASE_URL` has to come from the container's own environment;
the script's `dotenv` call on a missing file is a no-op that leaves `process.env` alone.

#### Not verified

- **Nothing was run against production data**, and no production deploy or migration was run.
  The migration was rehearsed on a throwaway database in Phase 1, not on the real one.
- **"Last expense added" and "Storage" have no customer-facing screen to sit beside**, so those
  two lines were compared against their source column and against the quota's own function
  rather than against an organization's own UI. They are marked ⚠️ in the table above rather
  than claimed as matches.
- **Archived funding sources were not exercised live.** Team Pursuit Global has three sources and
  none archived, so the "0 archived" half of that line is a true reading of a zero, not a
  demonstration of the split; the split itself is covered by the Phase 3 integration test.
- **No React component test exists for these screens** — this repo runs `environment: "node"` with
  no React testing library, and one was deliberately not added, so `/a` is proven in a browser
  rather than in the suite. A refactor that breaks a screen without breaking a query would not be
  caught by `npm test`.
- **Concurrency was tested as two simultaneous `suspendOrgAction` calls (Phase 2) and one
  out-of-band suspend racing an open dialog (Phase 4)**, not as `changePlanAction` racing
  `suspendOrgAction`, and not under load. The row lock makes that safe by construction, but it
  was reasoned, not measured.
- **`loadOrgDirectory` was only ever run against five organizations**, nowhere near the scale
  §3.9's `ponytail:` note contemplates.
- **No accessibility audit** beyond `aria-pressed` / `aria-label` / labelled controls, and
  **nothing below 768px** was checked — the ticket asks for desktop and tablet only.
- **The staff sign-in does not record a last-sign-in for the staff member themselves.** Not asked
  for, not built.

---

## 9. Acceptance criteria → where each is proven

All eleven are proven and pass. The Phase 5 Results block above carries the browser evidence
line by line; this table says where each is held down in the suite as well.

| Done when | Proven in | Verdict |
|---|---|---|
| Only staff open the dashboard; Misty can't | P1 `requireStaff` / `requireStaffPage` tests + P4 browser check + **P5 browser, against Team Pursuit Global's own admin — the real Misty case — plus a 401 on the file route from a staff session** | ✅ |
| List shows every org with signup, plan, status, badges; counts match | P3 `summarize` = `filterOrgs` test + P4 browser + **P5: 5 rendered rows = 5 database rows, plan cards sum to 5, status cards sum to 5** | ✅ |
| Search, filters, summary cards narrow correctly | P3 unit + P4 browser + **P5: all eight cards, both Selects, case-insensitive and trimmed search, card ∧ search, and the empty state** | ✅ |
| Org page numbers match the org's app | P3 usage integration + **P5 side-by-side against Team Pursuit Global's own screens — 78 expenses summed month by month, 1 in September, 3 funding sources, 1 · 1 months, and a real packet download taking the count 0 → 1** | ✅ |
| Plan/status change works and shows in History | P2 action tests + P4 browser + **P5** | ✅ |
| Complimentary with/without end date; ended shows as ended | P2 + P3 `complimentaryState` edges + P4 + **P5, including the warning tone on the ended badge** | ✅ |
| Suspend signs everyone out and blocks sign-in with the message; reinstate restores with nothing changed | P2 suspension tests (including the fail-before proof) + **P5 end to end in three live browser contexts: 12 sessions → 0, the open page dies on the next click, the paused message on sign-in, and `78/3/7` unchanged across the whole cycle** | ✅ |
| Suspending one org doesn't affect another | P2 two-org session test + **P5: the other organization's sessions were 2 before and 2 after, and its open page still worked** | ✅ |
| Every change shows who, when, reason/note | P2 event-shape assertions + P3 `describeAccountEvent` + **P5: seven real events rendered with actor, timestamp and note** | ✅ |
| Existing orgs = Reconciliation · Active · Complimentary; new = Reconciliation · Trial | P1 backfill + signup test + **P5: four backfilled organizations and one created through the real signup form** | ✅ |
| Desktop and tablet look right | P4 screenshots at 1280 / 768 + **P5 screenshots of both screens at both widths, zero page-level horizontal overflow** | ✅ |

---

## Appendix A — Product spec (verbatim, 2026-09-15)

AB Solutions runs this app for every organization that uses it. Today there is no screen to see who those organizations are or to manage their access.

Today:

- The admin area (`/a`) only says "Admin dashboard – Coming soon."
- Any organization's own admin can open it. Misty, for example, can reach it from Team Pursuit's account. It must be for AB Solutions staff only.
- The app doesn't store a plan, subscription status, complimentary access or suspension for an organization.
- Payments (Stripe) aren't connected yet, so everything here is set by hand for now. Stripe will fill in plans and statuses automatically later.

### Goal

AB Solutions staff get their own dashboard where they can:

- see every organization, with its plan and status
- open one organization and see its account details and usage
- suspend and reinstate an organization
- give an organization free (complimentary) access
- change an organization's plan and status by hand
- see totals by plan and by status

Every change is recorded with who made it and when.

### Who can open the dashboard

- Only **AB Solutions staff accounts** can open the dashboard. These accounts are separate from customer organizations/logins. They don't belong to any organization and can't see the normal app tabs.
- There's no sign-up for admin staff accounts. The developer creates/seeds them.
- Staff use the normal login page. After signing in they go straight to the admin dashboard.
- A customer account (admin or manager) that tries to open the dashboard is sent to its own app, as if the page didn't exist. This includes Misty.

### 2. Plans and statuses

**Plans** (from the landing page):

- **Reconciliation**, $297/month
- **Reconciliation + AI**, $497/month

For now a plan is only a label. It doesn't turn features on or off.

**Subscription status:** Trial, Active, Past due, Cancelled.

Two extra badges can show next to the status:

- **Complimentary**: free access, with an optional end date
- **Suspended**: access is blocked

**Starting values:**

- Organizations that already exist, such as Team Pursuit Global, start as **Reconciliation · Active · Complimentary** with no end date, so nobody loses access when this ships.
- A new sign-up starts as **Reconciliation · Trial**.

### 3. Organizations list (main page)

**Summary at the top** — small cards, one row each:

- **By plan:** "Reconciliation 7" · "Reconciliation + AI 2"
- **By status:** "Trial 3" · "Active 5" · "Past due 1" · "Cancelled 0"
- **Other:** "Complimentary 2" · "Suspended 1"

Clicking a card filters the list below to those organizations.

**Table**, newest sign-up first:

| **Organization** | **Signed up** | **Plan** | **Status** | **Users** | **Last sign-in** |
| --- | --- | --- | --- | --- | --- |
| Team Pursuit Global | 16 Aug 2026 | Reconciliation | Active · Complimentary | 3 | 15 Sep 2026 |
| Eastside Youth Alliance | 2 Sep 2026 | Reconciliation + AI | Past due · Suspended | 1 | 9 Sep 2026 |

- A search box finds organizations by name.
- Filters for plan and status.
- Clicking a row opens that organization's page.

### 4. Organization page

**Account details**

- Organization name and the name printed on documents (for example "Team Pursuit Global" / "Team Pursuit")
- Signed up: 16 Aug 2026
- Setup finished: 16 Aug 2026, or "Not finished" if they never completed setup
- Plan, status and badges, for example "Reconciliation · Active · Complimentary until 31 Dec 2026"
- Users: name, email, role (Admin / Manager) and last sign-in for each

**Usage**

- Funding sources: "2 active, 1 archived"
- Expenses: "412 total · 38 in September 2026"
- Last expense added: 14 Sep 2026
- Storage: "212 MB of 500 MB" with a small bar
- Months submitted: 7 · Months locked: 5
- Packets downloaded: 9

Only counts are shown here. Staff can't see the organization's expenses, receipts or documents.

**Last sign-in** isn't recorded today. It starts being recorded when this ships. Before that, it shows "Not recorded yet".

**Actions** (buttons on this page): Change plan, Complimentary access, Suspend / Reinstate.

**History** at the bottom, newest first. For example:

- "15 Sep 2026, 10:42 – Awais suspended access – Payment 30 days overdue"
- "1 Sep 2026, 09:10 – Awais changed plan from Reconciliation to Reconciliation + AI"
- "16 Aug 2026 – Organization signed up"

### 5. Change plan

**Change plan** opens a dialog:

- **Plan** dropdown: Reconciliation / Reconciliation + AI
- **Status** dropdown: Trial / Active / Past due / Cancelled
- **Note** (optional), for example "Upgraded after call with Misty"
- Buttons: **Save** and **Cancel**

Save updates the page and adds a line to History. Changing the plan or status never blocks or unblocks the organization. Only Suspend does that.

### 6. Complimentary access

**Complimentary access** opens a dialog:

- A checkbox: "Give this organization free access"
- **End date** (optional). Empty means no end.
- **Note** (optional), for example "Pilot partner until year end"
- Buttons: **Save** and **Cancel**

How it shows:

- With an end date: "Complimentary until 31 Dec 2026"
- After the end date passes: "Complimentary (ended 31 Dec 2026)" in a warning color

Nothing happens automatically when the date passes. Staff decide what to do next.

Turning it on or off adds a line to History.

### 7. Suspend and reinstate

**Suspend** opens a dialog:

- **Title:** "Suspend Eastside Youth Alliance?"
- **Text:** "Everyone in this organization will be signed out and won't be able to sign in until you reinstate it. None of their data is changed or deleted."
- **Reason** (required), for example "Payment 30 days overdue"
- Buttons: **Suspend** and **Cancel**

After suspending:

- Everyone in that organization is signed out right away. A page they already had open stops working on their next click or save.
- If they try to sign in, the login page shows: "Your organization's access is paused. Please contact support."
- Their data stays exactly as it was.

**Reinstate** opens a simple confirm ("Reinstate Eastside Youth Alliance?") with an optional note. Afterwards, everyone can sign in again and finds everything as they left it.

Both actions add a line to History.

### Not part of this ticket

- Connecting Stripe, taking payments or sending invoices
- Plans limiting features, such as the number of funding sources
- Suspending automatically when complimentary access ends or a payment is late
- Viewing an organization's expenses, receipts or documents, or signing in as a customer
- Creating, editing or deleting customer organizations or their users from the dashboard
- Emails to organizations (for example, a "you've been suspended" email)
- Changing the pricing on the landing page

### Done when

- Only AB Solutions staff accounts can open the dashboard. Customer admins and managers, including Misty, can't.
- The list shows every organization with signup date, plan, status and badges, and the summary counts match the list.
- Search, filters and clicking a summary card all narrow the list correctly.
- An organization's page shows its account details and usage, and the numbers match what is in that organization's app.
- Changing the plan or status works and shows in History.
- Complimentary access can be turned on with or without an end date, and an ended date shows as ended.
- Suspending signs everyone in that organization out and blocks sign-in with the message. Reinstating lets them back in with nothing changed.
- Suspending one organization doesn't affect any other organization.
- Every change shows in History with who made it, when, and the reason or note.
- Existing organizations start as Reconciliation · Active · Complimentary, and new sign-ups start as Reconciliation · Trial.
- Screens look right on desktop and tablet.
