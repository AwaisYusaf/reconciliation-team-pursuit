"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";

import { AUTH_FIELD } from "@/src/components/ui/auth-card";
import { Button } from "@/src/components/ui/button";
import { FieldError, Helper, Input, Label } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { IDLE } from "@/src/lib/action-result";
import { signUpAction } from "@/src/modules/auth/actions";
import type { Interval, PlanId } from "@/src/modules/billing/rules";

export function SignupForm({
  plan,
  interval,
}: {
  /** From the landing page's plan links, already validated by the page (Phase 16, §4.9). */
  plan?: PlanId | null;
  interval?: Interval | null;
}) {
  const [state, setState] = useState(IDLE);
  const [pending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);

  const fieldErrors = state.ok ? {} : (state.fieldErrors ?? {});
  // The panel is for failures that aren't attached to a single field.
  const panelError = state.ok || Object.keys(fieldErrors).length > 0 ? null : state.error;
  const passwordType = showPassword ? "text" : "password";

  // A plain onSubmit (rather than a `<form action>`) so a failed submission never triggers
  // React's automatic form reset — that reset fires whenever the action resolves, including
  // on a validation failure, and was wiping every field over one bad entry.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await signUpAction(state, formData));
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {plan && <input type="hidden" name="plan" value={plan} />}
      {interval && <input type="hidden" name="interval" value={interval} />}
      {panelError && <DangerPanel className="mb-[22px]">{panelError}</DangerPanel>}

      {/*
        Five stacked fields ran past the fold on a laptop, so the short ones pair up from `sm`.
        Three rows instead of five, and the pairing is by meaning rather than to fill space:
        who you are on one row, the two halves of one password on another.

        One column below `sm`. Two 160px-wide fields side by side on a phone is worse than a
        longer form.
      */}
      {/*
        `gap-y-4` rather than a margin on the second cell. `mt-4 sm:mt-0` there pushed the
        right-hand field 16px below its neighbour at every width, because the override never
        beat the margin — the two labels in a row sat on different lines. A row gap spaces the
        single-column stack and disappears when the two share a row, with nothing to override.
      */}
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4 mb-4">
        <div>
          <Label htmlFor="orgName">Organization name</Label>
          <Input id="orgName" name="orgName" className={AUTH_FIELD} required />
          {fieldErrors.orgName && <FieldError>{fieldErrors.orgName}</FieldError>}
        </div>

        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" autoComplete="name" className={AUTH_FIELD} required />
          {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
        </div>
      </div>

      <div className="mb-4">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@yourorganization.org"
          className={AUTH_FIELD}
          required
        />
        {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4 mb-5">
        <div>
          {/*
            The Show toggle moved from beside the field to the end of its label row. As a
            44px-tall button next to the input it took a third of the field's width, and it is
            what stopped the two password fields from sharing a row.

            It still governs both fields — they read one `passwordType` — so it is labelled for
            that rather than for the field it sits over.
          */}
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-pressed={showPassword}
              className="text-[13px] font-bold text-accent hover:text-accent-dark shrink-0"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <Input
            id="password"
            name="password"
            type={passwordType}
            autoComplete="new-password"
            className={AUTH_FIELD}
            required
          />
          {fieldErrors.password ? (
            <FieldError>{fieldErrors.password}</FieldError>
          ) : (
            <Helper>At least 12 characters.</Helper>
          )}
        </div>

        <div>
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={passwordType}
            autoComplete="new-password"
            className={AUTH_FIELD}
            required
          />
          {fieldErrors.confirmPassword && <FieldError>{fieldErrors.confirmPassword}</FieldError>}
        </div>
      </div>

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </Button>
      {/* New tab: following a link must not throw away what has been typed into the form. */}
      <p className="text-[13px] text-sub text-center mt-3 leading-relaxed">
        By creating an account, you agree to our{" "}
        <Link href="/terms" target="_blank" rel="noopener" className="text-accent underline underline-offset-2 hover:text-accent-dark">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" target="_blank" rel="noopener" className="text-accent underline underline-offset-2 hover:text-accent-dark">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
