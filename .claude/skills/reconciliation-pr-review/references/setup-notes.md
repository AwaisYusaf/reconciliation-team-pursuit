# Setup notes and known local artefacts

## Local environment facts
- Repo: this checkout (`git rev-parse --show-toplevel`), remote
  `AwaisYusaf/reconciliation-team-pursuit`, base `main`. `gh` is installed and authenticated.
- DB: `postgresql://localhost:5432/ngo_expenses` (from `.env.local`). No `AUTH_SECRET` locally.
- Orgs in the local DB: "Team Pursuit Global" (a local copy of the client's setup — treat as sensitive,
  never publish) and "Mantaq" (test org; put review test data here).
- Scratch output goes in the session scratchpad, never the repo.

## Known artefacts that are not the PR's fault
- **`tsc`/`next build` errors pointing at `.next/types/…` or `.next/dev/types/…` for routes that no
  longer exist** (e.g. `app/(app)/…` after the `/r` move): stale generated types. `tsconfig.json`
  includes `.next/dev/types/**`. Move the folder aside (`mv .next/dev .next/dev-stale-<date>`) rather than
  deleting, rebuild, and tell the user. Moving it stops a running dev server.
- **PDF tests skipped**: poppler missing. `hasPdftotext()` must accept Xpdf's exit code 99.
- **Integration tests skipped**: `DATABASE_URL` not loaded (they read `.env.local` via dotenv).
- **Port :3000 busy**: another project's dev server. Use the user's :3001 or `ngo-expenses-3100`.

## Database safety
- Always back up before applying a PR's migrations:
  `pg_dump --format=custom -f <scratchpad>/ngo_expenses_pre_pr<n>.dump "$DB"`.
- After a PR adds migrations, `main` will not run against the migrated DB. Tell the user and give the
  restore command; do not restore without being asked.
- Read-only checks: `psql "$DB" -Atc "select …"`. For constraint probes, wrap in `BEGIN … ROLLBACK`.

## Re-reviews
- Fetch the latest head: `git fetch origin <head-branch>` then `git checkout -B pr-<n> origin/<head-branch>`
  (a new local ref per round is fine: `pr-<n>-v2`). Diff the new commits against the previous round's
  head to see exactly what changed, then re-verify each earlier finding explicitly — fixed / not fixed /
  new problem introduced by the fix.
