# Phase 6 — Multiple funding sources per organisation

Implementation plan. Written to be executed phase by phase by an agent that has not seen this
codebase before. Every file and line reference was checked against `settings/section-based` at
commit `bf74750` (2026-09-11). Line numbers drift as you edit, so search for the named symbol
rather than trusting a line number blindly.

The product spec this plan implements is reproduced verbatim in **Appendix A**. When this plan
and Appendix A disagree, Appendix A wins; stop and report the conflict.

---

## 0. Rules for the executing agent (read first, follow always)

1. Read `/AGENTS.md`, `/CLAUDE.md` and `docs/README.md` before touching code. This repo runs
   **Next.js 16**: before writing any Next.js code (pages, route handlers, server actions, `cache`,
   `cookies`, `revalidatePath`) read the matching guide in `node_modules/next/dist/docs/`.
2. **Money is integer cents** everywhere. Formatting only at the edge (`src/domain/format.ts`).
3. **Strings that print on documents** (cover sheet, packet, workbook, filenames) come only from
   `docs/01-domain/domain-rules.md` §12 via `src/domain/strings.ts`. Add the wording to §12 first,
   then to `strings.ts`. Never improvise a printed string.
4. **Never read, copy, commit or publish anything under `context/manual packet/`** (real client PII).
5. Do the phases **in order**. Each phase ends **green**: `npm run typecheck`, `npm run lint`,
   `npm test` (full suite, integration tests included — make sure `DATABASE_URL` is set so they
   run rather than skip; a skipped integration test proves nothing). Do not start the next phase
   on red.
6. Commit once per phase. Match the repo's commit style (read `git log -8`): plain descriptive
   title, prose body explaining *why*, bullets for review fixes, trailer
   `Co-Authored-By: Claude <your model name> <noreply@anthropic.com>`. Stage files by name, never
   `git add -A`. Never `--no-verify`, never `--amend`.
7. **Docs are the source of truth.** Update the docs listed in each phase in the same commit as the
   behaviour change. The decision for this whole feature is **D-93** in
   `docs/04-engineering/decisions.md` (latest existing entry is D-92).
8. Every server action/route that accepts a `fundingSourceId` from the client must verify it
   belongs to the session's organisation **on the server** (helper in Phase 2). The client is never
   trusted. The database composite foreign keys in Phase 1 are the backstop, not the check.
9. Each bug fix or invariant gets a test that **fails without the change and passes with it**.
   For the invariants marked ★ below, prove it: temporarily remove the guard, run the test, see it
   fail, restore, see it pass.
10. **Stop and report instead of improvising** when you hit any "STOP" condition written in this
    plan, when a test you did not touch starts failing and the cause is not obvious, or when the
    spec is ambiguous in a way the Open Questions (§7) do not already settle.

---

## 1. What changes, in one paragraph

Today everything financial hangs off the organisation: one `contract_settings` row, one set of
line items, one reference-number counter per month, one packet per month. After this phase a new
`funding_sources` table sits between the organisation and all of that. Line items, expenses,
month documents, month submission status, reference numbers, month snapshots and generated
artifacts all carry a `funding_source_id`. Contract details and tax/fee rules move from
`contract_settings` / `payment_sources` onto the funding source. The migration turns every
organisation's current setup into its **first funding source** so that, for an organisation with
one source, **nothing visible changes — not a figure, not a filename, not a byte of a regenerated
packet.** Performances stay exactly as they are (they live on line items, which now belong to a
source).

---

## 2. Design decisions (with the reason for each)

| # | Decision | Why |
|---|---|---|
| 2.1 | New table `funding_sources`; **every** grant-scoped table gets a `funding_source_id NOT NULL`. Expenses store it directly even though it is derivable from the line item. | The spec says "every expense records its funding source". Storing it lets the reference counter, unique indexes, filters and the composite FK below work without joins. |
| 2.2 | **Composite foreign keys** make cross-source and cross-org rows unrepresentable in the database: `expenses(line_item_id, funding_source_id) → line_items(id, funding_source_id)` and `X(funding_source_id, org_id) → funding_sources(id, org_id)` on every scoped table. | "Saving against another source's line item is impossible" must hold even if an app check is forgotten. Same philosophy as `reference_seq` having no default (schema.ts:363-372). |
| 2.3 | Composite FKs use the default `ON DELETE NO ACTION`, not `RESTRICT`. | Deleting an organisation cascades to both `funding_sources` and the child tables in one statement. `NO ACTION` is checked at end of statement, so the cascade succeeds; `RESTRICT` is checked immediately and would break org deletion (integration tests delete orgs in `afterAll`). |
| 2.4 | `contract_settings` and `payment_sources.tax_reimbursable/fees_reimbursable` are **kept in the database but no longer read or written** after this phase. Marked deprecated in schema comments and data-model.md. | Keeps the migration additive and reversible. A later phase can drop them once this has run in production. |
| 2.5 | The selected source is stored per organisation in `organizations.active_funding_source_id` (nullable; `NULL` = "All"), exactly like `organizations.active_month` (R2.3). | Spec: "The app remembers the choice, like it remembers the month." Same persistence model, same trade-off (shared by users of one org), no new concept. |
| 2.6 | **Reference numbers** (`2026-02-001`) are counted per `(org, source, month)`: `month_statuses` primary key becomes `(org_id, funding_source_id, month)`. The migrated first source inherits every existing `month_statuses` row, so the City's numbering continues unchanged. | Spec §6. `claimReferenceSeq` (references.ts:44) keeps its single-statement upsert; only its conflict target grows. |
| 2.7 | `expenses.sort_order` stays a per-`(org, month)` counter. | It only orders rows, is never printed, and gaps are harmless. Changing it would touch every existing row for no benefit. |
| 2.8 | **Cache-key stability:** `MonthSnapshot` (month-snapshot.ts:80) keeps **exactly its current shape**. The funding source id is passed to `resolveArtifact` separately and goes into the artifact *lookup scope*, never into the hashed snapshot. `docName` resolves to `source.doc_name ?? org.doc_name`, and `settings` come from the source row with the same field names. | For a single-source org the snapshot, and therefore `inputsHash`, is identical before and after. Existing cached and pinned artifacts keep matching, so a re-download serves the same bytes from cache instead of building a new artifact. This is what "same downloaded packets" means in code. Guarded by the Phase 0 stability test ★. |
| 2.9 | S3 keys for **expense and month documents are unchanged**; the new `funding_source_id` column on the row is what scopes them. **Generated artifact keys** gain a `{fundingSourceId}/` segment for artifacts written from now on. Existing rows keep their stored `s3_key`. | Nothing needs to move in the bucket. Two sources whose outputs happen to hash the same (for example two empty months) can never share or overwrite one generated object. |
| 2.10 | Tax/fee rules live on the funding source. A new expense's tax/fee checkboxes are pre-set from its **source's** rules. Changing the **payment source** no longer changes them. Saved expenses keep their own copy (unchanged, schema.ts:326-340). | Spec §1: "Payment sources go back to meaning only how something was paid." |
| 2.11 | **Migrated rules:** the first source takes the rules of the organisation's first **active** payment source by `sort_order` (falling back to `ORIGINAL_RULES` = tax no, fees yes, reimbursement.ts:29). | That is exactly what a brand-new expense defaults to today (expense-form.tsx:133 applies `paymentSources[0]`'s rules), so the default a user sees does not change. See the pre-flight check P0.3 for orgs whose payment sources disagree. |
| 2.12 | Filenames include the source name **only when the organisation has more than one funding source (archived ones included)**. For a single-source org the filename is byte-identical to today. | Spec §6. Unit-tested both ways. |
| 2.13 | One scoping helper module, `src/modules/funding-sources/`, owns: listing sources, resolving the current selection, and the server-side ownership check. Every page and action goes through it. | One place to get the selection rules right, instead of each page re-deriving "is this single-source / is All selected / is this id mine". |

