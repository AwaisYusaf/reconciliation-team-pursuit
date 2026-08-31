# Phase 2 — enhancements and fixes

Six changes requested by the client. **They are not independent**: one of them redefines what
"reimbursable" means, and three others report reimbursable totals. The order below is chosen so
that nothing is built twice.

**How each one is run.** One at a time, never in parallel, through the same five gates:

1. **Plan** — written into this file under that fix, before any code.
2. **Review the plan** — against the passing criteria and the edge-case list here.
3. **Implement.**
4. **Review the implementation** — adversarially, against the same lists, looking for what the
   plan missed rather than confirming it was followed.
5. **Verify the passing criteria**, then loop from (3) until every box is ticked.

A fix is not finished when the code works. It is finished when its passing criteria pass and the
February golden reference (`context/manual packet/`) still reconciles.

**Status:** F0, F1, F2 and F3 complete, all browser-verified. F4 (optional taxes and fees) is next. `Last reviewed: 2026-08-31.`

### Decisions already taken (2026-08-31)

| Ref | Question | Answer |
|---|---|---|
| **A1** | Where do the include-tax / include-fees defaults live? | **On the payment source / funder.** Set once per source; every expense inherits and can override. Matches the reason the feature exists |
| **A2** | Do completed months freeze? | **Yes — frozen at submission.** A stored snapshot; corrections to a closed month must be explicit and visible |
| **A3** | May we stamp the reference on supporting document pages? | **Ask the funder first.** F6 begins by producing a sample page and a written proposal, not by building |
| **A4** | Is "move between months" broken? | **To be verified by browser testing** — first task of F2 |

---

## The order, and why

| # | Fix | Why here | Depends on |
|---|---|---|---|
| **F0** | Regressions found while planning | Live defects in code F1 and F3 will edit — fix before building on top | — |
| **F1** | Remove the 20-file limit | Fully isolated — no domain rule changes, no document output changes | — |
| **F2** | Move expenses between months | **Largely already built.** Mostly verification plus one hygiene defect | — |
| **F3** | Recurring expense narratives | Additive. Touches the expense form, so it goes before F4 rewrites the same form | — |
| **F4** | Optional taxes and fees | **Redefines `reimbursableCents`.** Every total in the app and every generated document derives from it | — |
| **F5** | Monthly budget snapshots | Reports reimbursable figures — must be built against F4's final definition, not today's | F4 |
| **F6** | Final reconciliation packet structure | Prints category totals, monthly totals and remaining budget — needs both F4 and F5 settled | F4, F5 |

Doing F5 or F6 before F4 means building them against a definition of "amount" that F4 then
changes, and re-doing the generated-document conformance work a second time.

---

## Shared foundation — build once, before F4

Three things are needed by more than one fix and should not be invented twice:

- **A single money-shape type.** `reimbursableCents()` ([money.ts:88](../src/domain/money.ts)) takes
  `{subtotalCents, feesCents}` and `ExpenseAmount` ([budget-math.ts:16](../src/domain/budget-math.ts))
  declares the same two fields. F4 must widen both in one change, or the two definitions drift apart
  and the dashboard stops agreeing with the packet — which R10.2 currently guarantees *by
  construction*, not by discipline.
- **A month-scoped totals function** used by F5 and F6 alike, so the packet and the screen cannot
  print different numbers for the same month.
- **A regression harness for generated documents.** T1 in [TASKS.md](TASKS.md) is still open. F4, F5
  and F6 all change what gets printed; without a golden-file check, a conformance regression is
  invisible until a human opens the PDF. **Recommend building this before F4, not after.**

---

# F0 · Regressions found while planning — fix before anything else

These are not enhancements. Two were introduced by earlier work in this project and one is a
long-standing data-integrity gap. **F0 goes first because F3 and F1 both edit the exact code paths
involved**, and building on top of them would bury the defects.

### B1 — Adding a second recurring item to a month fails outright ⚠ **live, severity high**

`addRecurringToMonthAction` ([recurring/actions.ts:152](../src/modules/recurring/actions.ts)) inserts
an expense **without `referenceSeq`**, so it takes the column default `0`
([schema.ts:273](../src/db/schema.ts)). The unique index `expenses_org_month_reference_uq` on
`(org_id, month, reference_seq)` then rejects the next one.

Reproduced against the database (inside a rolled-back transaction):

```
1st recurring add  -> OK, reference_seq = 0   (should be 1+)
2nd recurring add  -> FAILS 23505 | expenses_org_month_reference_uq
   Key (org_id, month, reference_seq)=(…, 2099-01, 0) already exists.
```

Two consequences: **the recurring feature is unusable for any month needing more than one item**, and
the one that does succeed is numbered `YYYY-MM-000` when references are specified to start at 1
(R2.6). Introduced with the reference counter; the recurring insert was never switched over to
`claimReferenceSeq`. Any expense already saved with `reference_seq = 0` needs backfilling.

- [x] `addRecurringToMonthAction` calls `claimReferenceSeq`, like every other insert path
- [x] Adding recurring items to one month succeeds, numbered consecutively from 1 — proven at the
      database level in `references.integration.test.ts`
- [x] Existing `reference_seq = 0` rows are backfilled by migration 0008, proven against a synthetic
      bugged month (row at 0 alongside 1 and 2 → renumbered to 3, counter advanced to 4)
- [x] A regression test covers two claims into the same month — the case that failed
- [x] **Structural fix**: the column default is gone, so omitting the reference is a type error
      (D-63). This is what caught a *third* broken insert path, `db/dev-fixture.ts`, which numbered
      a whole month at 0 and would have failed on its second row
- [x] The fixture numbers from the month's live counter, so a month emptied by deletions does not
      reissue references (R2.6) — proven: counter at 18 → rows 18..57, counter 58

**Done.** 481 tests pass (7 new, against a real database), lint and typecheck clean.

### B2 — The storage quota is measured against the wrong number

`orgStorageError` is called with `input.file.size` — the size *before* inspection — while the row
stores `inspection.body.byteLength` ([documents.ts:138, :178](../src/services/storage/documents.ts)).
HEIC→JPEG normalisation changes that value, so the running total drifts from what was actually
charged. F1 raises this cap, which makes the drift matter more.

- [x] Quota is checked and stored against the same number — the check moved after inspection and
      now takes `inspection.body.byteLength`, in **both** ingest paths
