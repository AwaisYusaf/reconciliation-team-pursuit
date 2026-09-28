/**
 * PHASE-18 T6: migration 0043's copy step starts each person on their own organization's month,
 * funding source and welcome banner dismissal. Runs the migration's real UPDATE (read from the SQL
 * file, pinned whole by `migration-0043.test.ts`) against two throwaway organizations inside a
 * transaction that is always rolled back. It is narrowed to those two organizations so it cannot lock or change anyone else's
 * row while the rest of the suite runs. Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import path from "node:path";

import { eq, inArray, sql, TransactionRollbackError } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const copyStatement = readFileSync(path.join(__dirname, "..", "..", "drizzle", "0043_user_active_month.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .find((s) => s.startsWith('UPDATE "users"'))!
  .replace(/;$/, "");

describe.skipIf(!hasDatabase)("migration 0043 copy step (integration, PHASE-18 T6)", async () => {
  const { db } = await import("@/src/db");
  const { fundingSources, organizations, users } = await import("@/src/db/schema");
  const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");

  it("gives each person their own organization's month, source and welcome dismissal, not another's", async () => {
    let seen: Array<{
      orgId: string;
      activeMonth: string | null;
      activeFundingSourceId: string | null;
      welcomeDismissedAt: Date | null;
    }> = [];
    const expected = new Map<string, { month: string; source: string | null; dismissed: Date | null }>();
    const dismissedAt = new Date("2026-01-05T15:00:00Z");

    await db
      .transaction(async (tx) => {
        const orgIds: string[] = [];
        for (const [month, withSource] of [
          ["2025-11", true],
          ["2026-04", false],
        ] as const) {
          const [org] = await tx
            .insert(organizations)
            .values({
              name: `Migration 0043 ${month}`,
              docName: "M",
              activeMonth: month,
              welcomeDismissedAt: withSource ? dismissedAt : null,
            })
            .returning({ id: organizations.id });
          let source: string | null = null;
          if (withSource) {
            const [row] = await tx
              .insert(fundingSources)
              .values({ orgId: org.id, name: "S", type: "grant", sortOrder: 0, ...ORIGINAL_RULES })
              .returning({ id: fundingSources.id });
            source = row.id;
            await tx.update(organizations).set({ activeFundingSourceId: source }).where(eq(organizations.id, org.id));
          }
          for (const tag of ["x", "y"]) {
            await tx.insert(users).values({
              orgId: org.id,
              email: `m0043-${tag}-${month}-${Date.now()}@example.test`,
              passwordHash: "unused",
              role: "manager",
            });
          }
          orgIds.push(org.id);
          expected.set(org.id, { month, source, dismissed: withSource ? dismissedAt : null });
        }

        await tx.execute(sql`${sql.raw(copyStatement)} AND "users"."org_id" IN (${orgIds[0]}, ${orgIds[1]})`);

        seen = await tx
          .select({
            orgId: users.orgId,
            activeMonth: users.activeMonth,
            activeFundingSourceId: users.activeFundingSourceId,
            welcomeDismissedAt: users.welcomeDismissedAt,
          })
          .from(users)
          .where(inArray(users.orgId, orgIds));
        tx.rollback();
      })
      .catch((error) => {
        if (!(error instanceof TransactionRollbackError)) throw error;
      });

    expect(seen).toHaveLength(4);
    for (const row of seen) {
      const want = expected.get(row.orgId)!;
      expect(row.activeMonth).toBe(want.month);
      expect(row.activeFundingSourceId).toBe(want.source);
      expect(row.welcomeDismissedAt?.toISOString() ?? null).toBe(want.dismissed?.toISOString() ?? null);
    }
  });
});
