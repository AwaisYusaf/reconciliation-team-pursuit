/**
 * Integration test setup helper (Phase 6, D-93).
 *
 * Every integration test needs an organisation *and* a funding source now that
 * `funding_source_id` is `NOT NULL` almost everywhere. One helper here, rather than each test
 * file hand-rolling the same two inserts, so the shape stays in one place.
 *
 * Import it the same way the test files already import the schema — `await import(...)`
 * inside the `describe` body — so nothing loads when `DATABASE_URL` is absent.
 */
import { v7 as uuidv7 } from "uuid";

import { db } from "@/src/db";
import { fundingSources, organizations } from "@/src/db/schema";
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
