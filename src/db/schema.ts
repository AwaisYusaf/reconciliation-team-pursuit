/**
 * Drizzle schema — implements docs/01-domain/data-model.md.
 *
 * Conventions (see the doc for the authoritative description):
 * - Money is always integer cents (`bigint`, JS number mode; safe to 2^53 cents ≈ $90T).
 * - Months are `char(7)` `YYYY-MM` keys (R2.1).
 * - Ids are uuid v7, generated in app code (Postgres 14 has no native `uuidv7()`).
 * - Case-insensitive uniqueness uses `lower()` expression indexes rather than the
 *   `citext` extension, so the database needs no extensions to be provisioned.
 * - Every table except `organizations` carries `org_id`; every query path re-checks it.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

/** Shared column builders. */
const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());
const cents = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
/**
 * Money that may legitimately be absent, as opposed to zero.
 *
 * Same storage as `cents`, without the not-null default: a remembered amount has to be able
 * to say "never learned", which is a different fact from an amount that really is zero.
 */
const nullableCents = (name: string) => bigint(name, { mode: "number" });
// Column names are given explicitly: without them Drizzle uses the TypeScript property
// name, which would put camelCase "createdAt" beside snake_case "org_id" and force every
// hand-written query to quote it.
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ enums */

/** expense_documents.kind — proof of payment, receipt/justification, or extra evidence (R4, R11.1). */
export const documentKind = pgEnum("document_kind", ["proof", "receipt", "supporting"]);

/** Upload lifecycle — only `attached` satisfies the documentation gate (R4.6). */
export const documentStatus = pgEnum("document_status", ["pending", "attached", "failed"]);

/** Month-level document categories. Packet order authority: packet-pdf-spec §2 (R11.2). */
export const monthDocumentCategory = pgEnum("month_document_category", [
  "bank_statement",
  "combined_hours",
  "timesheet",
  "fiduciary_invoice",
  "other",
]);

/** Generated output types (R10.4). */
export const artifactType = pgEnum("artifact_type", [
  "packet_pdf",
  "summary_xlsx",
  "cover_docx",
  "cover_pdf",
]);

/** users.role — admin = the org-creating account and anyone it promotes; manager = expenses/grants only. */
export const userRole = pgEnum("user_role", ["admin", "manager"]);

/** expense_audit_events.action — the five expense mutations this audit trail covers. */
export const expenseAuditAction = pgEnum("expense_audit_action", [
  "created",
  "edited",
  "deleted",
  "restored",
  "permanently_deleted",
]);

/* ----------------------------------------------------------- organizations */

