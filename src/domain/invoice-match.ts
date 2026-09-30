/**
 * Invoice-to-draft matching (Phase 14).
 *
 * Pure, database-free: given one line as read off an uploaded invoice plus the org's
 * remembered recurring items and vendors, decide what the DRAFT expense row holds. No I/O —
 * the caller resolves the invoice date, the active month, and everything else that touches
 * the database, and only passes the results in via MatchContext.
 */

/** One line as read off the invoice. Null means the invoice did not print it, which is not zero. */
export type InvoiceLine = {
  name: string;
  description: string | null;
  amountCents: number | null;
  taxCents: number | null;
  feesCents: number | null;
};

/** A curated recurring item (`recurring_items`). Null cents mean never set. */
export type RecurringMatch = {
  name: string;
  lineItemId: string;
  defaultDescription: string | null;
  defaultNarrative: string | null;
  defaultPaymentSource: string | null;
  defaultTaxCents: number | null;
  defaultFeesCents: number | null;
};

/** A remembered payee (`vendor_defaults`). Deliberately carries no narrative. */
export type VendorMatch = {
  name: string;
  defaultLineItemId: string | null;
  defaultDescription: string;
  defaultPaymentSource: string | null;
};

export type MatchContext = {
  recurringItems: readonly RecurringMatch[];
  vendors: readonly VendorMatch[];
  /** Active payment_sources labels, already ordered by sortOrder. The first is the org's usual one. */
  activePaymentSources: readonly string[];
  /** Line item ids belonging to THIS draft's funding source. */
  sourceLineItemIds: readonly string[];
  /** The invoice's date, as the caller resolved it. Never computed here. */
  invoiceDate: string;
  /** The caller's active month, "YYYY-MM". Never computed here. */
  month: string;
  /** The vendor the invoice named, or null. Added to each description (usability #62). */
  vendor: string | null;
  /** Vendors this organization's earlier invoices named (`expense_imports.vendor_name`), so a
   *  remembered description that starts with one of them loses it first (`withInvoiceVendor`). */
  earlierVendors: readonly string[];
};

/** The parts of an `expense_drafts` row this decides. The caller adds orgId, importId, fundingSourceId, sortOrder, note. */
export type DraftRow = {
  month: string;
  date: string;
  name: string;
  description: string; // NOT NULL in schema
  lineItemId: string | null;
  paymentSource: string; // NOT NULL in schema
  subtotalCents: number; // NOT NULL
  taxCents: number; // NOT NULL
  feesCents: number; // NOT NULL
  narrative: string | null;
};

/**
 * A matched line item, but only while it belongs to this draft's funding source.
 *
 * Sibling rule to `usableLineItemId` in src/modules/expenses/vendor-fill.ts — same check
 * (cross-source ids are dropped, never carried over), duplicated here because src/domain
 * cannot import from src/modules. Keep the two in sync if the rule ever changes.
 */
function usableLineItemId(id: string | null, sourceLineItemIds: readonly string[]): string | null {
  return id !== null && sourceLineItemIds.includes(id) ? id : null;
}

/**
 * The description with the invoice's vendor in front, so the cover sheet's Role column says who
 * was paid (usability #62). Name stays the line's own name: recurring items, the vendor library
 * and R8.3's added-state all match on it (PHASE-14 §5), so the vendor goes here instead.
 *
 * A remembered description (the vendor library learns every saved description, R8.2) can
 * already start with an earlier invoice's vendor that this same rule put there. That vendor is
 * dropped before this one goes in front, so a second vendor's invoice for the same line reads
 * "Westside Deli: Box lunches", never "Westside Deli: Eastside Catering: Box lunches".
 */
export function withInvoiceVendor(
  description: string,
  vendor: string | null,
  name: string,
  earlierVendors: readonly string[],
): string {
  const who = vendor?.trim();
  if (!who) return description;
  const lower = who.toLowerCase();
  // Another vendor's prefix goes first, so this vendor's name can only match in what is left:
  // "Uber" must not count as already named inside "Uber Eats: Team lunch".
  const others = earlierVendors.filter((earlier) => earlier.trim().toLowerCase() !== lower);
  const text = withoutInvoiceVendors(description.trim(), others);
  if (name.trim().toLowerCase() === lower) return text;
  if (text.toLowerCase().includes(lower)) return text;
  return text ? `${who}: ${text}` : who;
}

