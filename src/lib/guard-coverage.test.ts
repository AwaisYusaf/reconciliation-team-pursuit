/**
 * PHASE-16 U-18: no free use, guarded by default (§4.7, P22).
 *
 * Source-reading, in the repo's style for wiring checks (`domain/no-dashes.test.ts`): every
 * `"use server"` export, every `app/r` and onboarding page and every route method is found by
 * parsing the source, so a new one is covered the day it is written. Each must reach a guard that
 * refuses an unpaid organization (`actionSession`/`requireAdmin`, `pageSession`, `routeSession`)
 * or be on the allow-list below; an `*AnyPlan` helper may only be reached from a listed entry.
 * A guard reached through a same-file helper counts (`requireManagerTarget` in users/actions).
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

const FILES = [...sourceFiles("app"), ...sourceFiles("src")];
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

/* ------------------------------------------------------------------ analysis */

export type Entry = { file: string; name: string; refs: Set<string> };
export type Parsed = { useServer: boolean; exports: Entry[]; defaultExport: Entry | null; refs: Set<string> };

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

/**
 * Every exported function in `source`, each with the identifiers it references, following any
 * same-file top-level function it references (so a guard in a local helper counts).
 */
export function parse(file: string, source: string): Parsed {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);

  const first = tree.statements[0];
  const useServer =
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server";

  // Top-level functions by name: declarations and `const x = (async) () => …` / `function …`.
  const locals = new Map<string, ts.Node>();
  const exported: Array<{ name: string; node: ts.Node; isDefault: boolean }> = [];
  for (const statement of tree.statements) {
    const isExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      locals.set(name, statement);
      if (isExported) exported.push({ name, node: statement, isDefault });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (!ts.isIdentifier(declaration.name) || !init) continue;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isCallExpression(init)) {
          locals.set(declaration.name.text, init);
          if (isExported) exported.push({ name: declaration.name.text, node: init, isDefault: false });
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      exported.push({ name: "default", node: statement.expression, isDefault: true });
    } else if (ts.isExportDeclaration(statement) && useServer) {
      // `export { a }` from a server-action file would dodge the per-export walk below.
      exported.push({ name: "export-list", node: statement, isDefault: false });
    }
  }

  const refsOf = (root: ts.Node): Set<string> => {
    const seen = new Set<ts.Node>();
    const refs = new Set<string>();
    const walk = (node: ts.Node) => {
      if (seen.has(node)) return;
      seen.add(node);
      const visit = (child: ts.Node) => {
        if (ts.isIdentifier(child)) {
          refs.add(child.text);
          const local = locals.get(child.text);
          if (local && local !== root) walk(local);
        }
        ts.forEachChild(child, visit);
      };
      ts.forEachChild(node, visit);
    };
    walk(root);
    return refs;
  };

  const exports = exported.map(({ name, node }) => ({ file, name, refs: refsOf(node) }));
  const defaultIndex = exported.findIndex((e) => e.isDefault);
  return {
    useServer,
    exports,
    defaultExport: defaultIndex === -1 ? null : exports[defaultIndex],
    refs: refsOf(tree),
  };
}

const PLAN_GUARDS = ["actionSession", "requireAdmin"];
const STAFF_GUARDS = ["requireStaff"]; // `/a` is separate from any organization's plan (§4.7)
const RAW_SESSION = ["getSession", "requireSession"];
const isAnyPlan = (name: string) => /AnyPlan$/.test(name);
const usesAnyPlan = (refs: Set<string>) => [...refs].some(isAnyPlan);
const refsAny = (refs: Set<string>, names: string[]) => names.some((n) => refs.has(n));

/** `file#name`, `file#*`, or a directory prefix ending in `/`. */
function allowed(list: Record<string, string>, file: string, name: string): boolean {
  return Object.keys(list).some((key) => {
    if (key.endsWith("/")) return file.startsWith(key);
    const [f, n] = key.split("#");
    return f === file && (n === "*" || n === name);
  });
}

/* ---------------------------------------------------------------- allow-list */

/** §4.7: the only server actions an unpaid organization may reach. Each says why. */
export const ACTION_ALLOW: Record<string, string> = {
  "src/modules/auth/actions.ts#signInAction": "no session yet; sends an unpaid org to /r/plan",
  "src/modules/auth/actions.ts#signOutAction": "Sign out on the plan page",
  "src/modules/auth/actions.ts#signUpAction": "no session yet; sends the new org to /r/plan",
  "src/modules/settings/actions.ts#changePasswordAction": "§2.6: an unpaid admin can still change their password",
  "src/modules/users/actions.ts#listOrgUsersAction": "§4.7: list users",
  "src/modules/users/actions.ts#revokeUserAccessAction": "§4.7: remove a departed user",
  "src/modules/funding-sources/actions.ts#archiveFundingSourceAction":
    "D2: archive sources from the plan page before choosing Reconciliation",
  "src/modules/billing/actions.ts#*": "the billing actions: paying is the way out (Track A, Phase 3)",
};

