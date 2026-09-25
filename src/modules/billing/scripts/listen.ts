/**
 * `npm run billing:listen` (Phase 15 §9). Development only: forwards Stripe's webhook calls to
 * the local app with the Stripe CLI, for exactly the events the app handles. Uses `--api-key`
 * rather than `stripe login`, which needs CLI permission on the account. It prints the
 * `whsec_...` signing secret to put in `.env.local` as `STRIPE_WEBHOOK_SECRET`. Production has a
 * real webhook endpoint instead (§11 step 4).
 *
 *   npm run billing:listen      (STRIPE_CLI = path to stripe.exe, or `stripe` on the PATH)
 */
import { spawn } from "node:child_process";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { HANDLED_EVENTS } from "@/src/modules/billing/webhook";

const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
if (!key.startsWith("sk_test_")) {
  console.error("billing:listen is for test mode: set a sk_test_ key in .env.local");
  process.exit(1);
}

const port = new URL(process.env.APP_URL || "http://localhost:3000").port || "3000";
const args = ["listen", "--api-key", key, "--events", HANDLED_EVENTS.join(","), "--forward-to", `localhost:${port}/api/stripe/webhook`];
spawn(process.env.STRIPE_CLI || "stripe", args, { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 0));
