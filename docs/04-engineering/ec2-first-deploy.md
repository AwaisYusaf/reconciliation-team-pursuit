# First deployment to EC2 — step by step

Follow this once, in order, to put the reconciliation app on the EC2 instance that already
runs **the-pride-api**. Every subsequent release is just `./deploy.sh` (see
[`deploy-ec2.md`](deploy-ec2.md), which explains *why* the deployment has this shape; this
file is the *what to type*).

**The one rule:** the-pride-api must keep serving throughout. Exactly two steps in this
runbook touch anything shared — the IMDS hop limit (phase 0.4) and the Caddyfile (phase 4).
Both are called out where they appear, with the check that proves nothing broke.

Fill these in before you start and reuse them throughout:

| Placeholder | Value |
|---|---|
| `BUCKET` | `teampursuit-reconciliation` (must be globally unique — change if taken) |
| `REGION` | confirmed in phase 0.1 |
| `INSTANCE_ID` | confirmed in phase 0.1 |
| `ROLE` | confirmed in phase 0.1 |
| Public IP | `98.90.155.13` |
| Domain | `reconciliation.teampursuit.org` |
| Repo | `git@github.com:AwaisYusaf/reconciliation-team-pursuit.git` |
| App directory | `~/ngo-expenses` |

---

## Phase 0 — prerequisites (before touching the server)

### 0.1 Confirm the instance's identity

SSH in and read it from the metadata service. All read-only.

```bash
ssh ec2-user@98.90.155.13
```

```bash
TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
echo "region:   $(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)"
echo "instance: $(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)"
echo "role:     $(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/)"
```

Write down all three. If `role:` prints nothing, the instance has no role attached — stop and
attach one, because S3 uploads depend on it.

### 0.2 DNS — do this first, it is the slowest step

Add an **A record** in the `teampursuit.org` zone:

| Name | Type | Value | TTL |
|---|---|---|---|
| `reconciliation` | A | `98.90.155.13` | 300 |

Then poll until it resolves. Caddy cannot issue a certificate before this answers, and
propagation is usually the long pole — start it now and carry on with 0.3–0.5 while it settles.

```bash
dig +short reconciliation.teampursuit.org
```

✅ **Checkpoint:** prints `98.90.155.13`. Anything else — keep waiting.

### 0.3 Create the S3 bucket

Phases 0.3–0.5 run from **your laptop or AWS CloudShell with admin credentials**, not on the
server — the instance role is not allowed to create buckets or edit IAM. The values you wrote
down in 0.1 were read on the server, so set them again in the shell you are about to use:

```bash
export REGION="us-east-1"                 # from 0.1
export INSTANCE_ID="i-xxxxxxxxxxxxxxxxx"  # from 0.1
export ROLE="xxxxxxxx"                    # from 0.1
export BUCKET="teampursuit-reconciliation"
aws sts get-caller-identity               # confirm these are admin credentials
```

```bash
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
```

> `us-east-1` is the one region that must **not** be given a location constraint. Everywhere
> else the call needs one:
> `aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION"`

This bucket holds receipts, invoices and payroll proofs — real PII under the SOW. Lock it
down before anything is written to it:

```bash
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled
```

Versioning is not optional housekeeping here: these are grant records the City can ask to see,
and an accidental overwrite or delete is otherwise unrecoverable.

✅ **Checkpoint:**

```bash
aws s3api get-public-access-block --bucket "$BUCKET" --query 'PublicAccessBlockConfiguration'
```
All four values `true`.

### 0.4 Grant the instance role access to that bucket only

⚠️ **Touches shared configuration.** The instance role is the same one the-pride-api uses. You
are *adding* a separate inline policy, not editing its existing ones — the policy below names
only the new bucket, so it cannot widen or narrow the-pride-api's access.

Note the heredoc marker is unquoted, so `$BUCKET` is substituted:

```bash
cat > reconciliation-s3.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOwnBucketOnly",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::${BUCKET}"
    },
    {
      "Sid": "ReadWriteOwnObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/*"
    }
  ]
}
JSON

grep -o 'arn:aws:s3[^"]*' reconciliation-s3.json    # confirm the real bucket name landed

aws iam put-role-policy --role-name "$ROLE" \
  --policy-name reconciliation-s3 \
  --policy-document file://reconciliation-s3.json
```

✅ **Checkpoint:** `aws iam list-role-policies --role-name "$ROLE"` lists `reconciliation-s3`
alongside whatever the-pride-api already had. Nothing existing disappeared.

### 0.5 Raise the IMDS hop limit to 2

⚠️ **Touches the shared instance.** Containers reach the metadata service through one extra
network hop, and EC2 defaults the IMDSv2 hop limit to 1 — which silently denies containers the
instance role. S3 uploads would fail with a credentials error that reads like a bucket policy
problem.

