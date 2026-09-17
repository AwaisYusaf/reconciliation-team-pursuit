# Phase 10 — Reading amounts from receipts (AI)

Status: **Built and verified in the browser; real-receipt test blocked on OpenAI credit**
(2026-09-17). Branch `implementation/ai-receipt-reading`. The product spec is Appendix A, copied
word for word. §2 records where this plan departs from it and why. §2a (below) records where the
build departs from §3, and why. §6 is the verification record.

## 2a. Deviations from §3 taken while building

- **Settings switch revert.** §3.6 says the toggle uses "the existing `run(...)`/`reportResult`
  pattern"; `run()` has no way to know whether the action failed so the optimistic state can be
  reverted, so `toggleReadAmounts` in `settings-sections.tsx` is a small bespoke handler that
  calls `reportResult` directly instead of going through `run()`. Same success message
  ("Organization saved"), same `startTransition`/`router.refresh()` shape.
- **`UI.amountsSummaryParts`, not a `UI` entry.** The existing American-spelling guard
  (`strings.test.ts`) calls every `UI`-object function expecting a string back; a function
  returning `{ lead, totalPaid }` (so the panel can bold "Total paid" without re-parsing a
  joined sentence) broke that assumption. It is exported as a plain top-level function from
  `strings.ts` instead — same file, same "every user-facing string lives here" rule, just not
  inside the `UI` object the guard iterates.
- **`ADD_EXPENSE_TOUR_STEPS` → `addExpenseTourSteps(readAmounts)`.** §3.6 asks for this; the
  existing `add-expense-tour.test.ts`, which greps page source for the old constant name, was
  updated in the same change to grep for the new function name instead — otherwise the rename
  alone would have failed a previously-green suite.
- **Plus look on the two read fields (user request, 2026-09-17), departing from §3.6's "no new
  colors".** When reading is available, Proof of payment and Receipt get the header's gradient
  Plus badge (now the shared `PlusBadge` in `src/components/ui/plus-badge.tsx`, also used by the
  header), a warm `bg-autofill` drop zone with an accent dashed border, a sparkle icon, a one-line
  note, and a per-file AI status ("Reading amounts…", "Amounts found · Total $…", "No amount
  found"). On Edit the status appears only after the button is pressed. The amounts panel gets
  the same badge and an accent left border. Supporting documents and base-plan orgs are
  unchanged. Checked at 1280 and 375 px, no horizontal scroll.
- **Plus-only layout, tour and "couldn't read" box (user request, 2026-09-17).** All of these
  apply only when reading is available; the base plan keeps today's form, order, tour and text.
  (1) Proof of payment and Receipt render *above* Subtotal/Tax/Fees, so the amounts sit under the
  documents they come from — one shared `proofAndReceipt` block placed by `readAmounts`.
  (2) Appendix A §2's "We couldn't read amounts…" panel is removed: when nothing is readable no
  panel shows, and each file row's "No amount found" says it. (3) The tour follows the Plus
  order (proof, receipt, amounts, reimbursable); the proof and receipt steps explain what AI does;
  Appendix A §6's amounts text said "upload the receipt below", now wrong on Plus, so it reads
  "…or use the amounts we find in the receipt you added above…". (4) The Settings tour gains a
  "Read amounts with AI" step on the switch, dropped automatically where the switch isn't shown.
  Users who already finished a tour see the new steps only via the (i) replay button.
- **No `UI.cancel` existed before this phase.** Per the brief, added as a plain `"Cancel"` entry
  and reused as the "Replace the amounts you typed?" dialog's dismiss label, rather than adding
  a feature-specific word for an ordinary Cancel button.

---

## 1. What this is, in one paragraph

When a receipt or proof of payment is chosen on Add Expense, the app sends it to OpenAI and
shows a panel with the Subtotal, Tax, Fees and Total paid it found. Nothing reaches the form
until the user presses "Use these amounts". On Edit, reading only happens when the user presses
"Read amounts from documents". It is an AI-plan feature: only organizations on the
`reconciliation_ai` plan, with the Settings switch on and an OpenAI key on the server, ever send
a document.

## 2. Decisions taken before building (user, 2026-09-17)

| # | Question | Answer |
|---|---|---|
| Q1 | Appendix A says "on for every organization, plan limiting is not part of this ticket", but the requester added "this is an AI plus feature, only available to plus users". Which? | **Gate on the plan now.** `organizations.plan = 'reconciliation_ai'` is required. Plans already exist (Phase 9), so this is one condition in the single access check (§3.1). Team Pursuit only gets the feature once staff set its plan to Reconciliation + AI at `/a`. |
| Q2 | What do base-plan orgs see in Settings? | **Nothing.** The switch is hidden, not shown disabled. |
| Q3 | Real-receipt test key | The user puts `OPENAI_API_KEY` in `.env.local`. |

Design choices made in this plan (not in Appendix A):

- **One file per read request.** Matches the existing upload route (one file per POST), keeps
  every request under the 25 MB upload cap, and lets the browser cache each file's result so
  adding a second receipt reads only that one file. So the usage log has **one row per file
  read**; "number of files" for an org is a row count.
- **Total paid** in the panel is the sum of each file's *read* total (falling back to
  subtotal + tax + fees when the document shows no separate total). "Use these amounts" fills
  Subtotal/Tax/Fees only; the form's own receipt total then shows the result. If a receipt's
  read total disagrees with its own parts, the per-file warning says so (Appendix A §1).
