# Repo invariants — the review checklist

Each item: the rule, why it exists here, where it lives, and what a violation looks like in a diff.
Rules come from `docs/01-domain/domain-rules.md` (R-numbers), `docs/04-engineering/decisions.md`
(D-numbers) and defects this project actually shipped. Verify file paths still exist before citing.

## A. Docs-first
- **Behaviour change ⇒ docs change in the same PR**: the R-rule in `domain-rules.md`, the module spec
  `docs/03-modules/mNN-*.md`, `data-model.md` for schema, and a new `D-nn` row. Flag: code changed a
  rule but the rule text (or a sibling rule, or `docs/PHASE-N.md`) still says the old thing; two rules
  in the same doc now contradict each other; `docs/TASKS.md` ids duplicated.
- Comments must not lie. Flag comments that cite the wrong D-number, describe removed columns, call
  something "the only supplier" when it isn't, or say "Phase N" meaning a build step of another plan.

## B. Money and printed documents
- **Money is integer cents** end to end; format only at render (`src/domain/format.ts`). Flag string
  round trips (format → parse → format), floats, `?? 0` on unparseable money (saves $0.00 silently).
- **Printed strings come only from `src/domain/strings.ts`** (R-§12). Flag literals in generators.
- **Generator versions**: `PACKET_`/`SUMMARY_`/`COVER_SHEET_GENERATOR_VERSION` in
  `src/generation/versions.ts` (moved out of the download routes by PHASE-12, so shares and downloads
  read one value) must be bumped when output bytes change, and must **not** be bumped when they
  don't. Downloaded artifacts are pinned forever (R10.6); a stale version serves an old cached file.
- **Cache-key stability**: `MonthSnapshot` (`src/generation/month-snapshot.ts`) is hashed whole by
  `inputsHash`. Adding a field, reordering a query, or changing how `docName`/`settings` derive changes
  every key for existing orgs. `src/generation/snapshot-stability.integration.test.ts` holds constants
  recorded from pre-feature code — they must never be edited to make a test pass.
- **Funder-approved layouts**: the cover sheet's three-column table (R2.6/R6) never gains a column or
  edited text; the Aptos→Carlito font alias and render smoke (`scripts/render-smoke.ts`) guard wrapping.
- **Filenames** (`strings.ts` `*Filename`): `sanitiseForFilename` cuts at 80 chars from the tail. Any
  new prefix must not push the month, line item or "Breakdown" off the end — probe with real names
  (e.g. doc name "Team Pursuit", source "Community Violence Intervention", long line items) and check
  two different inputs never produce the same filename.

## C. Data integrity patterns
- **No column default on must-supply columns** (`expenses.reference_seq`, `tax_reimbursable`,
  `fees_reimbursable`, `users.role`, `funding_sources` rules): omission must be a type error, because a
  default made three separate money/data bugs compile. Flag new defaults on such columns.
- **One supplier per fact**, never an inline re-derivation:
  `claimReferenceSeq` (references), `rulesForFundingSource` (tax/fee defaults server-side),
  `documentationStatus` in `src/domain/gate.ts` (documentation completeness),
  `loadSourceContext` / `requireOwnedFundingSource` in `src/modules/funding-sources/queries.ts`
  (selection and ownership), `loadSelectableMonths` (month lists), `loadLineItemBudgets` (performances
  folded into scheduled value), `packetContents` (packet order).
- **References** (R2.6): unique per (org, funding source, month), never reissued, reassigned when an
  expense moves month **or source**, claimed inside the caller's transaction.
- **Pool deadlock**: any helper called inside `db.transaction()` must take and use `tx`
  (`Executor`/`Reader` params). A second pool checkout inside a transaction deadlocks under
  concurrency (pool max 10). Tests calling the helper directly with `tx` do not prove the call site passes it.
- **Audit trail** (`expense_audit_events`): mutation + event in one transaction; recurring add/remove
  write no events (known gap); history is only viewable per live expense.

