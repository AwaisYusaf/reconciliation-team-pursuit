# Phase 14 — Add expenses from one invoice

Status: **Phase 1 (schema) built and proven** (2026-09-21). Phases 2 and 3 in progress; Phases 4
to 6 not started. The product spec is the ticket, `docs/tickets/upload-invoices.md`, stored word
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
| C5 | "Proof of payment is still missing and the team adds it, as they do today." | Added **after approving**, on the expense, exactly as today. The draft edit screen has no file pickers. A draft is not an expense yet, so there is nowhere to hang an uploaded file until approval, and inventing one would mean a third table with its own quota accounting and orphan cleanup. Reversible later without touching the two tables. | User, 2026-09-21 |

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

## 3. Data model (one migration, `0032`)

Two new tables. **`expenses` is not altered at all**, which is the whole point.

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

Not in the month total, the line item spend or the amount left on a line item. Not on the
dashboard. Not in the Excel summary, the packet or the cover sheets. Not read by the AI monthly
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
| 4 | Screens: the Add Expense button, `/r/expenses/from-invoice` upload and check, the create route | Not started |
| — | **Seam to settle in Phase 4:** `read-invoice.ts` and `invoice-match.ts` each export a type called `InvoiceLine`, and they are not the same shape. The reader's line always carries real cents (a line whose amount the strict guard refuses is dropped, never kept as zero) and a non-null description; the matcher accepts nulls, because a person editing a row on the check screen can clear a field. Phase 4 must convert between them deliberately at one place rather than letting the names imply they are interchangeable. | |
| 5 | Review: the Waiting for review section, approve, approve all ready, discard and undo | Not started |
| 6 | Docs: this file, D-115, the data model, m02 and m03, TASKS, README | D-115 and this file done |

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
