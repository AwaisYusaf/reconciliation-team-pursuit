/**
 * PHASE-18 (D-131): the header's month and funding source, and the welcome banner's dismissal, are
 * each person's own (`users.active_month`, `users.active_funding_source_id`,
 * `users.welcome_dismissed_at`). The organization still has columns of
 * the same names, kept only for rollback, so the Phase 18 bug (one manager's switch moving everyone)
 * comes straight back if any code reads or writes them again. Source-reading, like
 * `access-columns.test.ts`: every non-test file under app/, src/ and scripts/ is scanned. Creating
 * an organization still sets `activeMonth` (the column is NOT NULL); that is an insert, which this
 * does not match.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(relDir: string): string[] {
  return readdirSync(path.join(repoRoot, relDir)).flatMap((entry) => {
    const rel = path.posix.join(relDir, entry);
    if (statSync(path.join(repoRoot, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$|\.test-helper\.ts$/.test(entry) ? [rel] : [];
  });
}

const FILES = [...sourceFiles("app"), ...sourceFiles("src"), ...sourceFiles("scripts")];

/** Reading the org's column (`organizations.activeMonth`, `schema.organizations.welcomeDismissedAt`). */
const ORG_READ = /\borganizations\s*\.\s*(activeMonth|activeFundingSourceId|welcomeDismissedAt)\b/;
/** Writing it (`.update(organizations).set({ activeMonth: … })`, across lines). */
const ORG_WRITE =
  /\.update\(\s*(?:schema\.)?organizations\s*\)\s*\.set\(\s*\{[^}]*\b(?:activeMonth|activeFundingSourceId|welcomeDismissedAt)\b/;

export function orgSelectionUses(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [ORG_READ, ORG_WRITE].flatMap((pattern) => code.match(pattern)?.[0] ?? []);
}

describe("per-person header selection (PHASE-18, D-131)", () => {
  it("catches the code Phase 18 removed", () => {
    expect(orgSelectionUses("select({ activeMonth: organizations.activeMonth })")).toHaveLength(1);
    expect(
      orgSelectionUses("await db\n  .update(organizations)\n  .set({ activeFundingSourceId: id })\n  .where(x)"),
    ).toHaveLength(1);
    expect(orgSelectionUses("await db.update(schema.organizations).set({ activeMonth: MONTH })")).toHaveLength(1);
    expect(orgSelectionUses("db.update(organizations).set({ welcomeDismissedAt: new Date() })")).toHaveLength(1);
  });

  it("leaves the per-person columns, org creation and comments alone", () => {
    expect(orgSelectionUses("await db.update(users).set({ activeMonth: month })")).toEqual([]);
    expect(orgSelectionUses("db.insert(organizations).values({ name, activeMonth: currentMonthKey() })")).toEqual([]);
    expect(orgSelectionUses("// was organizations.activeMonth before Phase 18")).toEqual([]);
    expect(orgSelectionUses("await db.update(organizations).set({ onboardedAt: new Date() })")).toEqual([]);
  });

  it("no code reads or writes the organization's month, funding source or welcome dismissal", () => {
    const offenders = FILES.flatMap((file) =>
      orgSelectionUses(readFileSync(path.join(repoRoot, file), "utf8")).map((hit) => `${file}: ${hit}`),
    );
    expect(offenders).toEqual([]);
  });
});