- [x] The drift is proven real, not theoretical: a WebP measured 3,492 bytes uploaded and 11,539
      stored — the org was charged **under a third** of what the file consumes. Direction is
      systematic for every re-encoded type (HEIC, WebP)
- [x] The arithmetic is unit-tested without a database (`storageQuotaError` split out of
      `orgStorageError`), including the exact-cap boundary and the already-over case
- [x] **A real regression test**, after the review pointed out that the unit tests would all have
      passed with the bug still in place — they exercised arithmetic that was never wrong. The
      integration test fills an organisation to a headroom set *between* a file's uploaded and
      stored sizes, so the upload fits on the number the old code measured and does not fit on the
      number it stored. Verified by reintroducing the bug: the test fails, then passes again

**Done**, after an agent review found three things the first attempt missed:

- [x] **The quota was still raced.** The first fix moved the check but left it *outside* the lock B3
      had just added — the very thing this file warned about ("a byte-based cap inherits this and is
      worse"). The check now runs inside the transaction, and the lock was re-keyed from the parent
      to the **organisation**, because the 500 MB cap is org-wide: two uploads to different expenses
      race on it just as readily as two to the same one
- [x] **A full organisation is rejected before inspection again.** Moving the only check after
      inspection meant an at-cap org paid a full sharp decode — up to `MAX_PIXELS`, ~240–320 MB of
      raster — before being told no. There is now a cheap `used >= cap` early-out, which is safe
      because a stored file is never zero bytes, so "already full" can never become "fits"
- [x] **Error precedence restored.** With the early-out, a user at 499/500 MB uploading a damaged
      file is told the organisation is full — the blocker that applies to *every* subsequent upload
      — rather than being sent to re-export a file that would not have fit anyway
- [x] **The same bug, still live one line away**: `precheck` compared the 25 MB per-file cap against
      the *uploaded* size only. WebP→JPEG grows ~1.4×, so a 24 MB WebP passed and landed ~35 MB in
      the bucket — and `size_bytes` is the size the UI shows, beside copy promising 25 MB. The cap is
      now re-applied to the stored length (R13.2)
- [x] A missing organisation row no longer throws a 500 out of the quota query

### B3 — Count-then-insert race on the per-expense cap

The cap is read and then inserted against with no transaction, unique constraint or DB-level check
([documents.ts:130](../src/services/storage/documents.ts)). Two concurrent uploads both read 19 and
both insert. **A byte-based cap inherits this and is worse** — a single file can overshoot by up to
`MAX_UPLOAD_BYTES` (25 MB). F1 must fix the race, not port it.

- [x] The cap is enforced where it cannot be raced — the count and the insert now happen inside one
      transaction under a `pg_advisory_xact_lock` keyed on the parent (the expense, or the
      org+month). A row lock was not usable: month documents have no single parent row, and locking
      `organizations` would contend with unrelated writes such as the active-month change
- [x] Concurrent uploads cannot exceed it — proven by driving the real `ingestExpenseDocument` with
      40 simultaneous uploads against a real database and the local storage driver: exactly 20 are
      admitted, the other 20 are refused with a message
- [x] **The test is proven to catch the bug**: with the lock removed it fails, with it restored it
      passes. A concurrency test that passes either way is worthless
- [x] Racing uploads no longer collide on `sort_order` — it comes from the same locked read. Packet
      document order is defined by it, so the old code made that order non-deterministic (R10.1)
- [x] An upload refused *after* its bytes were written takes them back out, rather than leaving the
      organisation charged for an object no row points at

**Done.**

---

### B4 — Thumbnail bytes are stored but never counted · *found while fixing B2*

Every **image** upload writes two objects: the normalised document and a thumbnail
([inspect.ts:144](../src/services/storage/inspect.ts), null for PDFs). Only the document's length
reaches `size_bytes`, and `orgStorageError` sums that column — so **thumbnails occupy the bucket
without ever being charged.**

Not folded into B2 on purpose: counting them means either inflating `size_bytes` (which is also the
displayed file size and part of the artifact cache key) or adding a column. The right place is
**F1**, where the caps are being reworked anyway. Recorded here so it is not lost.

**Drift, measured** at the real settings (320 px, q70):

| Upload | Stored | Thumbnail | Uncounted |
|---|---|---|---|
| 4032×3024 phone photo | 8.55 MB | 6.3 KB | 0.1% |
| A4 300 dpi scan, mostly white | 191 KB | 9.8 KB | 5.1% |
| 800×600 flat PNG screenshot | 2.9 KB | 6.0 KB | **212%** |

A 500 MB cap filled with phone photos overshoots by under 0.5%; filled with small screenshots it
overshoots by roughly **14%**. Bucket usage is always ≥ what the database claims, never less.
**F1 removing the count cap makes the small-file case reachable**, which is what turns this from
academic into real.

- [x] **Done as part of F1.** `expense_documents` and `month_documents` gained a `thumbnail_bytes`
      column (migration 0009); every upload records it and the org quota sums `size_bytes +
      thumbnail_bytes`. Historical rows read 0 — the thumbnails exist in the bucket but their sizes
      were never recorded, and recovering them would mean listing it

---

# F1 · Remove the 20-file upload limit

> Please remove or significantly increase the 20 file upload maximum for an individual expense or
> category. Transportation is a good example — more than 20 Lyft or Uber transactions may belong to
> the same expense category. If there must be a technical limit, it needs to be substantially higher
> and based on total file size rather than a low number of individual files.

### What exists today

| Limit | Value | Where |
|---|---|---|
| Files per expense | **20** | `MAX_DOCUMENTS_PER_EXPENSE` ([documents.ts:36](../src/services/storage/documents.ts)) |
| Month documents per month | 50 | `MAX_MONTH_DOCUMENTS` |
| Storage per org | 500 MB | `MAX_ORG_BYTES`, enforced in `orgStorageError()` |
| Any single file | 25 MB | `MAX_UPLOAD_BYTES` ([keys.ts:27](../src/services/storage/keys.ts)) |
| Accepted types | jpg/png/webp/heic/pdf | `ALLOWED_MIME_TYPES` |

All four are codified as **R13.1 / R13.2** in [domain-rules.md](01-domain/domain-rules.md), so the
rulebook changes in the same commit as the code.

### The real constraint is not the count

The limit that actually bites is packet assembly, not the number 20. Every uploaded page is
rasterised to a JPEG and embedded as one packet page ([packet-pdf.ts](../src/generation/packet-pdf.ts)).
The pipeline is already written to stream page-by-page so peak memory is one page — but total build
time, output size and the size-downgrade ladder all scale with page count, on an instance that also
hosts Postgres.

**So: raising the count is correct, and raising it alone is not enough.** 60 Uber receipts are tiny
(≈ 60 × 100 KB). 60 multi-page scanned PDFs are not.

### Phases

- **F1.1 — Replace the count cap with a byte cap per expense.** Delete
  `MAX_DOCUMENTS_PER_EXPENSE`; add a per-expense total-bytes cap. Keep a very high count cap purely
  as a runaway guard (a bug uploading in a loop), not as a product limit.
- **F1.2 — Raise the org cap** and make its error message state the real numbers.
- **F1.3 — Cap total *pages* per expense, not just bytes.** This is the one that protects packet
  generation. Page counts are already recorded per document (`expenseDocuments.pageCount`), so the
  check is available at attach time.
- **F1.4 — Make the upload UI survive many files**: the document list must stay usable at 60+ rows,
  and the packet-page estimate ([page-estimate.ts](../src/generation/page-estimate.ts)) must still be
  accurate.
- **F1.5 — Update R13.1/R13.2** and the architecture doc's per-org caps line.

### Passing criteria

- [x] 60 files attach to a single expense without error — measured at **2.7 s for 68.8 MB**
- [x] A packet containing that expense builds, and every page appears in order — **63 pages**
      (3 generated + 60 uploads), verified by page count and by the ordering tests
- [x] Build time and peak memory **measured, not assumed** — see below
- [x] The byte/page budget rejects with a message naming the real limit and what to do about it
- [x] The org cap still blocks at its threshold with its explanatory message (R13.1 soft cap)
- [x] `page-estimate.ts` untouched and still passing — the cover sheet layout did not change
- [x] R13.1 and R13.2 rewritten (D-65); the count survives only as a runaway guard at 500

### Measured, on 60 photo-like receipts (1200×1600 JPEG, noise-filled so nothing compresses away)

| | |
|---|---|
| Attach, 60 files / 68.8 MB | 2.7 s |
| Packet | **63 pages, 73.1 MB** |
| Build time | 14.3 s |
| RSS during build | 234 MB → 425 MB (**+191 MB**) |

**Both numbers matter, and one is a problem.**

The memory claim in `packet-pdf.ts` — "peak usage is one page of image data rather than a whole
packet" — is true of *rasterisation* but not of assembly: pdf-lib holds the whole document before
`save()`. +191 MB on an instance that also runs Postgres and a second service is real.

**The packet ceiling, not the expense budget, is now the binding limit.** `MAX_PACKET_BYTES` is
25 MB for DocuSign, and this packet is 73 MB. `buildDeliverablePacket` walks all three rungs of
`RASTER_LADDER` before giving up — **three full builds, ~30 s** — and then delivers over the ceiling
with a warning anyway. Roughly 20 photo pages fit under 25 MB at 150 dpi, or ~50 at the bottom rung.

So raising the per-expense cap is right and is what was asked, but it does not make a 200-receipt
month submittable — it moves the wall from "the platform refuses your evidence" to "the packet is
too big for DocuSign". **That is a better failure** (nothing is lost, and the warning is honest),
but it is a wall, and it belongs in the F6 conversation. Recorded as **Q24**.

### Edge cases that must not be missed

- A 60-page **PDF** counts as 60 packet pages but one file — a count cap never saw this.
- The org cap sums `expense_documents + month_documents` and **excludes generated artifacts** on
  purpose; do not accidentally start charging orgs for their own packets.
- The 25 MB single-file cap and the new per-expense cap must not contradict each other.
- The packet size ladder (`MAX_PACKET_BYTES` / `RASTER_LADDER`) is **not in the artifact cache key**
  — see R2 in [TASKS.md](TASKS.md). Re-tuning quality here without bumping `GENERATOR_VERSION`
  serves stale bytes forever.
- The client has **no knowledge of already-attached bytes**, so a user can queue 40 MB against a
  30 MB remainder and only discover it on save, one sequential POST at a time.
- The presign **rate limit is 60/min per org** and fires before any size cap, aborting a large
  queue mid-flush with a 429. Fine at 20 files; bad at 60.
- A null `page_count` means inspection never finished. `rasterizePdf` guards with
  `if (expectedPages && …)`, so a falsy value **silently skips page-count verification** — the check
  that catches a truncated PDF.
- Pinned artifacts are never collected and are deliberately excluded from the org sum, so **real
  bucket usage exceeds counted usage without bound** as months accumulate.
- A cover-sheet failure throws with nothing cached, so Retry restarts the **entire** packet build —
  and there is still no single-flight lock (R1 in [TASKS.md](TASKS.md)).

### Open questions

- **Q1.** The numbers were chosen without waiting on an answer, and are one-line constants: **200 MB
  and 300 pages per expense, 5 GB per organisation.** 60 rideshare receipts use ~69 MB and 60 pages,
  so there is roughly 3× headroom. Tell me the realistic worst case and I will retune.
- **Q24 (new).** A month whose evidence genuinely exceeds 25 MB cannot produce a DocuSign-sized
  packet. Options: accept the oversize warning and submit anyway; split the packet by category;
  or lower the raster floor further at a cost in legibility. This needs the funder's actual
  constraint, and it belongs with F6.

---

# F2 · Move expenses between months

> Expenses entered into the wrong month need to be movable without deleting and recreating. From the
> expense screen, change the Month and Year dropdown, save, and the complete expense moves —
> receipt, proof of payment, narrative, description, budget category, taxes and fees, transaction
> identifier. Currently we have to delete the expense and rebuild it.

### ⚠ This is already implemented

Before planning any work, note what the code does today:

- **R2.2** already states the month is *"editable from the expense form"*.
- The form renders a Month `<Select>` ([expense-form.tsx:397](../src/modules/expenses/expense-form.tsx)).
- `updateExpenseAction` detects `movedMonth` and reassigns the reference from the destination
  month's counter ([actions.ts:240](../src/modules/expenses/actions.ts)) — exactly as **R2.6** and
  **D-61** specify.
- Documents are linked by `expenseId`, not by month, so they follow the expense automatically.

**So the first task is not to build this — it is to find out why you are seeing something different.**
The most likely explanation: **production is running older code.** S1 in [TASKS.md](TASKS.md)
("deploy the latest changes") is still open, and the reference/move work landed after the last
deploy.

### The one genuine defect

S3 keys embed the month: `org/{orgId}/months/{YYYY-MM}/expenses/{expenseId}/…`
([keys.ts:37](../src/services/storage/keys.ts)). `expense_documents` has **no month column** — the
key is a frozen string written at upload.

A moved expense therefore leaves its files under the **old month's prefix**. Retrieval still works,
because `keyBelongsToOrg()` only validates the org segment — so this is a hygiene and
lifecycle-policy problem, not a data-loss one. It matters for anything that reasons about storage by
month prefix (lifecycle rules, orphan sweeps, per-month accounting).

### Phases

- **F2.1 — Reproduce.** Confirm on the deployed instance whether the Month dropdown is present and
  whether saving moves the expense. Record the answer here. **Everything below depends on this.**
- **F2.2 — If it is a stale deploy:** deploy, re-verify, close the item. No code change.
- **F2.3 — If the dropdown is present but the destination month is missing from it:** the edit page
  builds its list from `monthWindow([expense.month, session.activeMonth])`
  ([edit/page.tsx:58](<../app/(app)/expenses/[id]/edit/page.tsx>)) — which does **not** include the
  contract months that the header selector gained on 2026-08-31 (D-62). Feed it the same list.
- **F2.4 — Decide the S3 key policy** (see Q2) and implement.
- **F2.5 — Invalidate the artifact cache for both months.** A move changes the contents of the
  source month *and* the destination month; both cached packets are now stale.

### Passing criteria

- [x] An expense with a receipt, a narrative, a note, a description, a line item, tax and fees moves
      months in one save — covered by an integration test against a real database
- [x] Attached documents follow by foreign key and keep their page counts
- [x] The reference is reissued from the destination month's counter, and the source month's number
      is **not** reused (R2.6/D-61) — asserted in the same test
- [x] **The destination month's list now offers every month the header does.** The form built its
      own narrower list, so D-62's contract months never reached it: a month you could *view* was
      not necessarily one you could move an expense *into*. Both now call `loadSelectableMonths`
- [x] **Moving into a submitted month now warns.** The R10.6 banner was resolved server-side for
      the source month and never re-evaluated, so moving *into* a submitted month said nothing and
      moving *out* warned about a month the expense was leaving
- [x] **The budget projection follows the dropdown.** R3.7 was computed for the source month only,
      so picking another month left the projection describing the wrong month's budget — and it no
      longer credits back the saved amount once the expense leaves its own month
- [x] Cached artifacts need no explicit invalidation — verified rather than assumed: both months'
      snapshots change, so their `inputsHash` changes and the next download rebuilds. Pinned rows
      are untouched, which is correct (R10.6: they are the record of what was actually sent)
- [x] **Browser confirmed** (Chrome, logged-in session, 2026-08-31). Created an expense in August
      2026 with a description, narrative, tax and fees; changed Month to December 2026; saved. It
      left August (list empty), arrived in December, and its reference was reissued **2026-08-002 →
      2026-12-001**. Narrative, description, line item, payment source, tax and fees all survived,
      and August's counter stayed at 3 — the number it held was not reissued (R2.6)
- [x] The header's month dropdown reaches **June 2027** and groups by year, confirming D-62 in the
      running app rather than only at the data level

### Edge cases that must not be missed

- Moving an expense **out of a submitted month** — the packet the funder already received no longer
  matches what the system holds. The pinned artifact preserves what was sent (R10.6/D-21), but the
  behaviour must be deliberate.
- Moving an expense **twice** — it must not accumulate references or leave a dangling counter.
- Moving to a month **outside the selector's list** entirely.
- Two expenses moved into the same month concurrently — the counter is atomic, so this should hold;
  it needs a test proving it.
- A move must not renumber *other* expenses in either month.
- **The R10.6 submitted-month banner is resolved server-side for the source month at page load and
  never re-evaluated when the Month select changes** — so moving *into* a submitted month warns
  about nothing, and moving *out* warns about a month the expense is leaving.
- **The live remaining-budget projection (R3.7) is computed for the source month only.** Pick a
  different month and the projection silently describes the wrong month's budget.
- **Move-then-move-back is not idempotent**: the original number was spent and is never reissued, so
  returning an expense to its original month yields a *third* number. D-61 accepts renumbering but
  does not address the round trip (Q17).
- `claimReferenceSeq` runs **before** the UPDATE and outside any transaction. If the UPDATE then
  matches zero rows (concurrent delete) the counter has already advanced — a burned number, and a
  possibly-created `month_statuses` row.
- `sortOrder` comes from `max+1` over live rows while `referenceSeq` comes from a never-reused
  counter. The packet body orders by `sortOrder`, the index by `referenceSeq` — **after enough moves
  and deletes the index order and the body order diverge.**
- **`recurring_item_id` travels with the expense.** The source month's recurring row flips back to
  "not added" and the destination shows "✓ Added" though nobody clicked it there — and Remove in the
  destination treats it as its own and deletes it (Q18).
- `validate` only checks `isValidMonthKey`, so a crafted request reaches any month 1900–2999. The
  dropdown is a convenience, not an enforcement boundary.
- `month_documents` (bank statements) belong to the month, not the expense, and must **not** move.

### Found during the browser test

- **A defect I introduced, caught by running it.** Making the projection follow the Month dropdown,
  I credited the saved amount back only when the month was *unchanged*. But `remaining(M)` counts
  every month up to and including M, so an expense saved in an **earlier** month is already inside
  the destination's figure — moving August → December counted it twice and showed **$19,743.00**
  where $19,871.50 was right. The condition is now "source month ≤ target month", which also keeps
  a backward move from inventing budget that does not exist. Only a real move surfaced this: every
  test passed, and both numbers looked plausible.
- **Q25.** After a move, the app returns to the **source** month's list, where the expense has just
  vanished. It reads like a deletion. Should it follow the expense to the destination month, or say
  where it went?
- **Q26.** The header's month dropdown is grouped by year; the expense form's is a flat list. Same
  data, two renderings. Worth unifying when the list gets long.

### Open questions

- **Q2 — proceeding on the safe default until you say otherwise.** Keys are left as they are and
  treated as an **immutable address**: the row is the lookup, the file route resolves by document
  id, and `keyBelongsToOrg` validates only the organisation segment — so nothing reads the month out
  of a key. Copying would buy tidier prefixes at the cost of a copy, a delete, and a window where
  both exist. The one thing it would help is per-month lifecycle rules, which do not exist yet.
  Say the word and I will switch it.
- **Q3.** What exactly do you see today on the edit screen — no Month dropdown at all, or a dropdown
  that does not contain the month you want?

---

# F3 · Recurring expense narratives

> Recurring expenses carry forward without making it easy to maintain the narrative. When creating or
> saving a recurring expense we need to save: expense name, description, narrative, budget category,
> other recurring information. When it recurs the following month the narrative should populate
> automatically and remain editable. We should not have to go back to the previous month and copy and
> paste it.

### What exists today

`recurring_items` ([schema.ts](../src/db/schema.ts)) stores **only**:
`name`, `amountCents`, `lineItemId`, `defaultDescription`, `sortOrder`.

**There is no narrative field.** Narrative lives on the expense row and is printed on the cover
sheet as a paragraph (R6.6, [cover-sheet-spec.md:28](02-outputs/cover-sheet-spec.md)). So the client's
description of the problem is exactly right.

### The complication: there are now two memory systems

`vendor_defaults` was added recently and *also* remembers per-payee values —
`defaultLineItemId`, `defaultDescription`, `defaultPaymentSource`, `defaultSubtotalCents`,
`defaultTaxCents`, `defaultFeesCents` — learned automatically on every save (R8.1–R8.2).

`recurring_items` is explicit and user-managed; `vendor_defaults` is implicit and learned. They
overlap on name, line item and description, and after this change they would overlap on narrative
too. **Deciding how these two relate is the main design question in F3, not the column itself.**

### Phases

- **F3.1 — Decide the relationship** between recurring items and vendor defaults (Q4). Record as a
  decision entry.
- **F3.2 — Add the missing columns** to `recurring_items`: narrative, and whatever else Q5 settles
  (payment source, tax/fees). Migration with a backfill for existing rows.
- **F3.3 — Carry them through "Add to <Month>"** so a generated expense arrives pre-filled and fully
  editable.
- **F3.4 — Write back on save**, so editing this month's narrative updates the template for next
  month — this is the half that stops the copy-paste loop. Needs Q6.
- **F3.5 — Update m05 and R8.3.**

### Passing criteria

- [x] A recurring item stores name, description, **narrative**, line item, payment source, tax and
      fees (migration 0010)
- [x] "Add to <Month>" produces an expense with all of them pre-filled — verified in the browser and
      in the database: narrative, description, payment source and $7.20 tax all carried
- [x] Every pre-filled field is editable before saving
- [x] Correcting the narrative on a generated expense **updates its template**, and only its own:
      editing Canva's left ClickUp's untouched. Verified end to end in Chrome
- [x] A blank narrative never clears the template — proven for `null`, `""` and whitespace
- [x] A hand-entered expense (no template id) never rewrites a template
- [x] Another organisation's template cannot be written to
- [x] Recurring and vendor autofill do not fight: narrative lives only on the curated template, so
      the vendor library's latest-write-wins learning cannot wipe it (D-66)
- [x] **Two recurring items added to one month now both succeed** — the B1 case, clicked through in
      the browser rather than only asserted

**Done.**

### Edge cases that must not be missed

- **A stale narrative is worse than no narrative.** "January outreach event" printing on a June cover
  sheet is a document defect the funder sees. Whatever Q6 decides, the risk must be handled.
- Vendor autofill currently fires on the payee name — a recurring-generated expense must not have its
  narrative overwritten by it.
- A narrative long enough to change the cover sheet's page count (`page-estimate.ts`).
- Narrative text is user input that reaches a generated document: it must go through the same
  escaping and `winAnsiSafe` handling as every other printed string.
- **If narrative goes into the vendor library, `learnVendor` runs on every save with latest-write-wins
  (R8.2) — so one expense saved with a blank narrative wipes the remembered paragraph for that
  payee.** This is the single most likely way to lose the client's work.
- `note` is **not** narrative: R6.5's inline note is combined with the automatic tax note (D-22).
  Carrying it forward on the same path would put a stale note beside the tax note.
- A recurring add deliberately creates a documentation-incomplete expense (R4.5) and must **stay**
  blocked by the R4.3 gate. Carrying more fields forward must not make it look complete.
- Description is a **snapshot at add time** — editing the template does not touch expenses already
  created. Narrative inherits that silently unless Q19 decides otherwise.
- The recurring form's description is a single-line `Input`; narrative is a 3-row `Textarea`. The
  control has to change with the data, or a paragraph gets typed into a one-line box.
- Null vs empty string differs across the four tables involved (`narrative` nullable, `description`
  notNull `''`, `default_description` nullable). The existing fallback chain will misbehave on `''`.
- U2 in [TASKS.md](TASKS.md) is an open defect on this exact screen: `add()` flashes the row green
  **before** awaiting the action, so a failed add still looks like it worked — which is precisely how
  B1 above stayed invisible.

### Open questions

- **Q4 — answered: stay separate** (D-66). They answer different moments; the template wins on "Add to month". Original question: should recurring items and vendor defaults **merge** into one "remembered values" concept,
  or stay separate with a clear precedence rule? Two systems remembering the same fields will
  eventually disagree.
- **Q5 — answered: payment source, tax and fees.** Original question: beyond narrative, which fields should a recurring item carry? You listed "other recurring
  information" — my proposal is payment source and the tax/fee amounts and their F4 flags.
- **Q6 — answered: it updates the template**, but only from an expense created by it and only when non-empty; clearing is done on the Recurring screen. Original question: should editing the narrative **update the template** for
  next month, or only that one expense? Auto-updating is what removes the copy-paste, but it also
  means a one-off edit silently changes every future month.

---

# F4 · Optional taxes and fees

> Different funding sources have different reimbursement requirements. The City may reimburse the
> base expense but not taxes or certain service fees, while another funder may allow the entire
> amount. For each expense we need: base expense amount, tax amount, fee amount, total receipt
> amount, an *Include in Reimbursement* option for taxes, and one for fees. The system should
> automatically calculate the eligible reimbursement. The original receipt and proof of payment
> should still remain attached.

### This is the largest change of the six

It rewrites a domain rule that everything else reads:

> **R1.3** Reimbursable amount = subtotal + fees. Tax is captured but excluded — the funder does not
> reimburse sales tax. **All "amount", "spent", "billed" figures in the system mean reimbursable
> unless explicitly labeled.**

That last sentence is why this is not a form change. One function
([`reimbursableCents`](../src/domain/money.ts)) feeds:

- the expenses table and the live budget projection (R3.7)
- `lineItemStats` → dashboard, contract summary (R3.1–R3.5)
- the cover sheet rows and totals
- the packet's expense index and summary page
- the Excel workbook
- the gate/readiness logic

`ExpenseAmount` in [budget-math.ts:16](../src/domain/budget-math.ts) currently declares only
`subtotalCents` and `feesCents` — **it cannot even see tax today.**

### Phases

- **F4.0 — Build the generated-document regression harness first** (see Shared foundation). Without
  it, the conformance risk in this change is uncontrolled.
- **F4.1 — Schema**: two boolean flags on `expenses` (tax reimbursable, fees reimbursable).
  Migration must backfill existing rows to **today's rule** — tax excluded, fees included — so no
  historical figure moves. Non-negotiable.
- **F4.2 — Domain**: widen `reimbursableCents` and `ExpenseAmount` together, in one change. Add a
  total-receipt helper. Rewrite R1.3 and add the new rules.
- **F4.3 — Defaults**: settle Q7, then implement. Per-expense-only means re-ticking on every expense.
- **F4.4 — Form**: the four amounts plus two toggles, with a live eligible-reimbursement readout and
  a total-receipt figure.
- **F4.5 — Read paths**: table, dashboard, contract summary, projection.
- **F4.6 — Generated documents**: cover sheet, packet index, packet summary, Excel. Each verified
  against the February golden reference.
- **F4.7 — Vendor defaults and recurring items** learn the flags too.

### Passing criteria

- [ ] Every existing expense's reimbursable amount is **byte-identical** before and after the
      migration.
- [ ] An expense with tax included reimburses subtotal + tax + fees; with fees excluded,
      subtotal only; all four combinations proven by unit tests.
- [ ] Total receipt amount = subtotal + tax + fees always, regardless of flags, and is what the
      receipt shows.
- [ ] Dashboard, contract summary, cover sheet, packet index, packet summary and Excel all show the
      **same** figure for the same month (R10.2).
- [ ] The February packet regenerates identical to the golden reference.
- [ ] Negative amounts (refunds, R1.4) still net correctly with flags in play.
- [ ] Receipt and proof of payment remain attached and unchanged — the client asked for this
      explicitly.
- [ ] R1.3 rewritten; every doc quoting "subtotal + fees" updated.

### Edge cases that must not be missed

- **The migration is the highest-risk step in all of Phase 2.** A wrong default silently restates
  every historical figure, including months already submitted to the funder.
- A **submitted** month whose expenses' flags are later changed — the pinned artifact still holds
  what was sent, but the screen will now disagree with it.
- Refunds with tax (R1.4).
- Rounding: percentages are half-away-from-zero in one place (R1.5) — a new denominator must not
  introduce a second rounding path.
- The Excel workbook writes user text as string cells, never formulas — a new column must not break
  that rule.
- The cover sheet's three-column layout is **funder-approved and must not gain a column** (R2.6,
  D-61 context). Where does an excluded-tax expense's arithmetic get explained?
