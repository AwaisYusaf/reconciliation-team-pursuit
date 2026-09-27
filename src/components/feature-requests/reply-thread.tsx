import { formatDateTimeUS } from "@/src/domain/dates";
import { UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";
import type { FeatureRequestReplyView } from "@/src/modules/feature-requests/queries";

/**
 * The conversation under a request, oldest first (ticket §4). The same on the customer's page
 * and in `/a` (ticket §7: "the same conversation the customer sees").
 *
 * Our team's replies are signed with the team's name, never a person's. A customer reply whose
 * account has since been removed shows only its date (PHASE-17 P13). Plain text: typed line
 * breaks are kept, nothing becomes a link, and a long address wraps rather than widening the
 * page.
 */
export function ReplyThread({ replies }: { replies: FeatureRequestReplyView[] }) {
  if (replies.length === 0) {
    return <p className="text-[15px] text-sub m-0">{UI.featureRequestNoReplies}</p>;
  }

  return (
    <ol className="flex flex-col gap-3 list-none m-0 p-0">
      {replies.map((reply) => (
        <li
          key={reply.id}
          className={cn(
            "rounded-[8px] border px-3.5 py-3",
            reply.fromStaff ? "bg-section border-line" : "bg-surface border-line",
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-sub">
            {(reply.fromStaff || reply.authorName) && (
              <span className={cn("font-semibold", reply.fromStaff ? "text-accent" : "text-ink")}>
                {reply.fromStaff ? UI.featureRequestTeamSignature : reply.authorName}
              </span>
            )}
            <span>{formatDateTimeUS(reply.createdAt)}</span>
          </div>
          <p className="mt-1.5 m-0 text-[15px] text-ink leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            {reply.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
