# Documentation — Grant Expense Reconciliation System

Docs-first, AI-native project. **These files are the source of truth.** Code serves the docs; when reality diverges, update the doc in the same change.

## Map

| Path | What it is |
|---|---|
| `00-product/prd.md` | Product requirements — problem, scope, flows, acceptance |
| `01-domain/domain-rules.md` | The rulebook: money math, gates, statuses, canonical wordings |
| `01-domain/data-model.md` | Entities, fields, relationships, S3 key scheme |
| `02-outputs/cover-sheet-spec.md` | Word + PDF cover sheet ("Breakdown" doc) format spec |
| `02-outputs/summary-excel-spec.md` | Excel contract summary format spec |
| `02-outputs/packet-pdf-spec.md` | Merged month-end packet PDF: canonical order, rasterization, footer |
| `03-modules/design-language.md` | Shared visual language + the paste-first Claude Design preamble |
| `03-modules/m00…m09-*.md` | Per-module spec + self-contained Claude Design prompt |
| `03-modules/design-review.md` | Fetched-design analysis: dc format, per-screen verdicts, adopted patterns, refetch instructions |
| `04-engineering/architecture.md` | Stack, layers, folder conventions, generation engine, ops, testing |
| `04-engineering/decisions.md` | Decision log — settled and open |
| `04-engineering/review-2026-08-16.md` | Adversarial review of the documentation (4 auditors) — findings + dispositions, all applied |
| `04-engineering/review-2026-08-16-implementation.md` | Adversarial review of the first implementation phase |
| `04-engineering/review-2026-08-16-generation.md` | Adversarial review of the generation layer (snapshot, workbook, artifact cache, download route) |

Reference inputs (not authored by us) live in `../context/`:
- `Reconciliation System MVP For Team Pursuit Global By Mantaq.pdf` — signed scope of work
- `manual packet/` — the client's real, approved February 2026 packet + manual Word cover sheets. **Golden reference for all generated outputs. Contains real PII — git-ignored, never commit or publish.**

## Build pipeline (per module)

Each `03-modules/m*.md` is one unit of work that flows through five gates:

1. **Spec** — written here (module file). Behavior references `domain-rules.md`; data references `data-model.md`; never duplicated.
2. **Design** — paste `design-language.md` preamble + the module file's "Claude Design prompt" section into Claude Design; client-facing UI comes back as an artifact.
3. **Fetch** — Claude Code fetches the module's `.dc.html` from the Claude Design project via DesignSync (projectId in `03-modules/design-review.md`) and reviews it against the spec.
4. **Page** — Claude Code implements the Next.js page(s) from spec + fetched design. Spec wins on conflict with the design; design wins on pure visuals.
5. **Wire** — backend (server actions/routes, DB, S3) makes it functional; acceptance checks in the module file pass.

### Module status

| Module | Spec | Prompt | Design | Page | Wired |
|---|---|---|---|---|---|
| m00 App shell & auth | ✅ | ✅ | ✅ | ✅ | ✅ |
| m01 Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| m02 Expense entry | ✅ | ✅ | ✅ | ✅ | ✅ |
| m03 Expenses list | ✅ | ✅ | ✅ | ✅ | ✅ |
| m04 Cover sheets | ✅ | ✅ | ✅ | ✅ | ✅ |
| m05 Recurring items | ✅ | ✅ | ✅ | ✅ | ✅ |
| m06 Month-end packet | ✅ | ✅ | ✅ | ☐ | ☐ |
| m07 Contract summary | ✅ | ✅ | ✅ | ✅ | ✅ |
| m08 Line items | ✅ | ✅ | ✅ | ✅ | ✅ |
| m09 Settings | ✅ | ✅ | ✅ | ✅ | ✅ |

Output generators (cover sheets, Excel, packet) are backend work items specced in `02-outputs/` and wired during m04/m06/m07.

## Working rules for AI sessions

- Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/` — this repo runs Next 16; APIs differ from training data (see `/AGENTS.md`).
- Money is integer cents everywhere in code. Formatting only at the edge (`domain-rules.md` §1).
- Exact output wordings and formats come from `01-domain` + `02-outputs` — never improvise strings that print on documents.
- New product decisions go to `04-engineering/decisions.md` the moment they're made; open questions live there too.
- Update the module status table above as gates complete.

## Build progress (updated as modules land)

Working software so far, all verified against a running app with a real database:

| Landed | What exists |
|---|---|
| Foundation | Drizzle schema (14 tables) + migrations + seed + dev fixture; custom session auth; Tailwind design tokens and the shared component library; m00 auth/onboarding/app shell |
| Domain | money · format · dates · strings · budget-math (R3) · gate (R4) · summary (R7) · line-item-rules (R9) · recurring-rules (R8) — all pure, all unit-tested |
| Storage | Driver abstraction (S3 + local, D-29), key rules, upload inspection, server-proxied ingestion (D-30), download-by-id route |
| Screens | m00 shell/auth · m01 dashboard · m02 expense entry · m03 expenses list · m04 cover sheets · m05 recurring · m07 contract summary · m08 line items · m09 settings |
| Generators | All three outputs: summary workbook (xlsx) · cover sheet (docx canonical + PDF) · month-end packet (merged, ordered, footer-stamped, size ladder). Shared month snapshot, rasterization (pdftoppm 150 DPI, page-at-a-time), artifact cache with inputs-hash and download pinning (R10.4, R10.6), gated download routes |

**Remaining:** m06 month-end packet · hardening (Playwright, Docker, the
February test).

### Running it locally

```bash
createdb ngo_expenses          # once
cp .env.example .env.local     # set DATABASE_URL to your local Postgres
npm run db:migrate
npm run db:seed                # creates the client org (no PII)
npm run db:fixture             # optional: February expenses for development
npm run db:fixture -- docs     # optional: attach proof+receipt to each, opening the gate
npm run dev
```

Sign in with the credentials `db:seed` prints. Downloads stay blocked until every expense
in the month carries its documents (R4.3), which is what `db:fixture -- docs` sets up.

Document generation shells out to two binaries, both of which the deployment container
ships. Install them locally to generate cover sheets and packets:

```bash
brew install poppler                  # pdftoppm/pdfinfo — rasterizing PDF proofs
brew install --cask libreoffice       # soffice — docx to PDF conversion
```

`SOFFICE_PATH` overrides the LibreOffice location if yours is elsewhere; the macOS app
bundle path is already tried, so the cask needs no configuration.

`npm test` runs unit and integration suites. Integration tests skip cleanly without
`DATABASE_URL`, and the rasterization and conversion tests skip without their binaries —
so the suite stays green on a bare machine, but only a fully equipped one proves the
generators work.
