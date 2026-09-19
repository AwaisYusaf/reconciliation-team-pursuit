import Link from "next/link";

import { buttonClassName } from "@/src/components/ui/button";
import { EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";

/** Keeps the app shell — and therefore the navigation — around a 404. */
export default function AppNotFound() {
  return (
    <div>
      <PageTitle className="mb-2">Not found</PageTitle>
      <Subtext className="mb-6">That page doesn&apos;t exist, or it has been deleted.</Subtext>
      <EmptyState>
        <Link href="/r" className={buttonClassName("secondary")}>
          Back to the dashboard
        </Link>
      </EmptyState>
    </div>
  );
}
