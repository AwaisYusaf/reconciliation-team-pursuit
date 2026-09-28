"use server";

/**
 * Thin server-action adapters over `billing.ts`, which holds every rule (Phase 16 §4.1).
 *
 * Every action: `actionSession()` (expired → return it), `billingEnabled()` off →
 * `billingNotEnabled`, non-admin → `billingNotAdmin`, then the per-user rate limit, then the
 * core call. `BillingError` maps to its UI string; a Stripe error is logged and turned into
 * `billingStripeError`; anything else rethrows (a real 500).
 *
 * These use the any-plan session (allow-list, Phase 4 §4.7): an org with no paid plan must
 * still be able to subscribe, so the billing check is skipped here and the admin check below is
 * this file's own. `guard-coverage.test.ts` allow-lists each of these actions by name for exactly
 * that reason, so a new one here is not let through unchecked.
 */
import Stripe from "stripe";

import * as billing from "@/src/modules/billing/billing";
import { billingEnabled } from "@/src/modules/billing/config";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSessionAnyPlan } from "@/src/lib/action-session";
import { consume } from "@/src/services/rate-limit";

const ERROR_MESSAGE: Record<billing.BillingErrorCode, (e: billing.BillingError) => string> = {
  unknown_plan: () => UI.billingUnknownPlan,
  price_missing: () => UI.billingUnknownPlan,
  already_subscribed: () => UI.billingAlreadySubscribed,
  payment_processing: () => UI.billingPaymentProcessing,
  no_plan: () => UI.billingNoPlan,
  payment_failed: () => UI.billingPaymentFailedRefused,
  payment_pending: () => UI.billingPaymentPending,
  cancel_pending: () => UI.billingCancelPending,
  change_pending: () => UI.billingChangePending,
  same_plan: () => UI.billingSamePlan,
  quote_expired: () => UI.billingQuoteExpired,
  portal_not_setup: () => UI.billingPortalNotSetUp,
  complimentary: () => UI.billingComplimentaryRefused,
  too_many_sources: (e) => UI.billingDowngradeTooManySources(e.count ?? 0),
  keep_source: () => UI.billingKeepSourceRefused,
};

type Guarded = { actor: billing.Actor };

/** The five checks every billing action opens with. */
async function guard(): Promise<Guarded | { result: ActionResult<never> }> {
  const session = await actionSessionAnyPlan();
  if ("expired" in session) return { result: session.expired };
  if (!billingEnabled()) return { result: fail(UI.billingNotEnabled) };
  if (session.role !== "admin") return { result: fail(UI.billingNotAdmin) };

  const budget = consume("billing", session.userId);
  if (!budget.allowed) return { result: fail(UI.billingRateLimited) };

  return { actor: { orgId: session.orgId, email: session.email } };
}

/** Runs a core call and turns its failures into the message the form shows. */
async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof billing.BillingError) return fail(ERROR_MESSAGE[e.code](e));
    if (e instanceof Stripe.errors.StripeError) {
      console.error("[billing] Stripe error", e.type, e.code, e.requestId, e.message);
      return fail(UI.billingStripeError);
    }
    throw e;
  }
}

/** `keepFundingSourceId`: which active source to keep on Reconciliation (D-129); checked
 *  against the org's own active sources in `startCheckout`, never trusted as given. */
export async function startCheckoutAction(input: {
  plan: string;
  interval: string;
  keepFundingSourceId?: string | null;
}): Promise<ActionResult<{ url: string }>> {
  const g = await guard();
  if ("result" in g) return g.result;
  return run(async () => ({ url: await billing.startCheckout(g.actor, input) }));
}

export async function quoteChangeAction(plan: string, interval: string): Promise<ActionResult<billing.ChangeQuote>> {
  const g = await guard();
  if ("result" in g) return g.result;
  return run(() => billing.quoteChange(g.actor, plan, interval));
}

export async function applyChangeAction(
  plan: string,
  interval: string,
  prorationDate: number,
): Promise<ActionResult<{ result: billing.ChangeResult["result"]; payUrl?: string | null }>> {
  const g = await guard();
  if ("result" in g) return g.result;
  return run(async () => {
    const r = await billing.applyChange(g.actor, plan, interval, prorationDate);
    return r.result === "payment_needed" ? { result: r.result, payUrl: r.payUrl } : { result: r.result };
  });
}

export async function cancelPendingChangeAction(): Promise<ActionResult> {
  const g = await guard();
  if ("result" in g) return g.result;
  return run<undefined>(async () => {
    await billing.cancelPendingChange(g.actor);
    return undefined;
  });
}

export async function cancelPlanAction(): Promise<ActionResult> {
  const g = await guard();
  if ("result" in g) return g.result;
  return run<undefined>(async () => {
    await billing.cancelAtPeriodEnd(g.actor);
    return undefined;
  });
}

export async function endPlanNowAction(): Promise<ActionResult> {
  const g = await guard();
  if ("result" in g) return g.result;
  return run<undefined>(async () => {
    await billing.endPlanNow(g.actor);
    return undefined;
  });
}

export async function resumePlanAction(): Promise<ActionResult> {
  const g = await guard();
  if ("result" in g) return g.result;
  return run<undefined>(async () => {
    await billing.resume(g.actor);
    return undefined;
  });
}

export async function billingPortalAction(): Promise<ActionResult<{ url: string }>> {
  const g = await guard();
  if ("result" in g) return g.result;
  return run(async () => ({ url: await billing.portalUrl(g.actor) }));
}
