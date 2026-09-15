# Phase 8 — Locking a reconciled month

Planning document. Not started — no code, no migration yet. Written against
`implementation/Multi-Grant` at commit `8d4f9d3` (2026-09-15); update file:line references if
the branch has moved since.

The product ask is reproduced verbatim in **Appendix A**. Read it first; this document is the
build plan for it, not a restatement.

---

## 1. What this is, in one paragraph

When the City sends back a signed, approved packet, the team locks that (funding source, month):
the signed PDF is stored with it, the month shows **Reconciled**, and nothing about its expenses
or month documents can change until someone unlocks it. Unlock → fix → re-download → lock again
with a new signed copy; earlier copies are kept. The rule that shapes the design: **"the block must
still hold if someone had a page open before the month was locked."** So the lock is checked on the
server at the moment of every save. Disabled buttons are a courtesy, never the guarantee.

This reverses one part of **D-21**, where a submitted month was "deliberately not a lock"
(`src/modules/packet/actions.ts:48-50`, `app/r/packet/submitted-marker.tsx:14-16`). Submitted stays
as it is; **Reconciled** is the new state on top of it. Recorded as **D-96**.

---

## 2. Investigation — what already exists

- **`month_statuses`** (`src/db/schema.ts:687`) is already one row per
  `(org_id, funding_source_id, month)`, holding `submitted_at` and the reference counter. The lock
  flag goes here: per source per month by its primary key, which is exactly "each funding source
  locks its months separately".
- **Every expense insert already takes that row's lock**: `claimReferenceSeq`
  (`src/modules/expenses/references.ts:45`) upserts it inside the save's transaction. A lock check
  on the same row, in the same transaction, is therefore race-safe for free (§3.2).
- **Submitting captures a figures snapshot** (`captureMonthSnapshot`, `src/modules/packet/snapshot.ts:28`),
  replacing any earlier one (`:21-27`). The Dashboard's "changed since submitted" notice compares
  against it.
- **`users.name`** + `userDisplay(name, email)` (`src/domain/user-display.ts`, D-89) give "by Awais".
- **Every write the ticket names:**

  | Write | Where | In a transaction today |
  |---|---|---|
  | Create expense | `createExpenseAction`, `src/modules/expenses/actions.ts:213` | yes (`:264`) |
  | Edit / move expense | `updateExpenseAction`, `:294` | yes (`:413`) — **but the target month's reference is claimed before it, on `db`** (`:406`) |
  | Delete expense | `deleteExpenseAction`, `:492` | yes |
  | Restore | `restoreExpenseAction`, `:538` — from Trash (`trash-table.tsx:172`) **and** the Packet page's recently-deleted list (`packet-download-buttons.tsx:73`) | yes |
  | Permanently delete | `permanentlyDeleteExpenseAction`, `:585` | yes |
  | Remove an attached file | `removeExpenseDocumentAction`, `:661` | no |
  | Attach a file | upload route `:105` → `ingestExpenseDocument`, `src/services/storage/documents.ts:189` | yes (`:284`) — its expense lookup (`:208`) reads the month but **not the source** |
  | Recurring "Add to {month}" | `addRecurringToMonthAction`, `src/modules/recurring/actions.ts:122` | **no** — insert (`:195`) and reference claim (`:217`) are separate |
  | Recurring "Remove" | `removeRecurringFromMonthAction`, `:237` | no |
  | Add month document | upload route `:72` → `ingestMonthDocument`, `documents.ts:339` | yes (`:411`) |
  | Remove month document | `removeMonthDocumentAction`, `src/modules/packet/actions.ts:20` | no |
  | Undo "Submitted" | `clearMonthSubmittedAction`, `actions.ts:82` | no (single update) |

- **Uploads store the object first, then refuse inside the transaction** (`documents.ts:271` then
  quota at `:303`; `:402` then `:427`), cleaning up on refusal. A lock refusal slots in beside the
  quota check and inherits that cleanup.
- **Files never go through Server Actions** — Next limits their body size; every upload uses
  `app/api/files/upload/route.ts` (`:47-48`). The signed PDF must too.
- **Quota counts two tables** (`orgStorageError`, `documents.ts:154-155`); **downloads by id**
  (`app/api/files/[id]/route.ts:40-54`) try two tables. Signed copies are a third line in each.
- **No object sweep exists** (`architecture.md:38` names `sweep.ts`; it was never built), so nothing
  deletes unreferenced objects today. Any future sweep must treat signed copies as live.
