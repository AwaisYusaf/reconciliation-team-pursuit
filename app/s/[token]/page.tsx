import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { buttonClassName } from "@/src/components/ui/button";
import { UI } from "@/src/domain/strings";
import { openShare, sharedFileUrl } from "@/src/modules/sharing/public";
import { UNLOCK_COOKIE } from "@/src/modules/sharing/unlock-cookie";

import { shareNotice } from "./notices";
import { ShareCard } from "./share-card";
import { UnlockForm } from "./unlock-form";

export const dynamic = "force-dynamic";

/**
 * `/s/{token}` — what the City opens (Appendix A §5).
 *
 * Open (no password, or unlocked within the last twelve hours) → straight to the file's own URL,
 * where the PDF opens in the browser's viewer or the workbook downloads. Otherwise the password
 * card. Anything unusable → the not-found page. The decision is `openShare`'s alone, the same
 * one the file and unlock routes make, so a visitor can't be bounced between them.
 *
 * `?e=` carries a notice back from the routes (`notices.ts`). One the file route sent — too many
 * opens, or the saved file unreadable — is shown instead of redirecting to the file again.
 */
export default async function SharedLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const opened = await openShare(token, (await cookies()).get(UNLOCK_COOKIE)?.value);
  if (opened.state === "unavailable") notFound();

  const notice = shareNotice((await searchParams).e);
  if (opened.state === "open") {
    if (!notice?.blocksFile) redirect(sharedFileUrl(opened.share));
    return (
      <ShareCard>
        <p role="alert" className="mt-4 text-center text-[17px] leading-relaxed text-ink">
          {notice.message}
        </p>
        <div className="mt-6 flex justify-center">
          {/* A plain link: a full navigation to the file, never the client router. */}
          <a href={sharedFileUrl(opened.share)} className={buttonClassName("primary")}>
            {UI.shareOpenFile}
          </a>
        </div>
      </ShareCard>
    );
  }

  return (
    <ShareCard title={UI.sharePasswordProtected}>
      <UnlockForm token={opened.share.token} kind={opened.share.kind} initialError={notice?.message ?? null} />
    </ShareCard>
  );
}
