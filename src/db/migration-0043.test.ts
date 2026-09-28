/**
 * Unit checks on migration 0043 (PHASE-18, D-131): the header's month and funding source, and the
 * welcome banner's dismissal, move to each person. No database: this only reads the SQL file and the journal, in the style of
 * `migration-0042.test.ts`. The copy itself is exercised against Postgres in
 * `user-active-month-migration.integration.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const drizzleDir = path.join(__dirname, "..", "..", "drizzle");
const sql = readFileSync(path.join(drizzleDir, "0043_user_active_month.sql"), "utf8");
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) =>
    s
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter(Boolean);

describe("migration 0043: per-person month, funding source and welcome banner", () => {
  it("starts by giving up on a table lock after a few seconds rather than queueing requests behind it", () => {
    expect(statements[0]).toMatch(/^SET LOCAL lock_timeout = '\d+s';$/);
  });

  it("adds three nullable columns to users, the source column emptied when its source is deleted", () => {
    expect(statements[1]).toBe('ALTER TABLE "users" ADD COLUMN "active_month" char(7);');
    expect(statements[2]).toBe('ALTER TABLE "users" ADD COLUMN "active_funding_source_id" uuid;');
    expect(statements[3]).toBe('ALTER TABLE "users" ADD COLUMN "welcome_dismissed_at" timestamp with time zone;');
    expect(statements[4]).toContain(
      'FOREIGN KEY ("active_funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE set null',
    );
  });

  it("then starts every person where their organization was: month, source and welcome banner", () => {
    expect(statements[5]).toBe(
      'UPDATE "users" SET "active_month" = "organizations"."active_month", "active_funding_source_id" = "organizations"."active_funding_source_id", "welcome_dismissed_at" = "organizations"."welcome_dismissed_at" FROM "organizations" WHERE "organizations"."id" = "users"."org_id";',
    );
    expect(statements).toHaveLength(6);
  });

  it("leaves the organization's columns in place, so a code-only rollback still finds a month", () => {
    // The statements, not the file: its header comment spells out the rollback's DROP COLUMN.
    const body = statements.join("\n");
    expect(body).not.toMatch(/\bDROP\b/i);
    expect(body).not.toMatch(/ALTER TABLE "organizations"/i);
  });

  it("is the newest entry in the migration journal", () => {
    const journal = JSON.parse(readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toMatchObject({ idx: 43, tag: "0043_user_active_month" });
  });
});
