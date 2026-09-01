# Data Model

Postgres, single database, org-scoped rows (single-tenant-per-org from day one; every table except `organizations` carries `org_id`). Money = integer cents (`bigint`). Months = `char(7)` `YYYY-MM`. IDs = uuid v7, generated in app code (`uuid` package — Postgres 14 has no native `uuidv7()`). Timestamps `created_at`/`updated_at` on all tables (omitted below). Implemented in `src/db/schema.ts` (Drizzle). (Revised per `04-engineering/review-2026-08-16.md`.)

**Case-insensitive text:** the tables below describe unique text as `citext`; the implementation uses plain `text` columns with `lower()` expression unique indexes instead, so the database needs no extension provisioned. Behaviour is identical, and it matches the Integrity-rules section's `lower()` phrasing.

## Entities

### organizations
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | Legal/display name — "Team Pursuit Global" |
| doc_name | text | Name printed on documents — "Team Pursuit". Non-empty; defaults to `name` |
| active_month | char(7) | Last selected month (per-org UI persistence, R2.3). Initialized to the current month in America/Detroit at signup |
| onboarded_at | timestamptz null | Null → login redirects into onboarding (m00) |
| welcome_dismissed_at | timestamptz null | First-run banner dismissal |

### users
One per org in MVP; table exists for future multi-user.
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| email | citext unique | Login identity |
| password_hash | text | argon2id; password minimum 12 chars |

### sessions (custom auth — D-06, architecture §Auth)
| Field | Type | Notes |
|---|---|---|
| id | text PK | `SHA-256(token)` hex — the raw cookie token is never stored |
| user_id | uuid FK | cascade delete |
| expires_at | timestamptz | 30-day sliding; renewed when < 15 days remain |

Logout deletes the row; password change deletes all the user's other sessions (revocation is row deletion).

### contract_settings (1:1 organizations)
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
| perf_grant_scheduled_cents | bigint | R7.2 |
| perf_grant_billed_cents | bigint | Manually maintained (R7.2) |
| advances_received_cents | bigint | R7.4 |

### payment_sources (org-configurable list — R5.1, decision D-19)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| label | text | Unique per org (case-insensitive). Seeded with the three defaults |
| sort_order | int | |
| active | boolean | Deactivated labels leave pickers; history keeps its snapshot |

### supporting_doc_types (org-configurable list — R11.1, decision D-19)
Same shape as payment_sources; seeded with the six defaults.

### line_items
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| name | text | Unique per org, case-insensitive |
| scheduled_value_cents | bigint | Budget |
| opening_billed_cents | bigint | Opening previously-billed (R3.1); default 0 |
| sort_order | int | Cover sheet/section & packet order |

### expenses
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | Client-generated uuid v7 accepted at create (draft-upload keying) |
| org_id | uuid FK | |
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
| reference_seq | int | **Per-month, unique** with (org_id, month) — the number behind the printed reference `{month}-{seq}` (R2.6), drawn from `month_statuses.next_reference_seq`. Distinct from `sort_order`, which races and is reused after a delete |
| recurring_item_id | uuid null | Set when the row was created by a recurring item's one-click add (R8.3). Deliberately **not** a foreign key: the link records provenance, and deleting the recurring item must not alter an expense that is already part of a submitted month. Indexed. |

Stored: `tax_reimbursable`, `fees_reimbursable` — what this funder pays for, defaulted from the payment source at entry and fixed on the row thereafter (R1.3). Derived (never stored): `reimbursable` per R1.3 and `receipt total` per R1.3a; documentation status from documents (R4).

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
| month | char(7) | |
| category | enum | `bank_statement` \| `combined_hours` \| `timesheet` \| `fiduciary_invoice` \| `other` — category order authority: packet-pdf-spec §Canonical section order (the section itself is last, D-77) |
| title | text null | Optional label shown in packet manager |

### month_statuses (decision D-21)
| Field | Type | Notes |
|---|---|---|
| org_id + month | PK | |
| submitted_at | timestamptz null | Set via "Mark as submitted" on the packet screen; drives the R10.6 edit warning |

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

### generated_artifacts (R10.4 cache + R10.6 pinning)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid FK | |
| month | char(7) | |
| type | enum | `packet_pdf` \| `summary_xlsx` \| `cover_docx` \| `cover_pdf` |
| line_item_id | uuid FK null | For cover sheets |
| inputs_hash | text | Canonical-JSON hash of the full month snapshot (expenses, documents' keys+sizes, line items, contract settings, doc_name, list labels) |
| downloaded_at | timestamptz null | Set on first successful download → **pinned forever** (no replacement, no lifecycle expiry) |
| s3_key, size_bytes, page_count | | |

Unique index `(org_id, month, type, line_item_id)` **where downloaded_at is null** — one live cache entry; pinned rows accumulate as history.

## Relationships summary

organizations 1—1 contract_settings · 1—n users, payment_sources, supporting_doc_types, line_items, expenses, month_documents, month_statuses, vendor_defaults, recurring_items, generated_artifacts. expenses 1—n expense_documents. line_items 1—n expenses (restrict), recurring_items (cascade after confirm), vendor_defaults (set null).

## S3 layout (private bucket)

```
org/{orgId}/
  months/{YYYY-MM}/
    expenses/{expenseId}/{proof|receipt|supporting}/{docId}.{ext}
    month-docs/{category}/{docId}.{ext}
    generated/{type}[-{lineItemSlug}]-{inputsHash}.{ext}
backups/  (pg_dump nightly — separate prefix, 30 daily + 12 monthly, lifecycle-managed)
```

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
- Unique `(org_id, lower(name))` on line_items and vendor_defaults; unique `(org_id, lower(label))` on payment_sources and supporting_doc_types; unique `lower(email)` on users.
- `generated_artifacts` live-cache uniqueness coalesces the nullable `line_item_id` (SQL NULLs are distinct in unique indexes, which would otherwise allow duplicate packet/summary cache rows).
- Indexes for hot paths (declared in the Drizzle schema): expenses `(org_id, month)`; expense_documents `(expense_id, kind, sort_order)`; month_documents `(org_id, month, category, sort_order)`; generated_artifacts `(org_id, month, type, line_item_id)`; sessions `(user_id)`, `(expires_at)`.
- No denormalized totals — all figures derive at read time through the calculation service (R10.2).
