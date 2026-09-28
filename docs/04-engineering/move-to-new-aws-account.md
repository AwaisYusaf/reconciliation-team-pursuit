# Moving the app to a new AWS account (stayfunded360.com)

From **Instance 1** (the shared the-pride-api box in the old account, `98.90.155.13`, domain
`reconciliation.teampursuit.org`) to **Instance 2** (its own box in the new account, domain
`stayfunded360.com`), with every database row and every stored file.

## The shape of the move

| | Instance 1 today | Instance 2 |
|---|---|---|
| App | Docker Compose: `app`, `postgres`, `migrate` | The same three containers, same compose file |
| Reverse proxy | the-pride-api's **Caddy** container (one site block in `~/the-pride-api/Caddyfile`), reaching the app over the `the-pride-api_default` network | **nginx on the host**, reaching the app at `127.0.0.1:3000` |
| TLS | Caddy's automatic certificates | Let's Encrypt through certbot |
| Database | Postgres 16 container, volume `reconciliation-pg-data` | The same, filled from a `pg_dump` of Instance 1 |
| Files | S3 bucket `teampursuit-reconciliation` (old account) | A new bucket in the new account, filled with a copy of every object |
| Domain | `reconciliation.teampursuit.org` | `stayfunded360.com`. The old domain redirects to it, so links already sent to the City keep working |

Database rows store only the **key** of each file, never the bucket name, and the app serves
files through itself (no signed S3 links, D-30). So copying the objects to a new bucket and
changing `S3_BUCKET` is all the app needs.

## How it runs

- **Part A, prepare.** Build Instance 2 completely and load a **practice copy** of the data.
  Test it on `https://stayfunded360.com`. The old site keeps running, and users see nothing.
- **Part B, switch over.** In a maintenance window of about an hour, stop the old app, copy the
  data one last time, point the domains, and turn billing on.
- **Part C, afterwards.** Backups on the new box. A week later, remove the old stack from Instance 1.

Anything changed on Instance 2 during Part A is thrown away at the switch-over, so **don't give
the new address to Misty's team before Part B.**

## What you need before starting

- SSH to Instance 1 and Instance 2 from your laptop
- The AWS console of the new account
- Admin on the GitHub repo `AwaisYusaf/reconciliation-team-pursuit`
- DNS control for `stayfunded360.com`, and for `teampursuit.org` (for the old-domain redirect)
- The Stripe dashboard (Stay Funded 360 sandbox)

## Conventions used below

- Commands say where they run: **laptop**, **old** (Instance 1) or **new** (Instance 2).
- `<NEW_IP>` is Instance 2's Elastic IP. `<NEW_BUCKET>` is the new bucket's name (suggested:
  `stayfunded360-files`). `<REGION>` is the new account's region, for example `us-east-1`.
- These steps assume Instance 2 runs **Amazon Linux 2023** on **x86_64**, like Instance 1. On
  Ubuntu, see the note in step A3.

On your **laptop**, add both servers to `~/.ssh/config` once, so the commands below stay short:

```
Host sf-old
  HostName 98.90.155.13
  User ec2-user
  IdentityFile ~/.ssh/<old-key>.pem

Host sf-new
  HostName <NEW_IP>
  User ec2-user
  IdentityFile ~/.ssh/<new-key>.pem
```

---

# Part A: prepare (no downtime)

## A1. The instance, its IP and its firewall (new AWS console)

1. **Size:** at least 2 vCPU and 4 GB of memory (for example `t3.medium`), with a **40 GB gp3**
   disk. The image build runs LibreOffice, and the file copy in A8 needs disk space.
2. **Elastic IP:** EC2, then Elastic IPs, then Allocate. Associate it with Instance 2. Without one, the
   public IP changes on every stop and start, and DNS breaks.
3. **Security group inbound rules:**
   - SSH, port 22, from **your IP only**
   - HTTP, port 80, from `0.0.0.0/0` and `::/0`
   - HTTPS, port 443, from `0.0.0.0/0` and `::/0`

   Don't open port 3000. The app listens only on `127.0.0.1`.

## A2. DNS for the new domain

At the DNS provider for `stayfunded360.com`:

- `A` record, `stayfunded360.com`, value `<NEW_IP>`
- `A` record, `www.stayfunded360.com`, value `<NEW_IP>`
- **Delete** any other `A`, `AAAA` or `CNAME` records on those two names, such as a
  registrar's parking page. A stray `AAAA` record makes the certificate step fail.

