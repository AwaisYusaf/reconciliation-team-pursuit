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
| `04-engineering/review-2026-08-16.md` | Adversarial review (4 auditors) — findings + dispositions, all applied |

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
| m04 Cover sheets | ✅ | ✅ | ✅ | ☐ | ☐ |
| m05 Recurring items | ✅ | ✅ | ✅ | ✅ | ✅ |
| m06 Month-end packet | ✅ | ✅ | ✅ | ☐ | ☐ |
| m07 Contract summary | ✅ | ✅ | ✅ | ☐ | ☐ |
| m08 Line items | ✅ | ✅ | ✅ | ✅ | ✅ |
| m09 Settings | ✅ | ✅ | ✅ | ☐ | ☐ |

Output generators (cover sheets, Excel, packet) are backend work items specced in `02-outputs/` and wired during m04/m06/m07.

## Working rules for AI sessions

- Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/` — this repo runs Next 16; APIs differ from training data (see `/AGENTS.md`).
- Money is integer cents everywhere in code. Formatting only at the edge (`domain-rules.md` §1).
- Exact output wordings and formats come from `01-domain` + `02-outputs` — never improvise strings that print on documents.
- New product decisions go to `04-engineering/decisions.md` the moment they're made; open questions live there too.
- Update the module status table above as gates complete.