---

## 3. Data model

### 3.1 New table `funding_sources` (add to `src/db/schema.ts`)

```ts
export const fundingSourceType = pgEnum("funding_source_type", [
  "grant", "donation", "line_of_credit", "other",
]);

export const fundingSources = pgTable("funding_sources", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text().notNull(),
  type: fundingSourceType().notNull().default("grant"),
  /** Printed on this source's documents; null → organizations.doc_name (spec §1). */
  docName: text("doc_name"),
  // ---- contract details: same columns and defaults as contract_settings (schema.ts:164-180)
  projectName: text("project_name").notNull().default(""),
  contractNumber: text("contract_number").notNull().default(""),
  basePoNumber: text("base_po_number").notNull().default(""),
  performancePoNumber: text("performance_po_number").notNull().default(""),
  contractValueCents: cents("contract_value_cents"),
  contractStart: date("contract_start"),
  contractEnd: date("contract_end"),
  fiduciaryName: text("fiduciary_name").notNull().default(""),
  advancesReceivedCents: cents("advances_received_cents"),
  // ---- reimbursement rules (moved from payment_sources, R1.3). No defaults, same reason as
  //      expenses.tax_reimbursable (schema.ts:333-338): a forgotten value must be a type error.
  taxReimbursable: boolean("tax_reimbursable").notNull(),
  feesReimbursable: boolean("fees_reimbursable").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Set → hidden from pickers; history and documents stay (spec §1). */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("funding_sources_id_org_uq").on(t.id, t.orgId),          // target of composite FKs
  uniqueIndex("funding_sources_org_name_uq").on(t.orgId, sql`lower(${t.name})`),
  index("funding_sources_org_sort_idx").on(t.orgId, t.sortOrder),
]);
```

### 3.2 Changes to existing tables

| Table (schema.ts) | Change |
|---|---|
| `organizations` (94) | add `activeFundingSourceId uuid NULL → funding_sources.id ON DELETE SET NULL`. `NULL` means "All". App code validates it belongs to the org whenever it is read (Phase 2). No composite FK here: `SET NULL` on a composite key would null `organizations.id` too. |
| `contract_settings` (164) | **unchanged, deprecated** (2.4). Add a doc comment saying so. |
| `payment_sources` (185) | **columns kept, deprecated**: `tax_reimbursable`, `fees_reimbursable` are no longer read. Update the doc comment at 196-201. |
| `line_items` (229) | add `fundingSourceId NOT NULL`. Replace `line_items_org_name_uq` (247) with `line_items_source_name_uq on (funding_source_id, lower(name))` so two sources can each have "Salary". Add `line_items_id_source_uq on (id, funding_source_id)` (target of the expenses composite FK). Replace `line_items_org_sort_idx` with `(org_id, funding_source_id, sort_order)`. FK `(funding_source_id, org_id) → funding_sources(id, org_id)`. |
| `line_item_performances` (261) | **no change**; scoped through its line item. |
| `expenses` (301) | add `fundingSourceId NOT NULL`. Composite FK `(line_item_id, funding_source_id) → line_items(id, funding_source_id)` ★. FK `(funding_source_id, org_id) → funding_sources(id, org_id)`. Replace `expenses_org_month_reference_uq` (391) with `(org_id, funding_source_id, month, reference_seq)`. Add index `(org_id, funding_source_id, month)`. Keep the existing single-column `line_item_id → line_items.id ON DELETE RESTRICT`. |
| `expense_audit_events` (430) | no column change. Add optional `fundingSourceName?: string` to `ExpenseAuditSnapshot` (411) so history can show a source move; old events simply lack it. |
| `expense_documents` (470) | **no change** (scoped through its expense). |
| `month_documents` (519) | add `fundingSourceId NOT NULL` + FK to `funding_sources(id, org_id)`. Index (544) becomes `(org_id, funding_source_id, month, category, sort_order)`. |
| `month_statuses` (550) | add `fundingSourceId NOT NULL` + FK. Primary key (572) becomes `(org_id, funding_source_id, month)`. |
| `month_snapshots` (592) | add `fundingSourceId NOT NULL` + FK. `month_snapshots_line_item_uq` (619) becomes `(org_id, funding_source_id, month, line_item_name)`: today two sources' "Salary" would collide. Lookup index becomes `(org_id, funding_source_id, month)`. |
| `month_snapshot_totals` (632) | add `fundingSourceId NOT NULL` + FK. Primary key (646) becomes `(org_id, funding_source_id, month)`. |
| `vendor_defaults` (652) | **no change** (org-level, spec "vendor memory per source" is out of scope). |
| `recurring_items` (692) | **no change** (belongs to a source through `line_item_id`, spec §4). |
| `generated_artifacts` (734) | add `fundingSourceId NOT NULL` + FK. Add `funding_source_id` into `generated_artifacts_lookup_idx` (762), `generated_artifacts_live_uq` (765) and `generated_artifacts_content_uq` (776), right after `org_id`. |
| `users`, `sessions`, `supporting_doc_types` | no change (org-level). |

Export the new types: `FundingSource = typeof fundingSources.$inferSelect`, `FundingSourceType`.

### 3.3 The migration (one file, `drizzle/0023_*.sql`)

Generate with `npm run db:generate`, then **hand-edit** the generated SQL into the order below.
drizzle-kit emits `ADD COLUMN ... NOT NULL` in one step, which fails on existing rows: you must
split it into add-nullable → backfill → set-not-null. Keep drizzle's `--> statement-breakpoint`
separators between statements.

