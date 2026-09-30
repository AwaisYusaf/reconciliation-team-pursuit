"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { Field, focusFirstInvalid, Input, Label, MoneyInput } from "@/src/components/ui/field";
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

  // After a refused Continue, the first marked field (PR #27): on a phone it is above the fold.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (fieldErrors && Object.keys(fieldErrors).length > 0) focusFirstInvalid(formRef.current);
  }, [fieldErrors]);

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <Field
        id="fundingName"
        label="Funding name"
        helper="For example, your funder's or program's name."
        error={fieldErrors?.fundingName}
        className="mb-5"
      >
        {(props) => <Input {...props} name="fundingName" defaultValue={initial.name} />}
      </Field>

      <Field
        id="contractValue"
        label="Total amount"
        helper="The full amount of this funding. Your line items can't add up to more than this. In Settings, it's the contract value."
        error={fieldErrors?.contractValue}
        className="mb-5"
      >
        {(props) => (
          <MoneyInput
            {...props}
            name="contractValue"
            defaultValue={initial.total}
            placeholder="0.00"
            className="max-w-[320px]"
          />
        )}
      </Field>

      <div className="flex flex-wrap gap-5 mb-5">
        <Field
          id="contractStart"
          label="Start date"
          optional
          error={fieldErrors?.contractStart}
          className="flex-1 min-w-[220px]"
        >
          {(props) => <Input {...props} name="contractStart" type="date" defaultValue={initial.start} />}
        </Field>
        <Field
          id="contractEnd"
          label="End date"
          optional
          error={fieldErrors?.contractEnd}
          className="flex-1 min-w-[220px]"
        >
          {(props) => <Input {...props} name="contractEnd" type="date" defaultValue={initial.end} />}
        </Field>
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
