#!/usr/bin/env bash
#
# Nightly database backup (D-07). Run from cron on the EC2 host:
#
#   15 3 * * * /home/ec2-user/ngo-expenses/backup.sh >> /home/ec2-user/backup.log 2>&1
#
# `pg_dump` runs inside the postgres container, so its version always matches the server it
# is dumping — a mismatch is the usual reason a backup script stops working after an upgrade.
# The dump is piped straight into the app container, which uploads it with the S3 credentials
# and driver it already has. Neither container needs a package it does not already ship.
#
# Nothing is written to disk on the host: the dump exists only in the pipe, so a backup can
# never quietly fill the volume the database itself is running on.
#
# Retention is the bucket's lifecycle rules, not this script's job — see
# docs/04-engineering/deploy-ec2.md. This only ever writes.

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.prod.yml"

if [[ ! -f .env ]]; then
  echo "error: .env not found in $(pwd)" >&2
  exit 1
fi

# `set -o pipefail` makes a pg_dump failure fail the whole pipeline rather than uploading
# whatever partial bytes reached the far end. The uploader checks the archive header too.
echo "==> $(date -u +%FT%TZ) starting backup"

$COMPOSE exec -T postgres pg_dump -U reconciliation -Fc reconciliation \
  | $COMPOSE exec -T app npm run --silent db:backup-upload

echo "==> $(date -u +%FT%TZ) backup complete"
