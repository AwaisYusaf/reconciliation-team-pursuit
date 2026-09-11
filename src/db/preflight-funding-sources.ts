/**
 * Read-only preflight for docs/PHASE-6.md (P0.3) — safe to run against production, writes nothing.
 *
 * Prints, per organisation, what the Phase 1 migration will do to it (decision 2.11): the name
 * and tax/fee rules its first funding source will inherit, whether its active payment sources
 * disagree on those rules (a divergence the operator should review before deploy), and a
 * before-picture of row counts. Only SELECTs; opens the transaction read-only as a second guard.
 * Exits 2 with a BLOCKER line if any row would make migration 0023 fail; 0 otherwise.
 *
 *   npm run db:preflight-funding-sources
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

function maskedHostDb(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  console.log(`Target database: ${maskedHostDb(connectionString)}`);

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    // Second guard, in addition to only ever issuing SELECTs below: reject any write this
    // session attempts, so a mistake here cannot mutate production data.
    await db.execute(sql`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`);

    const orgs = await db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .orderBy(schema.organizations.name);

    let divergentCount = 0;

    for (const org of orgs) {
      console.log(`\n=== ${org.name} (${org.id}) ===`);

      const [contract] = await db
        .select({ projectName: schema.contractSettings.projectName })
        .from(schema.contractSettings)
        .where(sql`${schema.contractSettings.orgId} = ${org.id}`)
        .limit(1);

      const projectName = contract?.projectName?.trim() ?? "";
      const migratedName = projectName || "Source 1";
      console.log(`  contract_settings.project_name: ${JSON.stringify(contract?.projectName ?? null)}`);
      console.log(`  migrated funding source name:   ${migratedName}`);

      const activePaymentSources = await db
        .select({
          id: schema.paymentSources.id,
          label: schema.paymentSources.label,
          sortOrder: schema.paymentSources.sortOrder,
          taxReimbursable: schema.paymentSources.taxReimbursable,
          feesReimbursable: schema.paymentSources.feesReimbursable,
        })
        .from(schema.paymentSources)
        .where(
          sql`${schema.paymentSources.orgId} = ${org.id} and ${schema.paymentSources.active}`,
        )
        .orderBy(schema.paymentSources.sortOrder, schema.paymentSources.id);

      const first = activePaymentSources[0];
      const migratedRules = first
        ? `(${first.taxReimbursable}, ${first.feesReimbursable}) from "${first.label}"`
        : "(false, true) fallback";
      console.log(`  migrated tax/fee rules:         ${migratedRules}`);

      const distinctPairs = new Set(
        activePaymentSources.map((p) => `${p.taxReimbursable},${p.feesReimbursable}`),
      );
      if (distinctPairs.size > 1) {
        divergentCount += 1;
        console.log(
          `  WARNING: active payment sources disagree on tax/fee rules. After the migration, ` +
            `new expenses in this org default to the first source's rules only:`,
        );
        for (const p of activePaymentSources) {
          console.log(
            `    - "${p.label}": (tax_reimbursable=${p.taxReimbursable}, fees_reimbursable=${p.feesReimbursable})`,
          );
        }
      }

      const lineItemCount = (
        await db.execute<{ count: string }>(
          sql`select count(*)::text as count from line_items where org_id = ${org.id}`,
        )
      ).rows[0];
      const expenseCounts = (
        await db.execute<{ total: string; trashed: string }>(
          sql`select count(*)::text as total,
                   count(*) filter (where deleted_at is not null)::text as trashed
            from expenses where org_id = ${org.id}`,
        )
      ).rows[0];
      const monthDocCount = (
        await db.execute<{ count: string }>(
          sql`select count(*)::text as count from month_documents where org_id = ${org.id}`,
        )
      ).rows[0];
      const artifactCounts = (
        await db.execute<{ total: string; pinned: string }>(
          sql`select count(*)::text as total,
                   count(*) filter (where downloaded_at is not null)::text as pinned
            from generated_artifacts where org_id = ${org.id}`,
        )
      ).rows[0];

      console.log(`  line_items:          ${lineItemCount?.count ?? 0}`);
      console.log(
        `  expenses:            ${expenseCounts?.total ?? 0} (trashed: ${expenseCounts?.trashed ?? 0})`,
      );
      console.log(`  month_documents:     ${monthDocCount?.count ?? 0}`);
      console.log(
        `  generated_artifacts: ${artifactCounts?.total ?? 0} (pinned/downloaded: ${artifactCounts?.pinned ?? 0})`,
      );
    }

    console.log(`\n${orgs.length} organisation${orgs.length === 1 ? "" : "s"}, ${divergentCount} with divergent rules.`);

    // The migration backfills each expense's funding source from its OWN organisation, then adds
    // the composite key (line_item_id, funding_source_id) → line_items. An expense pointing at a
    // line item of another organisation would fail that key and abort the whole migration (it
    // rolls back, but the deploy fails). The app has always refused such rows, so this should be
    // zero; checked rather than assumed, because a failed deploy is found out at the worst time.
    const crossOrg = (
      await db.execute<{ count: string }>(
        sql`select count(*)::text as count
            from expenses e join line_items li on li.id = e.line_item_id
            where li.org_id <> e.org_id`,
      )
    ).rows[0];
    if (Number(crossOrg?.count ?? 0) > 0) {
      console.log(
        `BLOCKER: ${crossOrg!.count} expense(s) reference another organisation's line item. ` +
          `Migration 0023 will fail on them. Do not deploy; investigate these rows first.`,
      );
      process.exitCode = 2;
    } else {
      console.log("No expense references another organisation's line item (migration 0023 can add its keys).");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