At the DNS provider for `teampursuit.org`: lower the **TTL** of `reconciliation.teampursuit.org` to
**300 seconds** now. It's moved in Part B, and a short TTL makes that move take minutes, not hours.

Check it from the **laptop** (it may take a few minutes):

```bash
dig +short stayfunded360.com
```

It should print `<NEW_IP>`.

## A3. Install Docker, nginx, cron and swap (new)

```bash
ssh sf-new
```

```bash
sudo dnf install -y docker git nginx cronie python3 augeas-libs
sudo systemctl enable --now docker nginx crond
sudo usermod -aG docker ec2-user

# Docker Compose and Buildx plugins (not packaged on Amazon Linux 2023)
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
BX=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
ARCH=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
sudo curl -fSL "https://github.com/docker/buildx/releases/download/${BX}/buildx-${BX}.linux-${ARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-*

# certbot, in its own Python environment (the method certbot documents for this OS)
sudo python3 -m venv /opt/certbot
sudo /opt/certbot/bin/pip install --upgrade pip
sudo /opt/certbot/bin/pip install certbot certbot-nginx
sudo ln -sf /opt/certbot/bin/certbot /usr/bin/certbot

# 2 GB of swap, so the image build can't run out of memory
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Log out and back in**, so the `docker` group applies. Then check each piece:

```bash
docker compose version && docker buildx version && certbot --version && free -h
```

✅ Each command prints a version, and `free -h` shows a 2.0Gi swap row.

> **Ubuntu instead of Amazon Linux:** the user is `ubuntu`, not `ec2-user`. Replace everything above
> the swap block with `sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
> docker-buildx git nginx cron certbot python3-certbot-nginx`, then `sudo usermod -aG docker ubuntu`.

## A4. Connect GitHub and fetch the code (new)

The repo is private, so the box gets its own **read-only deploy key**. GitHub won't accept a key
that's already in use, so this has to be a new key, not Instance 1's.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_sf360 -N "" -C "stayfunded360-instance-2"
cat ~/.ssh/id_ed25519_sf360.pub
```

On GitHub, go to the repo, then **Settings**, **Deploy keys**, **Add deploy key**. Name it "Instance 2
(new AWS account)", paste the key, and leave **Allow write access** unticked.

```bash
cat >> ~/.ssh/config <<'CFG'

Host github.com-sf360
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_sf360
  IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts

git clone git@github.com-sf360:AwaisYusaf/reconciliation-team-pursuit.git ~/reconciliation-team-pursuit
cd ~/reconciliation-team-pursuit && git log --oneline -1
```

✅ The last line shows the newest commit on `main`, which includes the change described in A5.

## A5. The one code change (on `main` since 2026-09-28)

Instance 1's compose file joined the-pride-api's Docker network so that Caddy could reach the app.
Instance 2 has no the-pride-api, and nginx runs on the host, so `main` now has:

- **`docker-compose.prod.yml`:** the `app` service drops the `proxy` network and publishes
  `127.0.0.1:3000:3000`, so only nginx on the same box can reach it. The `proxy` network
  (`the-pride-api_default`, external) is removed.
- **`deploy.sh`:** the check that `the-pride-api_default` exists is removed, along with the comments
  about sharing the box.
- **`backup.sh`:** the cron path in the comment becomes `~/reconciliation-team-pursuit`.

Nothing in the app itself changes. If Instance 2 was cloned before this landed, update it on **new**:

```bash
cd ~/reconciliation-team-pursuit && git pull --ff-only && git log --oneline -1
```

⚠️ **Never run `./deploy.sh` on Instance 1 again.** It would pull this change and cut Caddy off
from the app. Instance 1 keeps running what it has until Part B, and any fix merged in the
meantime goes live with the new box. That includes migration `0042_feature_requests`, which isn't
on Instance 1: Instance 2 applies it on its first deploy.

## A6. The new S3 bucket and its access key (new AWS console)

**Bucket:** S3, then Create bucket.

- **Name:** `<NEW_BUCKET>`. **Region:** `<REGION>`, the same region as Instance 2.
- **Object Ownership:** ACLs disabled.
- **Block all public access:** on (the default). The app serves every file itself.
- **Bucket Versioning:** enable, as on the old bucket.
- **Default encryption:** SSE-S3 (the default).