```sql
-- 1. type + table
CREATE TYPE "public"."funding_source_type" AS ENUM('grant','donation','line_of_credit','other');
CREATE TABLE "funding_sources" ( ...columns exactly as §3.1... );
CREATE UNIQUE INDEX "funding_sources_id_org_uq" ON "funding_sources" ("id","org_id");
CREATE UNIQUE INDEX "funding_sources_org_name_uq" ON "funding_sources" ("org_id", lower("name"));
CREATE INDEX "funding_sources_org_sort_idx" ON "funding_sources" ("org_id","sort_order");

-- 2. one source per existing organisation (decision 2.11 for the rules)
INSERT INTO "funding_sources" ("id","org_id","name","type","doc_name","project_name",
  "contract_number","base_po_number","performance_po_number","contract_value_cents",
  "contract_start","contract_end","fiduciary_name","advances_received_cents",
  "tax_reimbursable","fees_reimbursable","sort_order")
SELECT gen_random_uuid(), o.id,
       coalesce(nullif(btrim(cs.project_name), ''), 'Source 1'),
       'grant', NULL,
       coalesce(cs.project_name, ''), coalesce(cs.contract_number, ''),
       coalesce(cs.base_po_number, ''), coalesce(cs.performance_po_number, ''),
       coalesce(cs.contract_value_cents, 0), cs.contract_start, cs.contract_end,
       coalesce(cs.fiduciary_name, ''), coalesce(cs.advances_received_cents, 0),
       coalesce(ps.tax_reimbursable, false), coalesce(ps.fees_reimbursable, true), 0
FROM "organizations" o
LEFT JOIN "contract_settings" cs ON cs.org_id = o.id
LEFT JOIN LATERAL (
  SELECT p.tax_reimbursable, p.fees_reimbursable FROM "payment_sources" p
  WHERE p.org_id = o.id AND p.active ORDER BY p.sort_order, p.id LIMIT 1
) ps ON true;
-- gen_random_uuid() is core since Postgres 13; it yields a v4 uuid, which isUuid() (src/lib/ids.ts) accepts.

-- 3. add nullable columns: line_items, expenses, month_documents, month_statuses,
--    month_snapshots, month_snapshot_totals, generated_artifacts (funding_source_id uuid),
--    organizations (active_funding_source_id uuid).

-- 4. backfill: exactly one source per org exists at this point, so a join on org_id is exact.
UPDATE "line_items" t SET "funding_source_id" = fs.id FROM "funding_sources" fs WHERE fs.org_id = t.org_id;
-- ...same statement for the other six tables. organizations.active_funding_source_id stays NULL.

-- 5. SET NOT NULL on the seven funding_source_id columns.

-- 6. swap indexes/keys exactly as §3.2: drop line_items_org_name_uq, expenses_org_month_reference_uq,
--    month_snapshots_line_item_uq, the month_statuses and month_snapshot_totals primary keys (look up
--    their real constraint names in drizzle/meta/0022_snapshot.json), generated_artifacts_* indexes;
--    create the new ones.

-- 7. foreign keys: organizations.active_funding_source_id → funding_sources(id) ON DELETE SET NULL;
--    every (funding_source_id, org_id) → funding_sources(id, org_id);
--    line_items_id_source_uq, then expenses(line_item_id, funding_source_id) → line_items(id, funding_source_id).
```

**Known migration trap (read before running `db:migrate`).** A recent migration run hung because
teammates' merges renumbered migration files and the database tracking table fell out of step with
`drizzle/meta/_journal.json`. Before migrating: confirm `_journal.json` ends at
`0022_fantastic_sleeper` with idx 22, generate 0023 as the next entry, and never rename or
renumber existing migration files. If `db:migrate` hangs, **STOP** and report. Do not hand-edit
`drizzle.__drizzle_migrations`.

**Rollback** (write it into D-93 as a SQL block): drop the new FKs, indexes and columns, restore the
old indexes and primary keys, drop `funding_sources` and the enum. Nothing is lost because
`contract_settings` and the payment-source rule columns were never dropped. Rollback is only safe
**before any organisation creates a second source** (two sources' line items could then share a
name, which the restored `line_items_org_name_uq` would reject). Say so in D-93.

---

## 4. Invariants and where each is enforced

| Invariant | Enforced by | Test |
|---|---|---|
| ★ An expense's line item belongs to the expense's source | DB composite FK (2.2) **and** server check in create/update/recurring-add | integration: insert with mismatched pair throws `23503`; action returns "Choose a line item." |
| ★ A source id from the client belongs to the session's org | `requireOwnedFundingSource()` (Phase 2) in every action/route taking one; DB FK `(funding_source_id, org_id)` as backstop | two-org integration test per action, mirroring `performances.integration.test.ts` "refuses to edit another organisation's performance" |
| ★ Single-source org: generated outputs unchanged | 2.8 snapshot shape + docName/settings resolution | Phase 0 stability test |
| ★ References count per source per month; City unchanged | `month_statuses` key; `claimReferenceSeq(orgId, sourceId, month, tx)` | integration: two sources, same month, each gets `001`; migrated org's next number continues |
| ★ A packet never contains another source's expenses, line items or month documents | every snapshot/readiness query filtered by source | integration: two sources, one month; source A's snapshot contains zero B ids |
| Submitted / missing-docs gate / download block per source per month | `month_statuses`, `loadPacketReadiness`, download routes all source-scoped | integration: missing receipt on B does not block A's packet route |
| Archived sources are not offered for new expenses or new line items | server check in create actions + UI filter | integration |
| Adding/editing source 2 changes nothing in source 1 | all of the above | integration: capture A's dashboard stats + snapshot hash, create B with line items/expenses/docs/submission, re-capture A: deep-equal |

---

## 5. Phases

Each phase lists: goal · files · steps · tests · docs · done-when.

### Phase 0 — Preflight (no product change)

- **P0.1** Branch from the current branch: `feature/funding-sources`. Run typecheck, lint and the
  full suite; record the baseline test count (737 at the time of writing).
- **P0.2 Snapshot stability test ★** — new file `src/generation/snapshot-stability.integration.test.ts`.
  Insert an org **with fixed, hard-coded UUIDs and dates** (ids are otherwise random v7 and would
  change the hash every run): 2 line items (one with a performance), 3 expenses in `2026-02` with
  fixed `sortOrder`/`referenceSeq`, one attached month document row (a fake `s3Key` is fine; the
  snapshot only reads rows), and a `contract_settings` row. Call `loadMonthSnapshot(orgId, "2026-02")`
  and assert `inputsHash({ snapshot, generatorVersion: "packet-12" })` equals a **literal constant**
  you record from the current code. Do the same for the summary and one cover-sheet hash, using the
  generator version and scope constants their routes use (`app/api/downloads/summary/route.ts`,
  `app/api/downloads/cover-sheet/route.ts`). Commit this test on its own. From Phase 1 on, only the
  **setup** of this test may change (it must also create the funding source with a fixed id). The
  expected constants must **never** change. If they would, **STOP**.
