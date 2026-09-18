# First deployment to EC2 — step by step

Seven steps, top to bottom. Every release after this is just `./deploy.sh`.

Assumes: the EC2 box already runs the-pride-api behind Caddy, the S3 bucket
`teampursuit-reconciliation` exists, and DNS for `stayfunded360.com` points at
the instance. See [`deploy-ec2.md`](deploy-ec2.md) for why the deployment has this shape.

---

## 1. Create an AWS access key for the app

In the AWS console: **IAM → Users → Create user** (name it `reconciliation-app`) → **Attach
policies directly** → `AmazonS3FullAccess` → create. Then open the user → **Security
credentials → Create access key** → *Application running outside AWS*.

Copy the **access key ID** and **secret** now — the secret is shown once.

> `AmazonS3FullAccess` is the quick option and lets this key reach the-pride-api's bucket too.
> To limit it to ours, create the user with an inline policy allowing `s3:ListBucket` on
> `arn:aws:s3:::teampursuit-reconciliation` and `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject`
> on `arn:aws:s3:::teampursuit-reconciliation/*` instead. Same steps otherwise.

## 2. Add swap

```bash
ssh ec2-user@98.90.155.13
```

The box has 3.7 GB and no swap. A build here can push the kernel into killing something — and
it may pick the-pride-api rather than us. Two GB of insurance:

```bash
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

The `fstab` line is what brings it back after a reboot. `free -h` should now show a 2.0Gi swap row.

## 3. Clone the repo

The repo is private, so the server needs a read-only deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_reconciliation -N ""
cat ~/.ssh/id_ed25519_reconciliation.pub
```

Paste that into GitHub → the `reconciliation-team-pursuit` repo → **Settings → Deploy keys →
Add deploy key**. Leave *Allow write access* unchecked.

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

git clone git@github.com-reconciliation:AwaisYusaf/reconciliation-team-pursuit.git ~/ngo-expenses
```

## 4. Write `.env`

Paste your two AWS values into the first two lines; everything else is generated or fixed.

```bash
cd ~/ngo-expenses

AWS_KEY="AKIA..."           # from step 1
AWS_SECRET="..."            # from step 1

PG_PW="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
AUTH="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"

cat > .env <<EOF
POSTGRES_PASSWORD="${PG_PW}"
DATABASE_URL="postgresql://reconciliation:${PG_PW}@reconciliation-postgres:5432/reconciliation"

AUTH_SECRET="${AUTH}"
TRUSTED_PROXY_HOPS="1"

S3_BUCKET="teampursuit-reconciliation"
S3_REGION="us-east-1"
AWS_ACCESS_KEY_ID="${AWS_KEY}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET}"

NODE_ENV="production"
APP_URL="https://stayfunded360.com"
SIGNUP_ENABLED="false"
EOF

chmod 600 .env
unset AWS_KEY AWS_SECRET PG_PW AUTH
```

The Postgres password is stripped to letters and digits on purpose — it gets embedded in
`DATABASE_URL`, where a raw `/` or `+` would truncate the connection string.

## 5. Build and start

```bash
cd ~/ngo-expenses
./deploy.sh --no-pull
```

**The first build takes 10–20 minutes** — it installs LibreOffice and poppler into the image on
two CPUs. Later builds reuse those layers. The script migrates the database, starts the stack,
and waits until the app actually serves `/login` before reporting success.

## 6. Create the account

```bash
cd ~/ngo-expenses
read -rsp 'Password for the app sign-in: ' APP_PW; echo
docker compose -f docker-compose.prod.yml exec -e SEED_PASSWORD="$APP_PW" app npm run db:seed
unset APP_PW
```

Sign-in address is `team@teampursuitglobal.org`.

> The contract figures this writes — contract value, PO numbers, scheduled values, opening
> balances — are **placeholders** from the February packet (D-13). Every generated document
> derives from them, so confirm them with Misty and correct them in **Settings** before anyone
> produces a real submission.

## 7. Publish it through Caddy

Caddy already owns :80 and :443 for the-pride-api. Add one site block to its config. Back it
up first, and *reload* rather than restart — a reload does not drop the other service's
connections.

```bash
cd ~/the-pride-api
cp Caddyfile Caddyfile.bak

cat >> Caddyfile <<'CADDY'

stayfunded360.com {
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

docker compose -f docker-compose.prod.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

The 600s timeouts match the packet route, which can run for minutes; without them a long build
gets cut off mid-assembly. If `validate` fails, restore with `cp Caddyfile.bak Caddyfile` and
do not reload.

Certificate issuance takes 10–60 seconds. Then check both sites:

```bash
curl -sS -o /dev/null -w 'reconciliation: %{http_code}\n' https://stayfunded360.com/login
curl -sS -o /dev/null -w 'pride-api:      %{http_code}\n' https://pride-api.teampursuit.org/
```

Reconciliation should return `200`, and pride-api should return whatever it did before.

Open `https://stayfunded360.com` and sign in.

---

## After this

- **Deploying changes:** `cd ~/ngo-expenses && ./deploy.sh`
- **After editing `.env`:** `./deploy.sh --env-only` (a restart would not reload it)
- **Reset the password** (also signs out every session):
  `docker compose -f docker-compose.prod.yml exec app npm run db:reset-password -- --email team@teampursuitglobal.org`
- **Logs:** `docker compose -f docker-compose.prod.yml logs --tail=50 app`
- **Roll back:** `git reset --hard <sha> && ./deploy.sh --no-pull` — `deploy.sh` prints the sha
- **Backups:** enable the nightly dump and apply the S3 lifecycle rules — see the Backups
  section of [`deploy-ec2.md`](deploy-ec2.md). Run the restore drill once before go-live (D-07)

If the app will not start, `instrumentation.ts` refuses to boot on a missing `DATABASE_URL`,
`AUTH_SECRET`, `S3_BUCKET` or `TRUSTED_PROXY_HOPS`, and the log names which one.