Read the current settings first:

```bash
aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[].Instances[].MetadataOptions'
```

Then change **only** the hop limit:

```bash
aws ec2 modify-instance-metadata-options \
  --instance-id "$INSTANCE_ID" \
  --http-put-response-hop-limit 2
```

> **Do not add `--http-tokens required`.** That flag is about IMDSv1 vs v2, not hops. If
> the-pride-api still reads metadata the v1 way, forcing v2 breaks it. Omitting the flag
> leaves the existing setting untouched, which is what you want.

The change is immediate, needs no reboot, and does not restart any container.

✅ **Checkpoint:** re-run the `describe-instances` query — `HttpPutResponseHopLimit` is `2` and
every other field is unchanged from what you just read.

### 0.6 Create a GitHub deploy key

On the **server**:

```bash
ssh-keygen -t ed25519 -C "ec2-reconciliation-deploy" -f ~/.ssh/id_ed25519_reconciliation -N ""
cat ~/.ssh/id_ed25519_reconciliation.pub
```

Copy that public key into GitHub → the `reconciliation-team-pursuit` repo → **Settings → Deploy
keys → Add deploy key**. Leave *Allow write access* **unchecked** — the server only ever pulls.

Then teach SSH which key to use for this repo, and pre-trust GitHub's host key so the first
clone does not stop on an interactive prompt:

```bash
cat >> ~/.ssh/config <<'CFG'

Host github.com-reconciliation
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_reconciliation
  IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
```

✅ **Checkpoint:**

```bash
ssh -T git@github.com-reconciliation
```
Prints `Hi AwaisYusaf/reconciliation-team-pursuit! You've successfully authenticated, but
GitHub does not provide shell access.` — that message is success, not an error.

---

## Phase 1 — prepare the server

### 1.1 Record a baseline for the other service

Take this now, so that later you can tell whether anything you did affected it.

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -sS -o /dev/null -w 'pride-api: %{http_code}\n' https://pride-api.teampursuit.org/
```

Write down the result. Both pride containers should be `Up`.

### 1.2 Check restart policies before you ever reboot

```bash
docker inspect -f '{{.Name}} -> restart={{.HostConfig.RestartPolicy.Name}}' $(docker ps -q)
```

⚠️ If the-pride-api's containers say `restart=no`, **a reboot will leave that service down**
until someone starts it by hand. Fix that first (or plan to bring it back up manually) before
phase 5. Ours are `unless-stopped`, so they return on their own.

### 1.3 Add 2 GB of swap

The box has 3.7 GB and no swap. A `next build` runs alongside the other API, and a packet
build runs LibreOffice while holding the assembled PDF in memory. Without swap the kernel's
OOM killer picks a victim — and it may pick the-pride-api.

```bash
free -h
df -h /
```

Confirm there is room (you have ~25 G free), then create it. `dd` rather than `fallocate`:
a fallocated file can end up with holes that `swapon` refuses.

```bash
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

✅ **Checkpoint:**

```bash
swapon --show
free -h
```
`/swapfile` listed at 2 G, and `free -h` now shows a Swap row of `2.0Gi`.

### 1.4 Make the swap survive reboots

`swapon` only applies to the running kernel. Persist it in `/etc/fstab`:

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Verify the entry parses **before** you reboot on it — a malformed fstab can leave the instance
unbootable, and this line is the only thing standing between you and that:

```bash
sudo swapoff /swapfile && sudo swapon -a && swapon --show
```

That turns swap off and brings it back **using only the fstab entry**. If `/swapfile` appears
again, the entry is correct.

Then check the whole file parses, not just the line you added:

```bash
sudo findmnt --verify --verbose
```

✅ **Checkpoint:** `0 parse errors`. Do not reboot until you see that — the reboot in phase 5
is the moment a malformed fstab would strand the instance, and it hosts the-pride-api too.

### 1.5 Prefer RAM, keep swap as insurance

Default swappiness on AL2023 is 60, which pages aggressively. We want swap as OOM insurance,
not as routine memory:

```bash
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system | grep -i swappiness
```

✅ **Checkpoint:** `cat /proc/sys/vm/swappiness` prints `10`.

---

## Phase 2 — clone and configure

### 2.1 Clone

Note the `github.com-reconciliation` host alias from 0.6 — it selects the deploy key.

```bash
git clone git@github.com-reconciliation:AwaisYusaf/reconciliation-team-pursuit.git ~/ngo-expenses
cd ~/ngo-expenses
git log --oneline -1
```

### 2.2 Generate secrets and write `.env`

