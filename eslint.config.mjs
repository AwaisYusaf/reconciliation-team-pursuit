import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees (`.claude/worktrees/<id>/`) are whole checkouts of this repo, build
    // output included. The patterns above are anchored at the root, so they miss a nested
    // `.next/` and `npm run lint` reported 622 errors from generated bundles that are not
    // ours to fix. Nothing under `.claude/` is source.
    ".claude/**",
  ]),
]);

export default eslintConfig;
