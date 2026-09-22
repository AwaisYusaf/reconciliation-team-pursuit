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
 * - Every grant-scoped table (line items and everything under them) also carries
 *   `funding_source_id`, backed by a composite FK to `funding_sources(id, org_id)` so a row
 *   can never point at another organisation's or another source's parent (Phase 6, D-93).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
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
  type AnyPgColumn,
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

/** organizations.plan — from the landing page. A label only; it doesn't turn features on or off (Phase 9). */
export const orgPlan = pgEnum("org_plan", ["reconciliation", "reconciliation_ai"]);

/** organizations.subscription_status — hand-set until Stripe is connected (Phase 9). */
export const subscriptionStatus = pgEnum("subscription_status", [
  "trial",
  "active",
  "past_due",
  "cancelled",
]);

/** org_account_events.action — the six account changes AB Solutions staff can make (Phase 9). */
export const orgAccountEventAction = pgEnum("org_account_event_action", [
  "plan_changed",
  "complimentary_granted",
  "complimentary_changed",
  "complimentary_removed",
  "suspended",
  "reinstated",
]);

/** expense_audit_events.action — the five expense mutations this audit trail covers. */
export const expenseAuditAction = pgEnum("expense_audit_action", [
  "created",
  "edited",
  "deleted",
  "restored",
  "permanently_deleted",
]);

/** user_tour_progress.tour — the nine first-run walkthroughs (Phase 7, D-94; D-95 added the
 *  five past the original four). Order here is cosmetic (enum values, not `TOUR_SEQUENCE`'s
 *  navigation order — see `src/modules/tours/sequence.ts`). */