- **P0.3 Production data check (operator runs it; you write it).** Add
  `src/db/preflight-funding-sources.ts` (plus a `db:preflight-funding-sources` script in
  package.json) that prints, per organisation: whether its active payment sources have more than one
  distinct `(tax_reimbursable, fees_reimbursable)` pair, and its `contract_settings.project_name`.
  Read-only, no writes. Orgs with divergent rules will see different checkbox defaults after the
  migration (decision 2.11). The operator decides before deploy. Do not run it against production
  yourself.

Done when: baseline green, stability test committed and green, preflight script committed.

### Phase 1 — Schema, migration, backfill (zero visible behaviour change)

Goal: the database has funding sources, every row has one, every **insert path** writes one, and
the app still behaves exactly as before for every existing org.

Steps:
1. `src/db/schema.ts`: add §3.1 and every change in §3.2, using Drizzle `foreignKey({ columns, foreignColumns })`
   for composite FKs and `primaryKey({ columns })` for the new PKs. Update the header comment
   (line 10: "Every table except organizations carries org_id") to mention `funding_source_id`.
2. Generate and hand-order the migration (§3.3). Run `npm run db:migrate` on your dev database.
   Write `src/db/funding-sources-migration.integration.test.ts` that asserts, against the migrated
   schema: inserting an expense whose `(line_item_id, funding_source_id)` pair mismatches fails with
   Postgres code `23503`; inserting a row with another org's `funding_source_id` fails with `23503`;
   deleting an organisation that has sources, line items and expenses still succeeds (decision 2.3).
3. New module `src/modules/funding-sources/queries.ts` (server-only):
   - `primaryFundingSourceId(orgId, reader = db): Promise<string>`: the org's lowest `sort_order`,
     then oldest, **non-archived** source. Temporary bridge used by insert paths in this phase only.
     Mark it `// ponytail: bridge until Phase 2 passes the selected source; delete in Phase 4`.
4. Every **insert** path sets `fundingSourceId` (NOT NULL now forces it; the typecheck will list
   them all):
   - `src/modules/auth/actions.ts`: `signUpAction` (257-273) inserts the first source in the same
     transaction: name `"Source 1"`, type `grant`, rules `ORIGINAL_RULES`.
     `saveOnboardingLineItemsAction` (318-326) scopes its delete **and** insert to that source.
     `completeOnboardingAction` (370-374) writes contract fields to the **source row** instead of
     `contract_settings` (keep inserting the payment sources and doc types as today).
   - `src/modules/line-items/actions.ts`: `saveLineItemAction` (create path).
   - `src/modules/expenses/actions.ts`: `createExpenseAction` (219-229): source = the line item's
     `funding_source_id` (select it in the `owned` query at 191-195).
   - `src/modules/recurring/actions.ts`: `addRecurringToMonthAction` (around 182-205): source = the
     line item's source.
   - `src/modules/expenses/references.ts` `claimReferenceSeq`: add a `fundingSourceId` parameter
     (second, before `month`). Upsert values and conflict target
     `[orgId, fundingSourceId, month]`. Update all 3 callers (expenses create/update, recurring add).
   - `src/modules/packet/actions.ts` `markMonthSubmittedAction` (45-51), `clearMonthSubmittedAction`,
     `src/modules/packet/snapshot.ts` capture/discard (43-88, 101-110), `src/services/storage/documents.ts`
     `ingestMonthDocument` (339-420), `src/generation/artifacts.ts` insert (110-122): use
     `primaryFundingSourceId(orgId)` for now.
   - `src/db/seed.ts`, `src/db/dev-fixture.ts`: create the source; attach everything to it.
5. **Tests:** integration tests insert line items/expenses/month rows directly and will now fail on
   NOT NULL. Add one helper, `src/db/test-org.ts` (`createTestOrg({ name, ... }) → { orgId, fundingSourceId }`),
   and convert every integration test to use it (about 20 files; `grep -l "insert(organizations)" src`).
   Change **setup only**, never assertions. If an assertion must change, **STOP**: that is a
   behaviour change.

Docs: `data-model.md` (new table, new columns, deprecations, updated S3 layout note for generated
artifacts); open **D-93** in `decisions.md` with decisions 2.1-2.13 and the rollback block.

Done when: suite green with the **same test count + new tests**; stability constants unchanged;
the dev fixture's dashboard, packet and downloads look identical (spot-check in the browser).

### Phase 2 — Source context, selector, and source-scoped reads

Goal: every read is scoped to a source; the header has a selector; single-source orgs see nothing
new.

1. `src/modules/funding-sources/queries.ts` add:
   - `listFundingSources(orgId)`: all sources incl. archived, ordered `sort_order, name, id`.
   - `findFundingSource(orgId, id, reader = db)`: returns the row **only if** it belongs to `orgId`
     (and `isUuid(id)`), else `null`.
   - `loadSourceContext = cache(async (orgId, storedActiveId) => {...})` returning
     `{ sources, activeSources, single: boolean, selectedId: string | null }` with these rules:
     `single` ⇔ the org has exactly one source in total. If `single`: `selectedId` = that source.
     Otherwise `selectedId` = `storedActiveId` if it is one of `sources` (archived allowed, for
     viewing history), else `null` (All).
   - `requireOwnedFundingSource(session, id)`: typed failure (`fail("Choose a funding source.")`) unless
     `findFundingSource` finds it. Used by every action/route that takes an id.
2. `src/services/auth/store.ts`: add `activeFundingSourceId` to `SessionContext` (25-35) and to the
   `resolveSession` select (77) and context (112).
3. `src/modules/auth/actions.ts`: `setActiveFundingSourceAction(id: string | null)`, modelled on
   `setActiveMonthAction` (409-420). `null` = All. Non-null ⇒ `requireOwnedFundingSource`.
4. Header: `app/r/layout.tsx` (24-25, 53) renders a new `src/components/app-shell/funding-source-selector.tsx`
   next to `MonthSelector`, **only when `!single`**. Options: "All funding sources", each active
   source, then archived sources in a separate "Archived" group. Reuse the existing `Select`
   component (`src/components/ui/select.tsx`) and copy `month-selector.tsx`'s persist-then-refresh pattern.
