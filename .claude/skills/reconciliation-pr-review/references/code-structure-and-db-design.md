# Code structure, conventions and database design — the second half of every review

Functionality asks "does it work?". This half asks "will the next ten features still fit?". The
product is expected to grow (staff dashboard, Stripe plans, AI features, more organisations), so
each PR is also judged on whether it keeps the repo easy to extend and the schema sound.

Everything below was read from the code (2026-09-16, main at 91a6b0f + PR #17; `src/db` rows
re-checked 2026-09-29 at c280eaf). **Re-check a
convention in code before citing it** — when code and this file disagree, the code wins and this
file gets updated.

Report these under their own heading ("Code structure and database design"), ranked by how much
they will cost later. Each finding still needs quoted evidence. Convention drift is a finding;
personal taste is not.

---

## 1. Repo layout — where things belong

| Path | Holds | Must not hold |
|---|---|---|
| `app/<group>/<route>/page.tsx`, `layout.tsx` | Server Components: auth gate, load data, render | Business rules, SQL, money maths |
| `app/<group>/<route>/*.tsx` (colocated) | Client components used by **that route only** (`app/r/packet/month-lock.tsx`, `app/r/expenses/expenses-table.tsx`) | Components imported by a sibling route — those move up |
| `app/api/**/route.ts` | Binary streams only (uploads, downloads) | Mutations that could be Server Actions |
| `src/modules/<feature>/actions.ts` | `"use server"` mutations; every export async; first line authenticates | Helpers, constants, types (each export becomes a public endpoint) |
| `src/modules/<feature>/queries.ts` | `server-only` reads for that feature | Writes |
| `src/modules/<feature>/<concern>.ts` | Feature logic with IO (`references.ts`, `month-guard.ts`, `reimbursement.ts`, `guard.ts`) | Pure logic other features need — that belongs in `src/domain` |
| `src/domain/*.ts` | **Pure** functions, no IO: money, dates, gate, strings, formatting | `db`, `fetch`, `cookies`, React |
| `src/generation/` | Pure data → bytes generators | DB reads |
| `src/services/` | Infrastructure: auth store/session, storage, rate limit | Feature rules |
| `src/lib/` | Tiny cross-cutting helpers: `action-result.ts`, `action-session.ts`, `ids.ts`, `cn.ts` | Feature code |
| `src/components/ui/` | Shared primitives (Button, Select, Modal/Dialog, ConfirmButton, TableCard, Field) | Feature-specific components |
| `src/components/<area>/` | Components shared across routes (`app-shell/`, `audit/`) | One-route components |
| `src/db/schema.ts` | The whole schema, one file, sections by table | Queries |
| `src/db/*.ts` helpers | DB helpers the app imports: `index.ts` (the pool), `org-lock.ts`, `pg-errors.ts`, `billing-copy.ts`, `months.ts`, `queries.ts` | Feature rules |
| `src/db/*.ts` scripts | Operator scripts run with `npm run db:*` (`seed`, `dev-fixture`, `create-staff`, `reset-password`, `backup-*`, `preflight-*`) | App imports |
| `src/db/test-org.ts`, `**/*.test-helper.ts` | Test-only helpers, imported inside `describe` with `await import()`; the `.test-helper.ts` suffix keeps them out of vitest's include | App imports |
| `drizzle/` | Generated migrations + meta (hand-edited only for ordering/backfill) | — |
| `docs/` | Source of truth; `PHASE-N.md` plans; `tickets/` drafts | — |

