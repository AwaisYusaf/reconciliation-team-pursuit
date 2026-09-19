/**
 * PHASE-12 U-10: opening a shared link never builds a file and never depends on a session.
 *
 * Source-reading, in the repo's style for wiring checks (`monthly-summary/download-isolation
 * .test.ts`): every file under `app/s/` and the public lookup module must import nothing that
 * builds or resolves an artifact, and nothing that reads a session. If one crept in, a link could
 * start rebuilding a 70 MB packet per open, or quietly start behaving differently for a signed-in
 * visitor.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function filesUnder(relDir: string): string[] {
  const absolute = path.join(repoRoot, relDir);
  return readdirSync(absolute).flatMap((entry) => {
    const rel = path.join(relDir, entry);
    return statSync(path.join(repoRoot, rel)).isDirectory() ? filesUnder(rel) : [rel];
  });
}

const PUBLIC_FILES = [
  ...filesUnder("app/s").filter((file) => /\.tsx?$/.test(file)),
  "src/modules/sharing/public.ts",
];

/**
 * Every module specifier in a file, however it is written — `@/…`, `./…` or `../…`, static or
 * dynamic — resolved to a repo-relative path. A relative import is the natural way to reach
 * `./actions` from inside `src/modules/sharing`, and an alias-only check let it through (review).
 */
function importsOf(file: string): string[] {
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map(
    ([, specifier]) => specifier,
  );
  return specifiers.map((specifier) =>
    specifier.startsWith(".")
      ? path.relative(repoRoot, path.resolve(path.dirname(path.join(repoRoot, file)), specifier))
      : specifier.replace(/^@\//, ""),
  );
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["a generator", /^src\/generation\/(?!content-types$)/],
  ["the packet output path", /^src\/modules\/packet\/month-output$/],
  ["the sharing actions", /^src\/modules\/sharing\/actions$/],
  ["a session", /^src\/services\/auth\/session$/],
  ["the action session", /^src\/lib\/action-session$/],
];

describe("the public side of a shared link builds nothing and reads no session", () => {
  it("finds the public files", () => {
    expect(PUBLIC_FILES).toContain(path.join("app/s", "[token]", "[filename]", "route.ts"));
    expect(PUBLIC_FILES).toContain(path.join("app/s", "[token]", "page.tsx"));
    expect(PUBLIC_FILES).toContain(path.join("app/s", "[token]", "unlock", "route.ts"));
  });

  it("resolves relative and dynamic imports", () => {
    expect(importsOf("src/modules/sharing/public.ts")).toContain("src/modules/sharing/token");
    expect(importsOf(path.join("app/s", "[token]", "page.tsx"))).toContain("app/s/[token]/share-card");
  });

  describe.each(PUBLIC_FILES)("%s", (file) => {
    const imports = importsOf(file);
    it.each(FORBIDDEN)("imports no %s", (_, pattern) => {
      expect(imports.filter((specifier) => pattern.test(specifier))).toEqual([]);
    });
  });

  it("serves by streaming, never by reading the whole file", () => {
    const route = readFileSync(path.join(repoRoot, "app/s/[token]/[filename]/route.ts"), "utf8");
    expect(route).toContain(".stream(");
    expect(route).not.toMatch(/\.get\(share/);
  });
});
