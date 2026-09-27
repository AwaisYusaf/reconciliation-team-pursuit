"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { reportResult } from "@/src/components/ui/toast";
import { UI } from "@/src/domain/strings";
import { cn } from "@/src/lib/cn";
import { setFeatureRequestVoteAction } from "@/src/modules/feature-requests/actions";

/**
 * "I want this too", or "You want this" once pressed (ticket §2).
 *
 * Sends the state it wants rather than "toggle" (PHASE-17 P10), then refreshes so the count and
 * the label come from the server. A full-width line on a phone, where it sits under the text,
 * and its own width from `sm`.
 */
export function VoteButton({
  requestId,
  voted,
  className,
}: {
  requestId: string;
  voted: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function vote() {
    startTransition(async () => {
      const result = await setFeatureRequestVoteAction({ requestId, want: !voted });
      if (!reportResult(result)) return;
      router.refresh();
    });
  }

  return (
    <Button
      variant={voted ? "primary" : "secondary"}
      aria-pressed={voted}
      disabled={pending}
      onClick={vote}
      className={cn("min-h-11 px-4 text-[15px] w-full sm:w-auto whitespace-nowrap", className)}
    >
      {voted ? UI.featureRequestVoted : UI.featureRequestVote}
    </Button>
  );
}
