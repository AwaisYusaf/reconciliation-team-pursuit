/**
 * Unit check on the hand-added backfill in migration 0027 (Phase 9 §4): the generated
 * `ADD COLUMN`s for `subscription_status` and `complimentary` must exist, and the backfill
 * `UPDATE` must come strictly after both, or existing organisations would be backfilled to
 * `active`/`true` against columns that don't exist yet (or, if the generator is ever re-run and
 * the hand-edit lost, silently vanish and leave every existing org on the trial defaults).
 *
 * No database needed — this only reads the SQL file.
 *
 * Lives under src/db rather than drizzle/ so vitest (include: ["src/**\/*.test.ts"]) actually
 * picks it up — a copy at drizzle/migration-0027-backfill.test.ts never ran as part of the
 * suite; moved here instead of duplicated.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(__dirname, "..", "..", "drizzle", "0027_easy_xavin.sql"),
  "utf8",
);

describe("migration 0027 backfill ordering", () => {
  it("adds subscription_status and complimentary columns to organizations", () => {
    expect(sql).toMatch(/ALTER TABLE "organizations" ADD COLUMN "subscription_status"/);
    expect(sql).toMatch(/ALTER TABLE "organizations" ADD COLUMN "complimentary" boolean/);
  });

  it("contains the backfill UPDATE setting subscription_status='active' and complimentary=true, exactly once", () => {
    const matches = sql.match(
      /UPDATE "organizations" SET "subscription_status" = 'active', "complimentary" = true;/g,
    );
    expect(matches).not.toBeNull();
    expect(matches).toHaveLength(1);
  });

  it("the backfill UPDATE comes after both ADD COLUMN statements it depends on", () => {
    const statusIndex = sql.indexOf('ALTER TABLE "organizations" ADD COLUMN "subscription_status"');
    const complimentaryIndex = sql.indexOf('ALTER TABLE "organizations" ADD COLUMN "complimentary" boolean');
    const updateIndex = sql.indexOf('UPDATE "organizations" SET "subscription_status" = \'active\'');

    expect(statusIndex).toBeGreaterThan(-1);
    expect(complimentaryIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(statusIndex);
    expect(updateIndex).toBeGreaterThan(complimentaryIndex);
  });

  it("the UPDATE has no WHERE clause, so it touches every organisation that exists at migration time", () => {
    const updateStatement = sql
      .split("--> statement-breakpoint")
      .find((chunk) => chunk.includes('UPDATE "organizations"'));
    expect(updateStatement).toBeDefined();
    expect(updateStatement).not.toMatch(/WHERE/i);
  });
});
