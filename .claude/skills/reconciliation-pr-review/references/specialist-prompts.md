# Specialist subagent prompts

Launch all selected specialists in ONE message, `subagent_type: "general-purpose"`, background.
Fill `<REPO_ROOT>`, `<PR>`, `<BRANCH>` (`pr-<n>`), `<PLAN>` (e.g. `docs/PHASE-6.md`) and add the risks you already
suspect. Shared preamble for every prompt:

> Repo: <REPO_ROOT> (the absolute path of this checkout). Branch `<BRANCH>` is checked
> out; base is `main`. Start with `git diff main...HEAD --stat`, then `git diff main...HEAD -- <path>` by
> area. Stack: Next.js 16 App Router (server actions are public endpoints), React 19, Drizzle ORM +
> Postgres 16 (pool max 10), vitest integration tests against the real local DB. House rules:
> `.claude/skills/reconciliation-pr-review/references/repo-invariants.md` — read it first.
> READ-ONLY: no edits, no DB writes, no state-changing git. You may run a single vitest file or a
> read-only `psql` SELECT to check a claim. Never read `context/`.
> Output one JSON object per finding per line and nothing else:
> {"severity":"CRITICAL|INFORMATIONAL","confidence":1-10,"path":"file","line":N,"category":"...",
> "summary":"...","fix":"...","evidence":"verbatim quoted line(s)","specialist":"<name>"}
> A finding without quoted evidence must have confidence ≤ 5. If nothing: output exactly NO FINDINGS.

Also load the generic checklist for each from `~/.claude/skills/gstack/review/specialists/<name>.md`
when it exists, and tell the agent to read it.

## testing
For each acceptance criterion and each invariant the plan says is "proven by test": does the test
exist, and can it FAIL if the guard is removed? Flag assertions on constants, on mock return values,
only `ok === false` (could be refused for another reason, e.g. rate limit), `every()` over possibly
empty arrays, negative tests masked by a different guard firing first (e.g. cross-org FK firing before
the cross-source FK), tests calling a helper directly instead of the call site that regressed, skipped
blocks, fixed-UUID fixtures without pre-cleanup. Check setup-only churn vs weakened assertions. Give a
vitest test stub for each gap.

## data-migration (only when `drizzle/` changed)
Statement ordering vs Postgres rules; backfill edge cases (org with no `contract_settings`, zero/inactive
payment sources, existing rows under a PK change, NULL line items under new unique indexes); drizzle
snapshot vs `schema.ts`; atomicity if a late statement fails; rollback SQL restores exact names and
refuses unsafe states; the **deploy window** (`deploy.sh` builds → migrates → restarts; old app serves
the new schema): which old writes fail loudly and which succeed silently into deprecated places;
whether any preflight can actually be run on the EC2 box before migrate.

## security (tenancy)
Enumerate every server action, route handler and page reading `searchParams`/`params` that takes an id
from the client (org, user, expense, line item, funding source, document, recurring item). For each:
is ownership checked against the session org (and source) before any read or write? Role checks for
admin-only paths. Probe-resistance (foreign vs missing id indistinguishable). Archived/soft-deleted
parents refusing writes. React `cache`/`use cache` leaking across orgs. Uploads and downloads.

## maintainability (docs-first, single supplier)
Docs updated with the code (R-rules, module specs, data-model, D-row, PHASE doc, TASKS ids); rules that
now contradict each other; comments that lie or cite wrong decisions; a second inline copy of a fact
that has a single supplier (see invariants §C); dead code left behind (removed actions still exported,
`@deprecated` columns still written); printed strings outside `strings.ts`; duplicated user-facing
literals; scope creep smuggled into the PR.

## architecture (repo structure, conventions, database design)
Read `.claude/skills/reconciliation-pr-review/references/code-structure-and-db-design.md` first.
It records how this repo is actually built. Judge the diff against it:
- **File placement:** route-local components vs shared ones; `src/domain` purity; `"use server"`
  exports; `@/` imports vs `../`.
- **Naming and action conventions:** kebab-case files, `verbNounAction`, one object parameter for
  multi-field input, runtime validation of untrusted arguments, `ActionResult` instead of throwing.
- **Single suppliers:** types re-declared instead of `import type` from `schema.ts`, strings
  half-moved to `strings.ts`, repeated blocks that should be one helper.
- **Comments:** comments that cite "Phase N" ambiguously or have gone stale.
- **Encoding:** BOM or mojibake in changed files. Run the check in the reference file.
- **Database:**
  - Is the column on the right table for where the product is heading (billing, Stripe)?
  - Are invalid states storable (missing CHECK)?
  - Enum vs table.
  - Naming consistency with sibling tables (audit tables).
  - Cascade vs keep for history.
  - Actor deactivation vs delete.
  - Do indexes serve the new queries?
  - Lock level (`FOR UPDATE` vs `FOR NO KEY UPDATE`).
  - Migration safety (`lock_timeout`, additive, backfill order).
- **Scale ceilings:** client-side loading of all rows, per-request query fan-out against pool max 10.
For each finding name the sibling the diff drifts from, and rank it blocking / should fix / note
for later. Use `"category":"architecture: <sub-area>"` in the JSON.

## performance
N+1 across sources/months on dashboard, expense form (new/edit) and lists; queries without a usable
index for the new WHERE shapes (and redundant indexes that only add write cost); helpers inside
`db.transaction()` using the pooled `db`; O(sources × months × line items × expenses) loops in pages;
React `cache` dedupe actually hitting.

## api-contract
Every changed action/route signature: find all callers including untyped ones (FormData hidden inputs,
URLSearchParams, hrefs built as strings, tests, dev-fixture, scripts). Error shapes and statuses vs
conventions; stale tabs after deploy hitting new required params (is the message actionable?);
`ActionResult` unions (`expired` vs `denied`); optional fields on stored JSON (audit snapshots) rendering
for rows written before the PR.

## design
Spec fidelity of each user-visible criterion (quote the JSX); shared primitives vs hand-rolled markup;
destructive actions behind `ConfirmButton`; empty/loading/error/disabled states and why-disabled hints;
responsive (header wrap at 375px, table width rule at 1220px); a11y (labels, `aria-labelledby`, focus after
`router.refresh()`); copy consistency (sentence case, one term per concept, no "now" release-note copy);
post-save redirects landing where the record is visible.

## red team (adversarial)
"Think like an attacker and a chaos engineer. Find how this fails in production for the real client
(one organisation today that must see no change; later additions must not alter it)." Point it at: the
deploy window, "All"/null branches, moving records between parents (month/source) and every link that
should follow or be cleared, archived parents, per-parent counters and caps, cache keys and pinned
artifacts, filename truncation with long real names, org-wide shared UI state. Ask for FIXABLE vs
INVESTIGATE, confidence, and a final `Recommendation: <action> because <most exploitable finding>` line.

## Codex (optional)
`codex exec` / `codex review` may fail with an auth error ("Your access token could not be refreshed").
If so, say "Codex unavailable (auth)" and continue with Claude-only passes. If running it, do so from a
`git worktree add --detach <scratch>/pr-wt HEAD` checkout (no `context/`, no `.env*`), read-only sandbox.
