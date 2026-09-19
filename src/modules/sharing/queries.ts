import "server-only";

/**
 * Shared links as the Month-End Packet tab shows them (PHASE-12 §7).
 *
 * The password hash never leaves this file: the view carries `hasPassword` only (P5).
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/src/db";
import { organizations, sharedLinks, users } from "@/src/db/schema";
import { formatDateUS, todayIso, type MonthKey } from "@/src/domain/dates";
import { userDisplay } from "@/src/domain/user-display";
import { recordsHash } from "@/src/generation/cache-key";
import { loadMonthSnapshot } from "@/src/generation/month-snapshot";
import { siteOrigin } from "@/src/lib/site-url";

import type { MonthOutputKind } from "@/src/modules/packet/month-output";

export type SharedLinkView = {
  id: string;
  kind: MonthOutputKind;
  url: string;
  hasPassword: boolean;
  /** `formatDateUS` in the organisation's calendar, as "Submitted {date}" is (PHASE-12 C3). */
  sharedOn: string;
  sharedBy: string;
  /** The month's records no longer match the ones behind the shared file (P14). */
  recordsChanged: boolean;
};

export type SharedLinksForMonth = {
  links: SharedLinkView[];
  /** A cancelled organisation can still sign in, but its links don't open (PHASE-12 C4). */
  orgCancelled: boolean;
};

/** The full link for a token, from `APP_URL` (P1). */
export function shareUrl(token: string): string {
  return `${siteOrigin()}/s/${token}`;
}

/**
 * The active links for one source's month, packet first, and whether each file is out of date.
 *
 * The month's snapshot is loaded only when there is at least one link, so a month nobody shared
 * costs one query. It reads only the database (about six queries), never storage.
 */
export async function loadSharedLinks(
  orgId: string,
  fundingSourceId: string,
  month: MonthKey,
): Promise<SharedLinksForMonth> {
  const [rows, [org]] = await Promise.all([
    db
      .select({
        id: sharedLinks.id,
        artifactType: sharedLinks.artifactType,
        token: sharedLinks.token,
        hasPassword: sql<boolean>`${sharedLinks.passwordHash} is not null`,
        recordsHash: sharedLinks.recordsHash,
        sharedAt: sharedLinks.sharedAt,
        sharerName: users.name,
        sharerEmail: users.email,
      })
      .from(sharedLinks)
      .leftJoin(users, eq(users.id, sharedLinks.sharedBy))
      .where(
        and(
          eq(sharedLinks.orgId, orgId),
          eq(sharedLinks.fundingSourceId, fundingSourceId),
          eq(sharedLinks.month, month),
          isNull(sharedLinks.revokedAt),
        ),
      )
      // `packet_pdf` sorts before `summary_xlsx`: the packet row first, as Appendix A shows it.
      .orderBy(asc(sharedLinks.artifactType)),
    db
      .select({ subscriptionStatus: organizations.subscriptionStatus })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1),
  ]);

  const orgCancelled = org?.subscriptionStatus === "cancelled";
  if (rows.length === 0) return { links: [], orgCancelled };

  const current = recordsHash(await loadMonthSnapshot(orgId, fundingSourceId, month));

  return {
    orgCancelled,
    links: rows.map((row) => ({
      id: row.id,
      kind: row.artifactType === "packet_pdf" ? "packet" : "summary",
      url: shareUrl(row.token),
      hasPassword: row.hasPassword,
      sharedOn: formatDateUS(todayIso(row.sharedAt)),
      // A removed account leaves no user row, the same as the lock history (D-89).
      sharedBy: row.sharerEmail ? userDisplay(row.sharerName, row.sharerEmail) : "Unknown",
      recordsChanged: row.recordsHash !== current,
    })),
  };
}
