"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { EmptyState } from "@/src/components/ui/surfaces";
import { reportResult } from "@/src/components/ui/toast";
import { setActiveFundingSourceAction } from "@/src/modules/auth/actions";
import type { FundingSource } from "@/src/db/schema";

/**
 * Shown in place of a screen that needs exactly one funding source selected, while the
 * header has "All" active (Phase 2; Phase 5 builds the real All dashboard).
 *
 * `archivedSources` is opt-in per caller (default none): a screen whose documents an
 * archived source's history should stay reachable from (packet, cover sheets, contract
 * summary) passes them; a screen that only ever *creates* new records against the chosen
 * source (line items) leaves it out, since archived sources refuse new line items anyway
 * (spec §1) and offering them here would invite a doomed attempt.
 */
export function PickFundingSource({
  sources,
  archivedSources = [],
}: {
  sources: readonly FundingSource[];
  archivedSources?: readonly FundingSource[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(id: string) {
    startTransition(async () => {
      const result = await setActiveFundingSourceAction(id);
      if (reportResult(result)) router.refresh();
    });
  }

  return (
    <EmptyState className="flex flex-col items-center gap-4">
      <p>This screen shows one funding source at a time. Choose one to continue.</p>
      <div className="flex flex-wrap justify-center gap-3">
        {sources.map((source) => (
          <Button
            key={source.id}
            variant="secondary"
            disabled={pending}
            onClick={() => choose(source.id)}
          >
            {source.name}
          </Button>
        ))}
      </div>
      {archivedSources.length > 0 && (
        <div className="flex flex-col items-center gap-3 mt-2">
          <p className="text-[13px] uppercase tracking-[0.04em] text-sub">Archived</p>
          <div className="flex flex-wrap justify-center gap-3">
            {archivedSources.map((source) => (
              <Button
                key={source.id}
                variant="quiet"
                disabled={pending}
                onClick={() => choose(source.id)}
              >
                {source.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </EmptyState>
  );
}
