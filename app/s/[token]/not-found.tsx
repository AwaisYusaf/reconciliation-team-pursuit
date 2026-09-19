import { UI } from "@/src/domain/strings";

import { ShareCard } from "../share-card";

/**
 * Every way a link can be unusable — never existed, malformed, stopped, or the organization is
 * paused or cancelled — ends here with the same words, so the page reveals nothing about which
 * (Appendix A §5). Served with a 404 status. Body text rather than a heading: two sentences at
 * the heading size ran to three heavy lines on a phone.
 */
export default function SharedLinkUnavailable() {
  return (
    <ShareCard>
      <p role="status" className="mt-4 text-center text-[17px] leading-relaxed text-ink">
        {UI.shareUnavailable}
      </p>
    </ShareCard>
  );
}
