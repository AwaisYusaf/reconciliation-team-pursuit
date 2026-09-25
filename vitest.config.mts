import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` throws unless resolved under React's "react-server" condition.
      // Tests run server code directly in Node, so point it at the package's own no-op.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Stripe sandbox tests run separately (`npm run test:stripe`, `vitest.stripe.config.mts`):
    // they hit real Stripe, take minutes, and must never skip silently inside the normal suite.
    exclude: [...configDefaults.exclude, "src/**/*.stripe.test.ts"],
    // TZ is deliberately hostile: a UTC-offset machine would hide America/Detroit bugs
    // (domain-rules R2.5), so the suite runs in a zone a day ahead of Detroit.
    env: { TZ: "Asia/Karachi" },
  },
});