- **Reusable UI:** `MonthDocuments` already has `readOnly`; the edit page already loads
  `month_statuses` rows into a `"{sourceId}:{month}"` map for the submitted warning
  (`app/r/expenses/[id]/edit/page.tsx:43-57`, `expense-form.tsx:291`); `Select` renders a real
  `<button>` (`src/components/ui/select.tsx:227`), so a native `<fieldset disabled>` disables the
  whole form.

---

## 3. Design decisions

| # | Decision | Why |
|---|---|---|
| 3.1 | **State: one nullable column, `month_statuses.locked_at`. History: one append-only table, `month_lock_events`** — a row with a stored file is a lock (the signed copy), a row without one is an unlock (with its optional reason). "Locked on {date} by {name}", the current copy, and each earlier copy's "Replaced on {date}" are all read off the ordered events — nothing else stored. Unlocking clears only `locked_at`; `submitted_at` stays, which is what puts the month back to **Submitted**, not Open. | The column is only the fast guard flag; everything shown to people comes from one list, so there is one source of truth for history. Both are written in the same transaction. |
| 3.2 | **One guard, `monthLocked(tx, orgId, sourceId, months)`**, the first thing inside each write's transaction: for each month's row, in sorted key order, `INSERT … ON CONFLICT DO NOTHING` then `SELECT locked_at … FOR UPDATE`; returns `true` when any is locked, and the action returns `fail(UI.monthLocked(...))` before writing anything. | Inside the transaction is what makes the open-page case and a lock pressed mid-save both hold: lock and save take the same row lock, so one waits for the other and sees its result. `FOR UPDATE` rather than `FOR SHARE` because expense inserts already upgrade to an exclusive lock on this row (§2) — two share locks upgrading would deadlock. Sorted order is one `.sort()` and covers a move that touches two months. A plain boolean, not an exception, because the guard runs before any write. |
| 3.3 | **The guard creates the month's row if it doesn't exist yet**, before locking it. | A `SELECT … FOR UPDATE` that finds no row does not wait for another transaction's uncommitted insert of it, so without this a lock on a month with no row yet (an empty month, §7 Q4) and that month's first expense saved at the same instant could both succeed. `INSERT … ON CONFLICT DO NOTHING` *does* wait on a conflicting uncommitted insert, so the `FOR UPDATE` after it always sees the lock's committed result. Two statements, in one helper. |
| 3.4 | **The few writes not in a transaction get one**, because a check outside a transaction is check-then-act: recurring add (insert + reference claim, which also fixes their existing non-atomicity), recurring remove, remove expense file, remove month document. `updateExpenseAction` claims its reference inside the transaction after the guard, not before it. | Required for the guarantee, and fixes a real burn: today a refused move would still spend the target month's reference number. |
| 3.5 | **Undo "Submitted" needs no transaction**: its update gains `AND locked_at IS NULL` (the lock is on that same row, so one conditional statement is atomic). `markMonthSubmittedAction` is left alone — its button is hidden on a locked month and re-marking changes no expense. | Smallest correct change for both. |
| 3.6 | **Lock = one upload request** (`target=signed-packet` on the existing upload route), not a Server Action: inspect (must be PDF), store, then one transaction — lock the row, refuse if already locked or if the month has blocking records (§3.7), set `submitted_at` if null, set `locked_at`, insert the lock event, re-capture the snapshot (§7 Q1). Refusal cleans up the stored object the way quota refusals already do. **Unlock = a Server Action**: `UPDATE … SET locked_at = NULL WHERE … AND locked_at IS NOT NULL` + insert the unlock event, one transaction. Signed copies are never deleted. | Server Actions can't take a 25 MB body. One request means a lock can't exist without its copy. |
| 3.7 | **"Missing documents" = the existing blocking list** (`loadPacketReadiness(...).blocking`, R4.3), checked inside the lock's transaction after the row lock is held. | One definition; button and server can't disagree. |
| 3.8 | **Signed copy = an ordinary upload**: the existing inspection (must come back `application/pdf`), ≤ 25 MB, counted in the quota, key `org/{orgId}/months/{YYYY-MM}/signed-packets/{fundingSourceId}/{eventId}.pdf`, served by `/api/files/[id]`. | Reuses the upload, quota and download paths; no new route. |
| 3.9 | **Admins and managers** (`actionSession()`). | Ticket. |
| 3.10 | **One message** `UI.monthLocked(monthLabel)` and the disabled-button text, both in `domain-rules.md` §12 and `strings.ts`. | Project rule for interface wording. |
| 3.11 | **Read-only expense page = `<fieldset disabled>` around the form + no Save button.** Locked months reach the form the same way submitted ones already do: the edit page's existing `month_statuses` query also selects `locked_at`. | Native disabling covers every input, the dropdown and the upload buttons in one attribute. No new loader for that page. |
| 3.12 | **Out of scope** (ticket): line items, performances, source settings, other months. Not added either: a Reconciled badge in the header or Dashboard, or lock entries in expense History. | The Dashboard's drift notice already covers figures moving under a locked month. |