- **Unreadable and no-amount are shown the same way:** "No amount found". A failed OpenAI call
  for one file never fails the others.
- **Model returns decimal strings, the server converts to cents** with `parseMoneyToCents`
  (R1). Anything that does not parse is treated as "no amount found" for that field set.
- **Cost** is logged in micro-dollars from token counts × two optional price settings. With no
  prices set, tokens are still logged and cost is null.
- **Edit button** shows when the expense has attached *or* queued receipts/proofs (Appendix A
  says "attached"; a just-added file is also readable per §3 of the ticket).
- **Receipts pending deletion** (No receipt ticked on edit) are not read; that expense is
  treated as proofs-only.

## 3. Design

### 3.1 Access — one function

`src/modules/amount-reading/access.ts` → `canReadAmounts(org: { plan, readAmountsEnabled })`:
`plan === "reconciliation_ai" && readAmountsEnabled && openAiConfigured()`. Every consumer
(new/edit pages, the read route, the Settings page for the switch's visibility via the plan
part, the tour) calls this. `openAiConfigured()` = both `OPENAI_API_KEY` and
`OPENAI_READ_MODEL` are non-empty. The route re-checks from the DB on every request; pages
only decide what to render.

### 3.2 Data (one migration)

- `organizations.read_amounts_enabled boolean not null default true`.
- New table `amount_reads`: `id`, `org_id` (fk cascade), `user_id` (fk set null),
  `source` enum-ish text (`upload` | `attached`), `document_kind` (`receipt` | `proof`),
  `outcome` (`found` | `none` | `failed`), `model` text, `input_tokens` int null,
  `output_tokens` int null, `cost_micro_usd` int null, `created_at`. Index on
  `(org_id, created_at)`. **No file names, no amounts, no document content** — nothing PII.

### 3.3 Reading service — `src/services/openai/read-amounts.ts`

- Plain `fetch` to `POST https://api.openai.com/v1/responses` (no new dependency).
- Body: `model: OPENAI_READ_MODEL`, `store: false`, a fixed instruction, the file as
  `input_file` (`file_data: data:application/pdf;base64,…`, `filename`) or `input_image`
  (`image_url: data:image/jpeg|png;base64,…`), and
  `text.format = { type: "json_schema", strict: true, schema }` where schema is
  `{ found: boolean, subtotal: string|null, tax: string|null, fees: string|null, total: string|null }`.
