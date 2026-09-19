"use server";

/**
 * Sharing a month's packet or summary by link (PHASE-12 §5).
 *
 * Admins and managers alike, on every plan; locked months and archived sources are allowed,
 * because sharing changes no record (Appendix A §1). A cancelled organisation is refused: its
 * links can't open (C4), so a new one would only be a dead link in the City's inbox. Create and
 * Update build a file and can take a minute or two for a big packet, so the screen reaches them
 * through the POST routes in `app/api/shared-links/` rather than as Server Actions (P12); they
 * are exported here so that every check lives in one place, and each still authenticates itself.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/src/db";
import { organizations, sharedLinks } from "@/src/db/schema";
import { isValidMonthKey, type MonthKey } from "@/src/domain/dates";
import {
  artifactTypeOf,
  SHARE_PASSWORD_MAX,
  SHARE_PASSWORD_MIN,
  sharedFileKindOf,
  type SharedFileKind,
} from "@/src/domain/shared-links";
import { UI } from "@/src/domain/strings";
import { fail, ok, type ActionResult } from "@/src/lib/action-result";
import { actionSession } from "@/src/lib/action-session";
import { isUuid } from "@/src/lib/ids";
import { findFundingSource, requireOwnedFundingSource } from "@/src/modules/funding-sources/queries";
import {
  ensureMonthOutput,
  generationBudgetMessage,
  monthOutputFailureMessage,
  monthOutputRecordsHash,
  prepareMonthOutput,
  type PreparedMonthOutput,
} from "@/src/modules/packet/month-output";
import { hashPassword } from "@/src/services/auth/passwords";
import { consume } from "@/src/services/rate-limit";

import { shareUrl } from "./queries";
import { beginShareBuild, endShareBuild, shareBuildKey } from "./single-flight";
import { generateShareToken } from "./token";

/** P5: not trimmed, no composition rules. The bounds are shared with the screen and the public check. */
const passwordSchema = z
  .string()
  .min(SHARE_PASSWORD_MIN, UI.sharePasswordTooShort)
  .max(SHARE_PASSWORD_MAX, UI.sharePasswordTooLong)
  .nullable();

const createSchema = z.object({
  fundingSourceId: z.string(),
  month: z.string().refine(isValidMonthKey),
  kind: z.enum(["packet", "summary"]),
  password: passwordSchema,
  confirmedDeletions: z.boolean(),
});

const updateSchema = z.object({
  shareId: z.string().refine(isUuid),
  confirmedDeletions: z.boolean(),
});

const passwordChangeSchema = z.object({
  shareId: z.string().refine(isUuid),
  password: passwordSchema,
});

const stopSchema = z.object({ shareId: z.string().refine(isUuid) });

export type SharedLinkCreated = { url: string; kind: SharedFileKind; hasPassword: boolean };

/** Token collisions at ~71 bits don't happen; the retry only keeps one from surfacing as an error. */
const TOKEN_ATTEMPTS = 3;

/**
 * Save the file as it is now and give it a link (Appendix A §2).
 *
 * Refuses an already-shared file rather than replacing its link: the screen shows that file's
 * row instead, and replacing would break a link the City may already have.
 */
export async function createSharedLinkAction(input: {
  fundingSourceId: string;
  month: string;
  kind: SharedFileKind;
  password: string | null;
  confirmedDeletions: boolean;
}): Promise<ActionResult<SharedLinkCreated>> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { kind, password, confirmedDeletions } = parsed.data;
  const month = parsed.data.month as MonthKey;

  const source = await requireOwnedFundingSource(session, parsed.data.fundingSourceId);
  if ("denied" in source) return source.denied;
  if (await activeShareId(session.orgId, source.id, month, kind)) return fail(UI.shareAlreadyExists);

  return buildSharedFile(
    { orgId: session.orgId, source, month, kind, confirmedDeletions },
    async ({ artifactId, prepared }) => {
      const passwordHash = password === null ? null : await hashPassword(password);
      const now = new Date();

      for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
        const token = generateShareToken();
        const [inserted] = await db
          .insert(sharedLinks)
          .values({
            orgId: session.orgId,
            fundingSourceId: source.id,
            month,
            artifactType: artifactTypeOf(kind),
            artifactId,
            token,
            passwordHash,
            filename: prepared.filename,
            recordsHash: monthOutputRecordsHash(kind, prepared.snapshot),
            createdBy: session.userId,
            sharedAt: now,
            sharedBy: session.userId,
          })
          .onConflictDoNothing()
          .returning({ token: sharedLinks.token });

        if (inserted) return ok({ url: shareUrl(inserted.token), kind, hasPassword: passwordHash !== null });
        // Nothing inserted: either someone shared this file in the meantime (another container,
        // or a tab that raced past the single-flight check), or the token collided.
        if (await activeShareId(session.orgId, source.id, month, kind)) return fail(UI.shareAlreadyExists);
      }
      throw new Error("Could not allocate a unique share token");
    },
  );
}

/**
 * Put the file as it is now behind the same link (Appendix A §4). The token and password stay;
 * the date, the name and the file move. The same checks as a download apply.
 */