---

## 4. Data model

```ts
// src/db/schema.ts

// month_statuses gains:
lockedAt: timestamp("locked_at", { withTimezone: true }),

/** Lock/unlock history per (source, month), append-only (D-96). The newest `locked` row is the
 *  current signed copy; earlier `locked` rows are replaced copies, kept forever. */
export const monthLockEvents = pgTable(
  "month_lock_events",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fundingSourceId: uuid("funding_source_id").notNull(),
    month: char({ length: 7 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Unlock only; trimmed, null when blank. */
    reason: text(),
    /** Set on a lock (the signed copy, always a PDF), null on an unlock — this is what says
     *  which of the two a row is. */
    s3Key: text("s3_key"),
    filename: text(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("month_lock_events_month_idx").on(t.orgId, t.fundingSourceId, t.month, t.createdAt),
    foreignKey({ columns: [t.fundingSourceId, t.orgId], foreignColumns: [fundingSources.id, fundingSources.orgId] }),
  ],
);
```

Migration `0026`, additive: one table, one nullable column. No backfill. A deleted user leaves the
event with a null actor, rendered "Unknown" (D-89). No separate lock/unlock field: a lock always has
its signed copy and an unlock never does, so the file is the flag.

---

## 5. Server surface

All in the existing packet module, which already owns month-level actions and queries:

- **`src/modules/packet/lock.ts`** (new; server-only, no `"use server"`, because the upload route
  and the expense/recurring modules import it): `monthLocked` guard, `lockMonth`.
- **`src/modules/packet/actions.ts`** (existing): `unlockMonthAction(month, fundingSourceId, reason)`,
  beside mark/clear submitted.
- **`src/modules/packet/queries.ts`** (existing): `loadLockedMonths(orgId, sourceId | null)` → set of
  `"{sourceId}:{month}"` for the list screens; `loadLockEvents(orgId, sourceId, month?)` → ordered
  events, used by the Packet tab (one month) and by Reporting periods (all months, merged with the
  months that have live expenses or a submission).
- **Guard added** to every row of the §2 table. A move checks the old and the new (source, month);
  file attach/remove checks the expense's own.
- `orgStorageError` and `/api/files/[id]` each gain the new table.

---

## 6. Screens

- **Month-End Packet** (`app/r/packet/page.tsx:98`): **Lock month** beside the Submitted marker,
  disabled with its message while the red blocking panel shows; the lock dialog per Appendix A
  (posts to the upload route). Locked: the **Reconciled** line
  (`Reconciled · Locked on {date} by {name} · View signed packet · Unlock`) at the top; "Submitted
  {date}" stays but its Undo is hidden; `MonthDocuments readOnly` with the lock message;
  recently-deleted Restore disabled; downloads unchanged. The **Unlock** dialog per Appendix A. The
  month's event list beneath: current copy, earlier copies labelled "Replaced on {date}", unlock
  reasons.
- **Edit expense**: locked month → message at the top, `<fieldset disabled>`, no Save. The Expenses
  row menu's History stays available to admins (a read, untouched by the lock).
- **Expense form month choice** (add and edit): choosing a locked (source, month) shows the message
  where the submitted notice shows, and Save is refused.
- **Expenses** (`expenses-table.tsx:403`), **Trash** (`trash-table.tsx:172`, `:189`), **Recurring**
  (`recurring-manager.tsx:183`, `:192`): the row's action disabled with the message, looked up by
  the row's own source and month.
- **Contract Summary** (after the downloads, `app/r/contract-summary/page.tsx:190`): **Reporting
  periods**, newest first, with a month's event list beneath it when it was locked more than once.
- **Tour** (`src/modules/tours/packet-tour.ts:37`): new last-step copy.

---

## 7. Open questions — defaults applied unless told otherwise

1. **Locking re-captures the "as submitted" figures.** The signed copy is what the City approved;
   without this, unlock → fix → lock leaves the Dashboard's drift notice on forever. It is one call
   to the existing function, the same rule re-submitting already follows.
