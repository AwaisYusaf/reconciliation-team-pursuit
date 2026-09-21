# Data Model

Postgres, single database, org-scoped rows (single-tenant-per-org from day one; every table except `organizations` carries `org_id`). Money = integer cents (`bigint`). Months = `char(7)` `YYYY-MM`. IDs = uuid v7, generated in app code (`uuid` package — Postgres 14 has no native `uuidv7()`). Timestamps `created_at`/`updated_at` on all tables (omitted below). Implemented in `src/db/schema.ts` (Drizzle). (Revised per `04-engineering/review-2026-08-16.md`.)

**Funding sources (Phase 6, D-93):** every grant-scoped table (line items and everything under them) also carries `funding_source_id`, backed by a composite FK to `funding_sources(id, org_id)` so a row can never point at another organisation's or another source's parent. `contract_settings` and the payment-source rule columns are kept but deprecated — no longer read or written.

**Case-insensitive text:** the tables below describe unique text as `citext`; the implementation uses plain `text` columns with `lower()` expression unique indexes instead, so the database needs no extension provisioned. Behaviour is identical, and it matches the Integrity-rules section's `lower()` phrasing.

## Entities

### organizations
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | Legal/display name — "Team Pursuit Global" |
| doc_name | text | Name printed on documents — "Team Pursuit". Non-empty; defaults to `name` |
| active_month | char(7) | Last selected month (per-org UI persistence, R2.3). Initialized to the current month in America/Detroit at signup |
| active_funding_source_id | uuid FK null | Last selected funding source (per-org UI persistence, same model as `active_month`, D-93 2.5). `NULL` = "All". Plain single-column FK (not composite — `SET NULL` on a composite key would null `organizations.id` too); app code re-validates it belongs to the org whenever it is read |
| onboarded_at | timestamptz null | Null → login redirects into onboarding (m00) |
| welcome_dismissed_at | timestamptz null | First-run banner dismissal |
| plan | org_plan enum | `reconciliation` \| `reconciliation_ai`. Hand-set until Stripe is connected (Phase 9, D-98) |
| subscription_status | subscription_status enum | `trial` \| `active` \| `past_due` \| `cancelled` |
| complimentary | boolean | Free access, independent of `subscription_status` |
| complimentary_until | date null | Null → no end. A past date is allowed and shows as ended |
| suspended_at | timestamptz null | Set → every session for this org is refused and its users can't sign in. Enforced in `resolveSession` (Phase 9 part 2, D-99); written by `suspendOrgAction`/`reinstateOrgAction` and read by `signInAction`'s paused branch |
| read_amounts_enabled | boolean | Settings → Organization switch (Phase 10, D-105). Default `true`, admin-only to change. Combined with `plan` and the server's OpenAI configuration in `canReadAmounts` — never decided from this column alone |

The five columns above arrive in migration `0027`, which ends with a one-off
`UPDATE organizations SET subscription_status = 'active', complimentary = true;` — every
organization that exists when the migration runs becomes Reconciliation · Active ·
Complimentary with no end date, so nobody loses access on the day this ships. Organizations
created afterwards take the column defaults (`reconciliation` · `trial` · not complimentary),
which is also what old code still running between the migration and the restart would insert.

### users
Multi-user per org (D-85). Org creation provisions one `admin`; admins create `manager` accounts. User management (add user, reset password) is admin-only, enforced server-side in the action.
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| name | text null | Display name for "who did this" (D-89). Null for an account that predates this column; falls back to email at render (`userDisplay`) rather than a guess |
| email | text, unique index on `lower(email)` | Login identity. Postgres has no `citext` extension here; the case-insensitive uniqueness is the functional index `users_email_lower_uq` |
| password_hash | text | argon2id; password minimum 12 chars |
| role | user_role enum | `admin` \| `manager`. No column default — a forgotten role is a type error, not a silent admin (D-85) |
| last_sign_in_at | timestamptz null | Written from ship date on (Phase 9); null on every account that predates it |

### sessions (custom auth — D-06, architecture §Auth)
| Field | Type | Notes |
|---|---|---|
| id | text PK | `SHA-256(token)` hex — the raw cookie token is never stored |
| user_id | uuid FK | cascade delete |
| expires_at | timestamptz | 30-day sliding; renewed when < 15 days remain |

Logout deletes the row; password change deletes all the user's other sessions (revocation is row deletion).

### staff_users (Phase 9, D-98)
AB Solutions staff accounts, separate from `users` — they don't belong to any organisation and can't resolve through the customer session path. No sign-up; created by the developer (`db:create-staff`).
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text, unique index on `lower(email)` | Login identity (`staff_users_email_lower_uq`). Also unique across both `users` and `staff_users`, enforced in application code by `emailInUse()` — no single constraint spans two tables |
| name | text | |
| password_hash | text | argon2id, same policy as `users` |