5. **Scope every loader by source.** Add a `fundingSourceId` parameter (right after `orgId`) and a
   `funding_source_id = ?` filter:
   - `src/db/queries.ts`: `loadLineItemBudgets` (43), `loadExpenseAmounts` (83),
     `loadContractSettings` (105) → rename to `loadFundingSourceSettings`, reading the source row
     (same return shape).
   - `src/db/months.ts` `loadSelectableMonths` (17): accept `fundingSourceId | null`. `null` (All) →
     union of every source's contract months and expense months.
   - `src/generation/month-snapshot.ts` `loadMonthSnapshot(orgId, fundingSourceId, month)`: filter
     line items, expenses, prior amounts, month documents; `settings` from the source row
     (186-190 → source); `docName` = `source.doc_name ?? org.doc_name` (129-133). **Do not add any
     field to `MonthSnapshot`** (decision 2.8).
   - `src/modules/packet/queries.ts` `loadPacketReadiness` (59): all five queries + `month_statuses`.
   - `src/modules/packet/snapshot.ts` capture/discard: take `fundingSourceId`; replace the Phase 1 bridge.
   - `src/modules/expenses/queries.ts`: `loadExpenseFormOptions` (60), `loadMonthExpenses` (288),
     `loadTrashedExpenses` (347): take `fundingSourceId | null` (null = all sources, for the list
     and trash with All selected).
   - `src/modules/line-items/queries.ts` `loadLineItemRows` (41), `findLineItem` (112).
   - `src/modules/line-items/actions.ts`: the duplicate-name check in `saveLineItemAction`
     (50-54) currently loads **every line item in the org**; scope it to the line item's source,
     or a second source can never have its own "Salary". Also scope `reorderLineItemsAction` (163)
     and the create path to the selected source (replacing the Phase 1 bridge), and refuse
     creating a line item on an archived source. Test: two sources can each create "Salary"; the
     same source cannot twice.
   - `src/generation/artifacts.ts` `resolveArtifact`: new required input `fundingSourceId`, added to
     `scope` (59-66) and the insert (110-122); `generatedArtifactKey` (keys.ts:78) gains the
     `{fundingSourceId}/` segment (decision 2.9). Update `keys.test.ts`.
6. **Pages.** Resolve `{ selectedId, single }` via `loadSourceContext` and pass `selectedId` down.
   - Single-source-only screens: `app/r/line-items/page.tsx`, `app/r/cover-sheets/page.tsx`,
     `app/r/packet/page.tsx`, `app/r/contract-summary/page.tsx`. When `selectedId === null`, render a
     new shared `src/components/app-shell/pick-funding-source.tsx`: a short explanation plus one
     button per active source that calls `setActiveFundingSourceAction` and refreshes.
   - Dashboard, Expenses list, Trash, Recurring: support `null` = All (Phase 5 builds the All
     dashboard; in this phase with All selected the dashboard may temporarily render the
     pick-a-source panel).
7. Tests: unit-test `loadSourceContext`'s rules (single / multi with a valid stored id / stored id
   from another org → All / stored archived id → still selected). Integration: two sources in one
   org; every loader above returns only its source's rows ★.

Docs: domain-rules **R2.3** (selection persisted like the month), new **§14 Funding sources**
(definition, selection rules, isolation rules); `03-modules/m00-*.md` (header selector).

Done when: green; with the dev fixture (single source) no selector appears and every screen is
unchanged; with a second source inserted by hand, the selector appears and screens scope correctly.

### Phase 3 — Settings: Funding sources section

1. `src/modules/funding-sources/actions.ts` (`"use server"`): `createFundingSourceAction`,
   `updateFundingSourceAction`, `archiveFundingSourceAction`, `unarchiveFundingSourceAction`.
   Allowed for admins **and** managers (spec §1), so use `actionSession()`, not `requireAdmin()`.
   Validate: name required and trimmed, unique per org case-insensitively. Check it in the app
   first with the same `isDuplicateName` helper `saveLineItemAction` uses
   (`src/modules/line-items/actions.ts:50-54`), and keep `funding_sources_org_name_uq` as the
   database backstop; `type` in the enum; money via
   `parseMoneyToCents` (≥ 0); dates via `isValidIsoDate`, start ≤ end; booleans for the rules. Every
   update/archive filters `WHERE id = ? AND org_id = session.orgId`. Archiving the source that is
   `organizations.active_funding_source_id` sets it to `NULL`. Refuse to archive the **last active**
   source ("Keep at least one active funding source.").
2. Move the existing contract and advances logic out of `src/modules/settings/actions.ts`:
   `updateContractAction` (58) and `updateAdvancesReceivedAction` (107) are **replaced** by
   `updateFundingSourceAction`. Delete them, plus `updateReimbursementRulesAction` (138), in this
   phase; the typecheck lists every caller.
3. `src/modules/settings/queries.ts` `loadSettings` (36): stop reading `contract_settings`; return
   `fundingSources` instead.
