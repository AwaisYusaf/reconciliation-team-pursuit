# Phase 9 — AB Solutions staff dashboard

Status: **Phase 1 built, not committed; Phases 2-5 not started** (2026-09-16). The product spec is Appendix A, copied word for word.
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
- **`app/a/page.tsx`** (server) → **`org-directory.tsx`** (client):
  - Three rows of summary cards: By plan, By status, Other (Complimentary / Suspended). Clicking a card sets the matching filter; clicking it again clears it.
  - A search input, plus plan and status `Select`s.
  - A `TableCard` with Organization · Signed up · Plan · Status (+ badges) · Users · Last sign-in, newest sign-up first. Clicking a row goes to the org page (it is a real link, so it works from the keyboard).
- **`app/a/orgs/[id]/page.tsx`**. `params` is a Promise in Next 16. A non-uuid or unknown id → `notFound()`.
  - **Account details** card: name / doc name, signed up, setup finished or "Not finished", and the plan · status · badges line. Also a users table with name, email, role and last sign-in, or "Not recorded yet".
  - **Usage** card:
    - funding sources "2 active, 1 archived"
    - expenses "412 total · 38 in September 2026"
    - last expense added
    - a storage bar "212 MB of 5 GB"
    - months submitted / locked
    - packets downloaded
  - **Actions** (client): Change plan (`Modal` with two `Select`s + note), Complimentary access (`Modal`: checkbox, `<Input type="date">`, note), Suspend (`Dialog tone="danger"`, reason required, confirm disabled until filled), Reinstate (`Dialog tone="neutral"`, optional note).
    - Errors show inside the dialog. On success: `reportResult` + `router.refresh()`, as in `month-lock.tsx:99-114`.
  - **History** card, newest first. The "Organization signed up" line is always last.
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

---

## 9. Acceptance criteria → where each is proven

| Done when | Proven in |
|---|---|
| Only staff open the dashboard; Misty can't | P1 `requireStaff` / `requireStaffPage` tests + P4 browser check |
| List shows every org with signup, plan, status, badges; counts match | P3 `summarize` = `filterOrgs` test + P4 browser |
| Search, filters, summary cards narrow correctly | P3 unit + P4 browser |
| Org page numbers match the org's app | P3 usage integration + P5 side-by-side against the org's own screens |
| Plan/status change works and shows in History | P2 action tests + P4 browser |
| Complimentary with/without end date; ended shows as ended | P2 + P3 `complimentaryState` edges + P4 |
| Suspend signs everyone out and blocks sign-in with the message; reinstate restores with nothing changed | P2 suspension tests (including the fail-before proof) |
| Suspending one org doesn't affect another | P2 two-org session test |
| Every change shows who, when, reason/note | P2 event-shape assertions + P3 `describeAccountEvent` |
| Existing orgs = Reconciliation · Active · Complimentary; new = Reconciliation · Trial | P1 backfill + signup test |
| Desktop and tablet look right | P4 screenshots at 1280 / 768 |

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
