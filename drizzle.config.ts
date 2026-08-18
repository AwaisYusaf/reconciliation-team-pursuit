import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Local development reads .env.local. In the deployed container that file does not exist
// and DATABASE_URL arrives in the real environment from compose's env_file — dotenv never
// overwrites an existing variable, so the container's value wins either way. Stated here
// because the deployment depends on it and it is not obvious from the call alone.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