export const organizations = pgTable("organizations", {
  id: id(),
  /** Legal/display name — "Team Pursuit Global". */
  name: text().notNull(),
  /** Name printed on documents — "Team Pursuit". Non-empty; defaults to `name`. */
  docName: text("doc_name").notNull(),
  /** Last selected month (per-org UI persistence, R2.3). */
  activeMonth: char("active_month", { length: 7 }).notNull(),
  /** Null → login redirects into onboarding (m00). */
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  /** First-run banner dismissal (m00). */
  welcomeDismissedAt: timestamp("welcome_dismissed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------- users */

export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    /**
     * Display name for "who did this" (created-by/updated-by, audit actor). Nullable: an
     * account that predates this column has no name on file, and falls back to email at
     * render (`userDisplay`) rather than a guessed value.
     */
    name: text(),
    /** argon2id; password minimum 12 chars (D-06/D-24). */
    passwordHash: text("password_hash").notNull(),
    /** admin = the org-creating account and anyone it promotes; manager = expenses/grants only.
     *  No column default on purpose, same reason as expenses.referenceSeq: a default makes this
     *  optional on insert, and a forgotten role would silently mint an admin. */
    role: userRole().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_org_idx").on(t.orgId),
  ],
);

/* ---------------------------------------------------------------- sessions */

/**
 * Custom session auth (D-06). `id` is the SHA-256 hex of the random cookie token —
 * the raw token is never stored, so a database leak cannot forge cookies.
 * Revocation is row deletion; password change deletes all of a user's other rows.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 30-day sliding expiry; renewed when under 15 days remain. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

/* ------------------------------------------------------- contract settings */

export const contractSettings = pgTable("contract_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  projectName: text("project_name").notNull().default(""),
  contractNumber: text("contract_number").notNull().default(""),
  basePoNumber: text("base_po_number").notNull().default(""),
  performancePoNumber: text("performance_po_number").notNull().default(""),
  /** 0 → derive from the sum of scheduled values (R7.3). */
  contractValueCents: cents("contract_value_cents"),
  contractStart: date("contract_start"),
  contractEnd: date("contract_end"),
  fiduciaryName: text("fiduciary_name").notNull().default(""),
  advancesReceivedCents: cents("advances_received_cents"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* --------------------------------------------------- configurable label lists */

/** Org-configurable payment sources (R5.1, D-19). Expenses store the label as a snapshot. */
export const paymentSources = pgTable(
  "payment_sources",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: text().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Deactivated labels leave pickers; history keeps its snapshot. */
    active: boolean().notNull().default(true),
    /**
     * The reimbursement rules this funder applies, offered as the default on a new expense
     * (R1.3, D-67). "Different funding sources have different requirements" is the reason the
     * feature exists, so the source is where the answer belongs — set once, not re-decided
     * on every entry. The expense keeps its own copy once saved.
     */
    taxReimbursable: boolean("tax_reimbursable").notNull().default(false),
    feesReimbursable: boolean("fees_reimbursable").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("payment_sources_org_label_uq").on(t.orgId, sql`lower(${t.label})`)],
);

/** Org-configurable supporting document types (R11.1, D-19). */
export const supportingDocTypes = pgTable(
  "supporting_doc_types",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: text().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("supporting_doc_types_org_label_uq").on(t.orgId, sql`lower(${t.label})`)],
);

/* --------------------------------------------------------------- line items */

export const lineItems = pgTable(
  "line_items",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Budget / scheduled value. */
    scheduledValueCents: cents("scheduled_value_cents"),
    /** Opening previously-billed balance from setup (R3.1). */
    openingBilledCents: cents("opening_billed_cents"),
    /** Cover sheet / packet section / summary row order. */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("line_items_org_name_uq").on(t.orgId, sql`lower(${t.name})`),
    index("line_items_org_sort_idx").on(t.orgId, t.sortOrder),
  ],
);

/**
 * Performances (m08): additive amounts on top of a line item's base `scheduledValueCents`.
 *
 * Replaces the old hand-maintained `contract_settings.perf_grant_*` figure — instead of one
 * contract-wide number nobody could bill real expenses against, each performance lives on a
 * real line item and rolls into the same Scheduled Value everything else already reads
 * (`loadLineItemBudgets`), so it bills down through the ordinary expense flow like any other
 * budget dollar.
 */
export const lineItemPerformances = pgTable(
  "line_item_performances",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    lineItemId: uuid("line_item_id")
      .notNull()
      .references(() => lineItems.id, { onDelete: "cascade" }),
    amountCents: cents("amount_cents"),
    /**
     * Required at the point of adding a new performance through the UI; absent (null) on any
     * row that predates this column, including the migration-created Performance Grant row.
     */
    name: text(),
    /** Same nullability story as `name` above — required going forward, absent on legacy rows. */
    date: date(),
    /** Numbers the on-screen "Performance 1 / 2 / 3" list in the order each was added. */
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Whether this performance is money the org's `contract_value_cents` doesn't already
     * reflect (D-82). Defaults false, which is what every pre-existing row means: the
     * migration-created performance (and anything else that predates this column) is money
     * that was already part of the whole-contract figure someone typed into Settings, long
     * before it had a line item of its own — adding it again on top of `contract_value_cents`
     * would double it. `addLineItemPerformanceAction` sets this true explicitly, since a
     * performance added from here on really is new money the org hasn't caught up to yet.
     */
    countsTowardContractTotal: boolean("counts_toward_contract_total").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("line_item_performances_line_item_idx").on(t.lineItemId),
    check("line_item_performances_amount_ck", sql`${t.amountCents} > 0`),
  ],
);

/* ----------------------------------------------------------------- expenses */

