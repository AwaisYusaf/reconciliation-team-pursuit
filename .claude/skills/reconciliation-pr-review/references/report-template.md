# Report template

## For the user (Awais) — in chat

```
## PR #<n> — <title>: <GREEN FLAG | changes needed | blocking issues>

<One or two sentences: what the PR does, the overall judgement, the single most important problem.>

### Checks
typecheck ✓ · lint ✓ · tests <passed>/<total> (<skipped> skipped) · build ✓ · migrations applied (<n>)
<Any local artefacts and why they are not the PR's fault.>

### Acceptance criteria
| Criterion (ticket wording, shortened) | Status | Evidence |
|---|---|---|
| … | DONE / PARTIAL / NOT DONE / UNVERIFIED | code ref, test name, or what the browser/DB showed |

### Findings (verified), most important first
**1. <Plain statement of what goes wrong for a user>** — `file:line`
<Scenario in one or two sentences.> Proven by: <probe test / browser + DB / mutation / quoted code>.
Fix: <one line>.

### Test gaps (code works, nothing would catch it breaking)
- …

### Not verified
- <what, and why — e.g. Codex unavailable, production-only preflight>

### State on your machine
Branch `pr-<n>` checked out · local DB migrated to <n> (ahead of main) · test data: <list>
Restore: `pg_restore -d "postgresql://localhost:5432/ngo_expenses" --clean --if-exists <backup path>`
```

Rules: lead with the verdict; findings ranked by user/funder impact, not by specialist label; say
plainly when an earlier claim of yours was wrong; never "probably handled" — verified or unverified.

## For the developer — Slack draft (user posts it)

Short, plain, scannable. Developers skip long AI-written reviews.

```
PR #<n> review — <one-line overall>. <N> things before merge:

1. **<What breaks, in a few words>** — `file:line`
   <One or two sentences: scenario and what to do.>

2. …

Smaller:
- <one line each>

<Anything that is a product decision, not theirs to fix: "Awais is checking X with Misty — hold off.">
```

No praise paragraphs, no restated context, no speculation. Don't offer to post it.