- `page-estimate.ts` constants drift if the cover sheet gains any row or line.
- **The R6.5 tax note becomes a lie.** It reads *"(Note: Statement includes tax which was excluded
  from reimbursement amount)"* and fires purely on `taxCents > 0`. With tax included, that false
  statement prints on a document submitted to the funder. D-22 ("the tax note is always appended")
  needs an explicit amendment (Q20).
- **`loadExpenseAmounts` and the `priorAmounts` query do not select `taxCents` at all.** Miss either
  and the dashboard, contract summary and Excel keep excluding tax while the cover sheet includes it
  — breaking the R10.2 "they always agree" invariant in the least visible way possible.
- **`expense-form.tsx` re-implements the rule inline** (`subtotalCents + fees`) instead of calling
  `reimbursableCents`. Change only `money.ts` and the live "Reimbursable amount" box and the R3.7
  projection show a different number from the saved record.
- The R12 canonical string `reimburse-hint` — *"Sales tax is excluded. The funder does not reimburse
  it."* — is shown unconditionally and becomes sometimes-false. R12 is the authority for printed
  strings, so it changes in the same commit.
- **Flags are historical.** Flipping "include tax" on a February expense changes `previouslyBilled`
  for every later month, and pinned artifacts are never regenerated — so an already-downloaded packet
  will disagree with the live figures.
