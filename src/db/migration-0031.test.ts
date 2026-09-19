/**
 * Unit check on the hand-reordered migration 0031 (PHASE-12 §3): `shared_links_artifact_fk`
 * references five `generated_artifacts` columns, which Postgres only allows once a unique
 * constraint on exactly those columns exists. drizzle-kit writes foreign keys before indexes, so
 * a regenerated file would fail on deploy; this pins the index above the key.
 *
 * No database needed — this only reads the SQL file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(path.join(__dirname, "..", "..", "drizzle", "0031_shared_links.sql"), "utf8");

describe("migration 0031 ordering", () => {
  it("creates the five-column target index before the foreign key that needs it", () => {
    const index = sql.indexOf('CREATE UNIQUE INDEX "generated_artifacts_scope_id_uq"');
    const foreignKey = sql.indexOf('ADD CONSTRAINT "shared_links_artifact_fk"');
    expect(index).toBeGreaterThan(-1);
    expect(foreignKey).toBeGreaterThan(-1);
    expect(index).toBeLessThan(foreignKey);
  });

  it("the index covers exactly the columns the key references", () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "generated_artifacts_scope_id_uq" ON "generated_artifacts" USING btree ("id","org_id","funding_source_id","month","type")',
    );
    expect(sql).toContain(
      'REFERENCES "public"."generated_artifacts"("id","org_id","funding_source_id","month","type")',
    );
  });

  it("keeps one active link per source, month and kind, and every token unique", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "shared_links_active_uq" ON "shared_links" USING btree \("org_id","funding_source_id","month","artifact_type"\) WHERE "shared_links"\."revoked_at" is null/,
    );
    expect(sql).toMatch(/CREATE UNIQUE INDEX "shared_links_token_uq" ON "shared_links" USING btree \("token"\);/);
  });
});
