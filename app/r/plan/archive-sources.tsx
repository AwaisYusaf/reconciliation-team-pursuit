"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Card, CARD_PADDING, SectionTitle } from "@/src/components/ui/surfaces";
import { reportResult } from "@/src/components/ui/toast";
import { UI } from "@/src/domain/strings";
import { archiveFundingSourceAction } from "@/src/modules/funding-sources/actions";

/**
 * The org's active funding sources, each with Archive (Phase 16, D2): Reconciliation includes
 * one, and an unpaid org can't reach Settings, so this is where its admin gets down to one before
 * choosing it. Shown only while more than one is active.
 */
export function ArchiveSources({ sources }: { sources: ReadonlyArray<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function archive(id: string) {
    startTransition(async () => {
      if (reportResult(await archiveFundingSourceAction(id), UI.billingSourceArchivedToast)) router.refresh();
    });
  }

  return (
    <Card className={`${CARD_PADDING} mt-8`}>
      <SectionTitle className="mb-1">{UI.billingSourcesTitle}</SectionTitle>
      <p className="text-[15px] text-sub mb-4">{UI.billingSourcesHelp}</p>
      <ul className="divide-y divide-line">
        {sources.map((source) => (
          <li key={source.id} className="flex items-center justify-between gap-3 py-2">
            <span className="text-[15px] text-ink">{source.name}</span>
            <Button variant="quiet" disabled={pending} onClick={() => archive(source.id)}>
              {UI.billingArchiveSource}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
