"use server";

/**
 * What customers do with feature requests (PHASE-17): suggest one, vote, and reply.
 *
 * Admins and managers alike, on every paid plan (ticket §1): `actionSession()` lets paid and
 * complimentary organizations through and refuses the rest. A request another organization can't
 * see is answered exactly like one that doesn't exist (P9), so trying ids reveals nothing.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/src/db";
import { featureRequestReplies, featureRequests, featureRequestVotes } from "@/src/db/schema";
import { ORG_TIME_ZONE, todayIso } from "@/src/domain/dates";
import {
  FEATURE_REQUEST_DETAILS_MAX,
  FEATURE_REQUEST_REPLY_MAX,
  FEATURE_REQUEST_TITLE_MAX,
  FEATURE_REQUESTS_PER_DAY,
  normalizeTitle,
  votingOpen,
} from "@/src/domain/feature-requests";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult, type FieldErrors } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";

import { findVisibleFeatureRequest } from "./queries";

const suggestSchema = z.object({ title: z.string(), details: z.string() });
const voteSchema = z.object({ requestId: z.string(), want: z.boolean() });
const replySchema = z.object({ requestId: z.string(), body: z.string() });

/** The first field error as the message, with every field's own message beside it. */
function invalidFields(fieldErrors: FieldErrors): ActionResult<never> | null {
  const first = Object.values(fieldErrors)[0];
  return first ? fail(first, fieldErrors) : null;
}

/**
 * Suggest a feature (ticket §3): the request waits for review, seen only by this organization,
 * and the person who sent it has the first vote on it.
 *
 * At most ten a day per person, counted in the database on the America/Detroit day (P5). The
 * advisory lock is per person, so two sends at once can't both see nine and both get in.
 */
export async function suggestFeatureAction(input: {
  title: string;
  details: string;
}): Promise<ActionResult<{ id: string }>> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  const parsed = suggestSchema.safeParse(input);
  if (!parsed.success) return fail(UI.requestRefused);
  const title = normalizeTitle(parsed.data.title);
  const details = parsed.data.details.trim();

  const fieldErrors: FieldErrors = {};
  if (!title) fieldErrors.title = UI.featureRequestTitleRequired;
  else if (title.length > FEATURE_REQUEST_TITLE_MAX) {
    fieldErrors.title = UI.featureRequestTooLong(FEATURE_REQUEST_TITLE_MAX);
  }
  if (!details) fieldErrors.details = UI.featureRequestDetailsRequired;
  else if (details.length > FEATURE_REQUEST_DETAILS_MAX) {
    fieldErrors.details = UI.featureRequestTooLong(FEATURE_REQUEST_DETAILS_MAX);
  }
  const invalid = invalidFields(fieldErrors);
  if (invalid) return invalid;

  const id = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`feature-requests:${session.userId}`}))`);
    const [today] = await tx
      .select({ sent: count() })
      .from(featureRequests)
      .where(
        and(
          eq(featureRequests.authorUserId, session.userId),
          sql`to_char(${featureRequests.createdAt} at time zone ${ORG_TIME_ZONE}, 'YYYY-MM-DD') = ${todayIso()}`,
        ),
      );
    if ((today?.sent ?? 0) >= FEATURE_REQUESTS_PER_DAY) return null;

    const [created] = await tx
      .insert(featureRequests)
      .values({
        orgId: session.orgId,
        authorUserId: session.userId,
        title,
        details,
        status: "waiting_for_review",
      })
      .returning({ id: featureRequests.id });
    // Ticket §2: the person who suggested it has a vote on it from the start (P11).
    await tx.insert(featureRequestVotes).values({
      requestId: created.id,
      orgId: session.orgId,
      userId: session.userId,
    });
    return created.id;
  });
  if (!id) return fail(UI.featureRequestDailyLimit);

  // The dialog sends the reader to "From your organization"; this makes sure the new row is
  // there even when that list is the page already open.
  revalidatePath("/r/feature-requests");
  return ok({ id });
}

/**
 * "I want this too", or taking it back (ticket §2). Sets the vote rather than toggling it, so a
 * double click or an old second tab can't flip it the wrong way (P10).
 */
export async function setFeatureRequestVoteAction(input: {
  requestId: string;
  want: boolean;
}): Promise<ActionResult> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) return fail(UI.requestRefused);
  const { requestId, want } = parsed.data;

  // Visibility first, then whether voting is open: the other order would tell another
  // organization that a hidden request exists and has been released (P9).
  const request = await findVisibleFeatureRequest(db, session.orgId, requestId);
  if (!request) return fail(UI.featureRequestUnavailable);
  if (!votingOpen(request.status)) return fail(UI.featureRequestVotingClosed);

  if (want) {
    await db
      .insert(featureRequestVotes)
      .values({ requestId, orgId: session.orgId, userId: session.userId })
      .onConflictDoNothing({ target: [featureRequestVotes.requestId, featureRequestVotes.userId] });
  } else {
    await db
      .delete(featureRequestVotes)
      .where(
        and(eq(featureRequestVotes.requestId, requestId), eq(featureRequestVotes.userId, session.userId)),
      );
  }
  return ok();
}

/**
 * A reply below one of this organization's own requests (ticket §4). Anyone in the organization
 * may reply, on any status. Another organization's request, shown or not, is refused like a
 * missing one: customers never comment on each other's requests.
 */
export async function replyToFeatureRequestAction(input: {
  requestId: string;
  body: string;
}): Promise<ActionResult> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return fail(UI.requestRefused);
  const body = parsed.data.body.trim();

  const request = await findVisibleFeatureRequest(db, session.orgId, parsed.data.requestId);
  if (!request?.isOwn) return fail(UI.featureRequestUnavailable);

  if (!body) return fail(UI.featureRequestReplyRequired, { body: UI.featureRequestReplyRequired });
  if (body.length > FEATURE_REQUEST_REPLY_MAX) {
    const message = UI.featureRequestTooLong(FEATURE_REQUEST_REPLY_MAX);
    return fail(message, { body: message });
  }

  await db.insert(featureRequestReplies).values({
    orgId: session.orgId,
    requestId: parsed.data.requestId,
    fromStaff: false,
    authorUserId: session.userId,
    body,
  });
  return ok();
}