4. UI `app/r/settings/settings-sections.tsx` + `app/r/settings/page.tsx`: replace the **Contract**
   and **Advances** sections with one **Funding sources** section: a list (name, type, archived
   badge, Edit, Archive/Unarchive) and an add/edit form with name, type, document name (optional,
   placeholder showing the org's document name), contract number, PO numbers, contract value,
   start/end, fiduciary, advances received, and two checkboxes "Does this funder reimburse sales
   tax?" / "…fees?". Remove the tax/fee toggles from the payment-source list (**Lists** section) and
   reword its helper text: payment sources are only how something was paid.
5. Tests: integration for each action: happy path, duplicate name, other-org id refused ★, archive
   last active refused, archive clears the active selection, a manager can create (role check).

Docs: domain-rules **R1.3** (rules now on the source), **R5.1/R5.2** (payment source = how paid only),
**R7.3** (context comes from the source); `03-modules/m09-settings.md`.

### Phase 4 — Expense entry, list, trash, recurring

1. `src/modules/expenses/queries.ts` `loadExpenseFormOptions(orgId)`: return
   `fundingSources: [{ id, name, taxReimbursable, feesReimbursable }]` (active only, plus the
   expense's current source on edit even if archived) and `lineItemsBySource: Record<sourceId, {id, name}[]>`.
   Drop `reimbursementRules` keyed by payment source (86-95).
2. Pages `app/r/expenses/new/page.tsx` and `app/r/expenses/[id]/edit/page.tsx`: compute
   `remaining` per line item **per source** (the existing `allLineItemStats` call at new/page.tsx:25-30,
   run once per source) and pass `initialFundingSourceId`: new = `selectedId ?? first active source`;
   edit = the expense's source.
3. `src/modules/expenses/expense-form.tsx`:
   - Add a **Funding source** field above Line item. When the org has one source: pre-filled, not
     editable (render its name as static text, no control).
   - The line item `<Select>` (around 555) lists only `lineItemsBySource[values.fundingSourceId]`,
     each labelled `"{name} — Remaining {formatMoney(remaining)}"` (the em dash is the spec's own
     wording for this label; it is UI, not a printed document string).
   - Changing the source clears `lineItemId` and re-applies that source's tax/fee rules. Changing the
     payment source (564-593) **no longer** touches the rules (remove the code that applied
     `reimbursementRules[paymentSource]`, including the default at 133).
   - Vendor autofill (291-345, 501-511): apply the remembered line item **only if** it is in the
     current source's list; otherwise leave the line item empty.
   - Submitted warning (257-259, 475): `submittedOn` becomes keyed by `"{sourceId}:{month}"`. On edit,
     warn if the month was submitted for **either** the old or the new source.
4. `src/modules/expenses/actions.ts`:
   - `ExpenseInput` gains `fundingSourceId`. `validate()` requires a uuid.
   - `createExpenseAction` (182): `requireOwnedFundingSource`; refuse an archived source; the `owned`
     line-item query (191-195) also filters `funding_source_id = input.fundingSourceId` ★; tax/fee
     flags come from the client as today (the form pre-sets them from the source).
   - `updateExpenseAction` (249): same line-item check against the **new** source (261-266). Moving
     source is allowed. If the source **or** the month changed, claim a new reference in
     `(newSource, month)` (generalise `movedMonth` at 337-345 to `moved = monthChanged || sourceChanged`).
     Refuse moving **into** an archived source; editing an expense that already sits on an archived
     source is allowed. The audit snapshot records `fundingSourceName`.
   - `restoreExpenseAction` (461): unchanged, the row keeps its source. `searchVendorsAction`: unchanged.
   - Delete `primaryFundingSourceId` usages here (Phase 1 bridge).
5. `src/modules/recurring/actions.ts`: `addRecurringToMonthAction` takes the rules from the line
   item's **source** (replace `reimbursementRulesFor(orgId, paymentSource)` at 182 with the source's
   flags); references per source. `src/modules/expenses/reimbursement.ts`: replace
   `reimbursementRulesFor(orgId, label)` with `rulesForFundingSource(orgId, fundingSourceId)`.
6. Expenses list `app/r/expenses/page.tsx` + `expenses-table.tsx`, Trash `app/r/expenses/trash/*`:
   when the org has more than one source, show a **Funding source** column; with All selected, add a
   source filter (`?source=<id>`, validated server-side with `findFundingSource`; an unknown id is
   treated as All). The R5.2 total cards: with one source selected, unchanged; with All, show one
   reimbursable total **per funding source** instead of per payment source (no combined figure).
   Recurring page (`app/r/recurring/*`): with more than one source, show the source (via line item)
   on each row.
7. Tests (integration): create against another source's line item refused ★ (and prove it: remove the
   filter, see it fail, restore); move source → new reference in the target source, old source's
   counter untouched; move into an archived source refused; the form default rules come from the
   source; vendor autofill does not cross sources (unit test in `vendor-fill.test.ts`).

Docs: domain-rules **R2.6** (per source per month; move = new reference), **§4** unchanged but
note per-source gate; `03-modules/m02-*.md`, `m03-*.md`, `m05-*.md`.

### Phase 5 — Dashboard

1. `app/r/page.tsx`: extract the current body (lines 36-199, everything below the title) into a
   component `SourceBudgetSection({ orgId, source, month })` that renders **exactly** today's
   markup for one source (title of the section = source name, shown only when multi-source).
   - One source selected (or single-source org): render that one section. The page must look
     exactly as today for a single-source org.
   - All selected: one section per **active** source, in `sort_order`, each with its own
     approved/spent/remaining cards, drift notice (the `month_snapshots` query at 43-55 filtered by
     source) and line-item table. **No combined total anywhere.**
   - "View Month-End Packet" link: with All, link to `/r/packet` (which will ask for a source).
2. Tests: integration test of the page's data function if you extract one; otherwise rely on the
   loader tests from Phase 2 and verify in the browser.

Docs: `03-modules/m01-dashboard.md`.

### Phase 6 — Packets, cover sheets, Excel summary, month documents, submission

1. Download routes `app/api/downloads/{packet,summary,cover-sheet}/route.ts`: require a `source`
   query parameter; `findFundingSource(session.orgId, source)` or `404 "Unknown funding source"`.
   Pass it to `loadTrashedExpenses`, `loadMonthSnapshot`, `resolveArtifact`. The documentation gate
   is evaluated on that source's snapshot only, so it is per source automatically ★.
2. Filenames: extend `coverSheetFilename`, `summaryFilename`, `packetFilename`
   (`src/domain/strings.ts:181-202`) with an optional `sourceName`. When given, it goes between the
   document name and the month: `Team_Pursuit_Foundation_grant_February_2026_Packet.pdf` /
   `Team Pursuit Foundation grant February 2026 Salary Breakdown.docx`. Routes pass it **only when
   the org has more than one source** (decision 2.12). Add the format to domain-rules **§12 / R10.3**
   first. Unit tests: without `sourceName` the output is byte-identical to today (use the existing
   expectations in `strings.test.ts`); with it, the new format.
3. Packet screen `app/r/packet/*`: all actions and buttons carry the selected source.
   `markMonthSubmittedAction(month, fundingSourceId)` / `clearMonthSubmittedAction(month, fundingSourceId)`
   / `removeMonthDocumentAction` (packet/actions.ts): `requireOwnedFundingSource`; month-status
   upsert target `[orgId, fundingSourceId, month]`; snapshot capture per source.
   `packet-download-buttons.tsx` adds `&source=` to every URL.
4. Month documents upload `app/api/files/upload/route.ts` (76-80) → `ingestMonthDocument` gets
   `fundingSourceId` from the form, validated with `findFundingSource`. Sort order and listing are
   per source. The storage quota (documents.ts:155) stays org-wide.
5. Cover sheets page and line-item select `app/r/cover-sheets/*`: only the selected source's line
   items. Contract summary `app/r/contract-summary/page.tsx`: the source's settings via
   `loadFundingSourceSettings`.
6. Tests (integration): two sources, same month: A's snapshot has none of B's expenses, line items or
   month documents ★; a missing receipt on B does not block A's packet route; submitting A does not
   mark B; filenames single vs multi; the stability constants (Phase 0) still pass.

Docs: `02-outputs/cover-sheet-spec.md`, `summary-excel-spec.md`, `packet-pdf-spec.md` (per source,
filenames), domain-rules **R10.3, R10.4, R10.6, §11**, `03-modules/m04`, `m06`, `m07`.

### Phase 7 — Hardening, isolation proof, docs close-out

