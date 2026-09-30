# Phase 14 — Add expenses from one invoice

Status: **all six phases built** (2026-09-22), and reviewed — see §9 for what that review found
and changed. The product spec is the ticket, `docs/tickets/upload-invoices.md`, stored word
for word as written; this file does not restate it. §2 records where this plan departs from it
and why. Every build phase in §7 names its sources and its own checks, so each can run in a
fresh chat.

The one decision that shapes everything else is **D-115**: a draft is not an `expenses` row with
a flag on it, it is a different thing in its own table. §3 has the reasoning.

---

## 1. What this is, in one paragraph

A vendor sends one bill covering twelve charges. Today the team types twelve expenses by hand and
attaches the same PDF twelve times, because reading amounts with AI (Phase 10) only ever helps
with the one expense whose form is open. Now they upload the invoice once from the Add Expense
screen, the app reads its lines and creates one **draft** per line, already matched to a line
item wherever a recurring item or a remembered vendor recognises the name. The drafts wait in a
**Waiting for review** section at the top of the Expenses list until a person checks them, fills
in what is missing and approves. Until approval a draft counts in nothing at all. Approving is
what makes the expense real, and from that moment it behaves exactly like one typed by hand.

This is a **Plus (`reconciliation_ai`) feature**, gated by the same `readAmountsAllowedForOrg`
that receipt reading uses, so the plan, the Settings "Read amounts from uploaded documents"
switch and the server's OpenAI configuration must all be on for the entry point to appear.

---

## 2. Decisions

### 2.1 Changes to the ticket