/**
 * `text` without any leading "{invoice vendor}:" prefix, or empty when it is only an invoice
 * vendor (what `withInvoiceVendor` writes for a line with no description of its own).
 *
 * Also what the vendor library learns (`learnVendor`), so a remembered description never carries
 * an invoice's vendor in the first place: the library outlives the imports that named the
 * vendors (an import nothing came of is swept), and a manual Add Expense for the same name has no
 * vendor to show (usability #62).
 */
export function withoutInvoiceVendors(text: string, earlierVendors: readonly string[]): string {
  let rest = text.trim();
  for (let changed = true; changed; ) {
    changed = false;
    const lowerRest = rest.toLowerCase();
    for (const earlier of earlierVendors) {
      const lowerEarlier = earlier.trim().toLowerCase();
      if (!lowerEarlier) continue;
      if (lowerRest === lowerEarlier) return "";
      if (lowerRest.startsWith(`${lowerEarlier}:`)) {
        rest = rest.slice(lowerEarlier.length + 1).trim();
        changed = true;
        break;
      }
    }
  }
  return rest;
}

/**
 * A matched payment source, but only while the label hasn't been retired.
 *
 * Sibling rule to `usablePaymentSource` in src/modules/expenses/vendor-fill.ts — same check,
 * duplicated for the same import-boundary reason. Keep the two in sync if it ever changes.
 */
function usablePaymentSource(label: string | null, activeSources: readonly string[]): string | null {
  return label !== null && activeSources.includes(label) ? label : null;
}

/**
 * Decide one DRAFT expense row from one invoice line.
 *
 * Order is the ticket's: a recurring item (R8.3, curated) beats a remembered vendor (R8.1–R8.2,
 * learned), and an unmatched line keeps the org's usual payment source with nothing else filled.
 * A matched row's description wins over the line's own printed text, because the ticket names
 * the amounts as the one thing the invoice always wins — everything else it lists as coming from
 * the remembered row. An empty remembered description falls back to what the invoice printed.
 */
export function matchInvoiceLine(line: InvoiceLine, ctx: MatchContext): DraftRow {
  const name = line.name.trim();
  const key = name.toLowerCase();

  // Blank names never match a remembered row, even one that also happens to be blank.
  const recurring = key
    ? ctx.recurringItems.find((item) => item.name.trim().toLowerCase() === key)
    : undefined;
  const vendor = key
    ? ctx.vendors.find((item) => item.name.trim().toLowerCase() === key)
    : undefined;

  const usualPaymentSource = ctx.activePaymentSources[0] ?? "";
  const subtotalCents = line.amountCents ?? 0;

  if (recurring) {
    return {
      month: ctx.month,
      date: ctx.invoiceDate,
      name,
      description: withInvoiceVendor(
        recurring.defaultDescription || (line.description ?? ""),
        ctx.vendor,
        name,
        ctx.earlierVendors,
      ),
      lineItemId: usableLineItemId(recurring.lineItemId, ctx.sourceLineItemIds),
      paymentSource:
        usablePaymentSource(recurring.defaultPaymentSource, ctx.activePaymentSources) ??
        usualPaymentSource,
      subtotalCents,
      // The invoice's own figures always win; a remembered default only fills what it left blank.
      taxCents: line.taxCents ?? recurring.defaultTaxCents ?? 0,
      feesCents: line.feesCents ?? recurring.defaultFeesCents ?? 0,
      narrative: recurring.defaultNarrative,
    };
  }

  if (vendor) {
    return {
      month: ctx.month,
      date: ctx.invoiceDate,
      name,
      description: withInvoiceVendor(
        vendor.defaultDescription || (line.description ?? ""),
        ctx.vendor,
        name,
        ctx.earlierVendors,
      ),
      lineItemId: usableLineItemId(vendor.defaultLineItemId, ctx.sourceLineItemIds),
      paymentSource:
        usablePaymentSource(vendor.defaultPaymentSource, ctx.activePaymentSources) ??
        usualPaymentSource,
      subtotalCents,
      taxCents: line.taxCents ?? 0,
      feesCents: line.feesCents ?? 0,
      // Vendor rows are learned latest-write-wins; an empty narrative here would silently
      // overwrite a curated one (see the comment on recurring_items.defaultNarrative in schema.ts).
      narrative: null,
    };
  }

  return {
    month: ctx.month,
    date: ctx.invoiceDate,
    name,
    description: withInvoiceVendor(line.description ?? "", ctx.vendor, name, ctx.earlierVendors),
    lineItemId: null,
    paymentSource: usualPaymentSource,
    subtotalCents,
    taxCents: line.taxCents ?? 0,
    feesCents: line.feesCents ?? 0,
    narrative: null,
  };
}
