# Architecture

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.3 (App Router) + React 19 + TypeScript + Tailwind 4** | Already scaffolded. ⚠️ Next 16 has breaking changes vs training data — before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (see `/AGENTS.md`). |
| Database | **PostgreSQL (self-hosted: Docker container + volume on Mantaq infra; local Postgres in dev) + Drizzle ORM** with drizzle-kit migrations — settled D-07 | Schema in `01-domain/data-model.md`, authored as `src/db/schema.ts`. **Backup regime below — non-negotiable**. |
| Auth | **Custom session auth built into the app** — settled D-06 (no Auth.js, no Better Auth, no external service) | Full design in §Auth below. argon2id hashes, min 12 chars, revocable DB sessions. |
| Files | **AWS S3, private bucket** | Presign/processing/cleanup contract in `data-model.md` §S3 + §Upload processing (server-built keys, docId-only attach, PII-free keys, TTLs, quotas, provisioning checklist). `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. |
| Documents | **docx** (Word) · **exceljs** (Excel) · **pdf-lib** (assembly/stamping) · **LibreOffice headless** (docx→PDF) · **pdftoppm (poppler)** (PDF→PNG) · **sharp** (image processing, HEIC→JPEG, `limitInputPixels`) | Container binaries → **Docker deploy**. Container must install the **Carlito** font (metric-compatible Aptos/Calibri fallback — cover-sheet-spec). Fallback if D-08 parity spike fails: parallel pdf-lib cover-sheet renderer sharing `layout-constants.ts`. |
| Validation | **zod** everywhere a request crosses a boundary | Shared schemas between client forms and server actions. |

## Application layout

```
app/                     # routes only — thin; each feature screen imports from src/modules
  page.tsx               # public marketing landing
  robots.ts, sitemap.ts
  (auth)/login, signup, onboarding/…
  r/                      # authenticated layout: shell, nav, month selector
    page.tsx             # dashboard
    expenses/, expenses/new, expenses/[id]/edit
    cover-sheets/, recurring/, packet/, contract-summary/, line-items/, settings/
  a/                      # admin scaffold (session-gated only; no role check yet)
  api/files/…            # presign + attach + download routes (Node runtime)
  api/generate/…         # document generation routes (Node runtime, streaming)
  api/healthz            # DB ping for uptime monitoring
src/
  modules/<name>/        # mirrors docs/03-modules: components + server actions per module
  domain/                # PURE functions, no IO: money.ts, budget-math.ts (R3), gate.ts (R4),
                         # summary.ts (R7), strings.ts (R12 canonical strings), format.ts (R1.2/R1.5),
                         # dates.ts (R2.5 America/Detroit helpers)
  generation/            # cover-sheet-docx.ts, summary-xlsx.ts, packet-pdf.ts, raster.ts,
                         # convert.ts (soffice), layout-constants.ts (shared with page estimates)
  db/                    # drizzle schema.ts + client index.ts
  services/              # s3.ts, auth.ts (§Auth), artifact-cache.ts (R10.4/R10.6),
                         # rate-limit.ts, locks.ts (single-flight), sweep.ts (nightly cleanup)
drizzle/                 # generated SQL migrations (drizzle-kit)
docs/                    # this documentation (source of truth)
```

Principles:
- **One calculation service.** Every figure on any surface comes from `src/domain` (R10.2). Money helpers accept/return integer cents; `format.ts` is the only place `$#,##0.00` and percentage rounding exist; `dates.ts` is the only place "today" is computed (R2.5).
- **Server Components for reads, Server Actions for mutations,** route handlers only for binary streams. **Every route handler and action authenticates independently of middleware** (middleware is convenience, never the security boundary) and re-checks `session.orgId` against the target row. Route handlers are GET/side-effect-free or verify Origin; mutations live in Server Actions (origin-checked by Next).
- **Generators are pure(data) → bytes.** They take a fully-loaded month snapshot (one query layer builds it) and never touch the DB — makes golden-file testing trivial.
- Canonical strings imported from `domain/strings.ts` only (R12).
- **Rate limiting** (in-process fixed-window, `rate-limit.ts`): login 10/15min per email+IP; presign 60/min per org; generation 6/min per org.
- **Logging policy:** IDs and counts only — never request bodies, expense names, filenames, or amounts (expense names can identify CVI participants). Applies to app logs and any error tracker.

## Auth (settled — D-06)

One module (`services/auth.ts`), no framework. Sized for a single credentials provider with hard revocation requirements:

