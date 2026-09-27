/**
 * `createTestOrg` (Phase 16, P28): every existing integration org insert now needs to be
 * complimentary by default, or it hits the paywall once billing is wired into `resolveSession`.
 * This proves the default itself, not just individual callers' assumptions about it.
 *
 * Skipped when DATABASE_URL is absent, same as the sibling `*.integration.test.ts` files.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("createTestOrg complimentary default (P28)", async () => {
  const { db } = await import("@/src/db");
  const { organizations } = await import("@/src/db/schema");
  const { createTestOrg } = await import("./test-org");

  const orgIds: string[] = [];

  afterAll(async () => {
    for (const id of orgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  it("defaults to complimentary: true, with no end date", async () => {
    const { orgId } = await createTestOrg({ name: `Default Complimentary Org ${Date.now()}-${Math.random()}` });
    orgIds.push(orgId);
    const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    expect(row.complimentary).toBe(true);
    expect(row.complimentaryUntil).toBeNull();
  });

  it("override complimentary: false is honoured", async () => {
    const { orgId } = await createTestOrg({
      name: `Non Complimentary Org ${Date.now()}-${Math.random()}`,
      complimentary: false,
    });
    orgIds.push(orgId);
    const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    expect(row.complimentary).toBe(false);
  });

  it("override complimentary: true is a no-op against the default (still true)", async () => {
    const { orgId } = await createTestOrg({
      name: `Explicit Complimentary Org ${Date.now()}-${Math.random()}`,
      complimentary: true,
    });
    orgIds.push(orgId);
    const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    expect(row.complimentary).toBe(true);
  });
});