- Turning the tax note off changes the notes array length, which feeds `estimateCoverSheetPages` —
  page estimates shift for months where nothing else changed.
- Adding fields to `SnapshotExpense` changes `inputsHash` for **every** month, causing a one-time
  regeneration of all non-pinned cached artifacts. Harmless, but it will look like a mass cache miss
  in production.
- The Excel detail sheet prints `Subtotal | Tax | Fees | Reimbursable` with **no record of which
  components were included**, so two rows with identical numbers and different flags are
  indistinguishable to a reviewer reconciling column I against F+G+H (Q21).
- Recurring one-click add writes only `subtotalCents` — `recurring_items` has no tax, fees or flag
  columns, so those expenses always land on the column defaults.

### Open questions

- **Q7.** Where does the default live? Options: (a) per expense, always ticked the same way;
  (b) per **payment source / funder** — since you framed it as *"different funding sources have
  different requirements"*, this looks right, and would set itself; (c) per line item. **(b) is my
  recommendation** — it matches the reason the feature exists and stops it being a per-expense chore.
- **Q8.** Is "total receipt amount" **entered** by the user and checked against subtotal+tax+fees
  (catching typos), or purely **derived** and displayed? Entered is more work and catches real
  mistakes.
- **Q9.** When tax is excluded, must the cover sheet or packet **show** the excluded amount so a
  reviewer can see why the reimbursement is less than the receipt? The approved cover sheet layout
  cannot gain a column, so this likely belongs on the index page.
