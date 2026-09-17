# Deploying to EC2 alongside the-pride-api

The target is a single Amazon Linux 2023 instance (2 vCPU, 3.7 GB) that **already runs
another production service**, `the-pride-api`, behind a Caddy container that owns ports 80
and 443 and issues its own Let's Encrypt certificates.

Everything below is shaped by one constraint: **that service must not be disturbed.**

This file explains the shape and covers day-to-day operations. For the first deployment, follow
[`ec2-first-deploy.md`](ec2-first-deploy.md) — the numbered commands, in order, with checkpoints.

## Why this shape

| Decision | Reason |
|---|---|
| Deploy as a container, not on the host | The host has Node 18, and Next 16 needs 20.9+. LibreOffice and poppler are not in Amazon Linux 2023's default repositories, but are one `apt` line in a Debian image. |
| No second reverse proxy | Caddy already binds :80 and :443. A second proxy could not bind them and would fight the first. We add one site block to the Caddy that exists. |
| Join `the-pride-api_default` as an **external** network | Compose attaches to it and never creates, alters or removes it. Rebuilding or destroying this stack cannot affect the other one. |
| Our own Postgres container, no host port | The other service uses RDS. Ours is internal to this stack; publishing a port would risk colliding with the-pride-api's dev compose, which claims 5433. |
| Service alias `app` avoided | The other container already answers to `app` on the shared network. Ours is `reconciliation`. |

## Prerequisites

1. **DNS.** An A record for `reconciliation.teampursuit.org` pointing at the instance's
   public IP. Caddy cannot issue a certificate until this resolves, and propagation is
   usually the slowest step — do it first.
2. **Swap.** The box has 3.7 GB and no swap. A packet build runs LibreOffice and holds the
   assembled PDF in memory while the other API and its traffic continue. Without swap the
   kernel's OOM killer may choose `the-pride-api`, not us.
3. **IMDS hop limit.** Containers reach the instance metadata service through an extra
   network hop. EC2 defaults the IMDSv2 hop limit to 1, which silently denies containers the
   instance role — S3 uploads would fail with a credentials error that looks like a bucket
   policy problem. It must be 2.

## Redeploying

After first-time setup, every subsequent release is one command on the box:

```
cd ~/ngo-expenses && ./deploy.sh
```

It pulls, builds, migrates, restarts and then **verifies** — it does not report success until
the container actually serves `/login`. A started container is not a working one:
`instrumentation.ts` refuses to boot on a missing `AUTH_SECRET` or `S3_BUCKET`, and
`docker compose ps` still shows that container as up. The script prints the commit it moved
from and the exact command to roll back to it.

Two variants: `--env-only` recreates the app after an `.env` edit without rebuilding (the
file is injected at container start, so `restart` would *not* pick up the change, whereas
`--force-recreate` does), and `--no-pull` releases what is already checked out.

Migrations run as a one-off `migrate` service before the new app starts, so a failed
migration aborts the deploy with the previous version still serving, rather than putting new
code on a half-migrated schema. It is behind a compose profile, so `up` never starts it, and
it carries no `container_name`, so a one-off run cannot collide with a long-lived container.

The script never touches the-pride-api: not its Caddyfile, not its containers, and not the
shared network, which stays `external`.

## Operational notes

- **Backups.** See the dedicated section below. The database and upload volumes are Docker
  named volumes on this instance's EBS volume, so EBS snapshots remain a second line of
  defence, but the nightly dump to S3 is the primary one.
- **Rebuilding** is `./deploy.sh` (see above). It touches only this stack.
- **The Caddyfile is shared.** It lives in `~/the-pride-api/Caddyfile` and is bind-mounted
  into that project's Caddy container. Editing it is the one action in this runbook that
  touches the other service's files, so: back it up, validate before applying, and reload
  rather than restart. A reload is graceful — existing connections to the other API are not
  dropped.
- **Operator password reset** (D-24 — the only recovery path):
  `docker compose -f docker-compose.prod.yml exec app npm run db:reset-password -- --email <address>`.
  It sets a new hash and revokes every session for that user. Since Phase 9 it falls back to
  `staff_users`/`staff_sessions`, so the same command recovers an AB Solutions staff account.
- **Creating AB Solutions staff accounts** (Phase 9, D-98 — there is no staff sign-up).
  **One-off, the first time Phase 9 is released:** after `deploy.sh` has run `db:migrate`, run
  this once per AB Solutions staff member, then hand each password over out of band:

  ```
  docker compose -f docker-compose.prod.yml exec app \
    npm run db:create-staff -- --email <address> --name "<Full Name>"
  ```

  With no `--password` a strong one is generated and printed **once**. The script refuses an
  address that already belongs to a customer account or to another staff account. Until at
  least one staff account exists, `/a` is unreachable by anyone — which is the safe default,
  not a failure.

  *Verified, not assumed:* the production image does ship `tsx`, which this script needs.
  `Dockerfile:60` is `RUN npm ci --include=dev`, and the comment above it (lines 55-59) says
  the flag is load-bearing precisely so `drizzle-kit` and `tsx` survive `NODE_ENV=production`
  and `db:migrate`/`db:reset-password` keep working in the running container. `db:create-staff`
  is the same `tsx --conditions=react-server` invocation as `db:reset-password`, and
  `src/db/create-staff.ts` is copied in by `COPY . .`. `.dockerignore` excludes `.env.local`,
  so — exactly as for `db:reset-password` — `DATABASE_URL` must come from the container's own
  environment; the script's `dotenv` call on a missing `.env.local` is a no-op that leaves it
  alone.