export const expenses = pgTable(
  "expenses",
  {
    /** Client-generated uuid v7 accepted at create, so draft uploads can be keyed before the row exists. */
    id: uuid().primaryKey().$defaultFn(() => uuidv7()),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Restricted: a line item with expenses cannot be deleted (R9.3). */
    lineItemId: uuid("line_item_id")
      .notNull()
      .references(() => lineItems.id, { onDelete: "restrict" }),
    /** Reporting month (R2.1); editable from the form (R2.2). */
    month: char({ length: 7 }).notNull(),
    /** Defaults to today in America/Detroit (R2.5); independent of `month`. */
    date: date().notNull(),
    /** Payee/label — vendor, person, or free text like "ATM Withdrawal". */
    name: text().notNull(),
    /** The cover-sheet "Role" column text (R6.2). */
    description: text().notNull().default(""),
    /** Label snapshot from payment_sources (R5.1). */
    paymentSource: text("payment_source").notNull(),
    subtotalCents: cents("subtotal_cents"),
    taxCents: cents("tax_cents"),
    feesCents: cents("fees_cents"),
    /**
     * Which parts of the receipt this funder reimburses (R1.3).
     *
     * Recorded on the expense rather than derived from the payment source at read time: the
     * source is a snapshot on the row and its rules can change, but what was *claimed* must
     * stay what it was on the day it was submitted.
     *
     * **No column default**, for the same reason `reference_seq` has none. Migration 0011
     * backfilled every existing row to the original rule and then the defaults were dropped
     * (0013): while they existed, an insert could omit them and silently claim a different
     * amount from an identical expense entered another way — which is exactly what the
     * recurring one-click add did. `reimbursementRulesFor` is the only supplier.
     */
    taxReimbursable: boolean("tax_reimbursable").notNull(),
    feesReimbursable: boolean("fees_reimbursable").notNull(),
    /** Inline heading note; a note naming what was excluded auto-prints when so (R6.5). */
    note: text(),
    /** Paragraph note printed under the heading (R6.6). */
    narrative: text(),
    noReceipt: boolean("no_receipt").notNull().default(false),
    /** Required non-empty when noReceipt; prints on the cover sheet (R4.2, R6.7). */
    noReceiptReason: text("no_receipt_reason"),
    /** Per-month monotonic counter assigned at insert — orders the month list, cover sheet rows and Excel grouping. */
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * The number behind this expense's reference, unique within its month (R2.6).
     *
     * Deliberately not `sort_order`, which looks like it would do: that value races on
     * assignment and is reused after a delete, so two expenses in a month can share one. A
     * reference that is printed, quoted and used to find a document has to be unique, which
     * is what the index on (org, month, reference_seq) enforces — and the counter it is
     * drawn from lives on `month_statuses`, so a deleted expense's number is never reissued.
     *
     * Reassigned if the expense is moved to another month, because the reference names the
     * packet it appears in — a 2026-02 reference sitting in the March packet would be worse
     * than a renumbered one.
     */
    /**
     * Per-month reference number (R2.6). **No default on purpose.**
     *
     * With a default, Drizzle makes this optional on insert and any new insert path that
     * forgets it silently lands on the same value — two of them then collide on
     * `expenses_org_month_reference_uq`. That is exactly what happened to the recurring
     * one-click add. Required here, so forgetting is a type error; `claimReferenceSeq` in
     * `modules/expenses/references.ts` is the only supplier.
     */
    referenceSeq: integer("reference_seq").notNull(),
    /**
     * Set when the expense was created by one-click "Add to month" (R8.3).
     * Remove targets this link rather than matching on name, so undoing an add can never
     * delete a manually entered expense that happens to share a payee and line item.
     */
    recurringItemId: uuid("recurring_item_id"),
    /** Set when trashed; null means active. Restore clears it, permanent delete removes the row. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expenses_recurring_idx").on(t.recurringItemId),
    index("expenses_org_month_idx").on(t.orgId, t.month),
    index("expenses_line_item_idx").on(t.lineItemId),
    index("expenses_org_month_sort_idx").on(t.orgId, t.month, t.sortOrder),
    // What makes a reference trustworthy. Assignment reads max+1 and can race, so the
    // database is the arbiter and the caller retries rather than hoping.
    uniqueIndex("expenses_org_month_reference_uq").on(t.orgId, t.month, t.referenceSeq),
    // References start at 1 (R2.6). Catches anything reaching the table outside Drizzle —
    // a raw SQL insert cannot fall back to 0 and collide with the next one.
    check("expenses_reference_seq_ck", sql`${t.referenceSeq} >= 1`),
    check(
      "expenses_no_receipt_reason_ck",
      sql`not ${t.noReceipt} or (${t.noReceiptReason} is not null and btrim(${t.noReceiptReason}) <> '')`,
    ),
  ],
);

/* ----------------------------------------------------- expense audit events */

/**
 * The audit trail's before/after field snapshot (D-87) — the same field set `toRow()` builds
 * in `src/modules/expenses/actions.ts`, plus `lineItemName` resolved at write time. Declared
 * here (not derived from `toRow()`'s return type) so the jsonb columns below can be typed
 * without a modules → db import, and so both the write and read side share one enforced shape
 * instead of one side trusting an unchecked cast.
 */
export type ExpenseAuditSnapshot = {
  name: string;
  lineItemId: string;
  lineItemName: string;
  paymentSource: string;
  month: string;
  date: string;
  description: string;
  subtotalCents: number;
  taxCents: number;
  feesCents: number;
  taxReimbursable: boolean;
  feesReimbursable: boolean;
  note: string | null;
  narrative: string | null;
  noReceipt: boolean;
  noReceiptReason: string | null;
};

export const expenseAuditEvents = pgTable(
  "expense_audit_events",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * Nullable and NOT cascaded from expenses on purpose: an audit log that disappears when
     * the row it describes is hard-deleted defeats its own purpose. `permanentlyDeleteExpenseAction`
     * writes this event before deleting the expense; the FK then nulls this column out instead
     * of removing the row, so actor/action/timestamp survive the expense itself.
     */
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: expenseAuditAction().notNull(),
    /**
     * Field-level before/after snapshots (D-87), so the audit page can show what actually
     * changed rather than only that a change happened. Both null on create; only `afterData`
     * set on create/restore; only `beforeData` set on delete/permanent delete; both set on
     * edit. Same field set `toRow()` builds, plus `lineItemName` resolved at write time —
     * money stays raw integer cents, formatted only at render.
     */
    beforeData: jsonb("before_data").$type<ExpenseAuditSnapshot>(),
    afterData: jsonb("after_data").$type<ExpenseAuditSnapshot>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("expense_audit_events_expense_idx").on(t.expenseId, t.createdAt),
    // The org-wide audit page (loadOrgAuditHistory) filters and paginates by org_id alone —
    // without this, that query has no usable index and falls back to a full table scan as
    // the log grows, since the per-expense index above doesn't help it.
    index("expense_audit_events_org_idx").on(t.orgId, t.createdAt),
  ],
);

/* -------------------------------------------------------- expense documents */

export const expenseDocuments = pgTable(
  "expense_documents",
  {
    /** Server-generated at presign; the client only ever references this id (never a raw S3 key). */
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    kind: documentKind().notNull(),
    /** Label snapshot from supporting_doc_types — required iff kind = 'supporting'. */
    supportingType: text("supporting_type"),
    status: documentStatus().notNull().default("pending"),
    s3Key: text("s3_key").notNull(),
    /** Original upload name — lives here, never in the S3 key (PII-free keys). */
    filename: text().notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    /**
     * Bytes of the thumbnail written alongside an image, 0 when there is none (PDFs).
     *
     * Separate from `size_bytes`, which is the document's own size and is what the UI shows
     * and what the artifact cache key hashes. Recorded so the storage quota can charge for
     * every object actually put in the bucket — it previously charged for none of these.
     */
    thumbnailBytes: integer("thumbnail_bytes").notNull().default(0),
    /** Filled at process-and-attach; PDFs get their real page count, images 1. */
    pageCount: integer("page_count"),
    /** Filled at process-and-attach; drives cover-sheet and packet page estimates. */
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expense_documents_expense_idx").on(t.expenseId, t.kind, t.sortOrder),
    index("expense_documents_org_idx").on(t.orgId),
    check(
      "expense_documents_supporting_type_ck",
      sql`(${t.kind} = 'supporting') = (${t.supportingType} is not null)`,
    ),
  ],
);

/* ---------------------------------------------------------- month documents */

export const monthDocuments = pgTable(
  "month_documents",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    month: char({ length: 7 }).notNull(),
    category: monthDocumentCategory().notNull(),
    /** Optional label shown in the packet manager. */
    title: text(),
    status: documentStatus().notNull().default("pending"),
    s3Key: text("s3_key").notNull(),
    filename: text().notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    /** As on `expense_documents` — bytes of the thumbnail, 0 when there is none. */
    thumbnailBytes: integer("thumbnail_bytes").notNull().default(0),
    pageCount: integer("page_count"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("month_documents_org_month_idx").on(t.orgId, t.month, t.category, t.sortOrder)],
);

/* ----------------------------------------------------------- month statuses */

/** Submission marker driving the R10.6 edit warning. */
export const monthStatuses = pgTable(
  "month_statuses",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    month: char({ length: 7 }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /**
     * The next expense reference to hand out in this month (R2.6).
     *
     * A counter rather than `max(reference_seq) + 1` over the live rows, because that reuses
     * the number of a deleted expense — the very flaw that rules `sort_order` out. Deleting
     * an expense leaves a gap here and never gives its reference to something else.
     *
     * Incremented by the insert itself, under the row lock the upsert takes, so two saves in
     * the same month cannot be handed the same number and nothing has to retry.
     */
    nextReferenceSeq: integer("next_reference_seq").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.month] })],
);