### staff_sessions (Phase 9, D-98)
The staff equivalent of `sessions` — same token, TTL and sliding-renewal rules. `getStaffSession()` looks here; `getSession()` never does.
| Field | Type | Notes |
|---|---|---|
| id | text PK | `SHA-256(token)` hex |
| staff_user_id | uuid FK | cascade delete |
| expires_at | timestamptz | 30-day sliding; renewed when < 15 days remain |

### org_account_events (Phase 9, D-98)
History of every account change AB Solutions staff make on an organisation's plan, status, complimentary access or suspension, written by the four admin actions in `src/modules/admin/actions.ts` (Phase 2).
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | cascade delete |
| actor_staff_id | uuid FK null | Set null when the acting staff account is removed — shown as "Unknown" |
| action | org_account_event_action enum | `plan_changed` \| `complimentary_granted` \| `complimentary_changed` \| `complimentary_removed` \| `suspended` \| `reinstated` |
| before / after | jsonb | `OrgAccountSnapshot` — `{ plan, status, complimentary, complimentaryUntil, suspended }` |
| note | text null | Trimmed; the suspend reason is required, the rest optional |

### contract_settings (1:1 organizations) — **deprecated (Phase 6, D-93)**
Superseded by `funding_sources`: contract details now live on each funding source. Kept in the database, no longer read or written, so the migration stays additive and reversible. A later phase drops this table once Phase 6 has run in production.
| Field | Type | Notes |
|---|---|---|
| org_id | uuid PK/FK | Row always created at onboarding (zero/null defaults), even on Skip |
| project_name | text | "Community Violence Intervention" |
| contract_number | text | e.g. 6007211 |
| base_po_number | text | e.g. 3086984 |
| performance_po_number | text | e.g. 3089749 |
| contract_value_cents | bigint | 0 → derive from scheduled totals (R7.3) |
| contract_start / contract_end | date null | |
| fiduciary_name | text | "Detroit Crime Commission" |
| advances_received_cents | bigint | R7.4 |

`perf_grant_scheduled_cents`/`perf_grant_billed_cents` (R7.2) are retired — dropped in
`drizzle/0015_narrow_diamondback.sql`, which migrates any existing value into a real line item
(see `line_items`/`line_item_performances` below) before dropping the columns (D-80).

### payment_sources (org-configurable list — R5.1, decision D-19)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| label | text | Unique per org (case-insensitive). Seeded with the three defaults |
| sort_order | int | |
| active | boolean | Deactivated labels leave pickers; history keeps its snapshot |
| tax_reimbursable / fees_reimbursable | boolean | **Deprecated (Phase 6, D-93)** — superseded by `funding_sources.tax_reimbursable`/`fees_reimbursable`. Kept in the database, no longer read or written: payment sources go back to meaning only how something was paid |

### supporting_doc_types (org-configurable list — R11.1, decision D-19)
Same shape as payment_sources; seeded with the six defaults.

### funding_sources (Phase 6, D-93)
An organisation's separate pot of money: its own line items, expenses, monthly packets, contract details and reimbursement rules. Every organisation gets one at sign-up; existing organisations were migrated into their first source (`drizzle/0023_faulty_tyrannus.sql`). Composite FK target: `(id, org_id)` is unique, so every grant-scoped table can reference it with a composite FK that makes cross-source and cross-org rows unrepresentable.
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | cascade delete |
| name | text | Unique per org, case-insensitive |
| type | funding_source_type enum | `grant` \| `donation` \| `line_of_credit` \| `other`; default `grant` |
| doc_name | text null | Printed on this source's documents; null → `organizations.doc_name` |
| project_name | text | "Community Violence Intervention" — same columns/defaults as the deprecated `contract_settings` |
| contract_number | text | e.g. 6007211 |
| base_po_number | text | e.g. 3086984 |
| performance_po_number | text | e.g. 3089749 |
| contract_value_cents | bigint | 0 → derive from scheduled totals (R7.3) |
| contract_start / contract_end | date null | |
| fiduciary_name | text | "Detroit Crime Commission" |
| advances_received_cents | bigint | R7.4 |
| tax_reimbursable / fees_reimbursable | boolean | Reimbursement rules (moved from `payment_sources`, R1.3). No column defaults — a forgotten value must be a type error |
| sort_order | int | Order in pickers and the All dashboard |
| archived_at | timestamptz null | Set → hidden from pickers; history and documents stay |