**Access key for the app:** in IAM, create a user `stayfunded360-app` with **no console access**.
Choose **Attach policies directly**, then **Create inline policy**, then **JSON**, and paste (with your bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::<NEW_BUCKET>" },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::<NEW_BUCKET>/*"
    }
  ]
}
```

Open the user, then **Security credentials**, **Create access key**, and choose **Application running outside
AWS**. Keep the **access key ID** and **secret** somewhere safe: the secret is shown only once.

**Backup retention**, from **new** (the bucket's lifecycle keeps 30 days of daily backups and 13 months of monthly ones,
exactly as on the old bucket; see `deploy-ec2.md` → Retention). This needs admin credentials,
not the app key, so it's easiest in **AWS CloudShell** in the new account's console:

```bash
cat > backup-lifecycle.json <<'JSON'
{
  "Rules": [
    { "ID": "daily-backups-30-days", "Filter": { "Prefix": "backups/daily/" }, "Status": "Enabled",
      "Expiration": { "Days": 30 }, "NoncurrentVersionExpiration": { "NoncurrentDays": 7 } },
    { "ID": "monthly-backups-13-months", "Filter": { "Prefix": "backups/monthly/" }, "Status": "Enabled",
      "Expiration": { "Days": 400 }, "NoncurrentVersionExpiration": { "NoncurrentDays": 30 } }
  ]
}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket <NEW_BUCKET> --lifecycle-configuration file://backup-lifecycle.json
```

## A7. The `.env` file (laptop, then new)

Copy Instance 1's `.env` and change only what the move changes. Keeping the rest identical
(`POSTGRES_PASSWORD`, `DATABASE_URL`, `AUTH_SECRET`, the OpenAI, Stripe and `STAFF_*` values,
`SIGNUP_ENABLED`, `TRUSTED_PROXY_HOPS`) means nothing else can drift.

On the **laptop**:

```bash
scp sf-old:~/reconciliation-team-pursuit/.env ./sf360.env
scp ./sf360.env sf-new:~/reconciliation-team-pursuit/.env
rm ./sf360.env
```

On **new**:

```bash
cd ~/reconciliation-team-pursuit && chmod 600 .env && nano .env
```

Change these lines and nothing else:

| Variable | New value |
|---|---|
| `APP_URL` | `"https://stayfunded360.com"` |
| `S3_BUCKET` | `"<NEW_BUCKET>"` |
| `S3_REGION` | `"<REGION>"` |
| `AWS_ACCESS_KEY_ID` | the new key ID from A6 |
| `AWS_SECRET_ACCESS_KEY` | the new secret from A6 |
| `BILLING_ENABLED` | `"false"` **for now**. It goes back to `"true"` in Part B |
| `TRUSTED_PROXY_HOPS` | `"1"` (nginx is one proxy, as Caddy was) |

Billing stays off during Part A, so nobody testing the practice copy can start a real Stripe
Checkout or subscription from it. Stripe's webhooks still go to Instance 1 until Part B.

Keeping `AUTH_SECRET` isn't required (passwords don't depend on it), but it changes nothing, so
keep it.

## A8. Practice copy of the database (laptop, then new)

The dump contains real client data. It travels only over SSH, and it's deleted in Part C.

On the **laptop**, dump Instance 1 without stopping anything:

```bash
ssh sf-old 'cd ~/reconciliation-team-pursuit && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U reconciliation -Fc reconciliation' > ~/sf360-db.dump
ls -lh ~/sf360-db.dump
scp ~/sf360-db.dump sf-new:~/sf360-db.dump
```

✅ The dump is a few MB or more, never 0 bytes.

On **new**, start **only Postgres**, and restore into its empty database:

```bash
cd ~/reconciliation-team-pursuit
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --no-owner --no-privileges --exit-on-error -U reconciliation -d reconciliation < ~/sf360-db.dump
echo "restore exit code: $?"
```

✅ `restore exit code: 0`. The dump includes the migration history (`drizzle` schema), so the
first deploy in A10 applies only migrations newer than Instance 1's, such as `0042`.

## A9. Practice copy of the files (new)

Two short-lived AWS CLI profiles on Instance 2 (the CLI comes with Amazon Linux): one reads the
old bucket, one writes the new bucket. The files go through Instance 2's disk. It's the simplest way
between two accounts, and it needs no bucket policies.

```bash
aws configure --profile old-bucket   # the AWS_ACCESS_KEY_ID / SECRET from Instance 1's .env; region us-east-1
aws configure --profile new-bucket   # the new key from A6; region <REGION>
```

Check the size first, and that the disk has room for it:

```bash
aws s3 ls s3://teampursuit-reconciliation --recursive --summarize --profile old-bucket | tail -2
df -h ~
```

Then copy the files down from the old bucket and up to the new one:

```bash
mkdir -p ~/s3-copy
aws s3 sync s3://teampursuit-reconciliation ~/s3-copy --profile old-bucket
aws s3 sync ~/s3-copy s3://<NEW_BUCKET> --profile new-bucket
aws s3 ls s3://<NEW_BUCKET> --recursive --summarize --profile new-bucket | tail -2
```

✅ "Total Objects" and "Total Size" match the old bucket. This includes the old nightly backups
under `backups/`.

## A10. Build and start the app (new)

```bash
cd ~/reconciliation-team-pursuit
./deploy.sh --no-pull
```

The first build takes **10 to 20 minutes** (LibreOffice and poppler go into the image). The script
checks `APP_URL`, builds, migrates, starts, waits for `/login`, makes sure the staff account
exists and runs the render smoke test.

✅ It ends with "healthy after …s" and prints no smoke-test warning. Also check locally:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
```

