#!/usr/bin/env bash
#
# Deploy the reconciliation app on the EC2 box it shares with the-pride-api.
#
# This script touches ONLY this stack. It never edits ~/the-pride-api/Caddyfile, never
# restarts that project's Caddy, and never creates or removes the shared Docker network —
# `the-pride-api_default` is declared external, so compose only ever attaches to it.
# The Caddy site block for reconciliation.teampursuit.org is added once, during first-time
# setup (docs/04-engineering/deploy-ec2.md); redeploys do not need it and must not touch it.
#
#   ./deploy.sh              pull, build, migrate, restart, verify
#   ./deploy.sh --env-only   apply .env changes only (recreate the app, no rebuild)
#   ./deploy.sh --no-pull    build and release what is already checked out
#
# Everything lives inside main() so that bash parses the whole file before executing any of
# it. Without that, `git pull` rewriting this file mid-run would leave bash reading the new
# bytes from its old offset and executing garbage.

set -euo pipefail

# Global rather than local to main(): finish() reads it too, and relying on bash's dynamic
# scoping to carry a caller's local into a callee is a trap for the next person editing this.
readonly COMPOSE="docker compose -f docker-compose.prod.yml"

main() {
  cd "$(dirname "$0")"

  local env_only=0 pull=1

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-only) env_only=1 ;;
      --no-pull)  pull=0 ;;
      -h|--help)  sed -n '3,13p' "$0" | sed 's/^#[[:space:]]\{0,1\}//'; exit 0 ;;
      *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
  done

  preflight

  # .env is injected at container start via env_file, never baked into the image, so an
  # env change needs a container RECREATE, not a rebuild. `restart` does NOT reload .env;
  # --force-recreate does.
  if [[ $env_only -eq 1 ]]; then
    echo "==> Applying .env changes (recreate app, no rebuild)"
    $COMPOSE up -d --force-recreate app
    finish
    return
  fi

  local previous
  previous="$(git rev-parse --short HEAD)"

  if [[ $pull -eq 1 ]]; then
    echo "==> Pulling latest code"
    git pull --ff-only
  fi

  echo "==> Building image"
  $COMPOSE build

  # Drizzle's migrator applies only what has not been applied, so this is a safe no-op when
  # nothing is pending. It runs BEFORE the new app starts: a failure here aborts the deploy
  # with the old version still serving, rather than leaving new code on an old schema.
  echo "==> Running DB migrations (no-op if none pending)"
  # --profile named explicitly: `run` is documented to enable its target's profile on its
  # own, but the deploy should not rest on that.
  $COMPOSE --profile tools run --rm migrate

  echo "==> Starting / updating stack"
  $COMPOSE up -d

  finish
  echo
  echo "Deployed $previous -> $(git rev-parse --short HEAD)"
  echo "Roll back with:  git reset --hard $previous && ./deploy.sh --no-pull"
}

preflight() {
  # Compose reads .env twice over: for ${POSTGRES_PASSWORD} substitution, and as the app's
  # env_file. Missing, it fails deep inside `up` with an error that reads like a bug.
  if [[ ! -f .env ]]; then
    echo "error: .env not found in $(pwd)" >&2
    echo "       cp .env.production.example .env, then fill in every value." >&2
    exit 1
  fi

  # Two concurrent builds on a 3.7 GB box is the realistic way to OOM this instance, and
  # the kernel picks the victim — which may be the-pride-api. One deploy at a time.
  if command -v flock >/dev/null 2>&1; then
    exec 9>/tmp/reconciliation-deploy.lock
    if ! flock -n 9; then
      echo "error: another deploy is already running on this box." >&2
      exit 1
    fi
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "error: cannot talk to Docker. Is the daemon up, and is this user in the docker group?" >&2
    exit 1
  fi

  # Declared external, so compose will not create it. If the-pride-api's stack has never
  # been started on this box, attaching fails with a bare "network not found".
  if ! docker network inspect the-pride-api_default >/dev/null 2>&1; then
    echo "error: docker network 'the-pride-api_default' does not exist." >&2
    echo "       Caddy lives on it. Start the-pride-api stack first; do not create it by hand." >&2
    exit 1
  fi

  # `next build` on a 2 vCPU / 3.7 GB box while the other API keeps serving. Without swap
  # the OOM killer gets to choose a victim, and it may not choose us.
  if [[ "$(awk '/SwapTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 1)" == "0" ]]; then
    echo "warning: no swap configured. A build here can OOM-kill the-pride-api." >&2
    echo "         See docs/04-engineering/deploy-ec2.md, prerequisite 2." >&2
  fi
}

# Prove the container can actually RENDER, not merely serve a page. Every generation defect
# this project has hit was invisible until something was rendered in a container: LibreOffice
# crushing proof images, a cover sheet at the wrong point size, a stale GENERATOR_VERSION
# serving pre-change bytes. `/login` answering says nothing about any of them.
#
# Advisory, not fatal: a deploy that serves correctly should not be rolled back because
# poppler is missing from the image. It prints loudly enough to be noticed.
smoke() {
  echo "==> Render smoke test"
  if $COMPOSE exec -T app npx tsx --conditions=react-server scripts/render-smoke.ts; then
    return 0
  fi
  echo "warning: the render smoke test failed — the app is serving, but generated documents" >&2
  echo "         are not what they should be. Check before telling anyone to download a packet." >&2
}

finish() {
  echo "==> Status"
  $COMPOSE ps

  echo "==> Waiting for the app to answer"
  local i
  for i in $(seq 1 18); do
    if $COMPOSE exec -T app node -e \
      'fetch("http://127.0.0.1:3000/login").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      >/dev/null 2>&1; then
      echo "    healthy after $((i * 5))s"
      smoke
      return 0
    fi
    sleep 5
  done

  # A started container is not a working one: a bad DATABASE_URL or a missing AUTH_SECRET
  # makes instrumentation.ts refuse to boot, and `ps` still shows the container as up.
  echo "error: the app did not serve /login within 90s." >&2
  echo "       Logs:  docker compose -f docker-compose.prod.yml logs --tail=50 app" >&2
  exit 1
}

main "$@"
