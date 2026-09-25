// U-6 (Phase 16 §8.1): `handleWebhook` signature/mode/dispatch rules. Pure — signed with a local
// Stripe client (`constructEvent` never calls the API), no server and no database.
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { HANDLED_EVENTS, handleWebhook, type WebhookDeps } from "./webhook";

const secret = "whsec_test_secret";
const signer = new Stripe("sk_test_x");

function sign(payload: string, opts: { secret?: string; timestamp?: number } = {}): string {
  return signer.webhooks.generateTestHeaderString({
    payload,
    secret: opts.secret ?? secret,
    timestamp: opts.timestamp,
  });
}

function event(overrides: Partial<{ id: string; type: string; livemode: boolean; data: unknown }> = {}): string {
  return JSON.stringify({
    id: overrides.id ?? "evt_1",
    object: "event",
    livemode: overrides.livemode ?? false,
    type: overrides.type ?? "invoice.paid",
    data: overrides.data !== undefined ? overrides.data : { object: { customer: "cus_123" } },
  });
}

function deps(overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    secret,
    live: false,
    sync: vi.fn().mockResolvedValue(undefined),
    dispute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("handleWebhook: signature and mode gates (bad cases never sync)", () => {
  it("missing signature: 400, sync never called", async () => {
    const d = deps();
    const result = await handleWebhook(event(), null, d);
    expect(result.status).toBe(400);
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("forged signature (garbage header): 400, sync never called", async () => {
    const d = deps();
    const result = await handleWebhook(event(), "t=1,v1=notreal", d);
    expect(result.status).toBe(400);
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("wrong secret used to sign: 400, sync never called", async () => {
    const d = deps();
    const body = event();
    const sig = sign(body, { secret: "whsec_a_totally_different_secret" });
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(400);
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("replayed (1h old timestamp): 400, sync never called", async () => {
    const d = deps();
    const body = event();
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    const sig = sign(body, { timestamp: hourAgo });
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(400);
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("tampered body (signature doesn't match the bytes actually sent): 400, sync never called", async () => {
    const d = deps();
    const body = event();
    const sig = sign(body);
    const tampered = body.replace("cus_123", "cus_attacker");
    const result = await handleWebhook(tampered, sig, d);
    expect(result.status).toBe(400);
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("wrong mode: a live event against a test-mode key is refused, 400, sync never called", async () => {
    const d = deps({ live: false });
    const body = event({ livemode: true });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(400);
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("wrong mode the other way: a test-mode event against a live key is refused, 400, sync never called", async () => {
    const d = deps({ live: true });
    const body = event({ livemode: false });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(400);
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("malformed JSON body with an otherwise-valid signature over those exact bytes: 400, sync never called", async () => {
    const d = deps();
    const body = "{not valid json";
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(400);
    expect(d.sync).not.toHaveBeenCalled();
  });
});

describe("handleWebhook: dispatch for handled events", () => {
  const nonDisputeEvents = HANDLED_EVENTS.filter((t) => t !== "charge.dispute.created");

  it.each(nonDisputeEvents)("%s syncs the named customer given as a plain string id", async (type) => {
    const d = deps();
    const body = event({ type, data: { object: { customer: "cus_string_id" } } });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(200);
    expect(d.sync).toHaveBeenCalledExactlyOnceWith("cus_string_id");
    expect(d.dispute).not.toHaveBeenCalled();
  });

  it.each(nonDisputeEvents)("%s syncs the named customer given as an expanded object", async (type) => {
    const d = deps();
    const body = event({ type, data: { object: { customer: { id: "cus_expanded_id" } } } });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(200);
    expect(d.sync).toHaveBeenCalledExactlyOnceWith("cus_expanded_id");
  });

  it("charge.dispute.created calls dispute, not sync", async () => {
    const d = deps();
    const disputeObject = { id: "dp_1", charge: "ch_1" };
    const body = event({ type: "charge.dispute.created", data: { object: disputeObject } });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(200);
    expect(d.dispute).toHaveBeenCalledExactlyOnceWith(disputeObject);
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("an unhandled event type: 200, no sync, no dispute", async () => {
    const d = deps();
    const body = event({ type: "customer.created" });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(200);
    expect(d.sync).not.toHaveBeenCalled();
    expect(d.dispute).not.toHaveBeenCalled();
  });

  it("a handled event with no customer on the object: 200, no sync", async () => {
    const d = deps();
    const body = event({ type: "invoice.paid", data: { object: {} } });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(200);
    expect(result.body).toContain("no customer");
    expect(d.sync).not.toHaveBeenCalled();
  });

  it("sync throwing: 500, so Stripe retries", async () => {
    const d = deps({ sync: vi.fn().mockRejectedValue(new Error("db down")) });
    const body = event({ type: "invoice.paid" });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(500);
  });

  it("dispute throwing: 500 too", async () => {
    const d = deps({ dispute: vi.fn().mockRejectedValue(new Error("stripe down")) });
    const body = event({ type: "charge.dispute.created", data: { object: { id: "dp_1", charge: "ch_1" } } });
    const sig = sign(body);
    const result = await handleWebhook(body, sig, d);
    expect(result.status).toBe(500);
  });
});
