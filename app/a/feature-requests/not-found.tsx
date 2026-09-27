import Link from "next/link";

import { ButtonLabel, buttonClassName } from "@/src/components/ui/button";
import { EmptyState, PageTitle, Subtext } from "@/src/components/ui/surfaces";
import { UI } from "@/src/domain/strings";

/** Keeps staff inside the feature requests list on a 404; `/a`'s own one talks about organizations. */
export default function StaffFeatureRequestNotFound() {
  return (
    <div>
      <PageTitle className="mb-2">Not found</PageTitle>
      <Subtext className="mb-6">{UI.staffFeatureRequestNotFound}</Subtext>
      <EmptyState>
        <Link href="/a/feature-requests" className={buttonClassName("secondary")}>
          <ButtonLabel>{UI.staffFeatureRequestsAll}</ButtonLabel>
        </Link>
      </EmptyState>
    </div>
  );
}
