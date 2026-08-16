import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // TZ is deliberately hostile: a UTC-offset machine would hide America/Detroit bugs
    // (domain-rules R2.5), so the suite runs in a zone a day ahead of Detroit.
    env: { TZ: "Asia/Karachi" },
  },
});