- **Q10.** Should changing a flag on an expense in a **submitted** month be blocked, warned, or
  allowed silently?

---

# F5 · Monthly budget snapshots

> When May is completed we need to see exactly where every budget category stood at the end of May.
> When we move into June, June's activity should begin as its own reporting period instead of May's
> monthly numbers appearing to roll into June. Each month should show opening budget balance,
> expenses for that month, remaining balance at month end. Plus a separate overall grant view:
> original approved budget, total spent to date, total remaining.

### Most of the maths already exists

`lineItemStats` ([budget-math.ts](../src/domain/budget-math.ts)) already returns, per line item per
month, exactly the shape asked for:

| Requested | Existing field | Rule |
|---|---|---|
| Opening budget balance | `previouslyBilledCents` | R3.1 |
| Expenses for that month | `spentThisMonthCents` | R3.2 |
| — | `totalBilledCents` | R3.3 |
| Remaining at month end | `remainingCents` | R3.4 |

**So this is mainly a presentation problem, plus one real architectural question.**

### The architectural question: derived or frozen?

Every figure is **recomputed from expense rows on every render**. There is no stored snapshot.

That means: if someone edits a May expense in June — or **moves one into May (F2)** — May's "closing
balance" changes retroactively. The month-end figure is therefore not a record of where things stood
at month end; it is a record of where they stand *now, given today's data*.