### line_items
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| funding_source_id | uuid FK | Composite FK `(funding_source_id, org_id) → funding_sources(id, org_id)` (D-93 2.2) |
| name | text | Unique per **source**, case-insensitive — two sources can each have "Salary" |
| scheduled_value_cents | bigint | **Base** budget, directly editable — the effective Scheduled Value everything else reads is this plus every row in `line_item_performances` (R9.5), summed in `loadLineItemBudgets` |
| opening_billed_cents | bigint | Opening previously-billed (R3.1); default 0 |
| sort_order | int | Cover sheet/section & packet order |

### line_item_performances (R9.5)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| line_item_id | uuid FK | cascade delete with its line item |
| amount_cents | bigint | Check `> 0` |
| name | text null | Required when added through the UI (D-92); null for a performance that predates this column, rendered as a positional fallback ("Performance 1/2/3…"), never guessed — editing such a row starts the field blank, so it is only ever filled with a value someone typed |
| date | date null | Same nullability story as `name` — required going forward, absent on legacy rows |
| sort_order | int | Order added — numbers the on-screen "Performance 1/2/3…" fallback when `name` is absent |
| counts_toward_contract_total | boolean | Default `false` (R7.3, D-82). `addLineItemPerformanceAction` sets it `true` — new money the org's `contract_value_cents` hasn't caught up to. Every pre-existing row, the migrated Performance Grant included, defaults `false`: that money was already inside whatever the org typed into `contract_value_cents` before it had a line item of its own. When `false`, `saveLineItemPerformanceAction` refuses any change to `amount_cents` (name/date stay editable) — surfaced to the UI as `amountLocked` (R9.5, D-92) |

Replaces the retired `contract_settings.perf_grant_*` figures (R7.2, D-80): a performance is
an amount, name and date added to a line item from the Line Items screen's "Manage" panel
(D-92), with no month dimension of its own — it changes the base figure a normal month's math
(R3) already runs against. `name`/`date` are display-only: nothing downstream (the packet, the
Excel workbook, Contract Summary) reads them, only the pre-aggregated total.

### expenses
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | Client-generated uuid v7 accepted at create (draft-upload keying) |
| org_id | uuid FK | |
| funding_source_id | uuid FK | Stored directly even though derivable from the line item (D-93 2.1). Composite FK `(funding_source_id, org_id) → funding_sources(id, org_id)`; composite FK `(line_item_id, funding_source_id) → line_items(id, funding_source_id)` makes a cross-source line item unrepresentable |
| line_item_id | uuid FK | restrict delete (R9.3) |
| month | char(7) | R2.1; editable from the form (R2.2) |
| date | date | Defaults today in America/Detroit (R2.5); independent of month |
| name | text | Payee/label — vendor, person, "ATM Withdrawal" |
| description | text | The cover-sheet "Role" text |
| payment_source | text | Label snapshot from payment_sources (R5.1) |
| subtotal_cents / tax_cents / fees_cents | bigint | Negatives allowed (R1.4) |
| note | text null | Inline heading note; tax note additionally auto-prints when tax > 0 (R6.5) |
| narrative | text null | Paragraph note (R6.6) |
| no_receipt | boolean | default false |
| no_receipt_reason | text null | Required non-empty when no_receipt (R4.2, R6.7) |
| sort_order | int | **Per-month monotonic counter** assigned at insert — orders m03's flat list, cover-sheet rows (within line item), and Excel grouping consistently |
| reference_seq | int | **Per-(source, month), unique** with (org_id, funding_source_id, month) — the number behind the printed reference `{month}-{seq}` (R2.6, D-93 2.6), drawn from `month_statuses.next_reference_seq`. Distinct from `sort_order`, which races and is reused after a delete |
| recurring_item_id | uuid null | Set when the row was created by a recurring item's one-click add (R8.3). Deliberately **not** a foreign key: the link records provenance, and deleting the recurring item must not alter an expense that is already part of a submitted month. Indexed. |

Stored: `tax_reimbursable`, `fees_reimbursable` — what this funder pays for, defaulted from the expense's **funding source** at entry (D-93; before that, from the payment source) and fixed on the row thereafter (R1.3) — changing a source's rules later never rewrites what was already claimed. Derived (never stored): `reimbursable` per R1.3 and `receipt total` per R1.3a; documentation status from documents (R4).

### expense_audit_events (D-86, D-87)
Admin-only audit trail, covering the five expense mutations only (create/edit/soft-delete/restore/permanent-delete). Recurring's own expense writes are out of scope for now, so a one-click recurring add appears nowhere in this table — its actor is simply not recorded (D-90 dropped the `expenses.created_by_user_id`/`updated_by_user_id` columns that had covered that case).

