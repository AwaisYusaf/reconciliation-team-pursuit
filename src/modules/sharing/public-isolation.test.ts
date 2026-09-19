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

const FORBIDDEN_IMPORTS: Array<[string, RegExp]> = [
  ["a generator", /from\s+"@\/src\/generation\/(?!content-types")/],
  ["the packet output path", /from\s+"@\/src\/modules\/packet\/month-output"/],
  ["the sharing actions", /from\s+"@\/src\/modules\/sharing\/actions"/],
  ["a session", /from\s+"@\/src\/services\/auth\/session"/],
  ["the action session", /from\s+"@\/src\/lib\/action-session"/],
];

describe("the public side of a shared link builds nothing and reads no session", () => {
  it("finds the public files", () => {
    expect(PUBLIC_FILES).toContain(path.join("app/s", "[token]", "[filename]", "route.ts"));
    expect(PUBLIC_FILES).toContain(path.join("app/s", "[token]", "page.tsx"));
    expect(PUBLIC_FILES).toContain(path.join("app/s", "[token]", "unlock", "route.ts"));
  });

  describe.each(PUBLIC_FILES)("%s", (file) => {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    it.each(FORBIDDEN_IMPORTS)("imports no %s", (_, pattern) => {
      expect(source).not.toMatch(pattern);
    });
  });

  it("serves by streaming, never by reading the whole file", () => {
    const route = readFileSync(path.join(repoRoot, "app/s/[token]/[filename]/route.ts"), "utf8");
    expect(route).toContain(".stream(");
    expect(route).not.toMatch(/\.get\(share/);
  });
});