For bookkeeping, that is usually wrong. The client's phrasing — *"exactly where every budget category
stood at the end of May"* — reads like they want the frozen meaning.

There is already a `month_statuses.submittedAt` marker and a pinned-artifact mechanism (R10.6, D-21)
that preserves what was actually sent. That is the natural anchor for a real snapshot.

### Phases

- **F5.1 — Settle Q11** (frozen vs derived). Record as a decision. Everything else follows.
- **F5.2 — If frozen:** persist a per-month, per-line-item snapshot written at submission, with an
  explicit path for correcting a closed month.
- **F5.3 — Separate the two views** in the UI: a month view (opening / this month / closing) and a
  cumulative grant view (approved / spent to date / remaining). The client's complaint is that these
  are currently mixed.
- **F5.4 — One shared totals function** for screen, Excel and packet, so R10.2 keeps holding.
- **F5.5 — Update R3.x and m01/m07.**

### Passing criteria

- [ ] The month view shows opening, this-month and closing per category, and they reconcile:
      `opening + thisMonth = closing side of totalBilled`, `remaining = scheduled − totalBilled`.
- [ ] The grant view shows approved budget, spent to date, total remaining, and never mixes in a
      single month's figures.
- [ ] Both views agree with the packet and the Excel workbook for the same month (R10.2).
- [ ] Per Q11: a closed month's figures either **provably do not move** when a past expense is
      edited, or move with a visible, deliberate indication.
