"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/src/components/ui/button";
import { Input, Label, MoneyInput } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { IDLE } from "@/src/lib/action-result";
import { completeOnboardingAction } from "@/src/modules/auth/actions";

export function OnboardingContractForm() {
  const [state, formAction, pending] = useActionState(completeOnboardingAction, IDLE);
  const error = state.ok ? null : state.error;

  return (
    <form action={formAction}>
      {error && <DangerPanel className="mb-5">{error}</DangerPanel>}

      <div className="mb-5">
        <Label htmlFor="contractValue">
          Total contract value <span className="font-normal text-sub">(optional)</span>
        </Label>
        <MoneyInput
          id="contractValue"
          name="contractValue"
          placeholder="0.00"
          className="max-w-[320px]"
        />
      </div>

      <div className="flex flex-wrap gap-5 mb-5">
        <div className="flex-1 min-w-[220px]">
          <Label htmlFor="contractStart">
            Contract start date <span className="font-normal text-sub">(optional)</span>
          </Label>
          <Input id="contractStart" name="contractStart" type="date" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <Label htmlFor="contractEnd">
            Contract end date <span className="font-normal text-sub">(optional)</span>
          </Label>
          <Input id="contractEnd" name="contractEnd" type="date" />
        </div>
      </div>

      <div className="mb-7">
        <Label htmlFor="fiduciaryName">
          Fiduciary or reviewing organisation name{" "}
          <span className="font-normal text-sub">(optional)</span>
        </Label>
        <Input
          id="fiduciaryName"
          name="fiduciaryName"
          placeholder="e.g. Detroit Crime Commission"
        />
      </div>

      <Button type="submit" name="intent" value="finish" fullWidth disabled={pending}>
        {pending ? "Finishing…" : "Finish setup"}
      </Button>

      <div className="text-center mt-4">
        {/* Skip runs the same action with empty values, so the contract settings row
            always exists and the organisation is still marked onboarded. */}
        <button
          type="submit"
          name="intent"
          value="skip"
          disabled={pending}
          className="py-2.5 px-2 text-[15px] text-accent underline hover:text-accent-dark disabled:text-disabled-ink"
        >
          Skip for now
        </button>
      </div>

      <div className="text-center mt-4">
        <Link
          href="/onboarding/line-items"
          className="text-[15px] text-sub underline hover:text-ink"
        >
          Back to budget line items
        </Link>
      </div>
    </form>
  );
}