Checks:
- A new file sits where its siblings are. A component shared by two routes, reached with `../../x`,
  is misplaced (PR #17: `app/a/badges.tsx` imported as `../../badges`). Imports use the `@/` alias;
  relative `../` imports are the exception (only 4 existed before PR #17).
- Pure logic placed in a module "because the client needs it" should be in `src/domain`, or the
  module file must say why it isn't.
- A `"use server"` file exporting a constant, type guard or helper is a defect (invariants §D).
- Watch for a feature's rules spreading across three layers without a pointer between them. Staff
  auth lives in `services/auth/store.ts` + `session.ts`, `lib/action-session.ts` (`requireStaff`)
  and `modules/admin/guard.ts` (`requireStaffPage`). That is acceptable **because**
  `architecture.md §Auth` names all three; a new layer without that pointer is a finding.
- File size as a smell, not a rule: an `actions.ts` over ~700 lines, or one mixing two features,
  should be split by concern (`expenses/actions.ts` is the current ceiling).

## 2. Naming and code conventions

- **Files:** kebab-case (`org-directory.tsx`, `month-guard.ts`). Tests sit beside the code:
  `x.test.ts` (pure, no DB) and `x.integration.test.ts` (real local DB). Scoped suffixes are fine:
  `queries.trash.integration.test.ts`.
- **Server Actions:** `verbNounAction`. Return `ActionResult` (`ok()` / `fail()`), never throw for
  expected failures. Multi-field input is **one object parameter** (`saveLineItemAction(input: {…})`,
  `createOrgUserAction({ name, … })`). A single id is fine positionally. Several positional strings
  are a finding, because `changePlanAction(orgId, plan, status, note)` compiles with `plan` and
  `status` swapped.
- **Runtime validation:** Server Actions receive untrusted JSON whatever the TypeScript says. The
  repo validates with zod (`auth/actions.ts`, `expenses/validation.ts`) or explicit checks. Calling
  `.trim()` on an unchecked argument, or truthiness-checking a boolean (`"false"` is truthy), is a
  finding.
- **URL / searchParams parsing:** check an enum value against `orgPlan.enumValues.includes(x)` or
  `Object.hasOwn(LABELS, x)`, never with `x in LABELS`. `in` walks the prototype, so
  `?plan=constructor` gets through and Postgres throws 22P02, which is a 500 (PR #17 round 2).
  Parse and build a page's URL in **one** pure helper that both the server page and the client
  filter component use. Two builders drift: PR #17 trimmed `q` in one and not the other, and one
  read `badge` from `window.location`. Trim and length-cap free text when parsing.
- **Caps need a test at cap + 1:** a `LIMIT` constant (users "View all", history) is only guarded
  when a test inserts one more row than the cap. The UI must also say the cap was reached, not
  offer a "View all" that links to the page already open.
- **Auth first line:** `actionSession()` / `requireAdmin()` / `requireStaff()` in actions;
  `getSession()` / `requireStaffPage()` in pages and routes.
- **Types:** the schema is the single source of enum/row types. Client components import them with
  `import type … from "@/src/db/schema"`, which is erased and pulls no DB code into the bundle
  (`audit-diff.tsx`, `users-manager.tsx`). Re-declaring a union that already exists in the schema is
  a finding (PR #17 `admin/directory.ts` `OrgPlan`, `SubscriptionStatus`, event action union).
- **Strings:** anything printed on a funder document comes only from `src/domain/strings.ts` (§12).
  UI copy that a spec pins also lives there (`UI.*`). Flag inconsistency *within one PR*: some
  messages moved to `UI` while siblings stay inline (`"That is not a valid plan."`, `"Admin"`).
- **Duplication:** the same 4–6 line block repeated (read row → update → snapshot → insert event)
  should be one helper. Six copies means the next field is added to five.
- **Comments:** explain *why* and cite `D-nn` / `R-n.n`. Flag comments that cite a build step
  ambiguously. "(Phase 2)" meaning "part 2 of PHASE-9" reads as `docs/PHASE-2.md`; write
  "PHASE-9 part 2". Flag comments that restate the code, and comments that are stale.
- **Encoding and hygiene:** UTF-8 without BOM, LF endings. Route folders like `app/(auth)` break
  `xargs sh -c`, so use a read loop:
  ```bash
  git diff main...HEAD --name-only | while IFS= read -r f; do [ -f "$f" ] && [ "$(head -c3 "$f" | xxd -p)" = "efbbbf" ] && echo "BOM $f"; done
  git diff main...HEAD --name-only | while IFS= read -r f; do [ -f "$f" ] && grep -l 'â€\|Â§\|â˜' "$f"; done
  ```
  PR #17 re-saved 15 test files with both a BOM and mojibake.
- **Dependencies:** a new package needs a reason (a D-row or the PR body), an exact version in
  `package.json`, and no overlap with an existing one.
- **Scripts:** operator scripts are idempotent where they run on deploy, never print secrets they
  were given, and treat `""` from `.env` as unset.

## 3. Database design

### Conventions already in the schema (keep them)
- Table names: snake_case plural. Columns: snake_case, **named explicitly** in the builder.
- Ids: `id()` → uuid v7 made in app code. Timestamps: `createdAt()` / `updatedAt()`, `timestamptz`.
- Money: `cents()` / `nullableCents()` → `bigint` integer cents. Months: `char(7)` `YYYY-MM`.
  Calendar dates: `date`. Instants: `timestamptz`.
- Index and constraint names: `<table>_<cols>_idx`, `_uq`, `_ck`. Case-insensitive uniqueness uses
  a `lower()` expression index (`users_email_lower_uq`), not `citext`.
- Tenancy: every table except `organizations` has `org_id`. Grant-scoped tables add
  `funding_source_id` with composite FKs to `funding_sources(id, org_id)`. Cross-tenant rows are
  unrepresentable, not merely unqueried.
- State as nullable timestamps (`archived_at`, `locked_at`, `suspended_at`, `deleted_at`) rather
  than booleans, so "since when" is free.
- History tables are append-only with an actor FK `ON DELETE SET NULL` and before/after jsonb typed
  with `$type<Snapshot>()`, the snapshot type declared in `schema.ts`.
- Must-supply columns have **no default** (invariants §C). Defaults are allowed where the ticket
  defines the starting value (`plan`, `subscription_status`), and signup should still set them
  explicitly.
- Enums: `pgEnum` for closed sets the code switches on.

### Questions to ask of every schema change
1. **Right table?** Does the column describe the entity, or a different concern that will grow its
   own fields? Billing on `organizations` (`plan`, `subscription_status`, `complimentary*`) works
   today. When Stripe lands (customer id, subscription id, period end, trial end, cancel-at), a 1:1
   `org_subscriptions` table keeps `organizations` from becoming a junk drawer. Raise this as a
   design note on the first PR that starts the pattern.
2. **Invalid states representable?** Pairs that must agree need a CHECK or a single column.
   `complimentary = false` with `complimentary_until` set is storable today. Suggest
   `CHECK (complimentary OR complimentary_until IS NULL)`, or derive the boolean from a nullable
   `complimentary_since`.
3. **Enum or table?** An enum is right for states the code branches on. A catalogue that business
   people change (plans with prices and Stripe price ids) belongs in a table. Adding an enum value
   needs a migration and a deploy.
4. **Naming consistent with siblings?** Two audit tables with different column names for the same
   idea (`expense_audit_events.before_data/after_data` vs `org_account_events.before/after`, and
   `actor_user_id` vs `actor_staff_id`) make shared history UI harder. New tables copy the closest
   existing one unless the D-row says why not.
5. **Lifecycle of the row's parent?** Should history survive the parent's deletion? `ON DELETE
   CASCADE` from `organizations` erases account history with the org. For billing and audit that
   is often wrong. Ask.
6. **Can the actor be removed without losing meaning?** An actor FK `SET NULL` turns history into
   "Unknown". A `disabled_at` on the actor table, instead of deleting, keeps names. `staff_users`
   has no way to deactivate a person today.
7. **Indexes match the real WHERE / ORDER BY?** Every new list query needs an index that serves it
   (`(org_id, created_at)` for history). No redundant index that only adds write cost.
8. **Locks:** `SELECT … FOR UPDATE` on `organizations` conflicts with every FK insert that
   references it (`FOR KEY SHARE`). To serialise writers of the row's own columns, `FOR NO KEY
   UPDATE` is enough.
9. **Migration shape:** additive first. Backfill before `SET NOT NULL`. Journal and snapshot match
   `schema.ts`. `lock_timeout` for ALTERs on hot tables (`organizations`, `users`) so a deploy
   can't queue every request behind it. Rollback path stated for anything not additive.
10. **Growth:** read models that load every row into the client (`loadOrgDirectory` → client-side
    filter) are fine at tens of organisations. Flag the ceiling (hundreds or thousands) and the
    next step: server-side search and pagination via URL params.

## 4. How to run this half

- **Diffs over ~200 lines:** launch the `architecture` specialist (`specialist-prompts.md`) in the
  same batch as the others.
- **Small diffs:** walk sections 1–3 yourself against `git diff main...HEAD --stat` and the schema
  diff.
- **Verify before reporting:** quote the file and line, and name the sibling it drifts from
  ("`createOrgUserAction` takes an object; `changePlanAction` takes four strings").
- **Ranking:**
  - **blocking:** a schema shape that is expensive to change once data exists (wrong table,
    missing constraint on money or tenancy, cascade that deletes audit history)
  - **should fix:** drift a reader will copy (positional args, duplicated blocks, re-declared
    types, misplaced shared components, encoding)
  - **note for later:** scale ceilings and future-feature designs
- **When this file is wrong or incomplete:** update it in the same session. It is the memory of how
  this repo is built.