| # | The ticket says | Changed to | Source |
|---|---|---|---|
| C1 | "Next to **Add Expense**, add a button" on the Expenses tab | A button on the **Add Expense screen** itself. This app has no left nav: "Add Expense" is one of nine tabs in a top row that already scrolls sideways on a phone, and a tenth tab would also have to become conditional for the first time, since the button only exists for organizations allowed to use AI reading. The Add Expense page already resolves `readAmounts`, so the gate costs nothing there. | User, 2026-09-21 |
| C2 | Silent on which funding source the drafts land on | When the header holds one source, that one, silently. When the header is on **All sources**, the upload screen asks before reading. Archived sources are never offered, as with any new expense. | User, 2026-09-21 |
| C3 | Silent on overspending a line item at approval | Approval behaves exactly as a hand-added expense does today. No new rule and no new message: the ticket says an approved expense behaves exactly like one added by hand, and a warning only at approval would be a rule drafts alone had to obey. | User, 2026-09-21 |
| C4 | "The invoice PDF becomes the **receipt** on every draft it created, so it is already attached when the team opens one." | The invoice is stored once, owned by the import, and shown on every draft it created. It becomes a real `expense_documents` receipt on each expense **at approval**. What the person sees is what the ticket asks for; the difference is structural, and it is what keeps one invoice from being charged once per line against the organization's 5 GB storage (D-115). | Plan |
| C5 | "Proof of payment is still missing and the team adds it, as they do today." | ~~Added **after approving**, on the expense. The draft edit screen has no file pickers, because a draft is not an expense yet and inventing somewhere to hang a file would mean a third table with its own quota accounting and orphan cleanup.~~ **Superseded by C6.** | User, 2026-09-21 |
| C6 | — | **A draft holds its own files after all**, in `expense_draft_documents` (migration `0033`, D-116). The upload fields are shown on the draft edit screen and on each charge card, and approval re-points the rows at the new expense keeping the same `s3_key`, so the object is stored once. C5 named the price of this exactly right and it is now paid rather than avoided: the quota counts the new tables, the per-expense budget and the upload lock apply, and discard deletes the objects. The one thing C5 bought that is not recovered: **Undo after a discard restores the draft, not the files that were on it.** | User, 2026-09-22 |
| C7 | "Unticking a row leaves it out. **Create drafts** makes one draft expense per ticked row." | The check screen is a list of **charge cards**, each one a real expense form, with **Save as expense** / **Mark as draft** per card, **Remove** instead of unticking, and one **Done** that writes everything at once. So the invoice path can create real expenses directly, not only drafts. Nothing is written until Done, so an abandoned screen leaves nothing behind. | User, 2026-09-22 |
| C8 | "A file picker for **one PDF**", and "Not part of this ticket: photos or scans of invoices. PDF only for now." | **Photos are accepted too** (JPEG, PNG, WebP, and HEIC converted in the browser per D-111), because an invoice photographed on a phone is the same document and the reader already handles images. Still one file at a time, still 25 MB, still 10 pages. | User, 2026-09-22 |
| C9 | The ticket's §1 upload step: a screen or dialog with a title, an explanation, **Read invoice** and **Cancel**. | **Not built.** The entry point on the Add Expense screen opens the file picker directly and the read starts on pick. One fewer step; the cost is that the limits and the explanation of what a draft is are never stated before the read. | User, 2026-09-22 |
| C10 | Silent on who was paid: each draft's Name is the invoice line's own name | **The invoice's vendor is added to each charge's description** (`withInvoiceVendor` in `src/domain/invoice-match.ts`), so the cover sheet's Role column says who was paid: `Eastside Catering: Dinner`, or just the vendor when the line printed no description. Left as it was when the description already names the vendor (any case), when the line's name is the vendor, or when no vendor was read. The same in all three match branches. The vendor library learns the saved description, vendor and all (R8.2), so a remembered description can start with an earlier invoice's vendor: a leading `{earlier vendor}: ` (any vendor this organization's earlier invoices named, `expense_imports.vendor_name`) is dropped before this invoice's vendor goes in front, so a second vendor's invoice reads `Westside Deli: Box lunches`, never `Westside Deli: Eastside Catering: Box lunches`. The vendor library itself learns the description without any invoice's vendor in front (`learnVendor` strips it with `withoutInvoiceVendors`), so it never depends on the import that named the vendor still existing (an import nothing came of is swept), and a manual Add Expense for the same name is not offered another bill's vendor. Not the Name, because recurring items, the vendor library and R8.3's added-state all match on the name (§5); changing it would stop them matching. | User, usability test 2026-09-29 (#62) |
| C11 | Amends C9 | **A hint on the button**, `Upload one invoice. Each charge on it is read out for you to check before anything is saved.`, as its tooltip and screen-reader description (a visible line under it wrapped into the header beside the month selector, user review 2026-09-29); still no extra dialog or step. The button reads `Extract from invoice`. The check screen now has a page title, `{N} charges from {vendor}, invoice #{number}` (dropping whichever part was not read); the reader asks for the invoice number for it, and it is display only, never stored. A hint next to Done, `Nothing is saved until you press Done. Then charges marked Saving as expense become expenses, and the rest become drafts waiting for review on the Expenses page.`, and after Done the screen lands on the Expenses page's drafts view only when every charge became a draft (`/r/expenses?view=drafts`), else on the Expenses page, which shows the expenses and links to the drafts with their count (`invoiceDoneHref`; PR #27: with a mix, the drafts view hid the charges saved as expenses). Marking a card toasts `Marked as an expense. It's saved when you press Done.` or `Marked as a draft. It's saved when you press Done.`, never "saved" (PR #27). The whole-bill tax/fee note is a calm information note, not a red one, and names tax and fees separately. | User, usability test 2026-09-29 (#60, #61, #63, #64) |
| C12 | Silent on reminding anyone that drafts are waiting | **A reminder with the count and total**: each dashboard section and the Month-End Packet page show a card titled `{N} drafts waiting for review · {total}` with a `Review drafts` link when that source and month have any, and the monthly summary section notes that they are not in the summary. The total is the drafts' reimbursable sum, the figure each draft row shows. On a locked month the reminder says the drafts can't be approved until the month is unlocked, rather than promising approval (R10.7). Reminders only: no figure, gate, page count, file or summary changes (§6). | User, usability test 2026-09-29 (#64, #65) |

### 2.2 Assumptions

- **"The organization's usual payment source"** means the first **active** `payment_sources`
  label by `sortOrder`. There is no default flag on that table.
- **A whole-bill tax or fee** is shown as a note on the check screen only. It is never split
  across the lines and never written to a draft; the ticket puts splitting out of scope.
- **A matched row's description wins** over the description printed on the invoice line, falling
  back to the printed one when the remembered description is empty. The ticket names the amounts
  as the single thing the invoice always wins ("Amounts always come from the invoice ... over
  anything remembered"), and lists description among the fields the matched row supplies.
- **The browser re-sends the PDF** at "Create drafts" rather than the server stashing it between
  the read and the confirm, so an abandoned check screen leaves no orphan object to clean up.

---

## 3. Data model (migrations `0032` and `0033`)

Three new tables across two migrations. **`expenses` is not altered at all**, which is the
whole point. `0032` adds `expense_imports` and `expense_drafts`; `0033` adds
`expense_draft_documents`, which C5 below originally ruled out and C6 reverses.

`expense_imports` — one uploaded invoice, and the owner of the stored file:

| Column | Notes |
|---|---|
| `org_id`, `funding_source_id`, `month` | Composite key to `funding_sources(id, org_id)`, as every source-scoped table has since D-93. |
| `uploaded_by` | `ON DELETE SET NULL`. The duplicate warning then names no one. |
| `s3_key`, `filename`, `mime_type`, `size_bytes`, `page_count` | The file. The filename lives here, never in the key (PII-free keys). |
| `sha256` | The "this invoice was already added" check. **Not unique**: adding the same invoice twice is allowed after a warning, because a vendor really can bill the same lines again. |
| `vendor_name`, `invoice_date`, `bill_tax_cents`, `bill_fees_cents` | What the model read off the bill as a whole. The two amounts are nullable because "never read" is a different fact from zero. |

`expense_drafts` — one read line:

| Column | Notes |
|---|---|
| `import_id` | `ON DELETE CASCADE`. Discarding an import takes its drafts with it. |
| `line_item_id` | **Nullable**, `ON DELETE SET NULL`. Null is the "Needs a line item" state. A suggestion is not a record, so deleting a line item blanks it rather than refusing the delete, unlike `expenses` (R9.3). |
| `payment_source` | Label snapshot, as on `expenses` (R5.1). The organization's usual one when nothing matched. |
| `narrative` | Null is the "Needs a narrative" state. |
| `sort_order` | The order the lines appeared on the bill, so the review list reads like the invoice. |
| — | **There is no `reference_seq` column.** A draft cannot hold a reference number because there is nowhere to put one. |

Two constraints carry the guarantees:

- Composite FK `(line_item_id, funding_source_id) -> line_items(id, funding_source_id)`, so a
  line item that **is** set still cannot cross funding sources (D-93 2.2). It is simply not
  checked while null (MATCH SIMPLE), which is what lets an unmatched line exist at all.
- `expense_drafts_month_ck`, the same `YYYY-MM` guard every month column has.

`ai_usage_events` gains the `invoice_read` feature and `ai_usage_events_invoice_read_ck`, which
mirrors the amount-read constraint: an invoice is always a freshly picked file read as a receipt.

### 3.1 The enum trap, and why D-106's mitigation does not work

D-106 records that Postgres cannot use an enum value in the transaction that added it, and
concludes that a value and a constraint naming it belong in **two migration files**. That does not
work. Drizzle applies every *pending* migration inside one transaction — `session.transaction`
wraps the whole loop in `pg-core/dialect.js` — so two files that are both pending still land
together, and `drizzle-kit migrate` fails with no error text at all, which is how this was found.

The fix is one character of SQL: the constraint compares `feature::text`, not the enum column.
Comparing as text never evaluates the new enum literal, so the value and the constraint that
names it land together in a single migration. D-115 records this as a qualification of D-106.

---

## 4. Reading the invoice

`src/services/openai/read-invoice.ts`, a sibling of `read-amounts.ts`, sharing its envelope
helpers, its strict decimal guard (D-110: `12,50` must not read as $1,250.00), its generic
`document.pdf` filename and its `store: false`. The schema it asks for is the vendor, the invoice
date, any whole-bill tax or fee, and the lines. Only what is printed is used; nothing is guessed
or worked out.

Two ceilings, both server side, neither trusted to the model: **10 pages** (OpenAI bills a PDF per
page, and the constant is now shared with the amount-read route so the two cannot drift) and
**50 lines** (the first 50 are kept and the screen says so).

The route `app/api/files/read-invoice/route.ts` repeats the guard order of the amount-read route
exactly, on a tighter rate-limit bucket, because one invoice read costs far more than one receipt
read. Exactly one `ai_usage_events` row is written per request that reaches a resolved document,
whatever the outcome.

---

## 5. Filling each row

`src/domain/invoice-match.ts`, pure and database free. Per line, in this order:

1. A **recurring item** with the same name, ignoring capitals: its line item, payment source,
   description, narrative, and its usual tax and fees **only when the invoice line shows none**.
2. A **remembered vendor** with the same name: its line item, payment source and description.
   Vendors carry no narrative, deliberately, because the vendor library is learned on every save
   with latest-write-wins and one blank narrative would wipe the remembered paragraph (D-66).
3. **No match**: line item and narrative stay empty, payment source is the organization's usual.

Amounts printed on the invoice always win over anything remembered. Every draft's date is the
invoice date; the month is the one in the header.

---

## 6. What a draft does not do

Not in the month total, the line item spend or the amount left on a line item. Not in any
dashboard figure (the dashboard and packet page only remind how many are waiting, C12). Not in the Excel summary, the packet or the cover sheets. Not read by the AI monthly
summary. Holds no reference number; the number is given at approval, like any other new expense.
Does not block the packet, because only approved expenses are checked for missing documents.

None of that is enforced by a filter. It follows from the drafts living in their own tables,
which no query for a total, a gate, a generator or the summary names.

---

## 7. Build phases

| # | Phase | Status |
|---|---|---|
| 1 | Schema and migration `0032`: both tables, the enum value and its constraint, and the tests that prove each guard bites | **Built and proven**, 2026-09-21 |
| 2 | The invoice reader, its route, the shared page cap, the usage log rows and the strings | In progress |
| 3 | `invoice-match.ts` and its unit tests | In progress |
| 4 | Screens: the Add Expense entry point, `/r/expenses/new/from-invoice` check screen (charge cards, C7), the create route | **Built** |
| — | **Seam to settle in Phase 4:** `read-invoice.ts` and `invoice-match.ts` each export a type called `InvoiceLine`, and they are not the same shape. The reader's line always carries real cents (a line whose amount the strict guard refuses is dropped, never kept as zero) and a non-null description; the matcher accepts nulls, because a person editing a row on the check screen can clear a field. Phase 4 must convert between them deliberately at one place rather than letting the names imply they are interchangeable. | |
| 5 | Review: the Waiting for review section, approve, approve all ready, discard and undo | **Built** |
| 6 | Docs: this file, D-115, D-116, the data model, m02 and m03, TASKS, README | **Done** |

### Phase 1 result (2026-09-21)

Both tables, the `invoice_read` enum value and `ai_usage_events_invoice_read_ck` are in the
database. `expenses` is untouched: `reference_seq` and `line_item_id` are still `NOT NULL` with
no default, checked directly against `information_schema` rather than assumed.

`src/db/expense-drafts.integration.test.ts` has eight checks, each one a constraint doing its
job: an unmatched line with no line item is accepted; a line item from another funding source is
refused; a bad month is refused; `expense_drafts` has no `reference_seq` column; deleting a line
item blanks the suggestion instead of refusing; deleting an import removes its drafts; an
invoice-read usage row without its document columns is refused, and with them is accepted; a
summary outcome on an invoice read is refused.

**Mutation-proved**, not asserted: dropping the composite FK, the month check and the invoice-read
check made exactly four of the eight tests fail, and re-adding them made all eight pass again.
The restored definitions were read back from `pg_get_constraintdef` and match the migration.

**Proved from scratch as well**, which is what a fresh deploy does: all 33 migrations were applied
to an empty database in one run and succeeded. That is the strongest form of the enum test in
§3.1, because a fresh database has every migration pending at once, so `0032`'s new enum value and
the constraint naming it are created inside the same transaction and the `feature::text`
comparison is the only reason it works. The resulting schema was checked column by column: both
tables present, the enum carrying all three values, the constraint present, and `expenses`
`reference_seq` and `line_item_id` still `NOT NULL`. The scratch database was then dropped.

---

## 8. Tests and verification

### The invisibility suite (done, 2026-09-21)

`src/modules/expense-imports/invisibility.integration.test.ts`. One month holding one real
$100 expense and one import of three $50 drafts, deliberately one of each kind a draft can be:
complete, missing its line item, missing its narrative. Everything measurable about the month is
taken before and after the drafts exist and compared.

Nothing moves: `loadExpenseAmounts` (which the dashboard, the Contract Summary screen and the
workbook all read), `allLineItemStats`, the month snapshot and **its artifact cache hash**,
`loadPacketReadiness`'s blocking list and record count, the monthly-summary facts and their
fingerprint, the month's expenses list, Trash, and `month_statuses.next_reference_seq`. Then one
draft is approved and every one of those moves, the reference counter by exactly one.

The cache-hash assertion is the load-bearing one: if the snapshot hashes identically, then no
generator and no cached artifact can see a draft, without this test needing to know which
generators exist.

**Mutation-proved.** A throwaway sibling inserted the same three rows as ordinary `expenses`
instead of drafts and asserted every one of those measurements *does* move. It passed, so the
invisibility assertions are sensitive to a leak rather than vacuously true. The throwaway was
deleted; drafts cannot be made to leak from inside the design, which is the point of D-115.

Drafts are inserted directly rather than through the import action, so the suite tests the
guarantee and not the one path that happens to create drafts today.

### Still to cover

Beyond each phase's own tests, the suite that matters is the **invisibility** one: with a month
holding one live expense and one import of drafts, a draft must appear in none of
`loadExpenseAmounts`, the month snapshot, the contract summary, the dashboard, the workbook, the
packet, the cover sheet, `buildMonthFacts`, `factsFingerprint` or `loadPacketReadiness`, and must
not block the documentation gate; the artifact cache key over the snapshot must be byte identical
before and after the drafts exist; `next_reference_seq` must be untouched by the import and
increment by exactly one on one approval. Then approve, and assert the opposite of all of it.

Edge cases to cover explicitly: a 0-line invoice; exactly 50 and 51 lines; exactly 10 and 11
pages; a line with no amount; a $0.00 line; a refund or negative line; duplicate line names on one
invoice; a name matching both a recurring item and a vendor (recurring wins); an archived source
or a locked month between read and create, and again between create and approve; two people
approving the same draft at once; a line item deleted before approval; a malformed or
password-protected PDF; the storage quota full at approval.

**Not provable by any of the above:** how reliably the model finds line-level tax and fees on real
vendor invoices. The read is capped, logged and refusable, but match quality is empirical and
needs a real invoice run against the live model before this goes in front of the client.

---

## 9. Review, 2026-09-22

The branch was reviewed against the ticket before merge. What it found, and what changed.

### Fixed

1. **Attaching a file to any existing expense failed.** `expense-form.tsx` passed the owner
   `"draft"` in the ordinary edit branch, so an expense id reached `ingestDraftDocument`, which
   looked it up in `expense_drafts` and answered "That draft no longer exists." The draft branch
   had the opposite fault: it returned before uploading anything at all, so files attached while
   fixing a draft were dropped in silence. The two branches were swapped. This was a regression on
   a shared screen, not on anything the invoice feature added.
2. **`learnVendor` was a public endpoint.** It was exported from `actions.ts`, which is
   `"use server"`, where every export is callable; it takes an `orgId` and writes to
   `vendor_defaults` with no session check. It, `toRow` and `snapshotOf` moved to
   `expense-row.ts`, a plain module. That also collapsed the three hand-maintained copies of the
   15-field audit snapshot into one.
3. **The 5 GB quota could not see this feature's bytes.** `orgStorageBytes` named three tables and
   neither new one, so the checks on the import and draft paths were measuring a total their own
   writes never entered. Both are counted now, which is also what the admin usage figure reads.
4. **The whole-bill tax and fee were stored 100x too large.** `readInvoice` returns
   `billTaxCents` in cents, the check screen posts `String(1250)`, and the route parsed it as
   dollars — the format-then-parse round trip R1.1 forbids, on an amount the model supplied. It is
   read as an integer now. Nothing read the column back, so no figure was ever shown wrong.
5. **An expense saved straight off an invoice taught the vendor library nothing** (R8.2), which
   quietly broke this feature's own §5 rule 2: the same vendor's next invoice would not match
   itself. The route calls `learnVendor` like the other two create paths.
6. **Discarding a draft stranded its files in the bucket**, and nothing ever deleted an import's
   object either. Discard now reads the keys before the cascade and deletes the objects after the
   delete commits, and reports how many went, so the toast can say so.
7. **`ingestDraftDocument` was the only ingest path** without the org upload lock, without the
   per-expense budget, and with the row committed before the object — which trades an orphan
   object for an orphan row, and approval copies that row into `expense_documents` where the
   documentation gate trusts it. It matches its siblings now, and guards a malformed `draftId`.
8. **Files queued on a card marked as a draft were uploaded and thrown away.** They attach to the
   draft now, which is what `0033` exists for.
9. Dead code removed: four unused `UI.invoice*` strings, an unreachable "Leave without saving"
   dialog (now wired to Back, which discards a whole read without asking), an identity function,
   and four orphaned doc comments. `invoiceNoRowsTicked` named a tickbox the screen does not have.

### Found and deliberately not changed

- **Approval does not re-check `isKnownPaymentSource`.** A label retired between import and
  approval reaches the expense. That matches R5.1/R5.2 — an expense keeps the label it was saved
  with — and the draft's label was valid when the draft was made. `updateExpenseAction` makes the
  same choice for the same reason.
- **Approval reads the reimbursement flags off the funding-source row it already has**, rather
  than through `rulesForFundingSource`. That helper takes the pooled handle and no `tx`, and a
  second pool checkout inside the approval transaction deadlocks under concurrency. Reading them
  inline also means they are read under the same row lock as the archived check.

### Still open

- **The invoice is stored once per approved expense.** Approval and the direct-expense path both
  re-upload the invoice bytes as each expense's receipt, so a twelve-line invoice ends up stored
  twelve times — the outcome D-115 cites as a reason for the two-table design. Fixing it means
  pointing each `expense_documents` row at the import's existing `s3_key` and teaching deletion
  that a key can be shared. Not done here because it changes a delete path every month depends on.
- **The month comes from org-wide shared state.** `session.activeMonth` can be changed by another
  user while someone is reviewing, and the check screen has no month field, so Done would write
  into a month the reviewer never saw. Needs the screen to post the month it was rendered for and
  refuse a mismatch. *Update (Phase 18, D-131): the month is now each person's own, so a colleague
  can no longer move it; only the same person switching in another tab or device still can.*
- **No rollback SQL for `0032`/`0033`**, unlike `rollback-0023-funding-sources.sql`.
- **Match quality against real vendor invoices is still unmeasured**, as §8 already says.
