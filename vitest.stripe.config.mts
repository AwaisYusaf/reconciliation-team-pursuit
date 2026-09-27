import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Stripe sandbox suite (Phase 16 §8.3): `npm run test:stripe`. Same alias/env setup as
// vitest.config.mts; separate config because these tests hit a real Stripe sandbox and a real
// Postgres database, run for minutes rather than seconds, and must never run inside the normal
// `npm test` pass.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.stripe.test.ts"],
    env: { TZ: "Asia/Karachi" },
    // A test can wait on several test-clock advances, each up to 15 minutes (`clockReady`).
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    maxConcurrency: 25,
  },
});
