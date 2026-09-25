/**
 * Unit checks on migration 0039 (Phase 15, §3): the Stripe billing columns. No database —
 * this only reads the SQL file and the schema's enum exports, in the style of
 * `src/db/migration-0031.test.ts`.
 *
 * D-106/D-115: drizzle runs every pending migration in one transaction, so anything here that
 * would fail partway (an `ALTER TYPE`, a `NOT NULL` with no default, an enum literal baked into
 * a `CHECK`) could wedge every future deploy, not just this one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as schema from "./schema";

const sql = readFileSync(path.join(__dirname, "..", "..", "drizzle", "0039_stripe_billing.sql"), "utf8");
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0039: Stripe billing columns", () => {
  it("has at least one statement", () => {
    expect(statements.length).toBeGreaterThan(0);
  });

  it("is only ALTER TABLE ... ADD COLUMN/ADD CONSTRAINT, or CREATE UNIQUE INDEX", () => {
    for (const statement of statements) {
      const isAddColumn = /^ALTER TABLE "\w+" ADD COLUMN /.test(statement);
      const isAddConstraint = /^ALTER TABLE "\w+" ADD CONSTRAINT /.test(statement);
      const isUniqueIndex = /^CREATE UNIQUE INDEX /.test(statement);
      expect(isAddColumn || isAddConstraint || isUniqueIndex, statement).toBe(true);
    }
  });

  it("never runs ALTER TYPE, UPDATE, DROP or ALTER COLUMN", () => {
    expect(sql).not.toMatch(/ALTER TYPE/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
  });

  it("every ADD COLUMN is nullable or has a DEFAULT — never a bare NOT NULL", () => {
    for (const statement of statements) {
      const match = statement.match(/^ALTER TABLE "\w+" ADD COLUMN "\w+" [^;]+$/);
      if (!match) continue;
      const clause = match[0];
      const hasNotNull = /NOT NULL/.test(clause);
      const hasDefault = /DEFAULT/.test(clause);
      expect(hasNotNull && !hasDefault, clause).toBe(false);
    }
  });

  // ── No enum literal (other than the four plain-text values this migration itself defines)
  // baked into a CHECK — a future Stripe status or a renamed enum value would otherwise leave
  // a CHECK that silently stops matching what the enum actually contains.
  it("no CHECK body quotes a pgEnum value, other than 'month'/'year'/'downgrade'/'price_move'", () => {
    const allowed = new Set(["month", "year", "downgrade", "price_move"]);
    const enumEntries = Object.entries(schema).filter(
      (entry): boolean => typeof entry[1] === "function" && "enumValues" in entry[1],
    ) as Array<[string, { enumValues: readonly string[] }]>;

    const checkStatements = statements.filter((s) => s.includes(" CHECK ("));
    for (const [enumName, enumColumn] of enumEntries) {
      for (const value of enumColumn.enumValues) {
        if (allowed.has(value)) continue; // not one of this migration's own text values
        for (const statement of checkStatements) {
          expect(statement.includes(`'${value}'`), `${enumName} value "${value}" in: ${statement}`).toBe(
            false,
          );
        }
      }
    }
  });

  // ── Every expected column and its CHECK text ────────────────────────────────

  it("adds every organizations billing column", () => {
    const expectedColumns = [
      ["stripe_customer_id", "text"],
      ["stripe_livemode", "boolean"],
      ["stripe_subscription_id", "text"],
      ["stripe_status", "text"],
      ["billing_interval", "text"],
      ["current_period_end", "timestamp with time zone"],
      ["cancel_at_period_end", "boolean"],
      ["pending_plan", '"org_plan"'],
      ["pending_interval", "text"],
      ["pending_at", "timestamp with time zone"],
      ["pending_reason", "text"],
      ["upgrade_pay_url", "text"],
      ["upgrade_expires_at", "timestamp with time zone"],
      ["billing_synced_at", "timestamp with time zone"],
      ["complimentary_plan", '"org_plan"'],
      ["collection_paused", "boolean"],
      ["billing_flag", "text"],
    ] as const;
    for (const [column, type] of expectedColumns) {
      expect(sql).toContain(`ALTER TABLE "organizations" ADD COLUMN "${column}" ${type}`);
    }
  });

  it("adds org_account_events.via_stripe, not null, defaulted", () => {
    expect(sql).toContain(
      'ALTER TABLE "org_account_events" ADD COLUMN "via_stripe" boolean DEFAULT false NOT NULL',
    );
  });

  it("cancel_at_period_end and collection_paused are NOT NULL DEFAULT false", () => {
    expect(sql).toContain(
      'ALTER TABLE "organizations" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL',
    );
    expect(sql).toContain(
      'ALTER TABLE "organizations" ADD COLUMN "collection_paused" boolean DEFAULT false NOT NULL',
    );
  });

  it("stripe_customer_id is unique, not a hard NOT NULL", () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "organizations_stripe_customer_id_uq" ON "organizations" USING btree ("stripe_customer_id")',
    );
  });

  it("has the four CHECK constraints, guarding empty status and the interval/reason values", () => {
    expect(sql).toContain(
      'ADD CONSTRAINT "organizations_stripe_status_ck" CHECK ("organizations"."stripe_status" IS NULL OR length("organizations"."stripe_status") > 0)',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "organizations_billing_interval_ck" CHECK ("organizations"."billing_interval" IS NULL OR "organizations"."billing_interval" IN (\'month\', \'year\'))',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "organizations_pending_interval_ck" CHECK ("organizations"."pending_interval" IS NULL OR "organizations"."pending_interval" IN (\'month\', \'year\'))',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "organizations_pending_reason_ck" CHECK ("organizations"."pending_reason" IS NULL OR "organizations"."pending_reason" IN (\'downgrade\', \'price_move\'))',
    );
  });

  it("is the newest entry in the migration journal", () => {
    const journalPath = path.join(__dirname, "..", "..", "drizzle", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const entry = journal.entries.find((e) => e.tag === "0039_stripe_billing");
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(39);
  });
});