1. **Isolation test** (`src/modules/funding-sources/isolation.integration.test.ts`): org with source A
   fully populated (line items, a performance, expenses, month docs, a submission). Capture A's
   dashboard stats, packet readiness and snapshot hash. Create source B, give it line items,
   expenses, month docs and a submission, rename and archive it. Re-capture A: everything deep-equal.
   This is the acceptance criterion "adding or editing a second source changes nothing in the first".
2. **Cross-org sweep:** extend the existing two-org pattern so every new action and route refuses
   another org's `fundingSourceId` ★.
3. Run a **security review** (the `security-review` skill, or a `red-team-auditor` pass) over the
   whole diff. It touches input parsing, authorization and money.
4. Docs close-out: `docs/00-product/prd.md` (multi-source scope), `docs/README.md` (map row for this
   file, module status), `docs/TASKS.md` (the out-of-scope list from Appendix A as later work),
   finish **D-93**.
5. Manual verification checklist (write the results into this file under a "Results" heading):
   single-source dev fixture: no selector, identical screens, identical filenames, re-downloading a
   previously downloaded month serves the cached artifact; two-source org: every acceptance
   criterion in Appendix A walked through by hand.

---

## 6. Acceptance criteria → where each is proven

| Criterion (Appendix A) | Proven by |
|---|---|
| Existing orgs unchanged: figures, documents, packets | P0.2 stability test; Phase 1 "same assertions" rule; P7.5 manual |
| Admin or Manager can add a source with details, rules, line items; archive later | Phase 3 tests |
| Every expense records its source; line items filtered with remaining; wrong-source save impossible | DB composite FK test (P1) + Phase 4 tests ★ |
| Dashboard shows all sources, each with its own balances, filterable | Phase 5 + P7.5 |
| One source: selector hidden, source pre-filled, no extra clicks | Phase 2 context unit tests + P7.5 |
| Outputs per source, never mixed | Phase 6 isolation tests ★ |
| Submitted, missing-docs check, references, monthly documents per source per month | Phases 4 and 6 tests |
| Moving an expense to another source → new reference + warning | Phase 4 tests |
| Adding/editing source 2 changes nothing in source 1 | P7.1 isolation test |
| Users only see their own org's data | P7.2 cross-org sweep + DB FKs |

---

## 7. Open questions — defaults to use (do not block on these; record each in D-93)

1. **Archived sources in the header selector?** Default: listed under "Archived", view-only.
   Their packets stay downloadable. No new expenses or line items can be added to them.
2. **First source's name at sign-up?** Default `"Source 1"`, renamable in Settings. (Migrated orgs:
   project name, else `"Source 1"`, per the spec.)
3. **Type of a migrated source?** Default `grant`.
4. **Is the selection per user or per organisation?** Per organisation, like the month (spec says
   "like it remembers the month"). Two users of one org share it, as they already share the month.
5. **Month selector with All selected?** Union of all sources' contract months and expense months.
6. **Editing an expense on an archived source?** Allowed (history corrections); moving an expense
   **into** an archived source is refused.
7. **Expenses-list total cards with All selected?** One reimbursable total per funding source,
   never per payment source across funders.
8. **Recurring screen with All selected?** Lists every item with its source; "Add to month" works
   per item.
9. **Orgs whose payment sources carry different tax/fee rules** (found by P0.3): migration takes
   the first active one's rules (decision 2.11); the operator reviews the preflight report before
   deploying.

---

## 8. Pitfalls this plan already knows about

- **Hash drift.** Adding *any* field to `MonthSnapshot`, reordering a query, or changing how `docName`
  or `settings` are derived changes every cache key. The Phase 0 test catches it. Never "fix" the
  test by updating its constants.
- **Pool deadlock.** Any helper called inside `db.transaction()` must receive and use `tx`, like
  `claimReferenceSeq` does (references.ts:38-42). `findFundingSource` and the loaders take a
  `reader` for this reason.
- **Integration test churn.** Setup changes are expected in about 20 files; assertion changes are not.
- **`revalidatePath("/", "layout")`** is how every action refreshes today; keep using it.
- **drizzle-kit ordering.** It will generate NOT NULL columns without a backfill; always hand-order (§3.3).
- **Composite FK delete semantics.** `NO ACTION`, not `RESTRICT` (decision 2.3).

---

## Results (Phase 7, 2026-09-11)

### Migration rehearsal — production data is preserved

Run on throwaway local databases only (`ngo_rehearsal`, `ngo_rehearsal_ref`), never the dev or
production database. "Before" was built with the **pre-feature code** (e5a0ff8): migrations
0000–0022, `db:seed`, `db:fixture`, `db:fixture -- docs` (40 expenses, 80 attached documents),
plus production-shaped edge cases: a submitted month with month snapshots and totals, a pinned
(downloaded) packet artifact, an unpinned summary artifact and a pinned cover sheet, a month
document, a trashed expense, a legacy performance with no name/date, a second organisation whose
project name is only spaces and whose active payment sources disagree on tax/fee rules (an
inactive one sorted first), and a third organisation with no `contract_settings` row at all.
"After" ran migration 0023 with the branch code.