2. **Re-locking keeps the original Submitted date.**
3. **Archived sources can lock and unlock** — R14.3 already allows finishing their last months.
4. **A month with no expenses can be locked** — nothing blocks its download either.
5. **Reporting periods ignores months whose only expenses are in the Trash.**

---

## 8. Build plan — two phases

Each phase ends green: `typecheck`, `lint`, `build`, full `npm test` **with the integration tests
running against the database** (start Docker first). Docs change in the same commit as the
behaviour they describe.

### Phase 1 — The lock, on the server
- Migration `0026`; `packet/lock.ts`, unlock action and the two queries in the packet module; upload
  route `target=signed-packet`;
  quota and download lookups; the guard on every §2 write; the transactions from §3.4–3.5.
- Docs: `domain-rules.md` **R10.7** + §12 strings; `data-model.md`; `decisions.md` **D-96**.
- Tests (integration):
  - lock: stores the copy; refused with blocking records; refused for a non-PDF; refused when
    already locked; marks an unsubmitted month submitted; source A's March leaves source B's open.
  - unlock with and without a reason; lock → unlock → lock keeps both copies, newest current.
  - **one table-driven test over the §2 writes**: each refused on a locked month with the message,
    and nothing changed (expense row, files, reference counter). Moves into and out of a locked
    month included. Each guard proven by removing it and watching its case fail.
  - **the open-page case**: read the expense, lock the month, then save → refused.
  - **the race**: a transaction holding the month's row lock makes a concurrent save wait, then
    refuses it once the lock commits.
  - downloads and `/api/files/[id]` still serve a locked month.

### Phase 2 — The screens
- Everything in §6.
- Docs: `m02`, `m03`, `m05`, `m06`, `m07` module specs; README map; this file's Results.
- Verified live: lock, view copy, unlock with a reason, re-lock, both copies downloadable; the
  blocked lock; the open-page case in two browser sessions; phone, tablet and desktop widths.

---

## 9. Acceptance criteria → where each is proven

| Criterion (Appendix A "Done when") | Proven by |
|---|---|
| A complete month locks with a signed PDF and shows Reconciled on Packet and Contract Summary | Phase 1 tests; Phase 2 live |
| A month with missing documents can't be locked, with the reason shown | Phase 1 (server); Phase 2 live (button + message) |
| Locking an unsubmitted month marks it submitted | Phase 1 |
| Every section 2 action is blocked with the message, including an already-open page | Phase 1 table-driven, open-page and race tests; Phase 2 live in two sessions |
| Viewing and downloads still work on a locked month | Phase 1; Phase 2 live |
| Locking one source's March doesn't affect another's | Phase 1 |
| Unlock works with or without a reason, shown in history | Phase 1; Phase 2 live |
| After unlock → fix → lock, both copies download, newest current | Phase 1; Phase 2 live |
| Reporting periods shows Open, Submitted, Reconciled correctly | Phase 1 (`loadLockEvents` + periods); Phase 2 live |
| Screens look right on phone, tablet, desktop | Phase 2 viewport pass |

---

## Appendix A — Product spec (verbatim, 2026-09-15)

Each month the team downloads the packet, sends it to the City, and presses **Mark as submitted**
on the Month-End Packet tab. The City reviews it and sends back a signed, approved copy.

Today:

- The app has nowhere to keep that signed copy.
- A finished month can still be changed by mistake. Editing an expense in a submitted month only
  shows a warning, and Save still works.
- Nothing shows which months are settled and which are still open.

### Goal

When the signed packet arrives, the team locks that month. Locking:

- saves the signed copy with the month
- marks the month as **Reconciled**
- stops the month's expenses from being changed

If the City asks for a correction, the team unlocks the month, makes the fix, downloads a fresh
packet, and locks the month again with the new signed copy.

Each funding source locks its months separately. Locking March for one funding source doesn't lock
March for another.

### The three states of a month

**Open → Submitted → Reconciled**

- **Open:** nothing has been sent yet.
- **Submitted:** someone pressed "Mark as submitted". This already exists and doesn't change.
- **Reconciled:** someone locked the month and uploaded the signed copy.

Locking is always something a person does. Nothing locks on its own. Admins and managers can both
lock and unlock.

### 1. Locking a month (Month-End Packet tab)

