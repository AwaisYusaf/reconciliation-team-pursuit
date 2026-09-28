# Phase 18: Each person keeps their own month, funding source and welcome banner

**Status (2026-09-28): built, in review (branch `feat/per-user-month`).** Written from the code.
Comes before the mobile app (`docs/mobile-app-plan.md`), which depends on it. The user asked for it
to be built straight after the plan; a security review ran on the diff (§5) and the user checked it
in the browser. Production needs migration `0043`, which `./deploy.sh` runs; no new environment
variable.

---

## 1. What this is

The month and the funding source picked in the header were stored on the organization (R2.3).
When manager A switched to March, manager B's screens showed March on their next page load, and
B's next expense, upload or invoice import landed in March without B choosing it. The dashboard's
welcome banner had the same flaw: one person dismissing it hid it for everyone.

After this phase each person has their own month, funding source and banner. What A does never
changes what B sees or where B's work is saved. The same person on two devices shares one choice,
because it is one account.

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| Q1 | Per **person** (user), not per device or session | The user, 2026-09-28: "if one manager changes month others should not get impacted". One account on web and phone stays in step |
| Q2 | The **funding source** moves to the person as well | Same problem as the month; half a fix would leave B's source moving under them |
| Q3 | At release, everyone starts where their organization was. After that, a new person starts on the current month (America/Detroit, R2.5), "All", and sees the welcome banner | The user, 2026-09-28 |
| Q4 | The **welcome banner** dismissal moves to the person too | The user, 2026-09-28: same kind of bug |
| P1 | Three nullable columns on `users`. An empty month means "the current month"; an empty source means "All", as it does today | Every path that creates a user (sign-up, Users page, seed, 38 test files) keeps working with no default to keep in step with the app's time zone |
| P2 | The organization's three columns stay in the database, unread and no longer written after creation, and are dropped in a later clean-up migration | A rollback of the code alone then still finds a month on every organization. Dropping them is one line once this is live |
| P3 | Nothing else changes. Every page, action and route already reads `session.activeMonth`, `session.activeFundingSourceId` and `session.welcomeDismissed`, and only `resolveSession` fills them | One supplier, one change |
| P4 | **Rule going forward:** anything one person picks or dismisses for themselves lives on the person, never the organization. A source-scan test enforces it for these three | So this class of bug does not come back (the user, 2026-09-28) |

---

## 3. Changes

| File | Change |
|---|---|
| `drizzle/0043_user_active_month.sql` | Adds `users.active_month char(7)`, `users.active_funding_source_id uuid REFERENCES funding_sources(id) ON DELETE SET NULL` and `users.welcome_dismissed_at timestamptz`, all nullable. Copies each organization's values onto its users in the same migration. Starts with `SET LOCAL lock_timeout = '5s'`, as 0040 to 0042 do. Additive |
| `src/db/schema.ts` | The three columns on `users`. The organization's three are marked unused since Phase 18 |
| `src/services/auth/store.ts` | `resolveSession` reads all three from `users`. An empty month becomes `currentMonthKey()` |
| `src/modules/auth/actions.ts` | `setActiveMonthAction`, `setActiveFundingSourceAction` and `dismissWelcomeAction` update the signed-in person's row, scoped by user id **and** org id |
| `src/modules/funding-sources/archive.ts` | Archiving clears the source from every person in that organization who had it selected, instead of from the organization |
| `src/db/dev-fixture.ts` | Sets the fixture users' month, not the organization's |
| `src/modules/funding-sources/queries.ts`, `src/domain/strings.ts`, `app/api/expenses/from-invoice/route.ts` | Comments only |
| Tests that read the organization's columns (store, no-free-use, cross-org, archive, billing sync) | Read the person's instead. `createTestOrg` is unchanged: most tests build their session by hand |
| `docs/01-domain/domain-rules.md` R2.3, R14.2; `data-model.md`; `03-modules/m00-app-shell-auth.md` | Per person instead of per organisation |
| `docs/04-engineering/decisions.md` | D-131 |
| `docs/PHASE-14.md` "Still open" | The colleague case is gone |
| `.claude/skills/reconciliation-pr-review/references/repo-invariants.md` | The PR review checklist gets the P4 rule |

Not touched: every page and route that reads the session, `proxy.ts`, and the organization table's
other columns.

