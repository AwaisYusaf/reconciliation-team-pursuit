import "server-only";

/**
 * The public side of a shared link (PHASE-12 §6, D-112) — the only lookups `/s/*` makes.
 *
 * There is no session here: the organisation, source, month and file all come from the share
 * row, found by its token. One function decides whether a link is open, locked or gone, so the
 * page, the unlock route and the file route can never disagree and bounce a visitor between
 * them. Nothing in this file may import a generator or `resolveArtifact`: opening a link never
 * builds a file (`public-isolation.test.ts`).
 */
import { and, eq, isNull, ne } from "drizzle-orm";

import { db } from "@/src/db";
import { generatedArtifacts, organizations, sharedLinks } from "@/src/db/schema";
import { verifyPassword } from "@/src/services/auth/passwords";
import { consume, reset } from "@/src/services/rate-limit";
import { keyBelongsToOrg } from "@/src/services/storage/keys";

import { isShareToken } from "./token";
import { isUnlocked, unlockCookie } from "./unlock-cookie";

export type PublicShare = {
  id: string;
  token: string;
  passwordHash: string | null;
  filename: string;
  artifactType: "packet_pdf" | "summary_xlsx";
  s3Key: string;
  sizeBytes: number;
};

/**
 * The share behind a token, or null when there is nothing to serve: an unknown or malformed
 * token, a stopped link, or an organisation that is paused (`suspended_at`) or cancelled
 * (PHASE-12 C4). All of these look the same from outside (Appendix A §5).
 */
export async function loadPublicShare(token: string): Promise<PublicShare | null> {
  if (!isShareToken(token)) return null;

  const [row] = await db
    .select({
      id: sharedLinks.id,
      orgId: sharedLinks.orgId,
      token: sharedLinks.token,
      passwordHash: sharedLinks.passwordHash,
      filename: sharedLinks.filename,
      artifactType: sharedLinks.artifactType,
      s3Key: generatedArtifacts.s3Key,
      sizeBytes: generatedArtifacts.sizeBytes,
    })
    .from(sharedLinks)
    // The five-column FK already makes this the share's own file; joining on the org as well
    // keeps the query honest if that key is ever loosened.
    .innerJoin(
      generatedArtifacts,
      and(eq(generatedArtifacts.id, sharedLinks.artifactId), eq(generatedArtifacts.orgId, sharedLinks.orgId)),
    )
    .innerJoin(organizations, eq(organizations.id, sharedLinks.orgId))
    .where(
      and(
        eq(sharedLinks.token, token),
        isNull(sharedLinks.revokedAt),
        isNull(organizations.suspendedAt),
        ne(organizations.subscriptionStatus, "cancelled"),
      ),
    )
    .limit(1);

  // P20: the key comes from the database, but a check that costs nothing makes a future bug
  // fail closed rather than serve another organisation's object.
  if (!row || !keyBelongsToOrg(row.s3Key, row.orgId)) return null;
  if (row.artifactType !== "packet_pdf" && row.artifactType !== "summary_xlsx") return null;

  return {
    id: row.id,
    token: row.token,
    passwordHash: row.passwordHash,
    filename: row.filename,
    artifactType: row.artifactType,
    s3Key: row.s3Key,
    sizeBytes: row.sizeBytes,
  };
}

/** The file's own URL, relative so it never depends on the host Next sees behind Caddy. */
export function sharedFileUrl(share: { token: string; filename: string }): string {
  return `/s/${share.token}/${encodeURIComponent(share.filename)}`;
}

export type OpenedShare =
  | { state: "unavailable" }
  | { state: "locked"; share: PublicShare }
  | { state: "open"; share: PublicShare };

/** Whether this visitor may have the file now, given their unlock cookie (if any). */
export async function openShare(token: string, unlockValue: string | undefined): Promise<OpenedShare> {
  const share = await loadPublicShare(token);
  if (!share) return { state: "unavailable" };
  if (share.passwordHash === null) return { state: "open", share };
  return isUnlocked({ id: share.id, passwordHash: share.passwordHash }, unlockValue)
    ? { state: "open", share }
    : { state: "locked", share };
}

export type UnlockOutcome =
  | { outcome: "unavailable" }
  | { outcome: "wrong" }
  | { outcome: "too_many" }
  | { outcome: "open"; url: string; cookie: ReturnType<typeof unlockCookie> | null };

/** The longest password a share can have (P5) — anything longer is wrong without hashing. */
const MAX_PASSWORD_LENGTH = 128;

/**
 * Check a password typed on the public page (PHASE-12 P2).
 *
 * Both limits are consumed before the password is checked, so the sixth try is refused even when
 * it is right, and a guess that was never going to be checked still counts. The fifth wrong try
 * already answers "too many", since nothing is left of that visitor's budget. A right password
 * resets the per-link count for that visitor only.
 */
export async function unlockSharedFile(input: {
  token: string;
  password: unknown;
  ip: string;
}): Promise<UnlockOutcome> {
  const share = await loadPublicShare(input.token);
  if (!share) return { outcome: "unavailable" };

  const url = sharedFileUrl(share);
  if (share.passwordHash === null) return { outcome: "open", url, cookie: null };

  const linkKey = `${share.id}|${input.ip}`;
  const perAddress = consume("sharePasswordPerIp", input.ip);
  if (!perAddress.allowed) return { outcome: "too_many" };
  const perLink = consume("sharePasswordPerLinkIp", linkKey);
  if (!perLink.allowed) return { outcome: "too_many" };

  const password = input.password;
  const right =
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= MAX_PASSWORD_LENGTH &&
    (await verifyPassword(share.passwordHash, password));

  if (!right) return perLink.remaining === 0 ? { outcome: "too_many" } : { outcome: "wrong" };

  reset("sharePasswordPerLinkIp", linkKey);
  return {
    outcome: "open",
    url,
    cookie: unlockCookie({ id: share.id, passwordHash: share.passwordHash, token: share.token }),
  };
}
