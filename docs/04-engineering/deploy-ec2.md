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

- **Backups.** `reconciliation-pg-data` (database) and `reconciliation-data` (only used if
  the local storage driver is ever enabled) are Docker named volumes on this instance's EBS
  volume. The nightly `pg_dump` in the architecture document is not yet wired; until it is,
  the database is protected only by EBS snapshots.
- **Rebuilding** is `./deploy.sh` (see above). It touches only this stack.
- **The Caddyfile is shared.** It lives in `~/the-pride-api/Caddyfile` and is bind-mounted
  into that project's Caddy container. Editing it is the one action in this runbook that
  touches the other service's files, so: back it up, validate before applying, and reload
  rather than restart. A reload is graceful — existing connections to the other API are not
  dropped.
- **Operator password reset** (D-24 — the only recovery path):
  `docker compose -f docker-compose.prod.yml exec app npm run db:reset-password -- --email <address>`.
  It sets a new hash and revokes every session for that user.
- **Rotating `AUTH_SECRET`** invalidates every session at once. That is the intended response
  to a suspected cookie compromise.

## Rollback

The app stack can be stopped without affecting the other service:

```
docker compose -f docker-compose.prod.yml down
```

To also remove the Caddy route, restore the backup taken in the setup steps and reload Caddy.
The database volume survives `down`; removing it needs an explicit `-v`, which would destroy
the data.