## D. Tenancy, roles, funding sources
- **Every server action and route handler is a public endpoint.** First line: `actionSession()` /
  `requireAdmin()`; every client-supplied id re-checked against the session org before any read/write.
  Routes answer a foreign id and a missing id identically (404) so probes learn nothing.
- Roles: Admin/Manager; Managers can do everything except user management and audit History (by ticket).
  UI hiding is never the boundary.
- **Funding sources (D-93)**: every grant-scoped table carries `funding_source_id` with composite FKs to
  `funding_sources(id, org_id)` and `expenses(line_item_id, funding_source_id) → line_items(id, funding_source_id)`.
  Check every new query is scoped by source where the data is per source, "All" (null) branches are
  handled, archived sources refuse new writes but keep history reachable, and the header selection
  (`users.active_funding_source_id`, each person's own since Phase 18) is re-validated.
  Links that record a relationship (e.g. `expenses.recurring_item_id`) must be cleared or re-scoped when
  an expense moves source.
- **Per-person state lives on the person (D-131)**: anything one person picks or dismisses for
  themselves (month, funding source, tours, banners) is stored on `users` or a per-user table, never
  on `organizations`. A column on `organizations` that one person's click changes for everyone is
  the Phase 18 bug; `src/lib/per-person-state.test.ts` blocks the month, source and welcome banner
  going back to the organization.
- `"use server"` files may export only async functions; helpers/constants live elsewhere.

## E. Migrations and deploy
- Hand-order SQL where drizzle-kit would fail: backfill before `SET NOT NULL`; unique index before a
  composite FK; PK drop/recreate. Check `drizzle/meta/_journal.json` and the snapshot match `schema.ts`.
- Edge-case orgs: no `contract_settings` row (signed up, never onboarded), zero or inactive payment
  sources, existing `month_statuses` rows under a PK change, `generated_artifacts` with NULL line item.
- **Deploy window**: `deploy.sh` builds, migrates, then restarts; the old app serves against the new
  schema for seconds. List which old writes fail loudly and which succeed silently into deprecated
  columns. Preflight scripts must be runnable on the EC2 box (inside the compose image), before migrate.
- Rollback SQL restores index/PK names exactly and refuses when data can no longer fit.

## F. UI conventions
- Shared primitives in `src/components/ui` (Select, Button, ConfirmButton, Modal/Dialog via
  OverlayShell, TableCard, Field/Input/Label, EmptyState). Destructive actions that destroy stored data
  go through `ConfirmButton`. Sentence-case section titles. Tailwind 4 `@theme` tokens only.
- Redirect after save must land where the saved record is visible (month **and** funding source), or it
  reads as a failed save.
- Expenses table must not scroll sideways at the 1220px content width (m03); new columns need a measure.
- Responsive and a11y: labels with `aria-labelledby` like sibling selects; focus after `router.refresh()`.

## G. Tests
- Integration tests hit the real local DB and must clean up (`delete(organizations)` cascades).
- Fixed-UUID fixtures need pre-cleanup or a crashed run poisons every later run.
- `describe.skipIf(!hasPdftotext())` blocks silently skip on machines without poppler — the developer's
  "green" may not include them.

## H. AI features (Phase 10/11, PR #18)
- Gate: `src/modules/ai/access.ts` is the single answer (plan + switch + env). Every route/action
  re-reads it from the DB; pages alone are not the boundary.
- **Test with the real model in the browser**, not only mocks. PR #18's mocked suite was green
  while the real model (a) read a bank line as `-$165.00`, which turned a proofs-only suggestion
  into a negative Subtotal (a refund), and (b) wrote "100%" because the prompt asked it to, which
  the figure verifier then rejected. **The prompt and the verifier are two paths that must
  agree**: every number the prompt invites must be in the allowed set.
- Model output that becomes money goes through a strict format check, not the lenient user-input
  parser (`parseMoneyToCents` reads "1.234,56" as $1.23).
- Every OpenAI request: `store: false`, `max_output_tokens`, a timeout the tests actually prove,
  and a usage row even on failure.
- Ask the user to put `OPENAI_*` in `.env.local` themselves; never handle the key.
