"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { buttonClassName } from "@/src/components/ui/button";
import { reportResult } from "@/src/components/ui/toast";
import { dismissWelcomeAction } from "@/src/modules/auth/actions";

/** First-run banner shown on the dashboard until dismissed (m00). */
export function WelcomeBanner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="bg-surface border border-line rounded-[3px] px-6 py-5 flex flex-wrap gap-4 items-center justify-between mb-6">
      <div className="text-base leading-relaxed max-w-[60ch]">
        Your budget is set up. Add your first expense to get started.
      </div>
      <div className="flex items-center gap-5">
        <Link href="/r/expenses/new" className={buttonClassName("primary", "px-5")}>
          Add Expense
        </Link>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (reportResult(await dismissWelcomeAction())) router.refresh();
            })
          }
          className="py-3 text-[15px] text-accent underline hover:text-accent-dark disabled:text-disabled-ink"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