It should print `200`.

## A11. nginx and HTTPS (new)

```bash
sudo tee /etc/nginx/conf.d/stayfunded360.conf > /dev/null <<'NGINX'
# www goes to the bare domain, so there is one address and one set of cookies.
server {
    listen 80;
    listen [::]:80;
    server_name www.stayfunded360.com;
    return 301 https://stayfunded360.com$request_uri;
}

server {
    listen 80;
    listen [::]:80;
    server_name stayfunded360.com;

    # Uploads are capped at 25 MB per file by the app; the same 30 MB Caddy allowed.
    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Next.js checks a server action's Origin against these; without them every
        # button that saves something fails with "Invalid Server Actions request".
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Appends the real client address last, which is what TRUSTED_PROXY_HOPS=1 reads.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # A month's packet can take minutes to build, and can be 70 MB or more: don't cut it
        # off, and stream it rather than holding it in nginx.
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }
}
NGINX

sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d stayfunded360.com -d www.stayfunded360.com --redirect \
  --agree-tos -m <your-email> --no-eff-email
```

certbot adds the HTTPS parts to this file and a redirect from http to https. Certificates last 90
days, so add the renewal job:

```bash
echo "0 0,12 * * * root /opt/certbot/bin/python -c 'import random, time; time.sleep(random.random() * 3600)' && certbot renew -q" \
  | sudo tee -a /etc/crontab > /dev/null
sudo certbot renew --dry-run
```

✅ The dry run reports success. From the **laptop**:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://stayfunded360.com/login
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.stayfunded360.com/r
```

These should print `200`, then `301 https://stayfunded360.com/r`.

## A12. Test the practice copy (browser)

On `https://stayfunded360.com`, with the Mantaq test organization:

- [ ] Sign in, and the Dashboard shows the same figures as the old site
- [ ] Open an expense and view its receipt (reads a file from the **new** bucket)
- [ ] Download a month's packet PDF (LibreOffice, a long request, streamed through nginx)
- [ ] Open a shared link: change the old domain to the new one in a `/s/…` address from the Month-End Packet tab
- [ ] Sign in to `/a` with the staff account
- [ ] Upload a test receipt, then delete it (writes to the new bucket)

Remember: none of this is kept after the switch-over.

---

# Part B: switch over (maintenance window, about an hour)

Pick a quiet time (evening in Detroit) and tell Misty's team beforehand:
- the old site will be unavailable for about an hour
- afterwards the address is `https://stayfunded360.com`
- everyone signs in again, with the same email and password

## B1. Stop the old app (old)

```bash
ssh sf-old
cd ~/reconciliation-team-pursuit
docker compose -f docker-compose.prod.yml stop app
crontab -e
```

In the crontab, put a `#` in front of the `backup.sh` and `billing:reconcile` lines (they need
the app container). **Only the app stops.** The old Postgres keeps running for the final dump, and
the-pride-api isn't touched. From now on, nobody can change data on the old site.

## B2. Final copy of the database (laptop, then new)