- [ ] Moving an expense between months (F2) updates both months' figures correctly.
- [ ] A month with no expenses renders sensibly rather than blank or zero-divided (R3.5, R3.6).
- [ ] Overspend (negative remaining) renders per R3.6, and never inside a generated document.

### Edge cases that must not be missed

- **A line item created mid-grant** has no history in earlier months — its opening balance must be
  right, not zero-by-accident.
- **A line item deleted mid-grant** with expenses already billed against it (R9.3).
- `openingBilledCents` is a **setup figure entered by hand** and is still a placeholder in production
  (C1 in [TASKS.md](TASKS.md)) — every snapshot inherits its correctness.
- Changing a line item's scheduled value mid-grant retroactively changes every month's remaining.
- F4 changes what "spent" means — this is why F5 comes after it.
- **Editing `opening_billed_cents` shifts every month's opening and closing at once** (R9.4). A
  snapshot invalidated only by expense writes would never notice.
- A line item **created after** month M still appears in M's summary at $0.00, because the budget
  query has no time filter — so a snapshot taken later contains a row the submitted document never
  had.
- A line item with zero expenses but a nonzero opening balance **can** be deleted (R9.3 only blocks
  when expenses reference it), which changes every past month's base.
- **Refunds are legal negatives (R1.4)**, so a month's spend can be negative and `closing(M)` can
  exceed `closing(M+1)`. Snapshot invariants must not assume monotonic growth.
- **Months need not be contiguous** — the free month picker reaches any month, so a back-entered
  month can precede every existing one. An opening-balance chain cannot assume M−1 exists.
- **The performance grant and advances-received figures have no month dimension at all** — they are
  hand-maintained running totals (R7.2, R7.4). Freezing the reconciliation block means asking the
  client for figures they have never kept per month (Q22).
- The generators read inside an explicit `repeatable read, read only` transaction so the gate and the
  figures see one instant (D-35). **A snapshot write path needs equivalent isolation** or it persists
  a torn month.
- **Unmarking a month as submitted is a plain null-out.** If submission is the freeze trigger, unmark
  needs a defined semantic: discard, keep, or refuse (Q23).
- Deletes are hard with no audit trail (D-25), so a snapshot written lazily on first read captures
  the post-deletion state and presents it as history.
- A snapshot must store **cents, not rounded percentages**, or a recomputed figure and a frozen one
  will disagree at the rounding boundary (R1.5).

### Open questions

- **Q11.** Should a completed month's numbers **freeze** (a stored snapshot, corrections explicit and
  visible), or keep recomputing so a late correction flows through automatically? This is the single
  most consequential decision in Phase 2.
- **Q12.** What marks a month "completed" — the existing `submittedAt`, packet download, or a new
  explicit *Close month* action?
- **Q13.** If a closed month must be corrected, should it reopen, or should the correction land in the
  current month as an adjustment (standard accounting practice)?

---

# F6 · Final reconciliation packet structure

> The final packet should be organized by approved budget category and contain: cover letter for each
> category, itemized expense list, expense identifiers, narratives, receipts, proof of payment,
> category totals, monthly totals, remaining budget information. Each expense should be traceable
> from the cover letter directly to its supporting documentation. If a fiduciary, funder, auditor or
> organization reviews the packet, they should be able to follow the financial trail without needing
> someone to explain where the documentation is.

### What the packet already does

Order today ([packet-pdf.ts](../src/generation/packet-pdf.ts)):

1. Contract summary
2. **Expense index** — `Ref | Date | Name | Line Item | Reimbursable`, added 2026-08-21
3. Month documents (bank statement etc.)
4. Then **per line item**: cover sheet, followed by that line item's supporting documents

So **organised by budget category — already true.** Narratives already print on the cover sheet
(R6.6). Category totals already print.

