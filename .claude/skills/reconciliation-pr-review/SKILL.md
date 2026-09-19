---
name: reconciliation-pr-review
description: Review a pull request on the Team Pursuit reconciliation app (this repo) the way this project requires — ticket-matched, docs-first, verified by running and rendering rather than reasoning, with mutation-tested guards, a code-structure and database-design pass against this repo's conventions, a usability pass for non-technical users, and a short Slack draft for the developer. Use when asked to review, check, re-review or give a green flag on a PR (a GitHub PR number/URL for AwaisYusaf/reconciliation-team-pursuit, or "the team member's PR"), or to confirm requested PR changes were fixed.
---

# Reconciliation PR review

This repo is a grant-expense reconciliation app (Next.js 16 App Router, React 19, Drizzle + Postgres 16,
custom session auth, S3, docx→PDF via LibreOffice, pdf-lib, exceljs). Its documents go to a funder
(the City of Detroit), so a wrong figure or a leaked row is worse than a slow page.

**Every defect that survived into a release here was two code paths that had to agree where only one
was updated, and the full test suite passed through all of them.** The review exists to find those.
Passing tests are evidence, not proof; a rendered page, a real DB row, or a failing mutation is proof.

## Non-negotiables

- **Never post to GitHub** (no PR comments, reviews, approvals, merges). The team talks in Slack: hand
  the user a short draft; they post it. A "yes" is not permission to post.
- **Never commit, push or edit the PR author's code.** Findings only. Temporary probe files are allowed
  only under the rules in "Proving a finding" and must be deleted before you finish.
- **Never read, render, commit or publish `context/`** (real client PII).
- **Never mint sessions or type passwords** to get into the app. Ask the user to sign in (see Browser).
- Back up the local database before applying a PR's migrations.

## Workflow

Track these as a checklist and keep the user posted between phases.

### 1. Intent — what was asked
1. `gh pr view <n> --json title,body,baseRefName,headRefName,additions,deletions,commits,files`.
   PR bodies are often empty; the commit messages and the `docs/PHASE-*.md` plan are then the spec.
2. Get the ticket (the user usually pastes it) and any plan the PR adds (`docs/PHASE-N.md`, new `D-nn`
   rows in `docs/04-engineering/decisions.md`). Read prior review rounds if this is a re-review.
3. Write a one-line **Intent** and list the ticket's acceptance criteria — each becomes a row in the
   final report with DONE / PARTIAL / NOT DONE / UNVERIFIED and the evidence.
4. Note scope creep (changes the ticket did not ask for) separately; it needs its own sign-off.

### 2. Setup — run `scripts/pr-setup.sh <pr-number>`
It prints state, backs up the DB to the scratchpad, fetches the branch into `pr-<n>`, applies
migrations, and runs typecheck, lint, the full test suite and the production build, writing logs.
Read `references/setup-notes.md` if anything fails — several failures here are local artefacts
(stale `.next/dev` types after a route move, the dev server on :3000 belonging to another project).

Record: tests passed/failed/**skipped** (a `describe.skipIf` that skipped is not a pass — PDF/LibreOffice
tests skip without poppler, integration tests skip without `DATABASE_URL`).

### 3. Read the diff by risk, not by file order
Order: migrations and `src/db/schema.ts` → server actions and route handlers (every one is a public
endpoint) → loaders/queries → generators (`src/generation/`) → UI → tests → docs.
Apply `references/repo-invariants.md` as you go. It is the checklist of this repo's house rules with
file pointers; most real findings are a violation of one of them.

Every review has three parts, and all go in the report:
- **Functionality:** does it do what the ticket says, without regressions?
- **Code structure and database design:** does it keep the repo and schema ready for a larger
  product? Where files belong, naming and action conventions, duplication, type and string
  suppliers, encoding, table and constraint design, migration shape and scale ceilings.
- **Usability:** the users are non-technical. Doing the real task in the browser, is it easy,
  findable and few-step? Ask for placement, order, wording or flow changes even when the ticket
  was followed (`references/usability-review.md`).

Read `references/code-structure-and-db-design.md` before reading the diff. It records how this repo
is actually built. Judge the PR against those conventions, not against personal taste. When the
code shows the file is stale, update the file.

For anything the diff introduces that has siblings (a new column, enum value, scope id, supplier
function), **grep every other path that writes or reads the same thing** — recurring add/remove,
vendor autofill, `dev-fixture.ts`, `seed.ts`, onboarding, download routes, snapshot capture — and read
them. That is where the "two paths that must agree" defect lives.

### 4. Fan out specialists in parallel (diffs over ~200 lines)
Launch read-only subagents in one message using the prompts in `references/specialist-prompts.md`:
testing, data-migration (if migrations), security/tenancy, maintainability (docs-first + single
supplier), **architecture (repo structure, conventions, database design)**, performance,
api-contract, design, and an adversarial red team. Give each the PR number,
the plan path and the specific risks you already suspect. Continue your own reading meanwhile.

Before calling a ticket mismatch a defect, check whether a later client decision changed the rule:
read the newest D-row, the R-rule text as it stands in the PR, and the commit messages ("the client
asked"). Round 1 of PR #15 asked for archived sources back in the header, which reversed the
client's 12 Sep request. When the rule changed, the finding goes to Awais as a question, not to
the developer as a fix.

Treat specialist output as leads. **Verify every finding you will report** (quote the code, or reproduce
it). Downgrade or drop what you cannot verify; say so. Specialists label test gaps "CRITICAL" — a
missing test is not a production defect; rank by user impact.

### 5. Prove findings
See `references/proving-findings.md`. In short:
- **Reproduce before claiming** a bug: a throwaway integration probe (`references/probe-test-template.ts`)
  against the local DB, a read-only SQL query, a `npx tsx` snippet for pure functions, or the browser.
- **Mutation-test every guard the PR adds or relies on**: put the old bug back (one-line `sed`), run the
  specific test file, confirm it fails, `git checkout -- <file>`. A test that stays green with the bug
  reintroduced guards nothing — that is a finding.
- Distrust tests that assert on constants, on mocks they configured, only on `ok === false`, or on
  `every(...)` over a possibly empty array.

### 6. Browser pass
See `references/browser-testing.md`. The user signs in (Chrome extension or the in-app Browser pane).
Test the ticket's user-visible acceptance criteria against real data, including the "nothing changed
for the existing client" case, and check the DB after each state-changing step.
Clicks that land before hydration silently do nothing — retry with coordinates before calling it a bug.

### 7. Report
Use `references/report-template.md`:
- For the user (Awais): verdict first (green flag / changes needed), acceptance-criteria table,
  verified findings ranked by impact with file:line and how each was proven, a separate
  **Code structure and database design** section (blocking / should fix / note for later), a
  **Usability asks** section (what the user sees → why it costs them → proposal), what
  was not verified,
  and the state left on the machine (branch, DB migration level, backup restore command, test data).
- **Slack draft for the developer: short and plain.** One-line intro, numbered points, each with
  `file:line`, what breaks, what to do. No praise paragraphs, no restated context. Developers skip long
  AI-sounding reviews.

### 8. Clean up
Delete probe files and any worktree; `git status` must show only what was there before. Leave the
review branch checked out unless the user says otherwise, and tell them the DB is migrated ahead of
`main` (main's code will break against it) with the restore command. After the user merges, check out
`main`, pull, and delete the local `pr-<n>` branch.
