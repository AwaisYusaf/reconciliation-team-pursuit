"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { FieldError, Helper, Input, Label, MoneyInput } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { IDLE } from "@/src/lib/action-result";
import { saveOnboardingFundingAction } from "@/src/modules/auth/actions";

type Initial = { name: string; total: string; start: string; end: string; fiduciary: string };

export function OnboardingFundingForm({ initial, rulesLine }: { initial: Initial; rulesLine: string }) {
  const [state, setState] = useState(IDLE);
  const [pending, startTransition] = useTransition();
  const error = state.ok ? null : state.error;
  const fieldErrors = state.ok ? undefined : state.fieldErrors;

  // A plain onSubmit (rather than a `<form action>`) so a rejected submission never triggers
  // React's automatic form reset — that reset fires whenever the action resolves, including
  // on a validation failure, and was wiping every typed field over one bad entry.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await saveOnboardingFundingAction(state, formData));
    });
  }

  /** `aria-invalid` and `aria-describedby` for a field with its own error under it. */
  function invalid(key: string) {
    return fieldErrors?.[key]
      ? { "aria-invalid": true, "aria-describedby": `${key}-error` }
      : {};
  }

  function errorFor(key: string) {
    const message = fieldErrors?.[key];
    return message ? <FieldError id={`${key}-error`}>{message}</FieldError> : null;
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="mb-5">
        <Label htmlFor="fundingName">Funding name</Label>
        <Input
          id="fundingName"
          name="fundingName"
          defaultValue={initial.name}
          {...(fieldErrors?.fundingName ? invalid("fundingName") : { "aria-describedby": "fundingName-helper" })}
        />
        {fieldErrors?.fundingName ? (
          errorFor("fundingName")
        ) : (
          <Helper id="fundingName-helper">For example, your funder&apos;s or program&apos;s name.</Helper>
        )}
      </div>

      <div className="mb-5">
        <Label htmlFor="contractValue">Total amount</Label>
        <MoneyInput
          id="contractValue"
          name="contractValue"
          defaultValue={initial.total}
          placeholder="0.00"
          className="max-w-[320px]"
          {...(fieldErrors?.contractValue ? invalid("contractValue") : { "aria-describedby": "contractValue-helper" })}
        />
        {fieldErrors?.contractValue ? (
          errorFor("contractValue")
        ) : (
          <Helper id="contractValue-helper">
            The full amount of this funding. Your line items can&apos;t add up to more than this. In Settings, it&apos;s
            the contract value.
          </Helper>
        )}
      </div>

      <div className="flex flex-wrap gap-5 mb-5">
        <div className="flex-1 min-w-[220px]">
          <Label htmlFor="contractStart">
            Start date <span className="font-normal text-sub">(optional)</span>
          </Label>
          <Input
            id="contractStart"
            name="contractStart"
            type="date"
            defaultValue={initial.start}
            {...invalid("contractStart")}
          />
          {errorFor("contractStart")}
        </div>
        <div className="flex-1 min-w-[220px]">
          <Label htmlFor="contractEnd">
            End date <span className="font-normal text-sub">(optional)</span>
          </Label>
          <Input
            id="contractEnd"
            name="contractEnd"
            type="date"
            defaultValue={initial.end}
            {...invalid("contractEnd")}
          />
          {errorFor("contractEnd")}
        </div>
      </div>

      <div className="mb-5">
        <Label htmlFor="fiduciaryName">
          Fiduciary or reviewing organization name{" "}
          <span className="font-normal text-sub">(optional)</span>
        </Label>
        <Input
          id="fiduciaryName"
          name="fiduciaryName"
          defaultValue={initial.fiduciary}
          placeholder="e.g. Detroit Crime Commission"
        />
      </div>

      <p className="text-[15px] text-sub mb-6">{rulesLine}</p>

      {/* Above Continue, where the person is looking when it is refused (as on Add Expense). */}
      {error && <DangerPanel className="mb-5">{error}</DangerPanel>}

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