- Instruction covers: US dollars only; a receipt/invoice gives its subtotal, tax, fees and total
  paid; a proof of payment (bank line, transfer screenshot, ATM slip) gives the single amount
  paid as total and as subtotal with tax/fees 0 unless shown; `found: false` for documents
  with no amount (timesheets) or many unrelated amounts (full statements); never guess.
- `AbortSignal.timeout(60_000)`. Any non-2xx, timeout, refusal, or unparsable output →
  `outcome: failed`, never throws. Log `usage.input_tokens` / `usage.output_tokens`.
- The API key never leaves the server; errors logged without the response body.

### 3.4 Route — `app/api/files/read-amounts/route.ts`

Same shape as `app/api/files/upload/route.ts`: session, `sameOrigin`, content-length cap,
new rate-limit bucket `readAmounts` (per org, 200 per hour — bounds spend from a script),
then `canReadAmounts` from the DB (403 when off). Two inputs:

- `file` + `kind` (`receipt`|`proof`): run `inspectUpload` (sniff, PDF validity, HEIC→JPEG),
  nothing stored.
- `documentId`: load the `expense_documents` row **scoped to the session org**, kind must be
  receipt or proof, expense not trashed; read bytes from the storage driver.

Returns `{ ok: true, data: { found, subtotalCents, taxCents, feesCents, totalCents } }` or
`{ ok: false, error }`. Writes one `amount_reads` row either way (except auth/origin/rate
failures).

### 3.5 Pure aggregation — `src/domain/amount-suggestion.ts` (unit-tested)

Input: per-file results `{ key, name, kind, result: found|none|pending }` and `noReceipt`.
Output: `{ state: reading|done|nothing, subtotal, tax, fees, total, files[], proofCheck, perFileMismatch }`.

- Receipts to sum = receipt files found, unless `noReceipt` → none.
- If there are receipts found: suggestion = sum of receipts; proofs found are summed and
  compared to the receipts' total → `matches` or `differs` (warning string, §3.7).
- If no receipts found (none uploaded, none readable, or No receipt ticked): suggestion = sum
  of proofs; no proof check.
- A receipt whose `total ≠ subtotal+tax+fees` gets the mismatch flag.
- All files none → `nothing`. Any pending → `reading` (count shown).

Panel rules that Appendix A leaves open, settled here so every state is consistent:

| Situation | What the panel shows |
|---|---|
| Receipts found, proofs found, sums equal | Each proof line: `{amount} ✓ matches` |
| Receipts found, proofs found, sums differ | Proof lines show their amounts, no ✓; the Appendix A warning once, under the list |
| Receipts found, no proof found/uploaded | Receipt lines only; no check line, no warning |
| Proofs only / No receipt ticked | Proof lines show amounts, never "matches"; totals are the proofs' |
| Receipts uploaded but none readable, proofs readable | Receipts show "No amount found"; totals are the proofs' (same as proofs-only) |
| Some files found, some not | Totals from the found ones, plus one line: "Documents marked No amount found are left out of these totals." (not in Appendix A; stops an incomplete total being used unnoticed) |
| A receipt's parts ≠ its total | Its line shows figures as read + the Appendix A mismatch sentence under that line |
| Every file none | Only the "We couldn't read amounts…" sentence and Dismiss |
| No receipt/proof files at all | Panel not shown |

Panel lifecycle:
- **Dismiss** hides the panel until the set of receipt/proof files changes.
- **Use these amounts** (after the confirm if needed) fills the fields and hides the panel the
  same way; it reappears only if the files change.
- While some files are still reading and others are done, the panel stays in the reading state
  ("Reading N documents…") — no partial totals, so a half-finished total is never offered.
- A read refused because the feature was switched off meanwhile counts as "No amount found".

### 3.6 UI

