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
 */
export function PickFundingSource({ sources }: { sources: readonly FundingSource[] }) {
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
    </EmptyState>
  );
}
