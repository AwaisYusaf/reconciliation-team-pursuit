/**
 * Nothing the app writes contains an em dash or an en dash (D-113, PHASE-13 §7).
 *
 * Source-reading, in the repo's style for wiring checks (`sharing/public-isolation.test.ts`):
 * every non-test source file is parsed with the TypeScript compiler, so comments are skipped and
 * only text that can reach a screen, a document or a log is judged: string literals, template
 * parts, regular expressions, JSX text and JSX attributes. A dash is caught however it is written:
 * the character itself, a `\u` escape, or an HTML entity.
 *
 * Text people type keeps its dashes (D-113), and none of it lives in source, so the rule here has
 * no exceptions beyond the two files below, each of which has to name a dash to do its job.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Files that must name a dash, each with exactly how many places it does, so new copy there still fails. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "src/generation/pdf-text.ts": { count: 1, why: "a table of the characters WinAnsi can encode, not copy" },
  "src/domain/dashes.ts": { count: 3, why: "the cleaner has to name the dashes it removes" },
};

// The character; a JavaScript escape (`\u2014`, `\u{2014}`); a CSS escape (`\2014`, as in a Tailwind
// `content-[...]` class); an HTML entity, named or numeric, with or without leading zeros.
const DASH = /[\u2013\u2014]|\\u(?:\{0*)?201[34]\}?|\\0*201[34]|&(?:mdash|ndash|#0*821[12]|#x0*201[34]);/i;

/** `String.fromCharCode(0x2014)` and friends: a dash built from its number. */
const DASH_CODE = /^(?:0x0*201[34]|0*821[12])$/i;

function sourceFiles(relDir: string): string[] {
  return readdirSync(path.join(repoRoot, relDir)).flatMap((entry) => {
    const rel = path.posix.join(relDir, entry);
    if (statSync(path.join(repoRoot, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$|\.test-helper\.ts$/.test(entry) ? [rel] : [];
  });
}

const ROOT_FILES = ["proxy.ts", "instrumentation.ts", "next.config.ts", "drizzle.config.ts"];
const FILES = [...sourceFiles("app"), ...sourceFiles("src"), ...sourceFiles("scripts"), ...ROOT_FILES];

const TEXT_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
]);

/** Every piece of text in `source` with a dash, as `file:line  text`. Comments never appear. */
export function dashesIn(file: string, source: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      /fromC(?:harCode|odePoint)$/.test(node.expression.getText(tree)) &&
      node.arguments.some((argument) => DASH_CODE.test(argument.getText(tree)))
    ) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      found.push(`${file}:${line + 1}  ${node.getText(tree).slice(0, 120)}`);
    }
    if (TEXT_KINDS.has(node.kind)) {
      const raw = node.getText(tree);
      // The cooked value too, so an escape the raw check might miss is judged as the character it is.
      const cooked = (node as { text?: string }).text ?? raw;
      if (DASH.test(raw) || DASH.test(cooked)) {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        found.push(`${file}:${line + 1}  ${raw.replace(/\s+/g, " ").trim().slice(0, 120)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe("no em or en dash in anything the app writes (D-113)", () => {
  it("reads the whole app, not an empty list", () => {
    expect(FILES).toContain("app/r/expenses/expenses-table.tsx");
    expect(FILES).toContain("src/domain/strings.ts");
    expect(FILES).toContain("src/services/openai/write-summary.ts");
    expect(FILES).toContain("instrumentation.ts");
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
  });

  it("finds none outside the allowlist", () => {
    const offenders = FILES.filter((file) => !(file in ALLOWED)).flatMap((file) =>
      dashesIn(file, readFileSync(path.join(repoRoot, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("allows each listed file exactly the dashes it needs, and no more", () => {
    for (const [file, { count }] of Object.entries(ALLOWED)) {
      expect(dashesIn(file, readFileSync(path.join(repoRoot, file), "utf8")), file).toHaveLength(count);
    }
  });

  it("finds none in the stylesheet or the shell scripts either, outside comments", () => {
    const offenders: string[] = [];
    // Comments blanked rather than removed, so line numbers stay right.
    const css = readFileSync(path.join(repoRoot, "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, " "),
    );
    css.split("\n").forEach((line, index) => {
      if (DASH.test(line)) offenders.push(`app/globals.css:${index + 1}  ${line.trim()}`);
    });
    for (const script of ["deploy.sh", "backup.sh"]) {
      readFileSync(path.join(repoRoot, script), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (!/^\s*#/.test(line) && DASH.test(line)) offenders.push(`${script}:${index + 1}  ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("catches a dash however it is written, and never in a comment", () => {
    const em = "\u2014";
    const en = "\u2013";
    const caught = (source: string, file = "x.tsx") => dashesIn(file, source).length;
    expect(caught(`const a = "Saved ${em} still missing proof.";`)).toBe(1);
    expect(caught(`const a = \`\${n} records ${en} see the packet\`;`)).toBe(1);
    expect(caught(`const a = \`\${n} of \${m} ${em} \${x}\`;`)).toBe(1);
    expect(caught(`const a = <p>Nothing yet ${em} add one.</p>;`)).toBe(1);
    expect(caught(`const a = <p>Nothing yet &mdash; add one.</p>;`)).toBe(1);
    expect(caught(`const a = <p>1&ndash;10</p>;`)).toBe(1);
    expect(caught(`const a = <p title="a ${em} b" />;`)).toBe(1);
    expect(caught(`const a = "a \\u2014 b";`)).toBe(1);
    expect(caught(`const a = "a \\u{2013} b";`)).toBe(1);
    expect(caught(`const a = /[${em}]/;`)).toBe(1);
    expect(caught(`const a = <p>&#08212;</p>;`)).toBe(1);
    expect(caught(`const a = <p title="&#x02014;" />;`)).toBe(1);
    expect(caught(`const a = <p className="before:content-['\\2014']" />;`)).toBe(1);
    expect(caught(`const a = String.fromCharCode(0x2014);`)).toBe(1);
    expect(caught(`const a = String.fromCodePoint(8212);`)).toBe(1);
    expect(caught(`const a = String.fromCharCode(0x2d);`)).toBe(0);
    expect(caught(`// a comment ${em} is fine\n/** so is ${en} this */\nconst a = "plain";`)).toBe(0);
    expect(caught(`const a = "a - b | c · d";`)).toBe(0);
  });
});
