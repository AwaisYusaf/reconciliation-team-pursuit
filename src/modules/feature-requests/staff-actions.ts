"use server";

/**
 * What AB Solutions staff do with a feature request in `/a` (PHASE-17, ticket §7): reword it,
 * set its status, show it to every organization or not, and reply. Behind `requireStaff()`; the
 * screens call `router.refresh()` afterwards, as the other `/a` actions' screens do.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/src/db";
import { isCheckViolation } from "@/src/db/pg-errors";
import { featureRequestReplies, featureRequests } from "@/src/db/schema";
import {
  canShowToAll,
  checkReplyBody,
  checkWording,
  parseFeatureRequestStatus,
} from "@/src/domain/feature-requests";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { requireStaff } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";

const editSchema = z.object({ requestId: z.string(), title: z.string(), details: z.string() });
const statusSchema = z.object({ requestId: z.string(), status: z.string() });
const shownSchema = z.object({ requestId: z.string(), shown: z.boolean() });
const replySchema = z.object({ requestId: z.string(), body: z.string() });

async function currentRequest(requestId: string) {
  if (!isUuid(requestId)) return null;
  const [row] = await db
    .select({
      orgId: featureRequests.orgId,
      title: featureRequests.title,
      details: featureRequests.details,
      status: featureRequests.status,
      shownToAllAt: featureRequests.shownToAllAt,
    })
    .from(featureRequests)
    .where(eq(featureRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

/**
 * Reword the title and details, for example to take out a name or a figure before showing the
 * request to everyone (ticket §7). The customer's own wording is kept once, by the first edit,
 * and never overwritten (P12): `SET` reads the row as it was, so `coalesce` stores the old text
 * only while nothing is stored yet, in the same statement as the change.
 */
export async function editFeatureRequestAction(input: {
  requestId: string;
  title: string;
  details: string;
}): Promise<ActionResult> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return fail(UI.requestRefused);
  // The same rules as the customer's Suggest, so staff can't save a wording a customer couldn't.
  const wording = checkWording(parsed.data);
  if (!wording.ok) {
    const { fieldErrors } = wording;
    return fail((fieldErrors.title ?? fieldErrors.details)!, fieldErrors);
  }
  const { title, details } = wording;

  const current = await currentRequest(parsed.data.requestId);
  if (!current) return fail(UI.staffFeatureRequestNotFound);
  if (current.title === title && current.details === details) {
    return fail(UI.staffFeatureRequestNothingChanged);
  }

  const updated = await db
    .update(featureRequests)
    .set({
      originalTitle: sql`coalesce(${featureRequests.originalTitle}, ${featureRequests.title})`,
      originalDetails: sql`coalesce(${featureRequests.originalDetails}, ${featureRequests.details})`,
      title,
      details,
    })
    .where(eq(featureRequests.id, parsed.data.requestId))
    .returning({ id: featureRequests.id });
  if (updated.length === 0) return fail(UI.staffFeatureRequestNotFound);
  return ok();
}

/**
 * Set the status (ticket §5). Moving to Waiting for review or Already requested also turns off
 * "Show to all organizations" in the same statement (P1); `hidden` tells the screen that
 * happened, so its toast can say so.
 */
export async function setFeatureRequestStatusAction(input: {
  requestId: string;
  status: string;
}): Promise<ActionResult<{ hidden: boolean }>> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  const parsed = statusSchema.safeParse(input);
  const status = parsed.success ? parseFeatureRequestStatus(parsed.data.status) : null;
  if (!parsed.success || !status) return fail(UI.requestRefused);

  const current = await currentRequest(parsed.data.requestId);
  if (!current) return fail(UI.staffFeatureRequestNotFound);

  const keepShown = canShowToAll(status);
  const updated = await db
    .update(featureRequests)
    .set({ status, shownToAllAt: keepShown ? sql`${featureRequests.shownToAllAt}` : null })
    .where(eq(featureRequests.id, parsed.data.requestId))
    .returning({ id: featureRequests.id });
  if (updated.length === 0) return fail(UI.staffFeatureRequestNotFound);
  return ok({ hidden: current.shownToAllAt !== null && !keepShown });
}

/**
 * "Show to all organizations" on or off (ticket §7). Refused while the status can't be shown;
 * the database CHECK refuses it too, so a status changed at the same moment can't slip past.
 */
export async function setFeatureRequestShownAction(input: {
  requestId: string;
  shown: boolean;
}): Promise<ActionResult> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  const parsed = shownSchema.safeParse(input);
  if (!parsed.success) return fail(UI.requestRefused);

  const current = await currentRequest(parsed.data.requestId);
  if (!current) return fail(UI.staffFeatureRequestNotFound);
  if (parsed.data.shown && !canShowToAll(current.status)) {
    return fail(UI.staffFeatureRequestShowBlocked);
  }

  try {
    await db
      .update(featureRequests)
      .set({
        // Keeps the first "since when" if it is already on.
        shownToAllAt: parsed.data.shown ? sql`coalesce(${featureRequests.shownToAllAt}, now())` : null,
      })
      .where(eq(featureRequests.id, parsed.data.requestId));
  } catch (error) {
    // The status moved to one that can't be shown between the read above and this write.
    if (isCheckViolation(error)) return fail(UI.staffFeatureRequestShowBlocked);
    throw error;
  }
  return ok();
}

/** A reply from our team, signed "Stay Funded 360 team" wherever it is shown (ticket §4). */
export async function staffReplyToFeatureRequestAction(input: {
  requestId: string;
  body: string;
}): Promise<ActionResult> {
  const staff = await requireStaff();
  if ("denied" in staff) return staff.denied;

  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return fail(UI.requestRefused);
  const reply = checkReplyBody(parsed.data.body);
  if (!reply.ok) return fail(reply.error, { body: reply.error });

  const current = await currentRequest(parsed.data.requestId);
  if (!current) return fail(UI.staffFeatureRequestNotFound);

  await db.insert(featureRequestReplies).values({
    orgId: current.orgId,
    requestId: parsed.data.requestId,
    fromStaff: true,
    authorStaffId: staff.staffId,
    body: reply.body,
  });
  return ok();
}