- **Passwords:** argon2id via `@node-rs/argon2`, minimum 12 characters (no other composition rules). Operator reset per D-24 is `npm run db:reset-password -- --email <address>` (`src/db/reset-password.ts`) — it sets a new hash **and deletes every session for that user**, which is the half that makes it a reset rather than a password change. Run only after confirming identity out of band.
- **Sessions:** `sessions` table (see data-model). Login: generate a 32-byte random token (`crypto.getRandomValues`), set cookie `session` = base64url(token) with `HttpOnly; Secure; SameSite=Lax; Path=/`; store **only `SHA-256(token)`** as the row id (a DB leak cannot forge cookies). Sliding 30-day expiry: renew `expires_at` when under 15 days remain. Logout deletes the row. **Password change deletes all the user's other sessions.**
- **Validation:** a single `getSession()` helper resolves cookie → hashed lookup → user + org; **every Server Action and route handler calls it directly** — middleware may redirect for UX but is never the security boundary. `requireOrg(rowOrgId)` asserts session org = target row org on every read/write (verified by the two-org IDOR suite).
- **CSRF:** mutations live in Server Actions (Next verifies Origin); the binary route handlers (`api/files`, `api/generate`) verify `Origin`/`Sec-Fetch-Site` themselves; `SameSite=Lax` is the second layer.
- **Rate limits** per this doc's rules (login 10/15 min per email+IP). Session expiry mid-form: failed action returns a typed `unauthenticated` result — client keeps form state and shows "Signed out — sign in and resubmit."
- **Why not a framework** (recorded in D-06): Auth.js Credentials forces JWT sessions (revocation becomes a workaround); Better Auth is the right tool if OAuth/2FA/multi-user arrive — revisit then.

## Generation pipeline (packet)

1. Load month snapshot → compute readiness; refuse if gated (R4.3).
2. Acquire per-(org, month, type, line_item) single-flight advisory lock — a concurrent second request waits and receives the first run's artifact.
3. Check `generated_artifacts` inputs-hash → serve cached S3 object on hit (R10.4; pinned artifacts never replaced — R10.6).
4. Build parts in a per-run temp dir: summary section (pdf-lib, paginating) · per-line-item cover sheet (docx → soffice → PDF) · uploaded PDFs rasterized page-per-page at 150 DPI (pdftoppm → JPEG q80, page-at-a-time to disk, never whole-file in memory) · images normalized (sharp).
5. Assemble in canonical order with pdf-lib; stamp footers; enforce the ≤25 MB downgrade ladder (packet-pdf-spec).
6. Upload artifact, record row, stream to client; set `downloaded_at` on completed download (pin).
7. **Always:** hard wall-clock timeout (kill soffice/pdftoppm children), temp dir removed in `finally`, boot-time sweep of stale temp dirs. Failure → red panel + Retry, logged with artifact id, never a partial file (packet-pdf-spec §Failure handling).

## Scheduled jobs (container cron)

- **Nightly sweep** (`sweep.ts`): S3 objects with no DB row >24 h (abandoned drafts, failed inline deletes), `failed` document rows + objects >24 h, unpinned `generated/` objects >90 d.
- **Nightly backup:** `pg_dump` → `s3://{bucket}/backups/` (30 daily + 12 monthly via lifecycle). Restore procedure documented in the deploy runbook and **executed once before go-live** (D-07). Bucket versioning ON.
- **Disk watch:** alert when volume >80 % (rasterization temp + Postgres share one disk).

## Testing

- **Unit (vitest):** `src/domain` exhaustively — R1/R3/R4/R7 including refund negatives, zero budgets, <10% boundary, month ordering, edit-mode projection (R3.7), Detroit-timezone date edges (R2.5).
- **Golden files:** generators against a fixture month re-creating February 2026 — assert docx XML (table shape, fills, centered alignment, strings), xlsx cell values/formats, packet page count + section order. Fixtures use sanitized stand-in images only.
- **AuthZ suite:** two fixture orgs; every server action and route probed with the other org's ids expecting 404/403 (IDOR regression net — cheap and mechanical).
- **E2E (Playwright, phase 4):** signup → onboarding → add expense with uploads (incl. a rejected corrupt PDF) → recurring add → gate blocks → attach → downloads succeed.
- **The February test** (PRD §3.1) is the release gate — run **in the production environment only** (real PII never lands on laptops/staging).

## Deployment & environment

Docker on Mantaq infra: app container (Next standalone + libreoffice + poppler-utils + fonts-crosextra-carlito), Postgres container + volume, reverse proxy (Caddy or nginx) terminating TLS with Let's Encrypt + baseline headers (HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`). Host disk encryption per D-07. `/api/healthz` wired to a free external uptime monitor.

Startup (`instrumentation.ts`) refuses to boot production without `DATABASE_URL`, `AUTH_SECRET`, `S3_BUCKET` or a plausible `TRUSTED_PROXY_HOPS`, so a misconfigured deploy fails at start rather than at the first sign-in.

Env: `DATABASE_URL`, `AUTH_SECRET`, `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`/`SECRET` (or instance role), `APP_URL`, `TRUSTED_PROXY_HOPS` (**required in production** — login limits are keyed on the client address, and without it every visitor shares one bucket, so an attacker's wrong guesses lock out the real user; the app refuses to start without it, as it does without `S3_BUCKET`), `SIGNUP_ENABLED` (**default false** — Team Pursuit's org is created via signup before gating; flipping to true later requires email verification first, D-15).

## AI-native working rules (every session)

1. Read the module's doc + `domain-rules.md` sections it cites **before** coding; read `node_modules/next/dist/docs/` for any Next API touched.
2. Implement to the spec; where the fetched Claude Design conflicts on behavior, spec wins — on pure visuals, design wins. Record any real conflict in `decisions.md`.
3. Docs updated in the same change that changes behavior; module status table (`docs/README.md`) advanced as gates pass.
4. Never commit `context/` contents (git-ignored wholesale), real PII, or `.env`. Test fixtures use sanitized stand-ins only.
