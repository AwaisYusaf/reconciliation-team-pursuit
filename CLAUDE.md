@AGENTS.md

# Project: Grant Expense Reconciliation System (Team Pursuit Global / Mantaq)

Docs-first, AI-native project. **Start every task at `docs/README.md`** — it maps the PRD, domain rules, data model, output specs, per-module specs (each with its Claude Design prompt), architecture, and the decision log. The docs are the source of truth; update them in the same change that changes behavior.

Hard rules:
- Money is integer cents; strings that print on documents come only from `docs/01-domain/domain-rules.md` §12 (via `src/domain/strings.ts` once code exists).
- `context/` holds the signed SOW and the client's real packet (`context/manual packet/` — real PII, git-ignored; never commit or publish its contents).
- Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (this repo runs Next 16 — see AGENTS.md above).