/** §4.7: route handlers that answer without `routeSession`. Each says why. */
export const ROUTE_ALLOW: Record<string, string> = {
  "app/api/me/avatar/route.ts#*": "the signed-in person's own photo, in the plan page's header",
  "app/r/billing/": "/r/billing/return re-syncs after Checkout (Track A, Phase 3)",
  "app/api/stripe/": "the Stripe webhook: Stripe, not a session (Track A, Phase 2)",
  "app/s/": "public shared links: no session; `loadPublicShare` checks the entitlement",
};

/** Where each `*AnyPlan` helper is defined; referencing it there is not a use. */
const DEFINITIONS = ["src/lib/action-session.ts", "src/lib/route-session.ts"];

const PAGE_GUARD = "pageSession";
const PLAN_PAGE = "app/r/plan/page.tsx";
const PLAN_PAGE_GUARD = "planPageSession";

/* ------------------------------------------------------------------ the data */

const parsed = new Map(FILES.map((file) => [file, parse(file, read(file))]));

const actions = [...parsed.values()].filter((p) => p.useServer).flatMap((p) => p.exports);

const PAGES = FILES.filter(
  (f) => (f.startsWith("app/r/") || f.startsWith("app/(auth)/onboarding/")) && f.endsWith("/page.tsx"),
);

const routeMethods = FILES.filter((f) => f.endsWith("/route.ts")).flatMap((file) =>
  parsed.get(file)!.exports.filter((e) => HTTP_METHODS.has(e.name)),
);

/* ---------------------------------------------------------------------- tests */

describe("U-18: every entry point refuses an unpaid organization unless allow-listed", () => {
  it("finds every kind of entry point, not an empty list", () => {
    expect(actions.length).toBeGreaterThan(60);
    expect(actions.map((a) => `${a.file}#${a.name}`)).toContain("src/modules/expenses/actions.ts#createExpenseAction");
    expect(PAGES).toContain("app/r/page.tsx");
    expect(PAGES).toContain("app/(auth)/onboarding/line-items/page.tsx");
    expect(PAGES).toContain(PLAN_PAGE);
    expect(PAGES.length).toBeGreaterThanOrEqual(18);
    expect(routeMethods.map((r) => `${r.file}#${r.name}`)).toEqual(
      expect.arrayContaining(["app/api/downloads/packet/route.ts#GET", "app/api/me/avatar/route.ts#DELETE"]),
    );
    expect(routeMethods.length).toBeGreaterThanOrEqual(19);
  });

  it("server actions: each reaches actionSession or requireAdmin (or requireStaff), or is allow-listed", () => {
    const offenders = actions
      .filter((a) => !refsAny(a.refs, [...PLAN_GUARDS, ...STAFF_GUARDS]) && !allowed(ACTION_ALLOW, a.file, a.name))
      .map((a) => `${a.file}#${a.name}`);
    expect(offenders).toEqual([]);
  });

  it("server actions: a raw session read or an *AnyPlan helper only in an allow-listed action", () => {
    const offenders = actions
      .filter((a) => (usesAnyPlan(a.refs) || refsAny(a.refs, RAW_SESSION)) && !allowed(ACTION_ALLOW, a.file, a.name))
      .map((a) => `${a.file}#${a.name}`);
    expect(offenders).toEqual([]);
  });

  it("the action allow-list names only actions that exist (or a whole billing file still to come)", () => {
    const stale = Object.keys(ACTION_ALLOW).filter((key) => {
      const [file, name] = key.split("#");
      if (name === "*") return false;
      return !actions.some((a) => a.file === file && a.name === name);
    });
    expect(stale).toEqual([]);
  });

  it("pages: every app/r and onboarding page calls pageSession(); only /r/plan calls planPageSession()", () => {
    const offenders = PAGES.filter((page) => {
      const entry = parsed.get(page)!.defaultExport;
      const guard = page === PLAN_PAGE ? PLAN_PAGE_GUARD : PAGE_GUARD;
      return !entry || !entry.refs.has(guard) || (page !== PLAN_PAGE && entry.refs.has(PLAN_PAGE_GUARD));
    });
    expect(offenders).toEqual([]);

    const planPageGuardUsers = FILES.filter(
      (f) => f !== PLAN_PAGE && f !== "src/lib/page-session.ts" && parsed.get(f)!.refs.has(PLAN_PAGE_GUARD),
    );
    expect(planPageGuardUsers).toEqual([]);
  });

  it("the /r layout checks the plan before it loads any organization data", () => {
    const layout = parsed.get("app/r/layout.tsx")!.defaultExport!;
    expect(layout.refs.has("hasPaidAccess")).toBe(true);
    const source = read("app/r/layout.tsx");
    expect(source.indexOf("hasPaidAccess(")).toBeGreaterThan(-1);
    expect(source.indexOf("hasPaidAccess(")).toBeLessThan(source.indexOf("loadSourceContext("));
  });

  it("route handlers: each method reaches routeSession or readSignedInJson, or is allow-listed", () => {
    const offenders = routeMethods
      .filter((r) => !refsAny(r.refs, ["routeSession", "readSignedInJson"]) && !allowed(ROUTE_ALLOW, r.file, r.name))
      .map((r) => `${r.file}#${r.name}`);
    expect(offenders).toEqual([]);
  });

  it("route handlers: a raw session read or routeSessionAnyPlan only in an allow-listed route", () => {
    const offenders = routeMethods
      .filter((r) => (usesAnyPlan(r.refs) || refsAny(r.refs, RAW_SESSION)) && !allowed(ROUTE_ALLOW, r.file, r.name))
      .map((r) => `${r.file}#${r.name}`);
    expect(offenders).toEqual([]);
  });

  it("public shared-link routes go through the sharing lookup that checks the entitlement", () => {
    const shareRoutes = routeMethods.filter((r) => r.file.startsWith("app/s/"));
    expect(shareRoutes.length).toBeGreaterThanOrEqual(3);
    const offenders = shareRoutes
      .filter((r) => !refsAny(r.refs, ["openShare", "unlockSharedFile", "loadPublicShare"]))
      .map((r) => `${r.file}#${r.name}`);
    expect(offenders).toEqual([]);
  });

  it("an *AnyPlan helper is referenced only where it is defined or from an allow-listed entry's file", () => {
    const hosts = new Set([
      ...DEFINITIONS,
      ...actions.filter((a) => allowed(ACTION_ALLOW, a.file, a.name)).map((a) => a.file),
      ...routeMethods.filter((r) => allowed(ROUTE_ALLOW, r.file, r.name)).map((r) => r.file),
    ]);
    const offenders = FILES.filter((f) => usesAnyPlan(parsed.get(f)!.refs) && !hosts.has(f));
    expect(offenders).toEqual([]);
  });
});