Read via `loadOrgAuditHistory` (`src/modules/expenses/queries.ts`) through its optional `expenseId` filter, which is what the Expenses table's three-dot "View history" uses (D-89) — there is no longer a separate org-wide page (D-91 removed `/r/audit`), so the per-expense view is the only reader. The unfiltered, paginated form of that query is kept for the same reason the `(org_id, created_at)` index is: it is the shape an org-wide view needs if one returns.
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | cascade delete with organization |
| expense_id | uuid FK null | **set null**, not cascade, on expense delete — see below |
| actor_user_id | uuid FK → users | who performed the mutation; NOT NULL |
| action | enum | `created` \| `edited` \| `deleted` \| `restored` \| `permanently_deleted` |
| before_data | jsonb null | field snapshot before the mutation; null on create/restore |
| after_data | jsonb null | field snapshot after the mutation; null on delete/permanent-delete |
| created_at | timestamptz | when it happened; the trail is read newest-first |

`expense_id` is nulled rather than cascaded on purpose: a log that disappears the moment the row
it describes is hard-deleted defeats its own purpose. `permanentlyDeleteExpenseAction` writes the
`permanently_deleted` event before deleting the expense, so actor/action/timestamp outlive the row.
Indexed `(expense_id, created_at)` for the per-expense batched lookup, and `(org_id, created_at)`
(D-88) for `loadOrgAuditHistory`'s org-wide, paginated read — the first index doesn't help a
query with no `expense_id` filter.

`before_data`/`after_data` (D-87) hold the same field set `toRow()` builds in `actions.ts` —
name, lineItemId, paymentSource, month, date, description, subtotalCents, taxCents, feesCents,
taxReimbursable, feesReimbursable, note, narrative, noReceipt, noReceiptReason — plus
`lineItemName`, the line item's name resolved at write time so a later rename doesn't rewrite
what was actually claimed. Money stays raw integer cents; the UI formats at render, never at
write. `created`/`restored` populate only `afterData`; `deleted`/`permanently_deleted` populate
only `beforeData`; `edited` populates both, and the audit page's diff dialog lists only the
fields that actually differ between them.

### expense_documents
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | Server-generated at presign (docId) |
| org_id / expense_id | uuid FK | cascade delete with expense (S3 cleanup via sweep) |
| kind | enum | `proof` \| `receipt` \| `supporting` |
| supporting_type | text null | Label snapshot from supporting_doc_types — required iff kind=supporting |
| status | enum | `attached` (processed OK) \| `failed` (validation error). Only `attached` satisfies R4. (`pending` predates D-30 server-proxied uploads and is no longer written — a row exists only once its bytes are stored.) |
| s3_key, filename, mime_type, size_bytes | | filename = original name (DB only — never in the key) |
| page_count | int null | PDFs: filled at processing; images: 1 |
| width_px / height_px | int null | Filled at processing; drives cover-sheet/packet page estimates |
| sort_order | int | Render order within kind |

### month_documents
Same processing/status fields as expense_documents, plus:
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| funding_source_id | uuid FK | Composite FK `(funding_source_id, org_id) → funding_sources(id, org_id)` |
| month | char(7) | |
| category | enum | `bank_statement` \| `combined_hours` \| `timesheet` \| `fiduciary_invoice` \| `other` — category order authority: packet-pdf-spec §Canonical section order (the section itself is last, D-77) |
| title | text null | Optional label shown in packet manager |

### month_statuses (decision D-21)
| Field | Type | Notes |
|---|---|---|
| org_id + funding_source_id + month | PK | Reference counter per (source, month) (D-93 2.6) |
| submitted_at | timestamptz null | Set via "Mark as submitted" on the packet screen, or by `lockMonth` on a fresh submission (not yet submitted, or a lock following an unlock — R10.7, D-96 amendment); drives the R10.6 edit warning |
| locked_at | timestamptz null | Reconciled (R10.7, D-96) — set/cleared by `lockMonth`/`unlockMonthAction`; the fast guard flag every protected write checks inside its own transaction (`monthLocked`). Unlocking never touches `submitted_at`. The first lock of an already-submitted month also leaves `submitted_at` alone — only a fresh submission moves it, kept paired with whether `lockMonth` re-captures the `month_snapshots` figures so the two never disagree |