Both values are generated on the box and never leave it. The Postgres password is stripped of
URL-unsafe characters on purpose — it gets embedded in `DATABASE_URL`, and a raw `/` or `+`
there silently truncates the connection string.

```bash
cd ~/ngo-expenses
PG_PW="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
AUTH="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"

cat > .env <<EOF
POSTGRES_PASSWORD="${PG_PW}"
DATABASE_URL="postgresql://reconciliation:${PG_PW}@reconciliation-postgres:5432/reconciliation"

AUTH_SECRET="${AUTH}"
TRUSTED_PROXY_HOPS="1"

S3_BUCKET="teampursuit-reconciliation"
S3_REGION="us-east-1"

NODE_ENV="production"
APP_URL="https://reconciliation.teampursuit.org"
SIGNUP_ENABLED="false"
EOF

chmod 600 .env
unset PG_PW AUTH
```

Set `S3_REGION` to your `REGION` from 0.1 if it is not `us-east-1`.

✅ **Checkpoint:**

```bash
grep -c '^[A-Z]' .env          # expect 9
git status --porcelain         # expect empty — .env is git-ignored
```

The second check matters: `.env` holds the session key and the database password, and this
repo is on GitHub.

---

## Phase 3 — first boot

### 3.1 Build, migrate and start

```bash
cd ~/ngo-expenses
./deploy.sh --no-pull
```

`--no-pull` because you just cloned; there is nothing to pull. The script runs preflight
(`.env`, Docker, the shared network, swap), builds the image, runs migrations as a one-off
container, starts the stack, and then waits until the app actually serves `/login`.

**Expect the first build to take 10–20 minutes.** It installs LibreOffice and poppler into
the image on 2 vCPUs. Later builds reuse those layers and take a fraction of the time.

✅ **Checkpoint:** the script prints `healthy after Ns` and exits 0. If it fails, it tells you
which stage; `docker compose -f docker-compose.prod.yml logs --tail=50 app` has the detail.

### 3.2 Seed the organisation

This creates the single shared account and the contract configuration. `read -rs` keeps the
password off your screen and out of `~/.bash_history`.

```bash
cd ~/ngo-expenses
read -rsp 'Password for the app sign-in: ' APP_PW; echo
docker compose -f docker-compose.prod.yml exec -e SEED_PASSWORD="$APP_PW" app npm run db:seed
unset APP_PW
```

It prints the line items, payment sources and document types it created, and the sign-in
address — `team@teampursuitglobal.org`. Seeding is idempotent, so re-running is safe.

> ⚠️ **The contract figures it writes are placeholders (D-13)** — contract value, PO numbers,
> scheduled values and opening balances come from the approved February packet and are *not*
> confirmed live numbers. They must be checked with Misty and corrected in **Settings** before
> anyone generates a real submission. See phase 6.

### 3.3 Confirm the app works before exposing it

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec -T app \
  node -e 'fetch("http://127.0.0.1:3000/login").then(r=>console.log("login:",r.status))'
```

✅ **Checkpoint:** both services `Up` (postgres `healthy`), and `login: 200`.

---

## Phase 4 — publish through Caddy

⚠️ **This is the step that touches the-pride-api's files.** The Caddyfile lives in that
project and is bind-mounted into its Caddy container. You are appending one site block, never
editing the existing one. Back up, validate, then *reload* — a reload is graceful and does not
drop live connections to the other API.

### 4.1 Confirm where the Caddyfile is mounted

```bash
docker inspect the-pride-api-caddy-1 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

Expect `/home/ec2-user/the-pride-api/Caddyfile -> /etc/caddy/Caddyfile`. If the destination
differs, use the real one in the commands below.

### 4.2 Back it up

```bash
cd ~/the-pride-api
cp Caddyfile "Caddyfile.bak.$(date +%F-%H%M)"
ls -l Caddyfile*
```

### 4.3 Append our site block

```bash
cd ~/the-pride-api
cat >> Caddyfile <<'CADDY'

reconciliation.teampursuit.org {
	encode gzip
	reverse_proxy reconciliation-app:3000 {
		transport http {
			read_timeout 600s
			write_timeout 600s
		}
	}
	request_body {
		max_size 30MB
	}
}
CADDY
cat Caddyfile
```

Why those two settings:

- **600s timeouts.** Assembling a month-end packet rasterises hundreds of pages; the route is
  declared `maxDuration = 600`. A default proxy timeout would cut the connection mid-build and
  show the user a failure for a packet that was actually still being produced.
- **30 MB body cap.** The app already rejects any single upload over 25 MB with a proper
  message, and one file goes per request. 30 MB sits just above that, so the app's own error
  is what users see; Caddy's cap is only a backstop against a body that never reaches it.

### 4.4 Validate before applying

