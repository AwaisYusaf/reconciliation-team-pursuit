import Link from "next/link";

import { buttonClassName } from "@/src/components/ui/button";
import { EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";

/**
 * Keeps staff inside `/a` on a 404. Without this the root not-found renders, whose only way
 * out is the public marketing page — a dead end for someone who followed a stale link to an
 * organization that has since been deleted.
 */
export default function AdminNotFound() {
  return (
    <div>
      <PageTitle className="mb-2">Not found</PageTitle>
      <Subtext className="mb-6">That organization does not exist, or has been deleted.</Subtext>
      <EmptyState>
        <Link href="/a" className={buttonClassName("secondary")}>
          All organizations
        </Link>
      </EmptyState>
    </div>
  );
}