- `src/modules/expenses/amount-suggestion-panel.tsx` — the three states from Appendix A §2,
  directly under the Subtotal/Tax/Fees row. "Use these amounts" + "Dismiss". Responsive: list
  wraps, buttons stack under 400px.
- **Visual consistency:** built only from the existing kit and tokens — `Button` (primary +
  quiet, like Save/Cancel), `Dialog` (like the other confirms), `Helper`, the
  `border border-line rounded-[3px] bg-section px-4 py-3.5` box used by "Include in
  reimbursement", `text-caution` for warnings (like the tax-exceeds-subtotal warning),
  `tabular-nums` + `formatMoney` for every figure, `min-h-11` tap targets, `text-[15px]`/
  `text-sm text-sub` type scale. `aria-live="polite"` on the panel so the state change is
  announced. No new colors, radii, shadows or spinners the app doesn't already use. The
  Settings switch reuses the existing `role="switch"` control in `settings-sections.tsx`. The
  Edit button is `Button variant="secondary"` like "Add files".
- `expense-form.tsx` gets `readAmounts: boolean` prop. A hook `useAmountReads` holds a
  `Map<fileKey, result>` cache (queued item `key`, or `doc:{id}`), runs at most 2 reads at
  once, drops results for files no longer present, and ignores late results after Dismiss /
  unmount.
  - **Add:** reads start whenever the set of queued receipt/proof files changes.
  - **Edit:** nothing reads until "Read amounts from documents" is pressed; after that, file
    changes re-read like Add. Button hidden when `ownSavedLocked`, or no receipt/proof
    attached or queued.
- "Use these amounts": if any of Subtotal/Tax/Fees parses to non-zero, `Dialog`
  "Replace the amounts you typed?" first. Fills the three fields as `"150.00"` strings; never
  touches any other field or the reimbursable checkboxes.
- Reading never disables Save.
- Settings → Organization: switch "Read amounts from uploaded documents" + help text, visible
  only when `plan === "reconciliation_ai"`; admins can toggle, managers see it read-only
  (disabled). Action `setReadAmountsEnabledAction(enabled)` via `requireAdmin()`.
- Tour: `addExpenseTourSteps(readAmounts: boolean)` returns the new amounts text when true.

### 3.7 Strings (`src/domain/strings.ts`, UI)

All panel, warning, dialog, switch and tour strings from Appendix A verbatim, as UI entries
(none print on documents).

### 3.8 Env (`.env.example`, deploy note)

`OPENAI_API_KEY`, `OPENAI_READ_MODEL="gpt-5.6-luna"`, optional
`OPENAI_READ_PRICE_INPUT_PER_MTOK="0.20"`, `OPENAI_READ_PRICE_OUTPUT_PER_MTOK="1.20"`
(OpenAI list price for gpt-5.6-luna as of 2026-07-30). **The live `.env` must be updated by
hand on deploy.**

## 4. Edge cases and how each is handled

| Case | Handling |
|---|---|
| No key / no model on server | `canReadAmounts` false → no panel, no button, route 403; tour keeps old text |
| Base plan org, or switch off | Same as above; switch hidden on base plan |
| Manager toggles via direct action call | `requireAdmin` refuses |
| Document from another org by id | Query scoped by session org → not found |
| Supporting document id | Kind check refuses |
| HEIC / WebP | `inspectUpload` converts to JPEG before sending |
| Encrypted / corrupt PDF, disguised file | `inspectUpload` refusal → file shows "No amount found" |
| Timesheet, full bank statement | model `found:false` → "No amount found" |
| OpenAI down / slow / 429 | per-file `failed` after ≤60 s; panel shows other files; Save unaffected |
| Model returns garbage number | parse fails → treated as none for that file |
| Negative amounts (refund) | parsed and summed like the form allows |
| File removed while reading | result discarded (key no longer present) |
| No receipt ticked after reading | aggregation switches to proofs-only |
| User typed amounts | confirm dialog before replacing |
| Locked month on edit | button hidden; route does not write, so no lock bypass concern |
| Script spamming the route | per-org hourly rate limit; each call logged |
| Prompt injection in the document | output is strict schema numbers only, and a person must confirm |