- **Rotating `AUTH_SECRET`** invalidates every session at once. That is the intended response
  to a suspected cookie compromise.

## Backups (D-07)

`pg_dump` runs inside the postgres container, so its version always matches the server it is
dumping — a mismatch is the usual reason a backup script stops working after an upgrade. The
dump is piped straight into the app container, which uploads it with the S3 credentials it
already has. Nothing is written to the host disk, so a backup can never fill the volume the
database itself is running on.

### Enable it

```bash
crontab -e
```

Add, adjusting the path if the clone lives elsewhere:

```
15 3 * * * /home/ec2-user/ngo-expenses/backup.sh >> /home/ec2-user/backup.log 2>&1
```

Run it once by hand first, and read the output rather than assuming:

```bash
cd ~/ngo-expenses && ./backup.sh
```

✅ **Checkpoint:** `Uploaded and verified backups/daily/<date>.dump`. The uploader reads the
object back and compares its length, so that line means the bytes are in S3 and readable —
not merely that a request succeeded.

### Retention

Retention belongs to the bucket, not to the script: a backup job that can delete is a backup
job that can delete the wrong thing, unattended, at 3am. The script only ever writes. Apply
the lifecycle rules once, from a shell with admin credentials:

```bash
cat > backup-lifecycle.json <<'JSON'
{
  "Rules": [
    {
      "ID": "daily-backups-30-days",
      "Filter": { "Prefix": "backups/daily/" },
      "Status": "Enabled",
      "Expiration": { "Days": 30 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 7 }
    },
    {
      "ID": "monthly-backups-13-months",
      "Filter": { "Prefix": "backups/monthly/" },
      "Status": "Enabled",
      "Expiration": { "Days": 400 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
    }
  ]
}
JSON

aws s3api put-bucket-lifecycle-configuration   --bucket teampursuit-reconciliation   --lifecycle-configuration file://backup-lifecycle.json
```

That gives 30 daily and 13 months of monthlies (400 days, so twelve are always complete). The
noncurrent-version rules matter because the bucket has versioning on: without them every
overwritten object would be kept forever.

A dump taken on the 1st is written twice, to `backups/daily/` and `backups/monthly/`, because
the two prefixes expire on different schedules and one object cannot be on two of them.

### Restore

The mirror of the backup, and it needs no tooling on the host either. Pick a key — the S3
console lists them under `backups/` — and pipe it back:

```bash
cd ~/ngo-expenses
docker compose -f docker-compose.prod.yml exec -T app \
  npm run --silent db:backup-fetch -- backups/daily/2026-08-20.dump \
  | docker compose -f docker-compose.prod.yml exec -T postgres \
      pg_restore --no-owner --no-privileges -U reconciliation -d reconciliation --clean --if-exists
```

⚠️ `--clean --if-exists` **drops and recreates every object it restores**, so it replaces the
current contents of the live database. Restore into a scratch database first if the goal is to
inspect a backup rather than to roll the system back.

### The drill

D-07 requires a restore actually executed before go-live, not just documented. Run it against
a scratch database so nothing live is touched:

```bash
cd ~/ngo-expenses
docker compose -f docker-compose.prod.yml exec -T postgres createdb -U reconciliation drill
docker compose -f docker-compose.prod.yml exec -T app \
  npm run --silent db:backup-fetch -- backups/daily/<date>.dump \
  | docker compose -f docker-compose.prod.yml exec -T postgres \
      pg_restore --no-owner --no-privileges -U reconciliation -d drill

# Compare against the live database — counts must match exactly.
for t in organizations users line_items expenses expense_documents vendor_defaults; do
  echo "$t live=$(docker compose -f docker-compose.prod.yml exec -T postgres psql -U reconciliation -d reconciliation -tAc "select count(*) from $t")" \
       "restored=$(docker compose -f docker-compose.prod.yml exec -T postgres psql -U reconciliation -d drill -tAc "select count(*) from $t")"
done

docker compose -f docker-compose.prod.yml exec -T postgres dropdb -U reconciliation drill
```

This procedure has been executed against a real dump on a development database: `pg_restore`
returned 0 and all ten tables, the summed money column and a three-way join matched the
original exactly. Running it once on the instance is what closes D-07.

## Rollback

The app stack can be stopped without affecting the other service:

```
docker compose -f docker-compose.prod.yml down
```

To also remove the Caddy route, restore the backup taken in the setup steps and reload Caddy.
The database volume survives `down`; removing it needs an explicit `-v`, which would destroy
the data.