On the **laptop**:

```bash
ssh sf-old 'cd ~/reconciliation-team-pursuit && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U reconciliation -Fc reconciliation' > ~/sf360-db.dump
scp ~/sf360-db.dump sf-new:~/sf360-db.dump
```

On **new**, replace the practice copy:

```bash
cd ~/reconciliation-team-pursuit
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -T postgres psql -U reconciliation -d postgres -c 'DROP DATABASE reconciliation WITH (FORCE)'
docker compose -f docker-compose.prod.yml exec -T postgres psql -U reconciliation -d postgres -c 'CREATE DATABASE reconciliation'
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore --no-owner --no-privileges --exit-on-error -U reconciliation -d reconciliation < ~/sf360-db.dump
echo "restore exit code: $?"
```

✅ `restore exit code: 0`. The app is started in B4.

## B3. Final copy of the files (new)

This copies only what changed since A9. `--delete` makes the new bucket an exact mirror, removing
what the practice run wrote. Always do the dry run first, and read it:

```bash
aws s3 sync s3://teampursuit-reconciliation ~/s3-copy --delete --profile old-bucket
aws s3 sync ~/s3-copy s3://<NEW_BUCKET> --delete --profile new-bucket --dryrun
```

The dry run should only upload files added since A9, and only delete your A12 test uploads.
If it wants to delete much more than that, **stop and check the bucket names**. Then run it for real:

```bash
aws s3 sync ~/s3-copy s3://<NEW_BUCKET> --delete --profile new-bucket
aws s3 ls s3://teampursuit-reconciliation --recursive --summarize --profile old-bucket | tail -2
aws s3 ls s3://<NEW_BUCKET> --recursive --summarize --profile new-bucket | tail -2
```

✅ Both buckets show the same object count and size.

## B4. Start the new app, with billing on (new)

In `.env`, set `BILLING_ENABLED="true"`, then:

```bash
cd ~/reconciliation-team-pursuit
nano .env
./deploy.sh --no-pull
```

This migrates the restored database (for example `0042`), starts the app and checks it.

## B5. Check that every row arrived (laptop)

Save this once as `~/count-rows.sql` on the **laptop**:

```sql
SELECT format('SELECT %L, count(*) FROM public.%I', table_name, table_name)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name
\gexec
```

Then count every table on both servers and compare:

```bash
PSQL='docker compose -f docker-compose.prod.yml exec -T postgres psql -U reconciliation -d reconciliation -tA'
ssh sf-old "cd ~/reconciliation-team-pursuit && $PSQL" < ~/count-rows.sql > ~/old-counts.txt
ssh sf-new "cd ~/reconciliation-team-pursuit && $PSQL" < ~/count-rows.sql > ~/new-counts.txt
diff ~/old-counts.txt ~/new-counts.txt && echo "all tables match"
```

✅ Every count is identical. The only allowed differences are tables that exist only on the new
side because of a newer migration, such as `feature_requests`, `feature_request_votes` and
`feature_request_replies`, all at 0.

**If anything else differs, stop here** and go to "Going back" at the end.

## B6. Stripe: send webhooks to the new address (Stripe dashboard)

In the Stay Funded 360 sandbox, open **Developers**, then **Webhooks** (event destinations), then the
production destination `we_1UKIHhCqeVigYIV8OQXfCIze`. Its URL is now
`https://reconciliation.teampursuit.org/api/stripe/webhook`. Edit the destination and change the
endpoint URL to:

```
https://stayfunded360.com/api/stripe/webhook
```

Changing the URL keeps the same signing secret, so `STRIPE_WEBHOOK_SECRET` in `.env` stays as it is.
Any webhook that failed during the window is retried by Stripe to the new URL. The app also
re-reads Stripe on the next page load and in the nightly reconcile (PHASE-16, P13).

From the **laptop**:

```bash
curl -sS -X POST https://stayfunded360.com/api/stripe/webhook -d '{}' -w ' %{http_code}\n'
```

✅ `bad signature 400`: billing is on, and the route is reached. `billing is off 503` means B4's
`.env` change didn't apply.

## B7. Point the old domain at the new box, as a redirect (DNS, then new)

Links already sent to the City (`https://reconciliation.teampursuit.org/s/…`) and everyone's
bookmarks keep working, because the old domain redirects every address to the same path on the new one.