export async function updateSharedFileAction(input: {
  shareId: string;
  confirmedDeletions: boolean;
}): Promise<ActionResult<undefined>> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const share = await loadActiveShare(session.orgId, parsed.data.shareId);
  const kind = share && sharedFileKindOf(share.artifactType);
  if (!share || !kind) return fail(UI.shareNoLongerShared);
  const source = await findFundingSource(session.orgId, share.fundingSourceId);
  if (!source) return fail(UI.shareNoLongerShared);

  return buildSharedFile(
    {
      orgId: session.orgId,
      source,
      month: share.month as MonthKey,
      kind,
      confirmedDeletions: parsed.data.confirmedDeletions,
    },
    async ({ artifactId, prepared }) => {
      // Still active is re-checked in the same statement: a Stop sharing that landed while the
      // file was building must win, not be undone by this update.
      const [updated] = await db
        .update(sharedLinks)
        .set({
          artifactId,
          filename: prepared.filename,
          recordsHash: monthOutputRecordsHash(kind, prepared.snapshot),
          sharedAt: new Date(),
          sharedBy: session.userId,
        })
        .where(activeShareScope(session.orgId, share.id))
        .returning({ id: sharedLinks.id });
      return updated ? ok() : fail(UI.shareNoLongerShared);
    },
  );
}

/**
 * Set, replace or remove a link's password (Appendix A §3). The old one stops working at once,
 * and so does every earlier unlock, because the unlock cookie is signed over the stored hash.
 */
export async function changeSharedLinkPasswordAction(input: {
  shareId: string;
  password: string | null;
}): Promise<ActionResult<{ hasPassword: boolean }>> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  const parsed = passwordChangeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const budget = consume("sharePasswordSet", session.userId);
  if (!budget.allowed) return fail(UI.sharePasswordSetLimited(Math.ceil(budget.retryAfterSeconds / 60)));

  const passwordHash = parsed.data.password === null ? null : await hashPassword(parsed.data.password);
  const [updated] = await db
    .update(sharedLinks)
    .set({ passwordHash })
    .where(activeShareScope(session.orgId, parsed.data.shareId))
    .returning({ id: sharedLinks.id });
  return updated ? ok({ hasPassword: passwordHash !== null }) : fail(UI.shareNoLongerShared);
}

/**
 * Turn a link off for good (Appendix A §3). The row stays so its token is never handed out again;
 * its password hash has no further use and goes (`shared_links_revoked_password_ck`).
 */
export async function stopSharedLinkAction(input: { shareId: string }): Promise<ActionResult<undefined>> {
  const session = await actionSession();
  if ("expired" in session) return session.expired;

  const parsed = stopSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const [stopped] = await db
    .update(sharedLinks)
    .set({ revokedAt: new Date(), revokedBy: session.userId, passwordHash: null })
    .where(activeShareScope(session.orgId, parsed.data.shareId))
    .returning({ id: sharedLinks.id });
  return stopped ? ok() : fail(UI.shareNoLongerShared);
}

/* ------------------------------------------------------------------ helpers */
// Not exported: every export of a "use server" file becomes a callable endpoint.

/**
 * Everything Create and Update share, in one order (P11, P13): the cancelled-plan refusal, one
 * build per file at a time, the organisation's generation budget, the download routes' own
 * checks, then the pinned file. `write` runs inside the single-flight claim, so the row is
 * written before another build of the same file can start.
 */
async function buildSharedFile<T>(
  input: {
    orgId: string;
    source: { id: string; name: string };
    month: MonthKey;
    kind: SharedFileKind;
    confirmedDeletions: boolean;
  },
  write: (built: { artifactId: string; prepared: PreparedMonthOutput }) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  if (await orgCancelled(input.orgId)) return fail(UI.shareCancelledRefused);

  const buildKey = shareBuildKey(input.orgId, input.source.id, input.month, input.kind);
  if (!beginShareBuild(buildKey)) return fail(UI.shareInProgress);
  try {
    const budget = consume("generate", input.orgId);
    if (!budget.allowed) return fail(generationBudgetMessage(budget.retryAfterSeconds));

    const prepared = await prepareMonthOutput(input);
    if (!prepared.ok) return fail(prepared.message);

    let artifactId: string;
    try {
      ({ artifactId } = await ensureMonthOutput(prepared));
    } catch (error) {
      console.error("shared file generation failed", {
        orgId: input.orgId,
        month: input.month,
        kind: input.kind,
        error,
      });
      return fail(monthOutputFailureMessage(input.kind, error));
    }

    return await write({ artifactId, prepared });
  } finally {
    endShareBuild(buildKey);
  }
}

/** The first message zod has for the input — the password rule is the only one a person sees. */
function invalid(error: z.ZodError): ActionResult<never> {
  const password = error.issues.find((issue) => issue.path[0] === "password");
  return password ? fail(password.message, { password: password.message }) : fail(UI.requestRefused);
}

async function orgCancelled(orgId: string): Promise<boolean> {
  const [org] = await db
    .select({ status: organizations.subscriptionStatus })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org?.status === "cancelled";
}

/** One active share of this organisation. Every lookup by id goes through this scope. */
function activeShareScope(orgId: string, shareId: string) {
  return and(eq(sharedLinks.id, shareId), eq(sharedLinks.orgId, orgId), isNull(sharedLinks.revokedAt));
}

async function loadActiveShare(orgId: string, shareId: string) {
  const [row] = await db
    .select({
      id: sharedLinks.id,
      fundingSourceId: sharedLinks.fundingSourceId,
      month: sharedLinks.month,
      artifactType: sharedLinks.artifactType,
    })
    .from(sharedLinks)
    .where(activeShareScope(orgId, shareId))
    .limit(1);
  return row ?? null;
}

async function activeShareId(
  orgId: string,
  fundingSourceId: string,
  month: MonthKey,
  kind: SharedFileKind,
): Promise<string | null> {
  const [row] = await db
    .select({ id: sharedLinks.id })
    .from(sharedLinks)
    .where(
      and(
        eq(sharedLinks.orgId, orgId),
        eq(sharedLinks.fundingSourceId, fundingSourceId),
        eq(sharedLinks.month, month),
        eq(sharedLinks.artifactType, artifactTypeOf(kind)),
        isNull(sharedLinks.revokedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