/* --------------------------------------------------------- month snapshots */

/**
 * What each line item's budget looked like when a month was submitted (R3.8, D-68).
 *
 * Everything here is otherwise recomputed from live expense rows, which means a correction
 * to an old month silently restates its "closing balance" — so the month-end figure is not a
 * record of where things stood at month end, it is where they stand now. This table is that
 * record.
 *
 * A record, not a lock: corrections still flow through to the live figures exactly as before.
 * When the two differ the screen shows both, because both are true — one is what was sent,
 * the other is what is now known.
 *
 * Cents, never rounded percentages: a stored percentage and a recomputed one disagree at the
 * rounding boundary (R1.5), and this table exists to be compared against live figures.
 */
export const monthSnapshots = pgTable(
  "month_snapshots",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    month: char({ length: 7 }).notNull(),
    /**
     * Nulled rather than cascaded when a line item is deleted, matching generated artifacts:
     * a submitted month's figures are evidence of what was claimed, and deleting a line item
     * years later must not erase it (D-21).
     */
    lineItemId: uuid("line_item_id").references(() => lineItems.id, { onDelete: "set null" }),
    /** The name at submission, so a later rename cannot rewrite history. */
    lineItemName: text("line_item_name").notNull(),
    scheduledValueCents: cents("scheduled_value_cents"),
    /** R3.1 — opening balance: everything billed before this month. */
    previouslyBilledCents: cents("previously_billed_cents"),
    /** R3.2 — this month's own activity, the figure the client wants kept separate. */
    spentThisMonthCents: cents("spent_this_month_cents"),
    /** R3.3 and R3.4, stored rather than re-derived so a comparison cannot drift. */
    totalBilledCents: cents("total_billed_cents"),
    remainingCents: cents("remaining_cents"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("month_snapshots_line_item_uq").on(t.orgId, t.month, t.lineItemName),
    index("month_snapshots_lookup_idx").on(t.orgId, t.month),
  ],
);