1. At the DNS provider for `teampursuit.org`, change the `A` record of
   `reconciliation.teampursuit.org` to `<NEW_IP>`. The TTL was lowered in A2, so this takes a few
   minutes. Check it from the laptop with `dig +short reconciliation.teampursuit.org`.
2. On **new**:

```bash
sudo tee /etc/nginx/conf.d/old-domain-redirect.conf > /dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name reconciliation.teampursuit.org;
    return 301 https://stayfunded360.com$request_uri;
}
NGINX
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d reconciliation.teampursuit.org --redirect
```

✅ From the **laptop**:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://reconciliation.teampursuit.org/s/test
```

It should print `301 https://stayfunded360.com/s/test`.

## B8. Final checks (browser), then tell the team

- [ ] Sign in at `https://stayfunded360.com`. The Dashboard figures match what the old site showed.
- [ ] A receipt opens, and a packet downloads.
- [ ] Settings, then Plan & billing: shows Team Pursuit's plan as before (Stripe copy restored, billing on).
- [ ] A real shared link from before, on the old domain, lands on the new one and opens.
- [ ] `/a` opens for the staff account. The Feature requests link is there (`0042` applied).
- [ ] Logs are clean: `docker compose -f docker-compose.prod.yml logs --tail=100 app`

Then tell Misty's team the new address.

---

# Part C: afterwards

## C1. Nightly jobs on the new box (new, same day)

```bash
crontab -e
```

```
15 3 * * * /home/ec2-user/reconciliation-team-pursuit/backup.sh >> /home/ec2-user/backup.log 2>&1
30 3 * * * cd /home/ec2-user/reconciliation-team-pursuit && docker compose -f docker-compose.prod.yml exec -T app npm run --silent billing:reconcile >> /home/ec2-user/billing-reconcile.log 2>&1
```

Run the backup once by hand:

```bash
cd ~/reconciliation-team-pursuit && ./backup.sh
```

✅ Ends with `Uploaded and verified backups/daily/<date>.dump` (now in the new bucket).

## C2. Remove the temporary copies (new and laptop, once B8 has passed)

These hold real client data and the old bucket's key.

```bash
# new
rm ~/sf360-db.dump
rm -rf ~/s3-copy
aws configure --profile old-bucket   # overwrite the old key with blanks, or delete the [old-bucket] and [new-bucket] sections from ~/.aws/credentials
```

```bash
# laptop
rm ~/sf360-db.dump ~/old-counts.txt ~/new-counts.txt
```

## C3. Take the old stack off Instance 1 (old, about a week later)

Only our stack and our Caddy block. **the-pride-api stays exactly as it is.**

```bash
ssh sf-old
cd ~/reconciliation-team-pursuit
docker compose -f docker-compose.prod.yml down        # without -v: the old database volume is kept
crontab -e                                            # delete the two commented-out lines from B1

cd ~/the-pride-api
cp Caddyfile Caddyfile.bak.$(date +%F)
nano Caddyfile                                        # delete only the reconciliation.teampursuit.org block
docker compose -f docker-compose.prod.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
curl -sS -o /dev/null -w 'pride-api: %{http_code}\n' https://pride-api.teampursuit.org/
```

If `validate` fails, restore the backup (`cp Caddyfile.bak.<date> Caddyfile`) and don't reload.
Check that pride-api answers as before.

**Later, your call** (suggested after 30 days without problems):
- delete the old database volume: `docker volume rm reconciliation-team-pursuit_reconciliation-pg-data`, after checking the name with `docker volume ls`
- empty and delete the old bucket `teampursuit-reconciliation`
- deactivate the old app access key in the old account's IAM
- remove Instance 1's deploy key from GitHub

## C4. Docs

After the move, `deploy-ec2.md` and `ec2-first-deploy.md` describe a box that no longer runs
this app. They get rewritten for Instance 2: nginx on the host, no shared Caddy, no the-pride-api
constraints, paths under `~/reconciliation-team-pursuit`.

---

# Going back

- **Before B7 (DNS not moved yet):** nothing on Instance 1 was changed except stopping the app.
  On **old**, run `docker compose -f docker-compose.prod.yml up -d app`, remove the `#` from the two
  crontab lines, and change the Stripe webhook URL back if B6 was done. The old site works as before.
- **After the team has used the new site:** going back would lose their new work. Decide go or
  no-go at B8, before telling anyone the new address.
