import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_NAME, pageTitle } from "@/src/domain/strings";

const ROOT = resolve(__dirname, "..", "..");
const SELF = resolve(__dirname, "app-name.test.ts");
const BANNED = ["Grant Expense Reconciliation", "Grant Ledger", "GrantLedger"];

/** Every `.ts`/`.tsx` file under a directory, skipping `node_modules` and dot-directories. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("APP_NAME", () => {
  it("has replaced the old product names everywhere under app/ and src/", () => {
    const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "src"))].filter(
      (path) => path !== SELF,
    );
    const offenders: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      for (const banned of BANNED) {
        if (text.includes(banned)) offenders.push(`${path}: "${banned}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("builds a page title in the fixed Section — App Name form", () => {
    expect(pageTitle("Dashboard")).toBe(`Dashboard — ${APP_NAME}`);
  });
});