### The actual gap: traceability

**R2.6 restricts the reference to the index page and nowhere else**, because the cover sheet's
three-column table is the funder-approved layout and may not gain a column. That decision was made
deliberately — and it is precisely what the client is now asking to change:

> *"Each expense should be traceable from the cover letter directly to its supporting documentation."*

Today a reviewer on packet page 84 holding a receipt has no marking telling them which expense it
belongs to. They must flip back to the index and count. **That is the gap, and closing it means
revisiting the constraint that produced it.**

The remaining gap is that **monthly totals and remaining-budget information do not appear** in the
packet at all — they live on screen and in the Excel workbook.

### Phases

- **F6.1 — Produce a proposal for the funder** (A3). Build a *sample* stamped page from the February
  packet — one receipt page with a footer reference — plus a short written note explaining that the
  original document is unaltered and only a footer is drawn over the placed image. **Nothing else in
  F6 starts until the funder answers**, because the stamp is the feature.
- **F6.2 — Stamp the reference** on every supporting-document page. Pages are rasterised and placed
  by us ([`addImagePage`](../src/generation/packet-pdf.ts)), so a footer can be drawn as vector text
  over the placed image without touching the original file.
- **F6.3 — Add totals**: category totals, monthly totals, remaining budget — sourced from F5's shared
  function, never recomputed.
- **F6.4 — Cover letter per category** — settle Q15 first; this may be a new page rather than the
  existing cover sheet.
- **F6.5 — Verify against the golden reference** and update
  [packet-pdf-spec.md](02-outputs/packet-pdf-spec.md) and R2.6.

### Passing criteria

- [ ] Every supporting document page carries its expense's reference, legibly, without obscuring the
      document content.
- [ ] Every reference in the index resolves to a real page, and every document page's reference
      appears in the index — verified by extracting text from the built PDF, not by eye.
- [ ] Category totals, monthly totals and remaining budget appear and **match the screen and the
      Excel workbook exactly** (R10.2).
- [ ] Multi-page PDFs stay correctly ordered and every page is stamped.
- [ ] The approved cover-sheet layout is unchanged, or the change is explicitly approved by the
      client and recorded as a decision.
- [ ] A packet for a month with no expenses still builds (existing behaviour).
- [ ] Packet size and build time do not regress materially against F1's recorded measurements.

### Edge cases that must not be missed

- A stamp must not cover content on a **full-bleed** scan — placement needs a margin the image
  cannot occupy.
- **Landscape** and unusually-shaped source pages.
- The month documents section (bank statement) belongs to no expense — it needs its own treatment.
- Stamping changes the rendered bytes, so **`GENERATOR_VERSION` must be bumped** or cached packets
  serve unstamped pages forever (R2 in [TASKS.md](TASKS.md)).
- An expense with **no** supporting documents (`noReceipt` with a reason, R4.4) still needs to be
  traceable — the trail must show *why* there is nothing to point at.
- Reference reassignment on a month move (F2) must not leave a stale stamp in a cached artifact.

### Open questions

- **Q14 — answered (A3): ask the funder.** F6.1 produces the sample page and the written proposal.
  If the funder declines, the fallback is to make the index page do more work — grouping it by
  category and giving page numbers — which changes only our own generated page.
- **Q15.** "Cover letter for each category" — is that the **existing cover sheet** (the approved
  three-column breakdown), or a **new** letter page in front of it with narrative context? If new,
  what should it say?
- **Q16.** Should "remaining budget information" in the packet be **per category, in total, or both**?

---

## All open questions, in one place

| # | Fix | Question | Blocking? |
|---|---|---|---|
| Q1 | F1 | Realistic worst case for files per expense? | Sizing only |
| Q2 | F2 | Copy files to the new month's S3 prefix, or leave keys immutable? | Yes |
| Q3 | F2 | ~~What do you see on the edit screen?~~ **Answered (A4): verify by browser testing** | Resolved |
| Q4 | F3 | Merge recurring items with vendor defaults, or keep separate? | Yes |
| Q5 | F3 | Which fields beyond narrative should recur? | Yes |
| Q6 | F3 | Does editing a narrative update the template or just that expense? | Yes |
| Q7 | F4 | ~~Where do the defaults live?~~ **Answered (A1): payment source / funder** | Resolved |
| Q8 | F4 | Total receipt amount — entered and checked, or derived? | Yes |
| Q9 | F4 | Must excluded tax be visible in the packet? | Yes |
| Q10 | F4 | Changing flags in a submitted month — block, warn, or allow? | Yes |
| Q11 | F5 | ~~Freeze or recompute?~~ **Answered (A2): freeze at submission** | Resolved |
| Q12 | F5 | What marks a month completed? | Yes |
| Q13 | F5 | Corrections to a closed month — reopen or adjust forward? | Yes |
| Q14 | F6 | ~~May we stamp the reference?~~ **Answered (A3): ask the funder first** | Resolved |
| Q15 | F6 | Is "cover letter" the existing cover sheet, or a new page? | Yes |
| Q16 | F6 | Remaining budget in the packet — per category, total, or both? | Minor |

### Raised by the code mapping, not in the original request

| # | Fix | Question |
|---|---|---|
| Q17 | F2 | Moving an expense back to its original month gives it a **third** number. Correct, or should the original be restored? |
| Q18 | F2 | Should a moved expense keep its `recurring_item_id`, making the destination month read "✓ Added" though nobody clicked it? |
| Q19 | F3 | Is a carried narrative a **snapshot at add time** (matching description today), or should editing the template retro-update expenses already added to open months? |
| Q20 | F4 | When tax **is** included, is the R6.5 note suppressed entirely or replaced with an "included" variant? D-22 needs amending either way |
| Q21 | F4 | Should the Excel sheet and packet index show a **total receipt** column, or a marker of what each row included? Without it, two rows with identical numbers and different flags are indistinguishable |
| Q22 | F5 | The performance grant and advances-received have **no month dimension** and are hand-maintained. Does freezing the reconciliation block mean asking Misty for figures she has never kept per month? |
| Q23 | F5 | If submission is the freeze trigger, what does **un-submitting** a month do — discard the snapshot, keep it, or refuse? |

Q17–Q23 are not blocking today; each one blocks its own fix when that fix starts.

**Nothing is blocked from starting.** F0 needs no answers, and A1–A4 unblock the rest.
