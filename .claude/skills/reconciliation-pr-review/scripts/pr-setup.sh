#!/usr/bin/env bash
# Prepare a local review of a reconciliation-team-pursuit PR.
#
# Usage: pr-setup.sh <pr-number> [scratch-dir]
#
# What it does (nothing destructive, nothing pushed, nothing posted):
#   1. prints PR metadata and local state (branch, dirty tree, ports, migration count)
#   2. backs up the local database to the scratch dir
#   3. fetches the PR head into a local branch pr-<n> and checks it out
#   4. applies migrations
#   5. runs typecheck, lint, the full test suite and the production build, writing logs
#
# It refuses to run with uncommitted tracked changes, so it can never mix a review with local work.
set -euo pipefail

PR="${1:?usage: pr-setup.sh <pr-number> [scratch-dir]}"
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"
SCRATCH="${2:-${TMPDIR:-/tmp}/reconciliation-pr-${PR}}"
mkdir -p "$SCRATCH"
DB="$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"')"

echo "== PR #$PR"
gh pr view "$PR" --json title,baseRefName,headRefName,additions,deletions,mergeable,commits \
  --jq '"\(.title)\nbase=\(.baseRefName) head=\(.headRefName) +\(.additions) -\(.deletions) mergeable=\(.mergeable)\n" + ([.commits[] | "  \(.oid[:7]) \(.messageHeadline)"] | join("\n"))'
HEAD_REF="$(gh pr view "$PR" --json headRefName -q .headRefName)"

echo "== local state"
echo "branch: $(git branch --show-current)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: tracked changes present; commit or stash them first." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi
for port in 3000 3001 3100; do
  pid="$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  [ -n "$pid" ] && echo "port $port: pid $pid cwd $(lsof -p "$pid" 2>/dev/null | awk '$4=="cwd"{print $NF}')"
done
echo "migrations applied before: $(psql "$DB" -Atc 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null || echo '?')"

echo "== backup"
BACKUP="$SCRATCH/ngo_expenses_pre_pr${PR}.dump"
pg_dump --format=custom -f "$BACKUP" "$DB"
echo "backup: $BACKUP ($(wc -c < "$BACKUP" | tr -d ' ') bytes)"
echo "restore: pg_restore -d \"$DB\" --clean --if-exists \"$BACKUP\""

echo "== checkout"
git fetch origin "$HEAD_REF" --quiet
git checkout -B "pr-${PR}" "origin/${HEAD_REF}"
git log --oneline -1
echo "merge base: $(git merge-base origin/main HEAD | cut -c1-7)"
git diff --stat origin/main...HEAD | tail -1

echo "== migrate"
npm run db:migrate 2>&1 | tail -2
echo "migrations applied after: $(psql "$DB" -Atc 'select count(*) from drizzle.__drizzle_migrations')"

echo "== gates (logs in $SCRATCH)"
run_gate() {
  local name="$1"; shift
  if "$@" > "$SCRATCH/$name.log" 2>&1; then echo "$name: pass"; else echo "$name: FAIL (see $SCRATCH/$name.log)"; fi
}
run_gate typecheck npx tsc --noEmit
run_gate lint npm run lint
run_gate test npx vitest run
grep -E "Test Files|Tests |skipped" "$SCRATCH/test.log" | tail -3 || true
run_gate build npm run build
if grep -qE "\.next/(dev/)?types/" "$SCRATCH/typecheck.log" "$SCRATCH/build.log" 2>/dev/null; then
  echo "NOTE: errors reference .next generated types — likely stale cache, see references/setup-notes.md"
fi
echo "== done. Review branch: pr-${PR}. DB is now at the PR's migration level."
