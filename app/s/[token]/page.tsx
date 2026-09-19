import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { UI } from "@/src/domain/strings";
import { openShare, sharedFileUrl } from "@/src/modules/sharing/public";
import { UNLOCK_COOKIE } from "@/src/modules/sharing/unlock-cookie";

import { ShareCard } from "../share-card";
import { UnlockForm } from "./unlock-form";

export const dynamic = "force-dynamic";

/**
 * `/s/{token}` — what the City opens (Appendix A §5).
 *
 * Open (no password, or unlocked within the last twelve hours) → straight to the file's own URL,
 * where the PDF opens in the browser's viewer or the workbook downloads. Otherwise the password
 * card. Anything unusable → the not-found page. The decision is `openShare`'s alone, the same
 * one the file and unlock routes make, so a visitor can't be bounced between them.
 */
export default async function SharedLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const opened = await openShare(token, (await cookies()).get(UNLOCK_COOKIE)?.value);

  if (opened.state === "unavailable") notFound();
  if (opened.state === "open") redirect(sharedFileUrl(opened.share));

  return (
    <ShareCard title={UI.sharePasswordProtected}>
      <UnlockForm token={opened.share.token} kind={opened.share.artifactType === "packet_pdf" ? "packet" : "summary"} />
    </ShareCard>
  );
}