export const tourKey = pgEnum("tour_key", [
  "dashboard",
  "add_expense",
  "recurring",
  "packet",
  "expenses",
  "cover_sheets",
  "contract_summary",
  "line_items",
  "settings",
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
  /**
   * Last selected funding source (per-org UI persistence, R2.3, same model as `active_month`).
   * `NULL` means "All". Not a composite FK: `SET NULL` on a composite key would null
   * `organizations.id` too, so this stays a plain single-column FK; app code re-validates it
   * belongs to the org whenever it is read (Phase 2). The explicit `AnyPgColumn` return type on
   * the reference callback (instead of letting it infer `fundingSources.id`'s type) is required
   * here because `funding_sources` in turn references `organizations` — without it the two
   * tables' types depend on each other and TS can't resolve either.
   */
  activeFundingSourceId: uuid("active_funding_source_id").references(
    (): AnyPgColumn => fundingSources.id,
    { onDelete: "set null" },
  ),
  /** Null → login redirects into onboarding (m00). */
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  /** First-run banner dismissal (m00). */
  welcomeDismissedAt: timestamp("welcome_dismissed_at", { withTimezone: true }),
  /** Hand-set until Stripe is connected (Phase 9). */
  plan: orgPlan().notNull().default("reconciliation"),
  subscriptionStatus: subscriptionStatus("subscription_status").notNull().default("trial"),
  /** Free access, independent of `subscriptionStatus` (Phase 9). */
  complimentary: boolean().notNull().default(false),
  /** Null → no end. Past dates are allowed and show as ended (Phase 9). */
  complimentaryUntil: date("complimentary_until"),
  /** Set → every session for this org is refused and its users can't sign in. Enforced in
   *  `resolveSession` (Phase 9 part 2, D-99); written by `suspendOrgAction`/`reinstateOrgAction`
   *  (`src/modules/admin/actions.ts`) and read by `signInAction`'s paused branch. */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  /** Settings → Organization switch (Phase 10, D-105). On by default; admin-only to change.
   *  Combined with the plan and the server's OpenAI configuration in
   *  `src/modules/ai/access.ts#canReadAmounts` — this column alone does not decide
   *  whether the feature is available. */
  readAmountsEnabled: boolean("read_amounts_enabled").notNull().default(true),
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
    /** Written from ship date on (Phase 9); null on every account that predates it. */
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
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

/* ------------------------------------------------------------ staff users */

/**
 * AB Solutions staff accounts (Phase 9, D-98). Separate from `users` on purpose: they don't
 * belong to any organisation and must never resolve through the customer session path — see
 * `staff_sessions` below. Created by the developer; there is no sign-up.
 */
export const staffUsers = pgTable(
  "staff_users",
  {
    id: id(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("staff_users_email_lower_uq").on(sql`lower(${t.email})`)],
);

/**
 * Staff sessions (Phase 9, D-98). Same cookie, token, TTL and renewal rules as `sessions` —
 * `getStaffSession()` looks here instead of there, so a customer token can never resolve as
 * staff and a staff token can never resolve through `resolveSession`.
 */
export const staffSessions = pgTable(
  "staff_sessions",
  {
    id: text().primaryKey(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("staff_sessions_staff_user_idx").on(t.staffUserId),
    index("staff_sessions_expires_idx").on(t.expiresAt),
  ],
);

/**
 * The account-fields snapshot `org_account_events` stores before/after (Phase 9). Declared
 * here for the same reason as `ExpenseAuditSnapshot` above: both jsonb columns can be typed
 * without a modules → db import.
 */
export type OrgAccountSnapshot = {
  plan: OrgPlan;
  status: SubscriptionStatus;
  complimentary: boolean;
  complimentaryUntil: string | null;
  suspended: boolean;
};

/**
 * History of every account change staff make (Phase 9, §3.8), written by the four admin
 * actions in `src/modules/admin/actions.ts` (Phase 2).
 */
export const orgAccountEvents = pgTable(
  "org_account_events",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Null shows "Unknown" — the acting staff account may since have been removed. */
    actorStaffId: uuid("actor_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
    action: orgAccountEventAction().notNull(),
    before: jsonb("before").$type<OrgAccountSnapshot>().notNull(),
    after: jsonb("after").$type<OrgAccountSnapshot>().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index("org_account_events_org_idx").on(t.orgId, t.createdAt)],
);

/* ------------------------------------------------------- contract settings */

/**
 * @deprecated Superseded by `funding_sources` (Phase 6, D-93): contract details now live on
 * each funding source. Kept in the database, no longer read or written, so the migration stays
 * additive and reversible. A later phase drops this table once Phase 6 has run in production.
 */
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
     * @deprecated Superseded by `funding_sources.tax_reimbursable`/`fees_reimbursable`
     * (Phase 6, D-93): the reimbursement rules now live on the funding source, not the payment
     * source ("payment sources go back to meaning only how something was paid"). Kept in the
     * database, no longer read or written.
     */
    taxReimbursable: boolean("tax_reimbursable").notNull().default(false),
    /** @deprecated See `taxReimbursable` above. */
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

/* ------------------------------------------------------------ funding sources */

/** funding_sources.type — Grant / Donation / Line of credit / Other (Appendix A §1). */
export const fundingSourceType = pgEnum("funding_source_type", [
  "grant",
  "donation",
  "line_of_credit",
  "other",
]);

/**
 * An organisation's separate pot of money (Phase 6, D-93): its own line items, expenses,
 * monthly packets, contract details and reimbursement rules. Every organisation gets one at
 * sign-up; existing organisations were migrated into their first source (drizzle/0023).
 */
export const fundingSources = pgTable(
  "funding_sources",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    type: fundingSourceType().notNull().default("grant"),
    /** Printed on this source's documents; null → organizations.doc_name (spec §1). */
    docName: text("doc_name"),
    // ---- contract details: same columns and defaults as contract_settings (deprecated above)
    projectName: text("project_name").notNull().default(""),
    contractNumber: text("contract_number").notNull().default(""),
    basePoNumber: text("base_po_number").notNull().default(""),
    performancePoNumber: text("performance_po_number").notNull().default(""),
    contractValueCents: cents("contract_value_cents"),
    contractStart: date("contract_start"),
    contractEnd: date("contract_end"),
    fiduciaryName: text("fiduciary_name").notNull().default(""),
    advancesReceivedCents: cents("advances_received_cents"),
    /**
     * Reimbursement rules (moved from payment_sources, R1.3). No defaults, same reason as
     * expenses.taxReimbursable below: a forgotten value must be a type error.
     */
    taxReimbursable: boolean("tax_reimbursable").notNull(),
    feesReimbursable: boolean("fees_reimbursable").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Set → hidden from pickers; history and documents stay (spec §1). */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("funding_sources_id_org_uq").on(t.id, t.orgId), // target of composite FKs
    uniqueIndex("funding_sources_org_name_uq").on(t.orgId, sql`lower(${t.name})`),
    index("funding_sources_org_sort_idx").on(t.orgId, t.sortOrder),
  ],
);

/* --------------------------------------------------------------- line items */

export const lineItems = pgTable(
  "line_items",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fundingSourceId: uuid("funding_source_id").notNull(),
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
    uniqueIndex("line_items_id_source_uq").on(t.id, t.fundingSourceId), // target of the expenses composite FK
    uniqueIndex("line_items_source_name_uq").on(t.fundingSourceId, sql`lower(${t.name})`),
    index("line_items_org_sort_idx").on(t.orgId, t.fundingSourceId, t.sortOrder),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
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
    /**
     * Denormalised from the line item (D-93 decision 2.1): letting the reference counter,
     * unique indexes and filters read this column directly avoids a join, and the composite FK
     * below makes it impossible for it to disagree with the line item it points at.
     */
    fundingSourceId: uuid("funding_source_id").notNull(),
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
     * recurring one-click add did. `rulesForFundingSource` is the only supplier.
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
    index("expenses_org_source_month_idx").on(t.orgId, t.fundingSourceId, t.month),
    // What makes a reference trustworthy. Assignment reads max+1 and can race, so the
    // database is the arbiter and the caller retries rather than hoping.
    uniqueIndex("expenses_org_month_reference_uq").on(
      t.orgId,
      t.fundingSourceId,
      t.month,
      t.referenceSeq,
    ),
    // References start at 1 (R2.6). Catches anything reaching the table outside Drizzle —
    // a raw SQL insert cannot fall back to 0 and collide with the next one.
    check("expenses_reference_seq_ck", sql`${t.referenceSeq} >= 1`),
    check(
      "expenses_no_receipt_reason_ck",
      sql`not ${t.noReceipt} or (${t.noReceiptReason} is not null and btrim(${t.noReceiptReason}) <> '')`,
    ),
    // ★ An expense's line item must belong to the expense's own source — cross-source and
    // cross-org saves become unrepresentable in the database (D-93 decision 2.2).
    foreignKey({
      columns: [t.lineItemId, t.fundingSourceId],
      foreignColumns: [lineItems.id, lineItems.fundingSourceId],
    }),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
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
  /** Set from Phase 4 on, so history can show a source move; older events simply lack it. */
  fundingSourceName?: string;
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
    fundingSourceId: uuid("funding_source_id").notNull(),
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
  (t) => [
    index("month_documents_org_month_idx").on(
      t.orgId,
      t.fundingSourceId,
      t.month,
      t.category,
      t.sortOrder,
    ),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
  ],
);

/* ----------------------------------------------------------- month statuses */

/** Submission marker driving the R10.6 edit warning. */
export const monthStatuses = pgTable(
  "month_statuses",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fundingSourceId: uuid("funding_source_id").notNull(),
    month: char({ length: 7 }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Set when this (source, month) is locked/Reconciled (R10.7, D-96). Null → not locked. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
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
  (t) => [
    primaryKey({ columns: [t.orgId, t.fundingSourceId, t.month] }),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
  ],
);

/**
 * Lock/unlock history per (source, month), append-only (R10.7, D-96). The newest `locked` row
 * is the current signed copy; earlier `locked` rows are replaced copies, kept forever.
 */
export const monthLockEvents = pgTable(
  "month_lock_events",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fundingSourceId: uuid("funding_source_id").notNull(),
    month: char({ length: 7 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Unlock only; trimmed, null when blank. */
    reason: text(),
    /** Set on a lock (the signed copy, always a PDF), null on an unlock — this is what says
     *  which of the two a row is. No separate action/enum column. */
    s3Key: text("s3_key"),
    filename: text(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("month_lock_events_month_idx").on(t.orgId, t.fundingSourceId, t.month, t.createdAt),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
  ],
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
    fundingSourceId: uuid("funding_source_id").notNull(),
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
    uniqueIndex("month_snapshots_line_item_uq").on(
      t.orgId,
      t.fundingSourceId,
      t.month,
      t.lineItemName,
    ),
    index("month_snapshots_lookup_idx").on(t.orgId, t.fundingSourceId, t.month),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
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
    fundingSourceId: uuid("funding_source_id").notNull(),
    month: char({ length: 7 }).notNull(),
    contractValueCents: cents("contract_value_cents"),
    perfGrantScheduledCents: cents("perf_grant_scheduled_cents"),
    perfGrantBilledCents: cents("perf_grant_billed_cents"),
    advancesReceivedCents: cents("advances_received_cents"),
    /** When these were captured — the submission that produced them. */
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.fundingSourceId, t.month] }),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
  ],
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

/* --------------------------------------------- expense imports and drafts */

/**
 * One uploaded invoice that covers several charges (Phase 14, D-115).
 *
 * The file is stored once and owned by this row. It becomes a real `expense_documents` receipt
 * only when a draft is approved, so an import that is never approved leaves nothing behind but
 * its own object, which the discard path deletes.
 *
 * `sha256` is the "this invoice was already added" check. Deliberately **not** unique: adding
 * the same invoice twice is allowed after a warning, because a vendor really can bill the same
 * lines again, and refusing it would be the app overruling the person who can see the paperwork.
 */
export const expenseImports = pgTable(
  "expense_imports",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fundingSourceId: uuid("funding_source_id").notNull(),
    month: char({ length: 7 }).notNull(),
    /** Null when the uploading account has since been removed; the warning then names no one. */
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    s3Key: text("s3_key").notNull(),
    /** Original upload name — lives here, never in the S3 key (PII-free keys). */
    filename: text().notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    pageCount: integer("page_count"),
    /** sha256 hex of the uploaded bytes. */
    sha256: char({ length: 64 }).notNull(),
    /** What the model read off the invoice as a whole. Null means it found none of them. */
    vendorName: text("vendor_name"),
    invoiceDate: date("invoice_date"),
    /**
     * A tax or fee charged on the whole bill rather than on one line.
     *
     * Recorded so the check screen can say it is there, and never split across the lines
     * (out of scope for Phase 14). Null means never read, which is a different fact from zero.
     */
    billTaxCents: nullableCents("bill_tax_cents"),
    billFeesCents: nullableCents("bill_fees_cents"),
    createdAt: createdAt(),
  },
  (t) => [
    // The duplicate-invoice warning's lookup, and the list of a month's imports.
    index("expense_imports_org_source_month_idx").on(t.orgId, t.fundingSourceId, t.month, t.sha256),
    // Same pattern as every other source-scoped table (D-93 2.3): NO ACTION, because funding
    // sources are archived, never deleted.
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
    check("expense_imports_month_ck", sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
  ],
);

/**
 * One line read off an invoice, waiting for a person to check it (Phase 14, D-115).
 *
 * **A draft is deliberately not an `expenses` row with a flag on it.** Its own table is what
 * makes "a draft counts in nothing" a property of the schema rather than of every reader
 * remembering to filter: no query for a month total, a line item's spend, the dashboard, the
 * packet gate, a generator or the AI monthly summary can see one, because none of them names
 * this table. It also means `expenses.reference_seq` keeps its not-null with no default — the
 * guarantee that forgetting to claim a reference number is a type error rather than two rows
 * colliding — since a draft simply has no such column to leave empty.
 *
 * Approving builds an ordinary `ExpenseInput` from this row and runs the normal create path, so
 * an approved expense is indistinguishable from one typed by hand, and the row here is deleted.
 */
export const expenseDrafts = pgTable(
  "expense_drafts",
  {
    id: id(),
    importId: uuid("import_id")
      .notNull()
      .references(() => expenseImports.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fundingSourceId: uuid("funding_source_id").notNull(),
    month: char({ length: 7 }).notNull(),
    date: date().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    /**
     * Null when nothing matched the line's name, which is the "Needs a line item" state.
     *
     * Set null rather than restricted when the line item is deleted (unlike `expenses`, R9.3):
     * a suggestion is not a record, so deleting a line item should blank the suggestion, not
     * refuse the delete. The composite key below still pins a suggestion that *is* set to this
     * draft's own source; a null one is simply not checked (MATCH SIMPLE).
     */
    lineItemId: uuid("line_item_id").references(() => lineItems.id, { onDelete: "set null" }),
    /** Label snapshot, as on `expenses` (R5.1); the org's usual one when nothing matched. */
    paymentSource: text("payment_source").notNull(),
    subtotalCents: cents("subtotal_cents"),
    taxCents: cents("tax_cents"),
    feesCents: cents("fees_cents"),
    note: text(),
    /** Empty until someone writes one, which is the "Needs a narrative" state. */
    narrative: text(),
    /** The order the lines appeared on the invoice, so the review list reads like the bill. */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expense_drafts_org_source_month_idx").on(t.orgId, t.fundingSourceId, t.month, t.sortOrder),
    index("expense_drafts_import_idx").on(t.importId, t.sortOrder),
    index("expense_drafts_line_item_idx").on(t.lineItemId),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
    // A set suggestion must belong to this draft's own source, exactly as on `expenses`
    // (D-93 2.2). Unchecked while null, which is what lets an unmatched line exist at all.
    foreignKey({
      columns: [t.lineItemId, t.fundingSourceId],
      foreignColumns: [lineItems.id, lineItems.fundingSourceId],
    }),
    check("expense_drafts_month_ck", sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
  ],
);

/**
 * Files attached to a draft before it is an expense (Phase 14).
 *
 * `expense_documents.expense_id` is NOT NULL, and a draft has no expense to point at, so the
 * proof of payment and supporting files someone adds while reviewing a draft live here until
 * approval moves them across. The stored object is written once and never re-uploaded: approval
 * inserts an `expense_documents` row carrying the same `s3_key` and deletes the row here, so the
 * bytes are only ever paid for once.
 *
 * Mirrors `expense_documents` field for field on purpose — the two are read by the same viewer,
 * and a column that exists on one and not the other would show as a gap in the packet estimates.
 */
export const expenseDraftDocuments = pgTable(
  "expense_draft_documents",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => expenseDrafts.id, { onDelete: "cascade" }),
    kind: documentKind().notNull(),
    supportingType: text("supporting_type"),
    status: documentStatus().notNull().default("pending"),
    s3Key: text("s3_key").notNull(),
    filename: text().notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    thumbnailBytes: integer("thumbnail_bytes").notNull().default(0),
    pageCount: integer("page_count"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expense_draft_documents_draft_idx").on(t.draftId, t.kind, t.sortOrder),
    index("expense_draft_documents_org_idx").on(t.orgId),
    check(
      "expense_draft_documents_supporting_type_ck",
      sql`(${t.kind} = 'supporting') = (${t.supportingType} is not null)`,
    ),
  ],
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
    fundingSourceId: uuid("funding_source_id").notNull(),
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
    index("generated_artifacts_lookup_idx").on(
      t.orgId,
      t.fundingSourceId,
      t.month,
      t.type,
      t.lineItemId,
    ),
    // One live cache entry per output; pinned (downloaded) rows accumulate as history.
    // line_item_id is coalesced because SQL NULLs are distinct in unique indexes.
    uniqueIndex("generated_artifacts_live_uq")
      .on(
        t.orgId,
        t.fundingSourceId,
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
      t.fundingSourceId,
      t.month,
      t.type,
      sql`coalesce(${t.lineItemId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.inputsHash,
    ),
    // The target of `shared_links_artifact_fk` (PHASE-12 P9). Trivially unique — `id` is the
    // primary key — but Postgres only lets a foreign key reference columns under a unique
    // constraint, and referencing all five is what makes a share unable to point at another
    // org's, source's, month's or kind's file.
    uniqueIndex("generated_artifacts_scope_id_uq").on(
      t.id,
      t.orgId,
      t.fundingSourceId,
      t.month,
      t.type,
    ),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
  ],
);

/* -------------------------------------------------------- shared links */

/**
 * A month's packet PDF or summary workbook shared by public link (PHASE-12, D-112).
 *
 * Opening `/s/{token}` serves exactly the artifact this row points at — read from storage, never
 * rebuilt. At most one active link per (source, month, kind); Stop sharing sets `revoked_at` and
 * keeps the row, so a token can never be handed out again.
 */
export const sharedLinks = pgTable(
  "shared_links",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fundingSourceId: uuid("funding_source_id").notNull(),
    month: char({ length: 7 }).notNull(),
    /** `packet_pdf` or `summary_xlsx` only (`shared_links_artifact_type_ck`). */
    artifactType: artifactType("artifact_type").notNull(),
    /** The pinned file the link serves; moves on Update shared file, the token does not. */
    artifactId: uuid("artifact_id").notNull(),
    /**
     * Stored as written, not hashed (PHASE-12 P4): the Shared links box must be able to show the
     * link again. Twelve base62 characters.
     */
    token: text().notNull(),
    /** argon2id; null means the link opens without a password. Never sent to a browser. */
    passwordHash: text("password_hash"),
    /** The download name when the file was last shared or updated (R10.3). */
    filename: text().notNull(),
    /** `recordsHash(snapshot)` when the file was last shared or updated (PHASE-12 P14). */
    recordsHash: text("records_hash").notNull(),
    /** Who first shared it (P21). Null once that account is removed. */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** When and by whom the current file was put behind the link — moves on Update (P15). */
    sharedAt: timestamp("shared_at", { withTimezone: true }).notNull(),
    sharedBy: uuid("shared_by").references(() => users.id, { onDelete: "set null" }),
    /** Stop sharing. The row stays so the token stays reserved (P16). */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Every row, stopped ones included: an old link can never come back.
    uniqueIndex("shared_links_token_uq").on(t.token),
    // One PDF link and one Excel link per source and month; also serves the packet tab's list.
    uniqueIndex("shared_links_active_uq")
      .on(t.orgId, t.fundingSourceId, t.month, t.artifactType)
      .where(sql`${t.revokedAt} is null`),
    // Serves the FK check when generated_artifacts rows are removed.
    index("shared_links_artifact_idx").on(t.artifactId),
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
    // NO ACTION, not RESTRICT: deleting an organisation cascades into both tables in one
    // statement, and NO ACTION is only checked at the end of it. Named explicitly because the
    // generated name would pass Postgres's 63-character limit.
    foreignKey({
      name: "shared_links_artifact_fk",
      columns: [t.artifactId, t.orgId, t.fundingSourceId, t.month, t.artifactType],
      foreignColumns: [
        generatedArtifacts.id,
        generatedArtifacts.orgId,
        generatedArtifacts.fundingSourceId,
        generatedArtifacts.month,
        generatedArtifacts.type,
      ],
    }),
    check("shared_links_month_ck", sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check(
      "shared_links_artifact_type_ck",
      sql`${t.artifactType} in ('packet_pdf', 'summary_xlsx')`,
    ),
    check("shared_links_token_ck", sql`${t.token} ~ '^[0-9A-Za-z]{12}$'`),
    // A stopped link keeps no password (P16): the hash has no further use.
    check("shared_links_revoked_password_ck", sql`${t.revokedAt} is null or ${t.passwordHash} is null`),
    // One way only: `revoked_by` is set null when that account is removed, the stop stays.
    check("shared_links_revoked_by_ck", sql`${t.revokedBy} is null or ${t.revokedAt} is not null`),
  ],
);

/* ------------------------------------------------------- tour progress */

/**
 * Per-user "have they seen this tour" record (Phase 7, D-94). One row per tour actually
 * finished or skipped — both count as seen, so a user isn't shown it again. No row means not
 * yet shown. Per-user rather than per-org: a teammate added later has no rows of their own and
 * sees every tour once, same as a brand-new sign-up. Deleting a user's rows ("Show the app
 * guide again" in Settings) re-arms every tour on their next visit to each tab.
 */
export const userTourProgress = pgTable(
  "user_tour_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tour: tourKey().notNull(),
    /** When this tour was marked seen — by finishing or by Skip, which count the same. Named
     *  explicitly rather than reusing the shared `createdAt()` builder: that would work (the
     *  row is only ever inserted, never updated), but it locks the SQL column to `created_at`
     *  when what it actually records is completion, which reads oddly in a raw query. */
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tour] })],
);

/* ------------------------------------------------------------ AI usage events */

/**
 * ai_usage_events.feature — which AI feature made the call (D-106).
 *
 * `monthly_summary` is declared now, before Phase 11 uses it: Postgres cannot add an enum value
 * and use it in the same migration transaction, and Phase 11's migration needs to reference it in
 * a check constraint.
 *
 * `invoice_read` (Phase 14) is one row per multi-line invoice read. It reuses the amount-read
 * document columns — an invoice is always a freshly-picked file read as a receipt — so its check
 * constraint below is the amount-read one over again rather than a new shape. Adding the value
 * and the constraint that names it needs two migration files, for the same Postgres reason.
 */
export const aiUsageFeature = pgEnum("ai_usage_feature", [
  "amount_read",
  "monthly_summary",
  "invoice_read",
]);

/**
 * ai_usage_events.outcome. `found`/`none`/`failed` are amount reads (Phase 10); `success` and
 * `rejected` (the figure check failed after a retry) are monthly summaries (Phase 11), declared now
 * for the same reason as `monthly_summary` above. Which outcomes a feature may use is enforced by
 * the table's check constraints.
 */
export const aiUsageOutcome = pgEnum("ai_usage_outcome", ["found", "none", "failed", "success", "rejected"]);

/** ai_usage_events.document_source — amount reads only: a freshly-picked file, or one already
 *  attached to the expense (Phase 10, D-105). */
export const aiUsageDocumentSource = pgEnum("ai_usage_document_source", ["upload", "attached"]);

/** ai_usage_events.document_kind — amount reads only: receipts and proofs are the only documents
 *  ever read (Phase 10 §1). */
export const aiUsageDocumentKind = pgEnum("ai_usage_document_kind", ["receipt", "proof"]);

/** ai_usage_events.trigger — monthly summaries only: the first draft, or a Write again
 *  (Phase 11, D-107, P12). */
export const summaryTrigger = pgEnum("summary_trigger", ["first", "again"]);

/**
 * One usage log for every AI call (D-106) — one row per amount read (Phase 10, D-105) and one row
 * per monthly summary run (Phase 11, D-107). Organisation-scoped and cost-bearing, so AI usage
 * and cost can be seen per organisation in one place once the features move to a paid plan.
 *
 * Deliberately carries no filename, no amount and no document or summary content: none of that is
 * needed to answer "how much did this organisation use, and what did it cost", and keeping it out
 * keeps this table free of anything that would need redacting later.
 *
 * Feature-specific columns are nullable, with a check constraint per feature saying which must be
 * present.
 */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Null when the acting user's account has since been removed. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    feature: aiUsageFeature().notNull(),
    outcome: aiUsageOutcome().notNull(),
    /** The model setting at the time of the call — a server setting, not written into the code,
     *  so a later model switch doesn't need a migration to keep old rows honest. */
    model: text().notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** From `costMicroUsd` — null when either token count or either price setting is missing. */
    costMicroUsd: integer("cost_micro_usd"),
    /** Amount reads only. */
    documentSource: aiUsageDocumentSource("document_source"),
    /** Amount reads only. */
    documentKind: aiUsageDocumentKind("document_kind"),
    /** Monthly summaries only. The composite key below ties it to this row's own organization. */
    fundingSourceId: uuid("funding_source_id"),
    /** Monthly summaries only. */
    month: char({ length: 7 }),
    /** Monthly summaries only: the first draft, or a Write again. */
    trigger: summaryTrigger(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_usage_events_org_idx").on(t.orgId, t.createdAt),
    // (source, org) like every other source-scoped table (D-93 2.3, PR #18 round 3): a single-column
    // key let a usage row name another organization's funding source. NO ACTION, since sources are
    // archived, never deleted; a null source (every amount read) isn't checked (MATCH SIMPLE).
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
    check("ai_usage_events_month_ck", sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    // An amount read always records what kind of document it read and where it came from, and
    // only has amount-read outcomes.
    check(
      "ai_usage_events_amount_read_ck",
      sql`${t.feature} <> 'amount_read' OR (${t.documentSource} IS NOT NULL AND ${t.documentKind} IS NOT NULL AND ${t.outcome} IN ('found', 'none', 'failed'))`,
    ),
    // An invoice read records the same document columns as an amount read, and only has
    // amount-read outcomes (Phase 14, D-115).
    //
    // `feature::text` rather than the bare column, unlike the two checks around it. Postgres
    // refuses to *use* an enum value in the transaction that added it, and drizzle applies every
    // pending migration in one transaction (`pg-core/dialect.js`, `session.transaction` around
    // the whole loop) — so splitting this into a second migration file does not help, as D-106
    // assumed it would. Comparing the column as text never evaluates the new enum literal, so
    // the value and the constraint that names it can land together.
    check(
      "ai_usage_events_invoice_read_ck",
      sql`${t.feature}::text <> 'invoice_read' OR (${t.documentSource} IS NOT NULL AND ${t.documentKind} IS NOT NULL AND ${t.outcome} IN ('found', 'none', 'failed'))`,
    ),
    // A monthly summary run always records the source, month and trigger it ran for, and only
    // has summary outcomes (Phase 11, D-107).
    check(
      "ai_usage_events_monthly_summary_ck",
      sql`${t.feature} <> 'monthly_summary' OR (${t.fundingSourceId} IS NOT NULL AND ${t.month} IS NOT NULL AND ${t.trigger} IS NOT NULL AND ${t.outcome} IN ('success', 'rejected', 'failed'))`,
    ),
  ],
);

/* ----------------------------------------------------------- monthly summaries */

/**
 * One AI-drafted monthly summary per funding source per month (Phase 11, D-107).
 *
 * `version` and `expensesFingerprint` are the two fields everything else in the module builds
 * on: `version` drives optimistic concurrency (P10) — every save sends the version it started
 * from, and a mismatch is a conflict rather than a silent overwrite — while
 * `expensesFingerprint` is a sha256 of the month's live expenses at write time (P7), recomputed
 * on load to show the "records changed since this was written" notice. Editing the Markdown
 * never touches the fingerprint; only Write again does, because only Write again re-reads the
 * records. Write again replaces `content_markdown`, `expenses_fingerprint`, `written_*` and
 * `model` in place and clears `edited_*` — older drafts are not kept (out of scope).
 */
export const monthlySummaries = pgTable(
  "monthly_summaries",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fundingSourceId: uuid("funding_source_id").notNull(),
    month: char({ length: 7 }).notNull(),
    /** As typed by the user — never rewritten by the app (P6). */
    contentMarkdown: text("content_markdown").notNull(),
    /** Optimistic concurrency (P10): +1 on every save and every write. */
    version: integer().notNull().default(1),
    /** sha256 hex of the month's live expenses at write time (P7). */
    expensesFingerprint: char("expenses_fingerprint", { length: 64 }).notNull(),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull(),
    /** Null when the writing account has since been removed. */
    writtenBy: uuid("written_by").references(() => users.id, { onDelete: "set null" }),
    /** The model setting at the time of the write — same reasoning as ai_usage_events.model. */
    model: text().notNull(),
    /** Null until the first save after a write. */
    editedAt: timestamp("edited_at", { withTimezone: true }),
    editedBy: uuid("edited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One summary per funding source per month; also serves the saved-months list (newest
    // first), so no separate written_at index is needed.
    uniqueIndex("monthly_summaries_source_month_uq").on(t.orgId, t.fundingSourceId, t.month),
    // Same pattern as every other source-scoped table (D-93 2.3): NO ACTION, because funding
    // sources are never deleted — only the org's cascade above ever removes a summary.
    foreignKey({
      columns: [t.fundingSourceId, t.orgId],
      foreignColumns: [fundingSources.id, fundingSources.orgId],
    }),
    check("monthly_summaries_month_ck", sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check("monthly_summaries_content_length_ck", sql`char_length(${t.contentMarkdown}) <= 60000`),
  ],
);

/* -------------------------------------------------------------------- types */

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type StaffUser = typeof staffUsers.$inferSelect;
export type StaffSession = typeof staffSessions.$inferSelect;
export type OrgAccountEvent = typeof orgAccountEvents.$inferSelect;
export type ContractSettings = typeof contractSettings.$inferSelect;
export type FundingSource = typeof fundingSources.$inferSelect;
export type PaymentSource = typeof paymentSources.$inferSelect;
export type SupportingDocType = typeof supportingDocTypes.$inferSelect;
export type LineItem = typeof lineItems.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type ExpenseAuditEventRow = typeof expenseAuditEvents.$inferSelect;
export type ExpenseDocument = typeof expenseDocuments.$inferSelect;
export type MonthDocument = typeof monthDocuments.$inferSelect;
export type MonthStatus = typeof monthStatuses.$inferSelect;
export type MonthLockEvent = typeof monthLockEvents.$inferSelect;
export type VendorDefault = typeof vendorDefaults.$inferSelect;
export type ExpenseImport = typeof expenseImports.$inferSelect;
export type ExpenseDraft = typeof expenseDrafts.$inferSelect;
export type ExpenseDraftDocument = typeof expenseDraftDocuments.$inferSelect;
export type RecurringItem = typeof recurringItems.$inferSelect;
export type GeneratedArtifact = typeof generatedArtifacts.$inferSelect;
export type UserTourProgress = typeof userTourProgress.$inferSelect;
export type MonthSnapshotRow = typeof monthSnapshots.$inferSelect;
export type MonthSnapshotTotals = typeof monthSnapshotTotals.$inferSelect;
export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type MonthlySummary = typeof monthlySummaries.$inferSelect;
export type SharedLink = typeof sharedLinks.$inferSelect;

export type DocumentKind = (typeof documentKind.enumValues)[number];
export type DocumentStatus = (typeof documentStatus.enumValues)[number];
export type MonthDocumentCategory = (typeof monthDocumentCategory.enumValues)[number];
export type ArtifactType = (typeof artifactType.enumValues)[number];
export type FundingSourceType = (typeof fundingSourceType.enumValues)[number];
export type TourKey = (typeof tourKey.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type ExpenseAuditActionType = (typeof expenseAuditAction.enumValues)[number];
export type OrgPlan = (typeof orgPlan.enumValues)[number];
export type SubscriptionStatus = (typeof subscriptionStatus.enumValues)[number];
export type OrgAccountEventAction = (typeof orgAccountEventAction.enumValues)[number];
export type AiUsageFeature = (typeof aiUsageFeature.enumValues)[number];
export type AiUsageOutcome = (typeof aiUsageOutcome.enumValues)[number];
export type AiUsageDocumentSource = (typeof aiUsageDocumentSource.enumValues)[number];
export type AiUsageDocumentKind = (typeof aiUsageDocumentKind.enumValues)[number];
export type SummaryTrigger = (typeof summaryTrigger.enumValues)[number];
