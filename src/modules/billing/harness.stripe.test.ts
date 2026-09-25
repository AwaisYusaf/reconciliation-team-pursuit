/**
 * Proves the Stripe sandbox suite can actually reach Stripe (Phase 15 §8.3): a pinned SDK
 * client can retrieve the sandbox balance, and it is genuinely test mode. Every later
 * `*.stripe.test.ts` file in Phases 2-3 builds on the same client.
 *
 * Never skips: without a `sk_test_` key and a database this throws at module load, so a
 * missing sandbox key fails loudly (`npm run test:stripe`) rather than silently reporting green.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_") || !process.env.DATABASE_URL) {
  throw new Error(
    "npm run test:stripe requires STRIPE_SECRET_KEY (a sk_test_... sandbox key) and DATABASE_URL " +
      "to be set. Set them in the environment or .env.local before running this suite.",
  );
}

import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { STRIPE_API_VERSION } from "./config";

describe("Stripe sandbox reachability", () => {
  it("connects with the pinned API version and confirms test mode", async () => {
    const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
    const balance = await stripe.balance.retrieve();
    expect(balance.livemode).toBe(false);
  });
});
