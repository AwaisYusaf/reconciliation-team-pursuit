import "server-only";

/**
 * The session an `app/api/*` route handler starts with (Phase 15 §4.7).
 *
 * `null` means signed out — each route already has its own 401 line, kept unchanged, so this
 * never writes one itself. An unpaid org gets a ready-made 403 response instead: JSON for the
 * routes that answer JSON, plain text for the ones that stream a download.
 */
import { NextResponse } from "next/server";

import { UI } from "@/src/domain/strings";
import { hasPaidAccess } from "@/src/services/auth/entitlement";
import { getSession } from "@/src/services/auth/session";
import type { SessionContext } from "@/src/services/auth/store";

export type RouteSessionDenial = { denied: NextResponse };

function billingDenied(format: "json" | "text"): NextResponse {
  if (format === "json") {
    return NextResponse.json({ ok: false, error: UI.billingPlanRequired }, { status: 403 });
  }
  return new NextResponse(UI.billingPlanRequired, {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * The guarded session for a route handler: `null` (not signed in), a denial (signed in, unpaid),
 * or the session itself.
 */
export async function routeSession(
  format: "json" | "text",
): Promise<SessionContext | null | RouteSessionDenial> {
  const session = await getSession();
  if (!session) return null;
  if (!hasPaidAccess(session)) return { denied: billingDenied(format) };
  return session;
}

/** `getSession()`, unguarded — only for an allow-listed route (§4.7). */
export async function routeSessionAnyPlan(): Promise<SessionContext | null> {
  return getSession();
}