```bash
cd ~/the-pride-api
docker compose -f docker-compose.prod.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
```

✅ **Checkpoint:** `Valid configuration`. If it fails, restore the backup and fix it — do not
reload a config that did not validate:
`cp Caddyfile.bak.<stamp> Caddyfile`

### 4.5 Reload

```bash
cd ~/the-pride-api
docker compose -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Watch it obtain the certificate (takes 10–60 seconds):

```bash
docker compose -f docker-compose.prod.yml logs --tail=40 caddy
```

### 4.6 Verify both sites

```bash
curl -sS -o /dev/null -w 'reconciliation: %{http_code}\n' https://reconciliation.teampursuit.org/login
curl -sS -o /dev/null -w 'pride-api:      %{http_code}\n' https://pride-api.teampursuit.org/
```

✅ **Checkpoint:** reconciliation returns `200`, and pride-api returns whatever it returned in
your phase 1.1 baseline. If the second one changed, restore the Caddyfile backup and reload.

Now open `https://reconciliation.teampursuit.org` and sign in with
`team@teampursuitglobal.org` and the password from 3.2.

---

## Phase 5 — the reboot test

⚠️ **This reboots the shared instance — the-pride-api goes down too**, for roughly a minute.
Schedule it rather than running it mid-day, and tell whoever depends on that API. The point of
doing it deliberately now is that the alternative is discovering the answer during an
unplanned reboot, with nobody watching.

Two things to confirm before you type it:

- Phase 1.2 — if the-pride-api's containers are `restart=no`, they will **not** come back by
  themselves and you will need to start them manually.
- Phase 1.4 — `findmnt --verify` reported `0 parse errors`.

```bash
sudo reboot
```

Wait ~60 seconds, reconnect, and verify everything returned by itself:

```bash
ssh ec2-user@98.90.155.13
```

```bash
swapon --show                                   # /swapfile, 2G — fstab worked
free -h                                         # Swap row shows 2.0Gi
cat /proc/sys/vm/swappiness                     # 10
docker ps --format 'table {{.Names}}\t{{.Status}}'
curl -sS -o /dev/null -w 'reconciliation: %{http_code}\n' https://reconciliation.teampursuit.org/login
curl -sS -o /dev/null -w 'pride-api:      %{http_code}\n' https://pride-api.teampursuit.org/
```

✅ **Checkpoint:** swap present without anyone running `swapon`, all four containers `Up`,
both sites answering. That is the deployment proven end to end.

---

## Phase 6 — before real data goes in

1. **Change the sign-in password.** The one from 3.2 was typed into a terminal. Change it in
   **Settings**, or reset it as operator (D-24 — this also revokes every existing session):
   ```bash
   docker compose -f docker-compose.prod.yml exec app npm run db:reset-password -- --email team@teampursuitglobal.org
   ```
2. **Replace the placeholder contract figures (D-13).** Contract value, PO numbers, dates,
   scheduled values and opening balances all came from the February packet as placeholders.
   Confirm each with Misty and correct them in **Settings** and **Line items**. Every generated
   document derives from these, so a wrong figure here is wrong on the submission.
3. **Leave `SIGNUP_ENABLED="false"`.** The organisation already exists; signup stays shut.
4. **Know the backup position.** The nightly `pg_dump` is not wired yet. Until it is, the
   database is protected only by EBS snapshots of the instance volume — take one, and set a
   schedule. `reconciliation-pg-data` and `reconciliation-data` are Docker named volumes on
   that same EBS volume.
5. **Never commit `context/`.** The client's real packet lives there and is git-ignored.

---

## If something goes wrong

| Symptom | What to do |
|---|---|
| Deploy fails partway | The old container is still serving. `docker compose -f docker-compose.prod.yml logs --tail=80 app` |
| Bad release | `git reset --hard <previous-sha> && ./deploy.sh --no-pull` — `deploy.sh` prints the sha to use |
| Caddy route wrong | `cd ~/the-pride-api && cp Caddyfile.bak.<stamp> Caddyfile` then reload (4.5) |
| Certificate never issues | DNS is not resolving yet (0.2), or :80 is blocked inbound. Caddy's HTTP challenge needs port 80 reachable |
| S3 uploads fail with credentials errors | The IMDS hop limit (0.5) did not take, or the role policy (0.4) names a different bucket than `.env` |
| App will not start | `instrumentation.ts` refuses to boot on a missing `DATABASE_URL`, `AUTH_SECRET`, `S3_BUCKET` or `TRUSTED_PROXY_HOPS`. The log names which |
| Stop our stack only | `docker compose -f docker-compose.prod.yml down` — the other service is untouched, and the database volume survives (removing it needs an explicit `-v`) |