## 5. Done when

Appendix A "Done when", plus the ship gate: typecheck, lint, full suite green; aggregation unit
tests; route integration tests with OpenAI mocked (access gate, org scoping, kind check, logging);
a security pass on the route. The real-receipt test (10+ files, gpt-5.6-luna, per-file result
and average cost) runs with the user's key and goes in the PR.

## 6. Results (2026-09-17)

**Ship gate.** Typecheck and lint clean. `npm test`: 1197 passed, 20 skipped, 1 file failed —
`packet-trace.integration.test.ts`, because this machine's `pdftotext` has no `-bbox-layout`
option; nothing under `src/generation` changed. Feature suites: 110 tests.

**Browser walk-through** (dev server, local Team Pursuit org on `reconciliation_ai`, a temporary
admin/manager account deleted afterwards, the read route faked in the browser so every panel
state could be driven):

| Check | Result |
|---|---|
| Two receipts + one proof, Appendix A figures | Panel shows $150.00 / $9.00 / $6.00 / Total paid $165.00, proof "✓ matches" — identical at 1280, 768, 375 px; no horizontal scroll; buttons 47–48 px |
| Use these amounts, nothing typed | Fills 110.00 / 6.60 / 3.40, no dialog, Name untouched, reimbursable follows funding-source rules ($113.40, tax excluded) |
| Use these amounts, amounts typed | "Replace the amounts you typed?" shown; fields unchanged while open and after Cancel; replaced only on confirm |
| Add then remove a file | Panel re-shows with new totals; removal re-reads nothing |
| Proof differs | Appendix A warning with $120.00 / $203.00, no "matches" |
| No receipt ticked | Switches to proofs-only ($200.00 / $0.00 / $3.00 / $203.00), no "matches" |
| Receipt parts ≠ total + timesheet | Mismatch sentence under the receipt; timesheet "No amount found"; left-out line shown |
| Only a bank statement | "We couldn't read amounts…"; Dismiss hides it |
| Read route returns 500 | "Couldn't read" state; Save stays enabled |
| Supporting document | Never sent for reading |
| Edit, unlocked with receipts | No read until the button is pressed; fields unchanged by reading |
| Edit, locked month / no receipts | Button hidden |
| Settings switch off (admin) | No read requests, no panel, old tour text; back on → new tour text |
| Manager | Switch visible, disabled, forced click changes nothing |
| Base plan | No switch, no panel, no Edit button, old tour text, route 403 |

**Bugs found and fixed during verification:**
1. **Each file was read twice after the Name field had been typed in** — double the OpenAI cost.
   `use-amount-reads.ts` updated its cache ref inside a `setState` updater, which React defers
   while another update is pending; the next-read check then saw the finished file as neither
   cached nor in flight. The ref is now written synchronously. Before: 3 requests for 2 files
   (reproduced 3/3 runs). After: 4 requests for 4 files, 3/3 runs, including a removal.
2. **Edit listed proofs above receipts**, unlike Add and Appendix A. Lines are now receipts
   first, then proofs, in the shared aggregation; unit test updated.
3. **The cross-org integration test leaked an organization** whenever an assertion failed;
   cleanup moved into `finally`. Two leaked local rows deleted.
4. **Phone:** Dismiss wrapped 20 px below the main button; vertical gap reduced.

**Real-receipt test:** the key lives in `.env.local` (it had been put in the tracked
`.env.example`; moved before any commit). 11 synthetic documents are generated and scored, but
every call returned `429 insufficient_quota` — the OpenAI account has no credit. The failure
path behaved as designed (each file `failed`, nothing thrown). Rerun once credit is added.

**Not verified:** a real OpenAI read and its cost; HEIC (no HEIC file could be generated
locally); a production build.