/**
 * The month-level figures that have no month dimension of their own (R7.2, R7.4).
 *
 * The performance grant and advances received are hand-maintained running totals — there is
 * no history to reconstruct and asking for one would mean asking the client for numbers they
 * have never kept. What *is* knowable is the value each held when the packet was built, which
 * is exactly what that packet was produced from. Captured, not invented.
 */
export const monthSnapshotTotals = pgTable(
  "month_snapshot_totals",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    month: char({ length: 7 }).notNull(),
    contractValueCents: cents("contract_value_cents"),
    perfGrantScheduledCents: cents("perf_grant_scheduled_cents"),
    perfGrantBilledCents: cents("perf_grant_billed_cents"),
    advancesReceivedCents: cents("advances_received_cents"),
    /** When these were captured — the submission that produced them. */
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.month] })],
);

/* ---------------------------------------------------------- vendor defaults */

/** Autofill library; learns automatically on every expense save (R8.1–R8.2). */
export const vendorDefaults = pgTable(
  "vendor_defaults",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Set null when the line item is deleted (R9.3). */
    defaultLineItemId: uuid("default_line_item_id").references(() => lineItems.id, {
      onDelete: "set null",
    }),
    defaultDescription: text("default_description").notNull().default(""),
    /**
     * What this payee last cost, offered as a starting point on the next expense (R8.1).
     *
     * Nullable, and deliberately not defaulted to zero: null means "never learned", which is
     * a different fact from a vendor whose tax really is zero — and most are. Conflating them
     * would prefill every new expense with a confident $0.00 it never actually learned.
     */
    /**
     * The label this payee was last paid through. Null means never learned.
     *
     * Stored as the label rather than a foreign key, matching `expenses.payment_source` — the
     * list is user-editable and a retired label has to stay readable on old records (R5.2).
     * A remembered label that has since been retired is not offered on a new expense.
     */
    defaultPaymentSource: text("default_payment_source"),
    defaultSubtotalCents: nullableCents("default_subtotal_cents"),
    defaultTaxCents: nullableCents("default_tax_cents"),
    defaultFeesCents: nullableCents("default_fees_cents"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("vendor_defaults_org_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

/* ---------------------------------------------------------- recurring items */

/** Fixed monthly set — subscriptions and salaries (R8.3). */
export const recurringItems = pgTable(
  "recurring_items",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    amountCents: cents("amount_cents"),
    /** Cascade-deleted with the line item, after the confirm dialog listing them (R9.3). */
    lineItemId: uuid("line_item_id")
      .notNull()
      .references(() => lineItems.id, { onDelete: "cascade" }),
    defaultDescription: text("default_description"),
    /**
     * The narrative to carry into next month's expense (R8.3).
     *
     * Lives here rather than on `vendor_defaults` on purpose: the vendor library is learned
     * automatically on every save with latest-write-wins (R8.2), so one expense saved with an
     * empty narrative would wipe the remembered paragraph. A recurring item is curated, so
     * the text only changes when someone means it to (D-66).
     */
    defaultNarrative: text("default_narrative"),
    /** Stored as the label, matching `expenses.payment_source` (R5.2). */
    defaultPaymentSource: text("default_payment_source"),
    /** A subscription's tax and fees are the same every month; null means never set. */
    defaultTaxCents: nullableCents("default_tax_cents"),
    defaultFeesCents: nullableCents("default_fees_cents"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recurring_items_org_sort_idx").on(t.orgId, t.sortOrder)],
);

/* ------------------------------------------------------ generated artifacts */

/**
 * Output cache (R10.4) and permanent submission record (R10.6).
 * A row with `downloaded_at` set is pinned: never replaced, never lifecycle-expired,
 * so the org can always reproduce exactly what the City received.
 */
export const generatedArtifacts = pgTable(
  "generated_artifacts",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    month: char({ length: 7 }).notNull(),
    type: artifactType().notNull(),
    /**
     * Set for cover sheets, null for packet/summary.
     *
     * Nulled rather than cascaded when the line item goes: a downloaded artifact is the
     * permanent record of what the City received (R10.6, D-21), and deleting a line item
     * years later must not erase the evidence that a cover sheet for it was submitted.
     */
    lineItemId: uuid("line_item_id").references(() => lineItems.id, { onDelete: "set null" }),
    /** Canonical-JSON hash of the full month snapshot (rows, settings, doc keys + sizes). */
    inputsHash: text("inputs_hash").notNull(),
    /** Set on first successful download → pinned forever. */
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    s3Key: text("s3_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    pageCount: integer("page_count"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("generated_artifacts_lookup_idx").on(t.orgId, t.month, t.type, t.lineItemId),
    // One live cache entry per output; pinned (downloaded) rows accumulate as history.
    // line_item_id is coalesced because SQL NULLs are distinct in unique indexes.
    uniqueIndex("generated_artifacts_live_uq")
      .on(
        t.orgId,
        t.month,
        t.type,
        sql`coalesce(${t.lineItemId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.downloadedAt} is null`),
    // One row per distinct set of bytes. Outputs are deterministic (R10.1), so two
    // concurrent downloads of the same month build the same artifact; without this they
    // would each insert a row and the permanent submission record would carry duplicates.
    uniqueIndex("generated_artifacts_content_uq").on(
      t.orgId,
      t.month,
      t.type,
      sql`coalesce(${t.lineItemId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.inputsHash,
    ),
  ],
);

/* -------------------------------------------------------------------- types */

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ContractSettings = typeof contractSettings.$inferSelect;
export type PaymentSource = typeof paymentSources.$inferSelect;
export type SupportingDocType = typeof supportingDocTypes.$inferSelect;
export type LineItem = typeof lineItems.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type ExpenseAuditEventRow = typeof expenseAuditEvents.$inferSelect;
export type ExpenseDocument = typeof expenseDocuments.$inferSelect;
export type MonthDocument = typeof monthDocuments.$inferSelect;
export type MonthStatus = typeof monthStatuses.$inferSelect;
export type VendorDefault = typeof vendorDefaults.$inferSelect;
export type RecurringItem = typeof recurringItems.$inferSelect;
export type GeneratedArtifact = typeof generatedArtifacts.$inferSelect;
export type MonthSnapshotRow = typeof monthSnapshots.$inferSelect;
export type MonthSnapshotTotals = typeof monthSnapshotTotals.$inferSelect;

export type DocumentKind = (typeof documentKind.enumValues)[number];
export type DocumentStatus = (typeof documentStatus.enumValues)[number];
export type MonthDocumentCategory = (typeof monthDocumentCategory.enumValues)[number];
export type ArtifactType = (typeof artifactType.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type ExpenseAuditActionType = (typeof expenseAuditAction.enumValues)[number];