| Check | Result |
|---|---|
| Every original column of all 18 pre-existing tables (row count + checksum over every row) | **identical** — the only difference anywhere is the migration counter, 23 → 24 |
| Packet, summary and cover-sheet cache keys for every org × month (20 keys), old code before vs new code after | **all 20 identical** — already-downloaded and cached artifacts keep matching |
| Rows assigned to a funding source other than their organisation's, across the 7 backfilled tables | **0** |
| Source name / rules per org | project name carried over; blank or whitespace project → "Source 1"; missing `contract_settings` → "Source 1" with zeroed contract fields; rules from the first **active** payment source (the inactive one was skipped), else (tax no, fees yes) |
| Migration that cannot complete (a planted expense pointing at another organisation's line item) | `db:preflight-funding-sources` prints `BLOCKER` and exits 2; `db:migrate` then fails and leaves **no trace** — still 23 migrations, no `funding_sources`, no new columns. The deploy aborts with the old version still serving. |
| Rollback (`docs/04-engineering/rollback-0023-funding-sources.sql`) | schema identical to a database migrated only to 0022 (44 indexes, 48 constraints, 190 columns, 6 enum types); data identical to "before" (0 of 19 differing) |
| Re-apply 0023 after a rollback | succeeds; data and all 20 cache keys identical to the first apply |
| Rollback after contract details were edited post-deploy (one org with a `contract_settings` row, one without) | edits carried into `contract_settings` for both |
| Rollback once a second source exists | refused with an exception; nothing changed |

### Deploying to production

1. Deploy at a quiet time. `deploy.sh` builds first, then migrates, then restarts. Between the
   migration committing and the new app taking over (seconds), the **old** app still serving
   cannot save an expense or line item: its inserts lack the new required column, and its
   reference-number upsert targets the old key. Those saves fail with an error and write
   nothing; no data is at risk, but a user saving in that window would have to retry.
2. Take a fresh backup (`./backup.sh`) and confirm the upload checkpoint.
3. Run `npm run db:preflight-funding-sources` against production (read-only, writes nothing).
   Exit 2 / a `BLOCKER` line: do not deploy. Read the per-org lines, especially any rules
   `WARNING`.
4. `./deploy.sh`. A failed migration aborts the deploy with the old version still serving.
5. Verify as the City org: the selector is hidden, the dashboard figures match the day before,
   and re-downloading an already-downloaded month's packet serves it from cache (same bytes).

---

## Appendix A — Product spec (verbatim from the client brief, 2026-09-11)

Today an organization has one contract. Its line items, expenses, monthly packets and settings all
belong to that one contract.

Team Pursuit will receive money from more than one place: the City of Detroit contract they have
now, a grant from another funder, a donation, or a line of credit. Each one has its own budget and
its own rules, and the City must never see another funder's expenses in its packet.

Performance grants are **not** part of this. They stay as they are: extra money added to a line
item inside the same contract.

### What we are building

An organization can have several **funding sources**. Everything below is tracked separately for
each one:

- line items and budgets
- expenses
- monthly packets, cover sheets and the Excel summary
- bank statements and other monthly documents
- contract details (funder, fiduciary, contract number, PO numbers, contract value, start and end dates, advances received)
- tax and fee reimbursement rules

**Example:** Team Pursuit has the City of Detroit contract ($940,000, line items Salary, Travel,
Supplies…). They receive a $50,000 grant from a foundation with two line items (Programs, Admin)
and a $5,000 donation. In the app that is three funding sources. Each has its own balances and its
own packet.

### How it works in the app

#### 1. Funding sources (Settings)

- Settings gets a **Funding sources** section. It replaces the current Contract and Advances sections.
- Add a funding source with: name (required), type (Grant / Donation / Line of credit / Other),
  document name (optional; if empty, documents use the organization's document name), contract
  details, advances received, and the tax/fee rules ("Does this funder reimburse sales tax? Fees?").
- The tax/fee rules move here from the payment-source list. Payment sources go back to meaning only
  how something was paid ("Paid by us", "Paid directly by fiduciary"). Expenses already saved keep
  the rules they were saved with.
- A funding source can be **archived** when it is finished. It disappears from pickers but its
  history and documents stay.
- Admins and Managers can do all of this.

**Example:** A donation of $5,000 from a local business: name "Local Business donation", type
Donation, one line item "General" with a $5,000 budget. No contract number or POs needed.

#### 2. Choosing a funding source

- A **funding source selector** sits in the header next to the month selector. The app remembers
  the choice, like it remembers the month.
- It has an **All** option. The dashboard and the Expenses list can show all sources. Screens that
  only make sense for one source (Line items, Cover sheets, Packet, Contract summary) ask you to
  pick one when All is selected.
- If the organization has only one funding source, the selector is **hidden** and everything works
  exactly as today.

#### 3. Line items

- Line items belong to one funding source. Two sources can each have a line item called "Salary".
- The Line items screen shows the selected source's line items. Performances work as they do now.

#### 4. Adding or editing an expense

- The form gets a **Funding source** field above Line item. It is pre-filled with the source
  selected in the header. With one source it is pre-filled and cannot be changed.
- The **line item list only shows that source's line items**, and each one shows its remaining
  balance, for example "Travel — Remaining $3,250.00". Changing the source clears the line item and
  shows the other source's list.
- Tax and fee checkboxes are pre-set from the source's rules.
- An expense belongs to one source only. A cost shared between two sources is entered as two expenses.
- Vendor autofill still works, but it only fills in the line item if that line item belongs to the
  selected source.
- On edit, the source can be changed. The expense then gets a new reference number (like moving it
  to another month), and the app warns if that month was already submitted for either source.
- The Expenses list and Trash show a Funding source column and filter when All is selected.
  Recurring items belong to a source through their line item.

**Example:** Header set to "Foundation grant". Add Expense opens with Funding source = Foundation
grant, and the line item list shows only Programs and Admin, each with its remaining balance.
Salary from the City contract is not offered.

#### 5. Dashboard

- With **All** selected: one section per funding source, each with its own totals (approved,
  spent, remaining) and its own line item table. There is no combined total across sources,
  because different funders' money is not one budget.
- With one source selected: the dashboard as it is today, for that source.

#### 6. Packets, cover sheets and Excel summary

- Always generated **for one funding source**. They contain only that source's line items,
  expenses and monthly documents. Nothing is ever combined.
- Documents use the source's document name (or the organization's, if the source has none). The
  City packet looks exactly as it does today.
- Filenames include the source name once an organization has more than one source.
- Marking a month as **Submitted**, the missing-documents check, and the download block are all per
  source per month. A missing receipt on the foundation grant does not block the City packet.
- Expense reference numbers (`2026-02-001`) count separately per source per month. The City's
  numbering continues unchanged.

#### 7. Bank statements and other monthly documents

- Uploaded **per funding source** per month, from the packet screen of that source.
- If one bank statement covers two sources, upload it under each. A packet only ever includes its
  own uploads.

#### 8. Existing data

- When this ships, every organization's current contract, line items, expenses and documents
  become its **first funding source**, named after the project name in Settings (or "Source 1" if empty).
- Nothing changes for them: same figures, same documents, same downloaded packets. Adding a second
  source later must not change anything in the first.
- Sign-up creates the first funding source automatically; onboarding fills in its line items and
  contract details as it does now.

Database changes are for the developer to decide.

### Out of scope (later)

- Splitting one expense across two sources
- Limiting which users can see which source
- Reporting periods other than calendar months
- Different documentation rules per source
- Vendor memory per source
- Any combined report across sources
- Deleting a source that has data (archive only)

### Acceptance criteria

- Existing organizations keep working with no visible change: same figures, same documents, same downloaded packets.
- An Admin or Manager can add a funding source with its own contract details, rules and line items, and archive it later.
- Every expense records its funding source. The line item list shows only that source's line items with their remaining balances. Saving against another source's line item is impossible.
- The dashboard shows all sources together, each with its own balances, and can filter to one.
- With one funding source, the selector is hidden and the form's source is pre-filled; no extra clicks anywhere.
- Packets, cover sheets and Excel summaries are per source and never contain another source's expenses, line items or monthly documents.
- Submitted status, missing-documents check, reference numbers and monthly documents are per source per month.
- Moving an expense to another source gives it a new reference number and warns if the month was submitted.
- Adding or editing a second source changes nothing in the first.
- Users only see data of their own organization.
