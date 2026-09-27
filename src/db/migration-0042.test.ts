/**
 * Unit checks on migration 0042 (PHASE-17 §3, D-127): the three feature-request tables and their
 * enum. No database: this only reads the SQL file and the journal, in the style of
 * `migration-0031.test.ts` and `migration-0041.test.ts`.
 *
 * D-106/D-115: drizzle runs every pending migration in one transaction, so a statement that fails
 * partway wedges every later deploy too. This migration only creates things, and the one
 * hand-ordering it needs (the unique index before the composite foreign key) is pinned here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const drizzleDir = path.join(__dirname, "..", "..", "drizzle");
const sql = readFileSync(path.join(drizzleDir, "0042_feature_requests.sql"), "utf8");
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

describe("migration 0042: feature requests", () => {
  it("starts by giving up on a table lock after a few seconds rather than queueing requests behind it", () => {
    expect(statements[0]).toMatch(/^SET LOCAL lock_timeout = '\d+s';$/);
  });

  it("after the lock timeout, only creates the enum, the three tables, their constraints and indexes", () => {
    for (const statement of statements.slice(1)) {
      const allowed =
        /^CREATE TYPE "public"\."feature_request_status" AS ENUM\(/.test(statement) ||
        /^CREATE TABLE "feature_request(s|_votes|_replies)" \(/.test(statement) ||
        /^ALTER TABLE "feature_request(s|_votes|_replies)" ADD CONSTRAINT /.test(statement) ||
        /^CREATE (UNIQUE )?INDEX "feature_request/.test(statement);
      expect(allowed, statement).toBe(true);
    }
  });

  it("never alters anything that already exists", () => {
    expect(sql).not.toMatch(/ALTER TYPE/i);
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
  });

  it("creates the (id, org_id) target index before the replies' composite foreign key that needs it", () => {
    const index = sql.indexOf('CREATE UNIQUE INDEX "feature_requests_id_org_uq"');
    const foreignKey = sql.indexOf('REFERENCES "public"."feature_requests"("id","org_id")');
    expect(index).toBeGreaterThan(-1);
    expect(foreignKey).toBeGreaterThan(-1);
    expect(index).toBeLessThan(foreignKey);
  });

  it("keeps a removed person's requests, votes and replies (set null), and deletes them with the organization", () => {
    for (const [table, column] of [
      ["feature_requests", "author_user_id"],
      ["feature_request_votes", "user_id"],
      ["feature_request_replies", "author_user_id"],
    ]) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_${column}_users_id_fk" FOREIGN KEY ("${column}") REFERENCES "public"."users"("id") ON DELETE set null`,
      );
    }
    expect(sql).toContain(
      'FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null',
    );
    for (const table of ["feature_requests", "feature_request_votes", "feature_request_replies"]) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade`,
      );
    }
  });

  // The two enum literals are the point of this CHECK (ticket §5: those two statuses are never
  // shown to other organizations). Compared as text, so a status added to the enum later can't
  // trip D-115's same-transaction rule; renaming one of these two would need this CHECK changed.
  it("makes a Waiting for review or Already requested request unshowable to other organizations", () => {
    expect(sql).toContain(
      `CHECK ("feature_requests"."shown_to_all_at" is null or "feature_requests"."status"::text not in ('waiting_for_review', 'already_requested'))`,
    );
  });

  it("allows one vote per person per request", () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "feature_request_votes_request_user_uq" ON "feature_request_votes" USING btree ("request_id","user_id")',
    );
  });

  it("is the newest entry in the migration journal", () => {
    const journal = JSON.parse(readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toMatchObject({ idx: 42, tag: "0042_feature_requests" });
  });
});
