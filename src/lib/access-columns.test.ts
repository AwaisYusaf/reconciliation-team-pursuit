/**
 * PHASE-16 U-20 (AC-F1): `orgEntitlement` is the only place billing state becomes a yes or no.
 *
 * Source-reading, like `guard-coverage.test.ts`: every non-test file is parsed and any reference
 * to the columns that decide access (`subscription_status`, `stripe_status`, `complimentary`,
 * `complimentary_until`, `complimentary_plan`, as a property or a raw SQL name) must sit in a file
 * listed below. Comments never count. A sharing file reading `subscriptionStatus` itself is what
 * this exists to stop (§13, security review).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
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

const ACCESS_NAMES =
  /^(subscriptionStatus|stripeStatus|complimentary|complimentaryUntil|complimentaryPlan|subscription_status|stripe_status|complimentary_until|complimentary_plan)$/;
/** The same names inside a raw SQL string, e.g. `sql\`… where stripe_status = …\``. */
const ACCESS_SQL = /\b(subscription_status|stripe_status|complimentary_until|complimentary_plan)\b/;

/** Directories (ending `/`) or files allowed to name those columns, each with why. */
const ALLOWED: Record<string, string> = {
  "src/modules/billing/": "orgEntitlement itself, and the Stripe sync that writes the columns (P1)",
  "src/domain/complimentary.ts": "the complimentary state orgEntitlement reuses (P10)",
  "src/services/auth/entitlement.ts":
    "loads the columns for orgEntitlement; keeps today's cancelled rule for shared links while billing is off",
  "src/db/": "the schema, the seed and the test-org fixtures",
  "src/modules/admin/": "the staff dashboard shows and edits them; staff access is not an org's plan",
  "app/a/": "the staff dashboard pages",
  "src/domain/strings.ts": "`UI.complimentaryUntil` is the /a badge's wording, not a check",
};

const isAllowed = (file: string) =>
  Object.keys(ALLOWED).some((key) => (key.endsWith("/") ? file.startsWith(key) : file === key));

export function accessReads(file: string, source: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const hit =
      (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node)) &&
      ACCESS_NAMES.test(node.text);
    const sqlHit =
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      ACCESS_SQL.test(node.text);
    if (hit || sqlHit) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      found.push(`${file}:${line + 1}  ${node.getText(tree).slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe("U-20: only the entitlement decides access from billing columns", () => {
  it("reads the whole app, not an empty list", () => {
    expect(FILES).toContain("src/modules/sharing/public.ts");
    expect(FILES).toContain("src/services/auth/store.ts");
    expect(FILES.length).toBeGreaterThan(200);
  });

  it("finds no read of an access column outside the allowed files", () => {
    const offenders = FILES.filter((f) => !isAllowed(f)).flatMap((f) =>
      accessReads(f, readFileSync(path.join(repoRoot, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("catches a property, a raw SQL name and a string key, never a comment", () => {
    const n = (source: string) => accessReads("x.ts", source).length;
    expect(n(`const a = org.subscriptionStatus === "cancelled";`)).toBe(1);
    expect(n(`db.select({ s: organizations.stripeStatus })`)).toBe(1);
    expect(n("const q = sql`select 1 where stripe_status = 'active'`;")).toBe(1);
    expect(n(`const k = row["complimentaryUntil"];`)).toBe(1);
    expect(n(`// org.subscriptionStatus\n/** stripe_status */ const a = 1;`)).toBe(0);
    expect(n(`const complimentaryLabel = UI.complimentaryLabel;`)).toBe(0);
  });
});