### month_lock_events (R10.7, D-96)
Append-only lock/unlock history per (source, month). A row with `s3_key` set is a lock (the
signed copy, always a PDF); a row without one is an unlock — the file is the only flag, there is
no separate action/enum column. The newest lock row is the current signed copy; earlier lock rows
are replaced copies, kept forever.
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | cascade delete with the organisation |
| funding_source_id | uuid FK | Composite FK `(funding_source_id, org_id) → funding_sources(id, org_id)`, same pattern as `month_statuses` |
| month | char(7) | |
| actor_user_id | uuid FK null | **set null** on the user's own delete — a deleted actor's event survives, rendered "Unknown" (D-89) |
| reason | text null | Unlock only; trimmed, null when blank |
| s3_key | text null | Set on a lock, null on an unlock |
| filename | text null | Set on a lock — the uploaded name |
| size_bytes | bigint null | Set on a lock |
| created_at | timestamptz | |

Index `(org_id, funding_source_id, month, created_at)`.

### vendor_defaults (library, R8.1–R8.2)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| name | citext | unique per org |
| default_line_item_id | uuid FK null | set null on line-item delete |
| default_description | text | |
| default_payment_source | text null | label, not FK — matches expenses.payment_source; withheld if retired (R5.2) |
| default_subtotal_cents | bigint null | last amount paid, offered as a starting point |
| default_tax_cents | bigint null | null = never learned, which is not the same as 0 |
| default_fees_cents | bigint null | null = never learned, which is not the same as 0 |

### recurring_items (R8.3)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| name | text | |
| amount_cents | bigint | |
| line_item_id | uuid FK | **cascade delete** with line item (after confirm listing them — R9.3) |
| default_description | text null | |
| sort_order | int | |

### expense_imports (Phase 14, D-115)
One uploaded invoice covering several charges, and the owner of the stored file. The file becomes
a real `expense_documents` receipt on each expense only when its draft is approved, so an import
nobody approves leaves nothing behind but its own object.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | cascade |
| funding_source_id | uuid | Composite FK `(funding_source_id, org_id) → funding_sources(id, org_id)` (D-93 2.3) |
| month | char(7) | `expense_imports_month_ck` |
| uploaded_by | uuid FK null | set null on user delete; the duplicate warning then names no one |
| s3_key, filename, mime_type, size_bytes, page_count | | filename lives here, never in the key (PII-free keys) |
| sha256 | char(64) | the "already added this month" check. **Not unique**: the same invoice may be added again after a warning |
| vendor_name | text null | read off the bill as a whole |
| invoice_date | date null | every draft it creates takes this date |
| bill_tax_cents | bigint null | a tax charged on the whole bill, shown as a note and never split across lines. null = never read, which is not the same as 0 |
| bill_fees_cents | bigint null | same |

### expense_drafts (Phase 14, D-115)
One line read off an invoice, waiting for a person to check it. **Deliberately not an `expenses`
row with a flag on it** — its own table is what makes "a draft counts in nothing" a property of
the schema rather than of every reader remembering to filter, and it is why `expenses` needed no
migration. Approving builds an ordinary `ExpenseInput` and runs the normal create path, then
deletes the draft.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| import_id | uuid FK | **cascade delete** with the import: discarding an import takes its drafts |
| org_id | uuid FK | cascade |
| funding_source_id | uuid | Composite FK to `funding_sources(id, org_id)` |
| month | char(7) | `expense_drafts_month_ck` |
| date | date | the invoice date |
| name, description | text | |
| line_item_id | uuid FK **null** | null = "Needs a line item". Set null on line-item delete, unlike `expenses` (R9.3): a suggestion is not a record, so deleting a line item blanks it rather than refusing. The composite FK `(line_item_id, funding_source_id) → line_items(id, funding_source_id)` still pins a suggestion that *is* set to this draft's own source, and is not checked while null (MATCH SIMPLE) |
| payment_source | text | label snapshot (R5.1); the org's usual one when nothing matched |
| subtotal_cents, tax_cents, fees_cents | bigint | amounts printed on the invoice line win over anything remembered |
| note | text null | |
| narrative | text null | null = "Needs a narrative" |
| sort_order | int | the order the lines appeared on the bill |
| — | | **No `reference_seq`.** A draft cannot hold a reference number because there is nowhere to put one; it is claimed at approval like any other new expense |