Add a **Lock month** button next to "Mark as submitted" (or next to "Submitted 04/08/2026" once
it's marked).

Pressing it opens a dialog:

- **Title:** "Lock March 2026?"
- **Text:** "Upload the signed packet from the City. Once locked, this month's expenses can't be
  changed until someone unlocks it."
- A file picker for the signed copy (PDF only).
- Buttons: **Lock month** and **Cancel**. Lock month stays disabled until a file is chosen.

Rules:

- **Missing documents:** you can't lock while the red "This packet cannot be downloaded yet."
  message is showing. The button is disabled and says: "Add the missing documents before locking
  this month."
- **Not yet submitted:** if nobody marked the month as submitted, locking marks it submitted too,
  with today's date.

After locking, the top of the page shows:

> **Reconciled** · Locked on 04/20/2026 by Awais · View signed packet · Unlock

While the month is locked:

- The "Undo" link for Submitted is hidden.
- The month documents section has no Add or Remove.
- Downloads still work.

### 2. What a locked month protects

For that funding source and month, nobody can:

- add a new expense to it, including picking that month in the Add Expense form
- edit one of its expenses, including attaching or removing files
- move an expense into it or out of it (changing the month or the funding source)
- delete one of its expenses
- restore or permanently delete one of its expenses from Trash
- press "Add to Mar" or "Remove" for it on the Recurring tab
- add or remove month documents

People can still view everything, download the packet, the Excel summary and cover sheets, and
admins can still open History.

When something is blocked, say why and where to go:

> "March 2026 is locked. Unlock it on the Month-End Packet tab to make changes."

Examples:

- **Opening a locked expense:** the page shows the message at the top, the fields can't be changed,
  and there's no Save button.
- **Expenses tab:** Delete is disabled for rows in a locked month.
- **Recurring tab:** "Add to Mar" is disabled with the message.
- **Expense form:** choosing a locked month when adding or editing an expense shows the message, and
  Save is refused.

The block must still hold if someone had a page open before the month was locked. For example,
Usman has an expense's edit page open, Misty locks March, and then Usman presses Save. The save is
refused with the message above.

**Not part of this ticket:** line items, performances, funding source settings and other months
stay editable, even though they can change a locked month's figures. The Dashboard's existing
"March 2026 has changed since it was submitted" notice already covers that.

### 3. Unlocking a month

Pressing **Unlock** opens a dialog:

- **Title:** "Unlock March 2026?"
- **Text:** "Its expenses can be changed again. The signed copy stays saved. Lock the month again
  when the new signed copy arrives."
- **Reason (optional):** for example, "City asked us to remove the duplicate Staples invoice."
- Buttons: **Unlock** and **Cancel**.

After unlocking:

- The month goes back to **Submitted**, not Open.
- The team makes the correction, downloads a fresh packet, and presses **Lock month** again with the
  new signed copy.
- The new signed copy becomes the current one.
- Earlier signed copies are never deleted. They stay downloadable, labelled "Replaced on
  05/02/2026".

### 4. Month list (Contract Summary tab)

Add a **Reporting periods** section for the selected funding source. List every month that has
expenses, or has been submitted or locked, newest first.

| Month | Status | Details |
| --- | --- | --- |
| April 2026 | Open | — |
| March 2026 | Submitted | Submitted 04/08/2026 |
| February 2026 | Reconciled | Locked 05/02/2026 by Misty · View signed packet |
| January 2026 | Reconciled | Locked 02/25/2026 by Awais · View signed packet |

Under a month that was unlocked and locked again, show what happened, oldest first:

- Locked 03/20/2026 by Misty · View signed packet (replaced)
- Unlocked 04/28/2026 by Awais — "City asked us to remove the duplicate Staples invoice"
- Locked 05/02/2026 by Misty · View signed packet

The Month-End Packet tab shows the same details for the month selected in the header: the current
signed copy, earlier copies, and unlock reasons.

### 5. Tour text

The Month-End Packet tour's last step still says: "Mark the month as submitted once it's sent. You
can still correct it later."

Change it to: "Mark the month as submitted once it's sent. When the signed copy comes back, lock
the month so nothing changes by accident."

### Done when

- A month with no missing documents can be locked with a signed PDF. It then shows as Reconciled on
  both the Month-End Packet and Contract Summary tabs.
- A month with missing documents can't be locked, and the reason is shown.
- Locking a month that wasn't submitted also marks it submitted.
- Every action in section 2 is blocked for a locked month, with the message. This includes a page
  that was already open before the lock.
- Viewing and all downloads still work for a locked month.
- Locking March for one funding source doesn't affect March for another.
- Unlocking works with or without a reason, and the reason shows in the history.
- After unlock → fix → lock again, both signed copies can be downloaded and the newest is marked
  current.
- The Reporting periods list shows Open, Submitted and Reconciled correctly.
- Screens look right on phone, tablet and desktop.
