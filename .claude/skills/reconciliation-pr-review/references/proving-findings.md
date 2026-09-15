# Proving findings

A finding goes in the report only with evidence: quoted code that plainly shows it, or a reproduction.
Mark anything else "unverified" or drop it. This project has been misled before by a plausible width
theory, a guard that passed at the broken value, a test comparing two constants, and a test harness
whose Left key did not move the caret. Check the harness before believing a surprising failure.

## Choose the cheapest proof that is real

| Claim | Proof |
|---|---|
| Pure function behaves wrongly (filenames, money, dates) | `npx tsx <scratch>.ts` importing the function from `src/` with real-world inputs |
| DB constraint exists / fires | `psql ... BEGIN; <offending INSERT>; ROLLBACK;` — read the error, nothing persists |
| Data state after an action | read-only `SELECT` before and after the step |
| Server action / cross-module bug | throwaway integration probe (`probe-test-template.ts`) that encodes the bug as passing assertions |
| A test guards a fix | mutation test (below) |
| User-visible behaviour | browser, then confirm in the DB |

## Mutation test a guard
```bash
git status --short                      # must be clean first
sed -i '' 's/<fixed code>/<original bug>/' <file>
git diff --stat                         # exactly one line changed
npx vitest run <the test file(s) that claim to guard it>
git checkout -- <file>                  # always restore
git status --short                      # clean again
```
Report "stays green with the bug reintroduced (N/N passed)" as a test finding, with the one-line mutation.

## Throwaway probe tests
- Put it next to the module under test (the `@/` alias only resolves inside the repo), name it
  `zz-review-probe.integration.test.ts`, write **assertions that encode the bug** (so "passed" means
  reproduced — console output is swallowed by vitest), clean up its org in `afterAll`.
- Run only that file, then `rm` it and confirm `git status` is back to where it was.
- Never leave a probe behind; never commit one.

## Ranking
Rank by what a real user or the funder would experience: wrong figures or documents, cross-org or
cross-source data exposure, silent data loss > broken flows with a visible error > missing test
coverage > docs/comment drift > style. A missing test is not a production defect.