---

## 4. Edge cases

| Case | Behaviour |
|---|---|
| New user added on the Users page, or a new organization signs up | Empty month, so the current Detroit month. Empty source, so "All", which a one-source organization already resolves to its only source. Sees the welcome banner until they dismiss it |
| A person's selected source is archived (Settings, or billing keeping one source for Reconciliation) | Cleared for every person in that organization who had it, in the same transaction, as before |
| A source is deleted | The foreign key empties the column (`ON DELETE SET NULL`) |
| A source id from another organization | Refused by `requireOwnedFundingSource` before it is stored, and re-checked on read by `loadSourceContext` |
| A malformed month | Refused by `isValidMonthKey` |
| The same person in two tabs, or on web and phone | Last choice wins for that person only. Before, it was last choice for the whole organization |
| A person is deactivated and later reinstated | Comes back to the month they left on; an archived source was cleared for them too |
| Staff | Unaffected: staff sessions have no month |
| Organization with no users at migration time | Nothing to copy |
| Migration runs while people are signed in | Sessions keep working. The next page load reads the copied value, which equals what they saw, except a switch made in the few seconds between the migration and the new code starting: the old code writes it to the organization, so it is lost and the person picks again |

---

## 5. Tests and checks

Each fails if its behaviour is removed.

| # | Test | File |
|---|---|---|
| T1 | A and B in one organization, both signed in for real: A sets March, B's session still shows B's month, and the organization's column is untouched; the same for the funding source, including All; A dismissing the banner leaves it for B | `src/modules/auth/active-selection.integration.test.ts` (new) |
| T2 | Where a new expense, upload or invoice import lands | Covered by T1: every one of them defaults to `session.activeMonth`, which T1 proves is per person. The packet's month documents and lock already post their month |
| T3 | A person who never picked a month resolves to the current Detroit month and All | `src/services/auth/store.integration.test.ts` |
| T4 | Archiving a source clears it for each person who had it and no one else, from Settings and from the billing sync | `src/modules/funding-sources/actions.integration.test.ts`, `src/modules/billing/sync.integration.test.ts` |
| T5 | Setting another organization's source, or a malformed month, is refused and stores nothing | `active-selection.integration.test.ts`, `cross-org.integration.test.ts` |
| T6 | The migration's real copy statement gives each person their own organization's month, source and banner dismissal | `src/db/user-active-month-migration.integration.test.ts` (new); the SQL is pinned by `src/db/migration-0043.test.ts` |
| T7 | `resolveSession` returns the person's month, not the organization's | `store.integration.test.ts` |
| T8 | An unpaid organization's month change writes nothing to the person's row; a paid one's lands there | `src/lib/no-free-use.integration.test.ts`. It, and `cross-org.integration.test.ts`, read the organization's column, which would have passed whatever the code did |
| T9 | **So it cannot come back:** no code reads or writes the organization's month, source or banner dismissal again | `src/lib/per-person-state.test.ts`, a source scan. Run against `main`'s versions of the fixed files, it names every one |

- **Proven:** with the session, the actions and archiving switched back to the organization's
  columns, 10 checks fail; restored, all pass.
- **Security review** of the diff: no tenancy or security issue. Every reader of the selection
  re-validates it against the organization; the non-exported helper in the `"use server"` file is
  allowed (Next 16 docs); the migration cannot fail on existing data. Its smaller findings (the two
  vacuous checks, stale comments, the deploy-window note in §4) are fixed.
- Typecheck, lint and the full suite pass; the user checked it in the browser.

---

## 6. Not part of this

- **Two screens of the same person.** Someone could switch month in one tab while another tab is
  open. The invoice check screen already refuses that (`UI.invoiceMonthChanged`), the packet's
  month documents and lock post their month, and the expense form has its own month field. The
  duplicate-invoice warning still checks the session's month, which is advisory only. The mobile
  plan sends the screen's month on every write.
- **Dropping the organization's three columns.** A later clean-up migration.

## 7. Rollback

Code: revert the commit. The organization's columns were never removed, so the old code finds a
month on every organization (the one it had at release). Database: `ALTER TABLE users DROP COLUMN
active_month, DROP COLUMN active_funding_source_id, DROP COLUMN welcome_dismissed_at;` (recorded
in D-131).
