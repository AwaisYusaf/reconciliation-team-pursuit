/**
 * Unit checks on migration 0041 (Phase 16, §3, D-125): the `org_billing` table, plus one column
 * each on `organizations` and `org_account_events`. No database: this only reads the SQL file,
 * the journal and the schema's enum exports, in the style of `src/db/migration-0031.test.ts`.
 *
 * D-106/D-115: drizzle runs every pending migration in one transaction, so anything here that
 * would fail partway (an `ALTER TYPE`, a `NOT NULL` column added to a table that has rows, an enum
 * literal baked into a `CHECK`) could wedge every future deploy, not just this one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as schema from "./schema";

const drizzleDir = path.join(__dirname, "..", "..", "drizzle");
const sql = readFileSync(path.join(drizzleDir, "0041_stripe_billing.sql"), "utf8");
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
const LOCK_TIMEOUT = /^SET LOCAL lock_timeout = '\d+s';$/;

/** `ALTER TABLE "t" ADD COLUMN ...;` on a table that already has rows. */
const ADD_COLUMN = /^ALTER TABLE "\w+" ADD COLUMN "\w+" [^;]+;?$/;

describe("migration 0041: Stripe billing", () => {
  it("starts by giving up on a table lock after a few seconds rather than queueing requests behind it", () => {
    expect(statements[0]).toMatch(LOCK_TIMEOUT);
  });

  it("after the lock timeout, only creates org_billing, adds columns, constraints and the unique index", () => {
    for (const statement of statements.slice(1)) {
      const allowed =
        /^CREATE TABLE "org_billing" \(/.test(statement) ||
        ADD_COLUMN.test(statement) ||
        /^ALTER TABLE "\w+" ADD CONSTRAINT /.test(statement) ||
        /^CREATE UNIQUE INDEX /.test(statement);
      expect(allowed, statement).toBe(true);
    }
  });

  it("never runs ALTER TYPE, an UPDATE statement, DROP or ALTER COLUMN", () => {
    expect(sql).not.toMatch(/ALTER TYPE/i);
    // As a statement only: the foreign key's own text says "ON UPDATE no action".
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
  });

  it("every column added to an existing table is nullable or has a DEFAULT, never a bare NOT NULL", () => {
    const added = statements.filter((statement) => ADD_COLUMN.test(statement));
    // Counted, so a pattern that stops matching fails here instead of checking nothing.
    expect(added).toHaveLength(2);
    for (const clause of added) {
      expect(/NOT NULL/.test(clause) && !/DEFAULT/.test(clause), clause).toBe(false);
    }
  });

  // No enum literal (other than the four plain-text values this migration itself defines) baked
  // into a CHECK: a renamed enum value would otherwise leave a CHECK that silently stops matching.
  it("no CHECK body quotes a pgEnum value, other than 'month'/'year'/'downgrade'/'price_move'", () => {
    const allowed = new Set(["month", "year", "downgrade", "price_move"]);
    const enumEntries = Object.entries(schema).filter(
      (entry): boolean => typeof entry[1] === "function" && "enumValues" in entry[1],
    ) as Array<[string, { enumValues: readonly string[] }]>;

    const checkStatements = statements.filter((s) => s.includes(" CHECK ("));
    expect(checkStatements.length).toBeGreaterThan(0);
    for (const [enumName, enumColumn] of enumEntries) {
      for (const value of enumColumn.enumValues) {
        if (allowed.has(value)) continue;
        for (const statement of checkStatements) {
          expect(statement.includes(`'${value}'`), `${enumName} value "${value}" in: ${statement}`).toBe(false);
        }
      }
    }
  });

  it("creates org_billing keyed by the org, deleted with it, one row per Stripe customer", () => {
    expect(sql).toContain('"org_id" uuid PRIMARY KEY NOT NULL');
    expect(sql).toContain('"stripe_customer_id" text NOT NULL');
    expect(sql).toContain('"livemode" boolean NOT NULL');
    expect(sql).toContain(
      'FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "org_billing_stripe_customer_id_uq" ON "org_billing" USING btree ("stripe_customer_id")',
    );
  });

  it("keeps the dropped columns dropped: no subscription id, no free-text flag", () => {
    expect(sql).not.toContain("stripe_subscription_id");
    expect(sql).not.toContain("billing_flag");
    expect(sql).toContain('"disputed_at" timestamp with time zone');
  });

  it("adds complimentary_plan to organizations and via_stripe to org_account_events", () => {
    expect(sql).toContain('ALTER TABLE "organizations" ADD COLUMN "complimentary_plan" "org_plan";');
    expect(sql).toContain('ALTER TABLE "org_account_events" ADD COLUMN "via_stripe" boolean DEFAULT false NOT NULL;');
  });

  it("is the newest entry in the migration journal", () => {
    const journal = JSON.parse(readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toMatchObject({ idx: 41, tag: "0041_stripe_billing" });
  });
});