### generated_artifacts (R10.4 cache + R10.6 pinning)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| funding_source_id | uuid FK | Composite FK `(funding_source_id, org_id) → funding_sources(id, org_id)`; part of the lookup scope, never the hashed snapshot (D-93 2.8) |
| month | char(7) | |
| type | enum | `packet_pdf` \| `summary_xlsx` \| `cover_docx` \| `cover_pdf` |
| line_item_id | uuid FK null | For cover sheets |
| inputs_hash | text | Canonical-JSON hash of the full month snapshot (expenses, documents' keys+sizes, line items, contract settings, doc_name, list labels) |
| downloaded_at | timestamptz null | Set on first successful download → **pinned forever** (no replacement, no lifecycle expiry) |
| s3_key, size_bytes, page_count | | |

Unique index `(org_id, funding_source_id, month, type, line_item_id)` **where downloaded_at is null** — one live cache entry per source; pinned rows accumulate as history.
Unique index `generated_artifacts_scope_id_uq` on `(id, org_id, funding_source_id, month, type)` — trivially unique, it exists only as the target of `shared_links_artifact_fk` (PHASE-12 P9). Sharing a file pins it, exactly as a download does (PHASE-12 P8).

### user_tour_progress (Phase 7, D-94/D-95)
| Field | Type | Notes |
|---|---|---|
| user_id | uuid FK | **cascade delete** with user |
| tour | enum PK | `dashboard` \| `add_expense` \| `recurring` \| `packet` \| `expenses` \| `cover_sheets` \| `contract_summary` \| `line_items` \| `settings` (D-95 added the last five) |
| completed_at | timestamptz | Set on Skip or Finish, never on mid-tour navigation away |

Composite PK `(user_id, tour)`. Keyed by user, not organization or browser — a tour shown once
must not reappear for that user on another device, but must show once each for every other user
of the org, including staff added later. "Show the app guide again" in Settings deletes all of a
user's own rows (`resetToursAction`), which re-arms all nine tours on next visit; the header's
(i) button (`replayTourAction`, D-95) does the same for just the current screen's tour.

### ai_usage_events (Phase 10, D-105, D-106; Phase 11, D-107)
One usage log for every AI call. Phase 10 writes one row per amount read; Phase 11 writes one row
per monthly summary run, carrying its own columns and constraint.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | cascade delete with organization |
| user_id | uuid FK null | **set null** when the acting user's account is removed |
| feature | ai_usage_feature enum | `amount_read` \| `monthly_summary` |
| outcome | ai_usage_outcome enum | amount reads: `found` \| `none` \| `failed`; monthly summaries: `success` \| `rejected` \| `failed` |
| model | text | the model setting at the time of the call (`OPENAI_READ_MODEL` for amount reads, `OPENAI_SUMMARY_MODEL` for summaries) |
| input_tokens | integer null | From the OpenAI response's `usage.input_tokens`; null when not numeric |
| output_tokens | integer null | Same, `usage.output_tokens` |
| cost_micro_usd | integer null | From `costMicroUsd` — null when either token count or either price env setting is missing |
| document_source | ai_usage_document_source enum null | amount reads only: `upload` (a freshly-picked file) \| `attached` (already on the expense) |
| document_kind | ai_usage_document_kind enum null | amount reads only: `receipt` \| `proof` — supporting documents are never read |
| funding_source_id | uuid null | monthly summaries only; composite FK `(funding_source_id, org_id)` → `funding_sources(id, org_id)`, NO ACTION (sources are archived, never deleted), so a row can't name another org's source (PR #18 round 3) |
| month | char(7) null | monthly summaries only; check `ai_usage_events_month_ck`: `YYYY-MM` |
| trigger | summary_trigger enum null | monthly summaries only: `first` (Write draft summary) \| `again` (Write again) |
| created_at | timestamptz | |

Index `(org_id, created_at)`. Check `ai_usage_events_amount_read_ck`: a row with
`feature = 'amount_read'` must have `document_source` and `document_kind`, and an amount-read
outcome. Check `ai_usage_events_monthly_summary_ck`: a row with `feature = 'monthly_summary'`
must have `funding_source_id`, `month` and `trigger`, and a summary outcome
(`success`/`rejected`/`failed`). Append-only, one row per call whatever the outcome — the usage
log for features billed per organization once they move off the plan gate. Deliberately carries
no filename, amount, document or summary content: nothing here ever needs redacting.

### monthly_summaries (Phase 11, D-107)
One AI-drafted summary per funding source per month, following the header the same way the
packet does. Write again replaces `content_markdown`, `expenses_fingerprint`, `written_*` and
`model` in place and clears `edited_*` — older drafts are not kept (out of scope).

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | cascade delete with organization |
| funding_source_id | uuid | composite FK `(funding_source_id, org_id) → funding_sources(id, org_id)`, **no action** — funding sources are never deleted, so only the org cascade above ever removes a summary (D-93 2.3) |
| month | char(7) | check `month ~ '^\d{4}-(0[1-9]\|1[0-2])$'`; `isValidMonthKey` in app too |
| content_markdown | text | as typed by the user, never rewritten by the app (P6); check `char_length(content_markdown) <= 60000` |
| version | integer, default 1 | optimistic concurrency (P10) — every save and every Write again sends the version it started from; +1 on each |
| expenses_fingerprint | char(64) | sha256 hex of the canonical JSON of the month's live expenses at write time (P7); recomputed on load to show the changed-records notice; editing never touches it, only Write again does |
| written_at | timestamptz | "Draft written …" |
| written_by | uuid FK null | set null when the writing account is removed |
| model | text | the model of the current draft (`OPENAI_SUMMARY_MODEL` at write time) |
| edited_at | timestamptz null | null until the first save after a write |
| edited_by | uuid FK null | set null when the editing account is removed |
| created_at / updated_at | timestamptz | |

Unique `(org_id, funding_source_id, month)` — one summary per source per month; this index also
serves the saved-months list (ordered by month desc), so there is no separate `written_at` index.

### shared_links (Phase 12, D-112)
A month's packet PDF or summary workbook shared by public link at `/s/{token}`. Opening the link
streams exactly the artifact the row points at, never rebuilt. Update shared file points the row
at a newer artifact and keeps the token; Stop sharing sets `revoked_at`, clears `password_hash`
and keeps the row.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | cascade delete with organization |
| funding_source_id | uuid | composite FK `(funding_source_id, org_id) → funding_sources(id, org_id)`, **no action** (D-93 2.3) |
| month | char(7) | check `month ~ '^\d{4}-(0[1-9]\|1[0-2])$'` |
| artifact_type | enum `artifact_type` | check: `packet_pdf` or `summary_xlsx` only |
| artifact_id | uuid | FK `(artifact_id, org_id, funding_source_id, month, artifact_type) → generated_artifacts(id, org_id, funding_source_id, month, type)`, named `shared_links_artifact_fk`, **no action** — a link cannot point at another org's, source's, month's or kind's file (P9) |
| token | text | twelve base62 characters, check `^[0-9A-Za-z]{12}$`; unique over **every** row, stopped ones included, so a token never comes back. Stored as written (P4) |
| password_hash | text null | argon2id; null = opens without a password. Never sent to a browser |
| filename | text | download name when last shared or updated (R10.3) |
| records_hash | text | `recordsHash(snapshot)` when last shared or updated — the snapshot's hash without a generator version, compared on load for "Your records changed" (P14) |
| created_by | uuid FK null | who first shared it; set null when that account is removed |
| shared_at | timestamptz | when the current file was put behind the link; moves on Update |
| shared_by | uuid FK null | who put it there; moves on Update; set null on removal |
| revoked_at | timestamptz null | Stop sharing |
| revoked_by | uuid FK null | set null on removal |
| created_at / updated_at | timestamptz | |

Partial unique `shared_links_active_uq` on `(org_id, funding_source_id, month, artifact_type)`
**where revoked_at is null** — one PDF link and one Excel link per source and month; it also serves
the packet tab's list. Index `(artifact_id)` serves the foreign-key check.
Checks `shared_links_revoked_password_ck` (`revoked_at is null or password_hash is null` — a stopped
link keeps no password) and `shared_links_revoked_by_ck` (`revoked_by is null or revoked_at is not
null` — one way only, since `revoked_by` is set null when that account is removed).

## Relationships summary

organizations 1—1 contract_settings (deprecated) · 1—n users, payment_sources, supporting_doc_types, funding_sources, line_items, expenses, month_documents, month_statuses, month_lock_events, vendor_defaults, recurring_items, generated_artifacts, ai_usage_events, monthly_summaries, shared_links (cascade delete). generated_artifacts 1—n shared_links (no action; pinned artifacts are never deleted). funding_sources 1—n line_items, expenses, month_documents, month_statuses, month_lock_events, generated_artifacts, monthly_summaries, shared_links (no action; funding sources are never deleted), ai_usage_events (set null on delete). expenses 1—n expense_documents. line_items 1—n expenses (restrict), recurring_items (cascade after confirm), vendor_defaults (set null). users 1—n user_tour_progress (cascade delete), month_lock_events (set null on delete), ai_usage_events (set null on delete), monthly_summaries as written_by/edited_by, shared_links as created_by/shared_by/revoked_by (set null on delete).

## S3 layout (private bucket)

```
org/{orgId}/
  months/{YYYY-MM}/
    expenses/{expenseId}/{proof|receipt|supporting}/{docId}.{ext}
    month-docs/{category}/{docId}.{ext}
    generated/{fundingSourceId}/{type}[-{lineItemSlug}]-{inputsHash}.{ext}
    signed-packets/{fundingSourceId}/{eventId}.pdf
backups/  (pg_dump nightly — separate prefix, 30 daily + 12 monthly, lifecycle-managed)
```
- **Generated artifact keys gain a `{fundingSourceId}/` segment** for artifacts written from Phase 6 on (D-93 2.9). Expense and month document keys are unchanged — the new `funding_source_id` column on the row is what scopes them. Existing rows keep their stored `s3_key`.
- **Signed packets** (R10.7, D-96): `{eventId}` is the `month_lock_events` row's own id, so every lock keeps its own object — earlier signed copies are never overwritten or deleted. Always `application/pdf`; served by `/api/files/[id]` the same as an expense or month document, looked up in `month_lock_events` where `s3_key IS NOT NULL`.

- **Keys never contain user-supplied filenames** (PII-free keys; original name lives in the DB and is served via RFC 5987-encoded `Content-Disposition`). Key month reflects upload time and is **historical** — moving an expense to another month never moves objects (DB row is authoritative).
- One sanitizer for every slug/filename use: allow `[A-Za-z0-9._ -]`, collapse whitespace, strip `\/:*?"<>|`, cap length 80.
- **Upload contract (revised — D-30):** uploads are **proxied through the server** rather than presigned direct to storage, because every file must be inspected and normalised server-side anyway. The server alone constructs keys (server-generated docId under the session org's prefix), inspects the bytes, stores them, and records the row as `attached` in one request. Clients never see or send object keys — they reference documents by **docId only**, and every read re-checks session org = row org.
- Upload presigned POST constrained server-side: images jpg/png/webp/heic ≤ 25 MB, pdf ≤ 25 MB (R13). Download presigned GET TTL ≤ 5 min, `Content-Disposition: attachment` for originals (15 min only for in-app preview/thumbnail rendering, or serve thumbnails via an authenticated proxy route).
- Bucket provisioning checklist: account-level Block Public Access, TLS-only bucket policy, SSE-S3, least-privilege IAM (prefix-scoped), access logging, versioning ON (survives app-bug deletes), CORS configured for presigned POST from `APP_URL`.

## Upload processing ("process & attach" — R4.6)

After the browser's S3 upload completes, the client calls `attachDocument(docId)`. The server then: fetches the object → magic-byte check against claimed type → rejects encrypted/corrupt/0-page PDFs and oversized pixel dimensions (sharp `limitInputPixels`) → converts HEIC/WebP → JPEG → records `page_count`, `width_px`, `height_px` → generates a thumbnail (PDF: first page) → sets status `attached`. Failure sets `failed` + a user-visible per-file error (R12 upload-failed). Documents count for the R4 gate and appear in outputs only when `attached`.

## Cleanup (nightly sweep + best-effort inline)

Deleting an expense/document deletes S3 objects inline best-effort; a nightly sweep removes: objects with no DB row older than 24 h (abandoned drafts, failed inline deletes), `failed` rows + objects older than 24 h, and unpinned `generated/` objects older than 90 d (lifecycle rule; pinned artifacts exempt).

## Integrity rules

- `no_receipt = true ⇒ no_receipt_reason <> ''` (check constraint); service layer rejects `no_receipt = true` combined with attached receipt documents (R4.2).
- `kind = 'supporting' ⇔ supporting_type not null` (check constraint).
- Unique `(org_id, lower(name))` on vendor_defaults; unique `(funding_source_id, lower(name))` on line_items (two sources can each have "Salary", D-93 2.2); unique `(org_id, lower(label))` on payment_sources and supporting_doc_types; unique `lower(email)` on users; unique `(org_id, lower(name))` on funding_sources.
- Composite FKs (D-93 2.2): every grant-scoped table's `(funding_source_id, org_id) → funding_sources(id, org_id)`, and `expenses(line_item_id, funding_source_id) → line_items(id, funding_source_id)` — cross-source and cross-org rows are unrepresentable at the database level. `ON DELETE NO ACTION` (not `RESTRICT`) so org deletion cascades in one statement.
- `generated_artifacts` live-cache uniqueness coalesces the nullable `line_item_id` (SQL NULLs are distinct in unique indexes, which would otherwise allow duplicate packet/summary cache rows).
- Indexes for hot paths (declared in the Drizzle schema): expenses `(org_id, funding_source_id, month)`; expense_documents `(expense_id, kind, sort_order)`; month_documents `(org_id, funding_source_id, month, category, sort_order)`; month_lock_events `(org_id, funding_source_id, month, created_at)`; generated_artifacts `(org_id, funding_source_id, month, type, line_item_id)`; sessions `(user_id)`, `(expires_at)`; staff_sessions `(staff_user_id)`, `(expires_at)`; org_account_events `(org_id, created_at)`.
- No denormalized totals — all figures derive at read time through the calculation service (R10.2).
