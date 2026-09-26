/**
 * Integration test setup helper (Phase 6, D-93).
 *
 * Every integration test needs an organisation *and* a funding source now that
 * `funding_source_id` is `NOT NULL` almost everywhere. One helper here, rather than each test
 * file hand-rolling the same two inserts, so the shape stays in one place.
 *
 * Import it the same way the test files already import the schema — `await import(...)`
 * inside the `describe` body — so nothing loads when `DATABASE_URL` is absent.
 *
 * Complimentary by default (Phase 16, P28): otherwise every integration test that exercises a
 * feature would first have to pay for a plan. Billing tests that need an unpaid org pass
 * `complimentary: false`.
 */
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import {
  fundingSources,
  orgBilling,
  organizations,
  type OrgBilling,
  type Organization,
} from "@/src/db/schema";
import { currentMonthKey } from "@/src/domain/dates";
import { ORIGINAL_RULES } from "@/src/modules/expenses/reimbursement";

export type TestOrgOverrides = {
  /** Explicit org id — the snapshot-stability test needs a fixed UUID. */
  id?: string;
  name?: string;
  docName?: string;
  activeMonth?: string;
  /** Explicit funding source id — same reason as `id` above. */
  fundingSourceId?: string;
  fundingSourceName?: string;
  /** Defaults to `true` (P28). Set `false` for a test that needs an unpaid org. */
  complimentary?: boolean;
};

export type TestOrg = { orgId: string; fundingSourceId: string };

/** Insert an organisation and its first funding source, ready for any grant-scoped insert. */
export async function createTestOrg(overrides: TestOrgOverrides = {}): Promise<TestOrg> {
  const [org] = await db
    .insert(organizations)
    .values({
      ...(overrides.id ? { id: overrides.id } : {}),
      name: overrides.name ?? "Test Org",
      docName: overrides.docName ?? overrides.name ?? "Test Org",
      activeMonth: overrides.activeMonth ?? currentMonthKey(),
      complimentary: overrides.complimentary ?? true,
    })
    .returning({ id: organizations.id });

  const [source] = await db
    .insert(fundingSources)
    .values({
      id: overrides.fundingSourceId ?? uuidv7(),
      orgId: org.id,
      name: overrides.fundingSourceName ?? "Source 1",
      type: "grant",
      sortOrder: 0,
      ...ORIGINAL_RULES,
    })
    .returning({ id: fundingSources.id });

  return { orgId: org.id, fundingSourceId: source.id };
}

export type BillingCopyFixture = Partial<Omit<typeof orgBilling.$inferInsert, "orgId">>;

/**
 * Gives the org a Stripe copy (`org_billing`, D-125), as the sync would. A new row defaults to
 * customer `cus_test_<orgId>` in test mode; on an existing row only the given keys change, so a
 * customer set earlier survives a later status change.
 */
export async function setBillingCopy(orgId: string, copy: BillingCopyFixture = {}): Promise<void> {
  const insert = db
    .insert(orgBilling)
    .values({ orgId, stripeCustomerId: `cus_test_${orgId}`, livemode: false, ...copy });
  await (Object.keys(copy).length > 0
    ? insert.onConflictDoUpdate({ target: orgBilling.orgId, set: copy })
    : insert.onConflictDoNothing());
}

/** The org row with its Stripe copy spread over it (any mode), for assertions. */
export async function orgWithBilling(orgId: string): Promise<Organization & Partial<OrgBilling>> {
  const [row] = await db
    .select()
    .from(organizations)
    .leftJoin(orgBilling, eq(orgBilling.orgId, organizations.id))
    .where(eq(organizations.id, orgId));
  return { ...row.organizations, ...(row.org_billing ?? {}) };
}