describe("the analysis itself catches what it must", () => {
  const exportsOf = (source: string, file = "src/modules/x/actions.ts") => parse(file, source).exports;

  it("finds a missing guard, and a guard reached through a local helper", () => {
    const [bare] = exportsOf(`"use server";\nexport async function a() { return db.select(); }`);
    expect(refsAny(bare.refs, PLAN_GUARDS)).toBe(false);
    const [viaHelper] = exportsOf(
      `"use server";\nasync function guard() { return requireAdmin(); }\nexport async function a() { await guard(); }`,
    );
    expect(refsAny(viaHelper.refs, PLAN_GUARDS)).toBe(true);
    const [arrow] = exportsOf(`"use server";\nexport const a = async () => { await actionSession(); };`);
    expect(refsAny(arrow.refs, PLAN_GUARDS)).toBe(true);
  });

  it("sees an *AnyPlan helper passed as a value, not only called", () => {
    const [passed] = exportsOf(
      `"use server";\nasync function t(g) { return g(); }\nexport async function a() { await t(requireAdminAnyPlan); }`,
    );
    expect(usesAnyPlan(passed.refs)).toBe(true);
  });

  it("flags an export list in a server-action file and ignores comments", () => {
    const listed = exportsOf(`"use server";\nasync function a() {}\nexport { a };`);
    expect(listed.map((e) => e.name)).toContain("export-list");
    const [commented] = exportsOf(`"use server";\nexport async function a() { /* actionSession() */ return 1; }`);
    expect(refsAny(commented.refs, PLAN_GUARDS)).toBe(false);
  });

  it("matches allow-list keys by entry, by file and by directory", () => {
    const list = { "a.ts#x": "", "b.ts#*": "", "app/s/": "" };
    expect(allowed(list, "a.ts", "x")).toBe(true);
    expect(allowed(list, "a.ts", "y")).toBe(false);
    expect(allowed(list, "b.ts", "anything")).toBe(true);
    expect(allowed(list, "app/s/[token]/route.ts", "GET")).toBe(true);
    expect(allowed(list, "app/sx/route.ts", "GET")).toBe(false);
  });
});
