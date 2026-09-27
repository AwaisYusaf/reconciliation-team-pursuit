import { SegmentedLinks } from "@/src/components/ui/segmented-links";
import { UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";

/**
 * "Organizations" · "Feature requests (N)" at the top of each `/a` list (PHASE-17, ticket §6),
 * N being the requests that need attention.
 *
 * Rendered by the list pages, not `app/a/layout.tsx`: a layout doesn't re-render on navigation
 * in Next 16, so a count there would stay at whatever it was when `/a` was first opened.
 */
export function AdminSectionLinks({
  current,
  attention,
}: {
  current: "organizations" | "feature-requests";
  attention: number;
}) {
  const onRequests = current === "feature-requests";
  return (
    <SegmentedLinks
      label={UI.staffSectionsLabel}
      className="mb-6"
      items={[
        { href: "/a", label: UI.staffSectionOrganizations, active: current === "organizations" },
        {
          href: "/a/feature-requests",
          active: onRequests,
          label: (
            <>
              {UI.staffSectionFeatureRequests}
              {attention > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full text-[13px] font-bold tabular-nums",
                    onRequests ? "bg-white/20 text-white" : "bg-caution/10 text-caution",
                  )}
                >
                  <span aria-hidden="true">{attention}</span>
                  <span className="sr-only">{UI.staffFeatureRequestsNeedingAttention(attention)}</span>
                </span>
              )}
            </>
          ),
        },
      ]}
    />
  );
}