---

## Appendix A — Product spec (verbatim)

When Misty adds an expense, she uploads the receipt and the proof of payment, then types the Subtotal, Tax and Fees from those same documents. Typing numbers already in front of the app is slow, and it's easy to mistype. A wrong amount ends up on the cover sheet the City reads.

Today the app doesn't read uploaded documents at all.

### Goal

When a receipt or proof of payment is uploaded, the app reads it and suggests the **Subtotal, Tax, Fees and Total paid**.

- If there are several receipts, their amounts are added together.
- The user always reviews the suggestion and chooses to use it. Nothing is filled in or saved without a person confirming.
- If a document can't be read (handwritten, blurry, unusual layout), the app says so and the user types the amounts as today.

### 1. What gets read and how it adds up

Only **Receipt / justification** and **Proof of payment** files are read. **Supporting documents** are never read.

A receipt and its proof of payment usually show the same payment, so they aren't added together:

- **Receipts are added up.** For example, two Staples invoices of $120.00 and $45.00 give a total paid of $165.00.
- **Proofs of payment are a check.** If the proofs add up to something different, show a warning: "Receipts add up to $165.00 but proofs of payment show $170.00. Check the amounts before saving."
- **No receipt:** if "No receipt available" is ticked, or only proofs are uploaded, the proofs are added up instead. This covers salaries and ATM withdrawals, for example.
- **Nothing to read:** a document with no amount (such as a timesheet), or with many unrelated amounts (such as a full bank statement), is skipped. It shows as "No amount found".
- **Total paid doesn't add up:** if a receipt's total doesn't match its subtotal + tax + fees, show the figures as read and add: "The amounts on this receipt don't add up. Please check them."

All amounts are US dollars.

### 2. Add Expense: reading when files are chosen

As soon as a receipt or proof of payment is chosen, the app starts reading it. The user can keep filling in the rest of the form while it reads.

A panel appears next to the amount fields (Subtotal / Tax / Fees). It has three states.

**While reading:** "Reading 2 documents…"

**Done:**

> **Amounts found in your documents** Subtotal $150.00 · Tax $9.00 · Fees $6.00 · **Total paid $165.00**
>
> - Staples invoice 0412.pdf: Subtotal $110.00 · Tax $6.60 · Fees $3.40 · Total $120.00
> - Staples invoice 0418.jpg: Subtotal $40.00 · Tax $2.40 · Fees $2.60 · Total $45.00
> - Bank transaction.png (proof of payment): $165.00 ✓ matches
>
> [**Use these amounts**] [Dismiss]

**Couldn't read anything:** "We couldn't read amounts from these documents. Please enter them yourself."

**Rules:**

- **Nothing is filled in until the user presses "Use these amounts".** That button puts the figures into Subtotal, Tax and Fees, and they can still be changed before saving.
- **Typed amounts aren't replaced silently.** If the user already typed amounts, "Use these amounts" replaces them only after a confirm: "Replace the amounts you typed?"
- **Files change, the suggestion updates.** If a file is added or removed after the panel appears, the panel reads again and shows the new totals.
- **Reading never blocks saving.** If it fails, is slow, or the service is down, the user can type the amounts and save as today.
- **Only amounts are read.** The panel never touches Name, Description, Date or any other field.
- **The reimbursable amount follows the funding source's rules.** Once the amounts are in, "Reimbursable amount" and the cover sheet's tax/fee note work exactly as they do today.

### 3. Edit expense: reading on request

On an existing expense, nothing is read automatically, so old expenses never change by surprise.

- Near the amount fields, add a button: **Read amounts from documents**.
- It reads the receipts and proofs attached to the expense, plus any files just added, and shows the same panel as on Add Expense.
- The button is hidden when the expense has no receipts or proofs attached.
- The button is hidden when the month is locked.

### 4. Settings switch

Under **Settings → Organization**, add a switch:

- **Label:** "Read amounts from uploaded documents"
- **Help text:** "Receipts and proofs of payment are sent to OpenAI to suggest amounts. OpenAI doesn't use them for training. Nothing is saved until you confirm."
- **On by default** for every organization, including Team Pursuit.
- Only admins can change it.

When it's off, no document is sent for reading, the panel and the Edit button don't appear, and the form works exactly as it does today.

**Later this will be limited to the "Reconciliation + AI" plan.** Put the "is this organization allowed to use it?" check in one place, so adding "and is on the right plan" later is a small change. Plans come from the Admin dashboard ticket. Until then, only the Settings switch decides.

### 5. Reading service (OpenAI)

- **Model:** OpenAI **gpt-5.6-luna**. It's OpenAI's low-cost model for high-volume work, reads images and PDFs, and costs about a tenth of a cent per receipt.
- **The model name is a server setting, not written into the code.** If testing shows too many misreads, We can switch to a stronger model (for example gpt-5.4-mini) without a new release.
- **The OpenAI key is a server setting.** We add it on the server. Without a key, the feature stays hidden, as if the Settings switch were off.
- **Files and answers aren't stored at OpenAI.** Ask OpenAI not to store the request. OpenAI doesn't train on API data by default. It may still hold requests for up to 30 days for abuse checks, unless OpenAI approves us for Zero Data Retention;
- **Always the same four fields.** Ask for Subtotal, Tax, Fees and Total paid in a fixed format, plus "no amount found" when the document has none. Never accept free text.
- **Files are sent as they'll be stored.** HEIC photos are converted to JPEG before sending, the same as on upload.
- **Each read is logged**: organization, number of files, success or failure, and cost. This lets us see usage per organization later, when the feature moves to a paid plan.

### 6. Tour text

The Add Expense tour's amounts step says: "Enter the amounts from the receipt. If there's tax or fees, you'll be asked whether the funder pays for them."

Change it to: "Enter the amounts from the receipt, or upload the receipt below and use the amounts we find. If there's tax or fees, you'll be asked whether the funder pays for them."

When the Settings switch is off, keep the old text.

### Not part of this ticket

- Reading the vendor name, date, description or line item
- Reading supporting documents or month documents (such as bank statements)
- Recurring one-click add, since it has no uploads
- Limiting the feature to a plan (it's switched on per organization for now)
- Going back and reading receipts on expenses that already exist
- Currencies other than US dollars

### Done when

- **Add Expense:** choosing a clear receipt shows the panel with Subtotal, Tax, Fees and Total paid. "Use these amounts" fills the fields.
- **Several receipts:** their amounts are added together, and each file's figures are listed.
- **Proof checks:** a proof that matches shows "matches". A proof that differs shows the warning.
- **Proofs only:** an expense with only proofs, or "No receipt available", adds up the proofs.
- **Nothing to read:** a timesheet or unreadable photo shows "No amount found" and doesn't break the rest.
- **Nothing without confirmation:** no amount is filled in or saved until "Use these amounts" is pressed, and typed amounts are only replaced after the confirm.
- **Saving always works:** the form still saves normally if reading fails or is slow.
- **Edit:** "Read amounts from documents" works on existing expenses and is hidden on locked months.
- **Settings switch:** turning it off stops all reading and hides the panel and button. Managers can't change it.
- **Numbers still agree:** reimbursable amount, cover sheet note and totals are the same as if the amounts were typed by hand.
- **Real-receipt test:** tried on at least 10 real-style receipts (clear PDF, phone photo, HEIC, multi-page PDF, handwritten) with gpt-5.6-luna. The PR lists each result and the average cost per receipt.
- **No key, no feature:** with no OpenAI key on the server, the feature stays hidden and the form works as today.
- **Tour and screens:** the tour text is updated, and screens look right on phone, tablet and desktop. this is ai plus feature and only will be avaliable to plus users
