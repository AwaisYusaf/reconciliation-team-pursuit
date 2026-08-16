# Adversarial review — generation layer (T3 + T4a)

Scope: the month snapshot loader, the summary workbook generator, the artifact cache and
pinning, the download route, the shared header helper, the m07 Contract Summary screen, and
the `docs` mode added to the dev fixture.

Every finding below was traced end-to-end before being accepted; each fix was then verified
against the running application with a real database, not only by unit test. Findings are
listed with their disposition.

## High

| # | Finding | Disposition |
|---|---|---|
| H1 | A transient storage read failure (throttle, timeout, expired credential) deleted the artifact row — including **pinned** rows, which are the permanent record of what the City received (R10.6). | **Fixed.** No row is ever deleted on a read failure. Bytes are deterministic (R10.1), so the artifact is rebuilt and written back to the same key, restoring the object and keeping the record. Verified by destroying a stored object under a pinned row: the row survived and the object was restored. |
| H2 | Every insert was pre-pinned, so the partial unique index (`WHERE downloaded_at IS NULL`) never applied: `onConflictDoNothing` could not fire and concurrent downloads each inserted a row. | **Fixed.** Added `generated_artifacts_content_uq` on (org, month, type, line item, inputs hash) — the natural key for one set of bytes. Four concurrent downloads now converge on one row. |
| H3 | Snapshot queries had no total ordering, and `canonicalJson` treats array order as data — so an unrelated `UPDATE` could reorder rows and change the cache key, rebuilding identical bytes forever. | **Fixed.** Every snapshot query carries a deterministic tiebreak (`asc(id)`). Verified: repeated downloads keep one artifact row. |
| H4 | The screen rounded `ratio × 100` in JavaScript while the workbook let Excel round; at an exact half (2300/4000 = 57.5%) they printed **57% and 58%** — a direct R10.2 breach, and the JS side also violated R1.5. | **Fixed twice over.** `percentValue` now normalises binary representation error to 15 significant digits (what Excel does) before applying R1.5; and the workbook writes the already-rounded value, so only one renderer rounds. Six half-boundary cases are regression-tested. |
| H5 | The snapshot was six independent statements. An expense created between two of them could appear in the figures but not in the set the documentation gate inspects — a workbook whose sheets disagree, for a month that should have been refused (R4.3). | **Fixed structurally.** The snapshot is read in one repeatable-read, read-only transaction, and this month's amounts are now *derived from* the expense rows rather than queried separately — so the summary sheet, the detail sheet and the gate are the same set by construction. |

## Medium

| # | Finding | Disposition |
|---|---|---|
| M1 | `desc(downloadedAt)` sorts `NULLS FIRST` in Postgres, selecting the unpinned row — the opposite of the stated intent. | **Fixed** (`desc nulls last`). |
| M2 | Every download read the organisation's entire `expense_documents` table and discarded ~97% in JavaScript; at R13.1's limits that is ~200k rows per download. | **Fixed** — scoped with `inArray` to the month's expenses. |
| M3 | The route had no error handling: a storage or generation fault produced Next's generic 500 page, in contrast to the carefully worded refusals beside it. | **Fixed** — faults are logged server-side and answered with actionable text. Rate limiting deferred (see below). |
| M4 | The workbook test's two sheets were built from different data, so the acceptance criterion that matters — the sheets reconciling — had no coverage and H5 would have shipped green. | **Fixed** — the fixture derives `amounts` from `expenses` exactly as the loader does, and an explicit test asserts the Detail total equals the summary's This Period. |
| M5 | `db:fixture -- docs` deleted **every** `expense_documents` row for whichever organisation Postgres returned first — capable of destroying a real org's evidence links and slamming the gate shut on every month. | **Fixed** — the delete is scoped to the fixture's own expenses, and the target organisation is chosen deterministically and printed before any write. |

## Low

| # | Finding | Disposition |
|---|---|---|
| L1 | Generation is a state-mutating `GET` and the session cookie is `SameSite=Lax`, so a third-party page could force generation and pinning. | **Fixed** — `Sec-Fetch-Site` is checked; cross-site requests get 403. Verified with both header values. |
| L2 | `encodeURIComponent` leaves `'` unescaped, and `'` delimits the RFC 8187 ext-value; filename length was unbounded, so a long upload name could produce a header a proxy rejects. | **Fixed** — full ext-value encoding plus a 120-character bound. |
| L3 | The merged section divider rows lacked the borders the spec puts on the whole table range. | **Fixed** — borders run the full merged span. |
| L4 | Money is written as `cents / 100`, so a cell holds 45641.119999999999; Excel's display rounding hides it. | **Accepted.** The code's own totals are exact — integers summed in cents and divided once — so the sheets agree; only a hand-written exact-difference formula could observe it. |
| L5 | `SnapshotDocument` omitted `sizeBytes`, which the data model names as part of the hash, and month documents omitted dimensions the packet will need. | **Fixed** — both carry sizes and dimensions now, ahead of the packet work depending on them. |

## Confirmed sound (do not re-litigate)

Formula injection is not exploitable: ExcelJS only emits a formula for `{formula: …}`, and
every user-controlled cell is additionally written through `textCell`. Sheet 1 and sheet 2
sum identical integer cents and divide once, so they agree arithmetically. Tenant isolation
is intact on every query and re-checked at the key prefix. `lte`/`lt` month comparisons
correctly exclude future months from both figures and hash. Header injection via filename is
covered.

## Deferred, with reasons

- **Rate limiting on the download route.** Generation is expensive and `isValidMonthKey`
  accepts ~1,200 months, so a signed-in user can loop them. The account is shared and
  trusted, and each empty month now costs one cheap indexed query rather than an org-wide
  scan (M2). Worth adding with the packet, where generation is far more expensive.
- **Single-flight advisory lock** (architecture, generation step 2). Concurrent builds now
  converge to one row and one object because outputs are deterministic, so the remaining
  cost is duplicated CPU, not incorrect data. Revisit for the packet, where a duplicated
  build is minutes rather than milliseconds.
