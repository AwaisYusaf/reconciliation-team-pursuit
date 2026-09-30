"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { AUTH_FIELD } from "@/src/components/ui/auth-card";
import { Button } from "@/src/components/ui/button";
import { Field, focusFirstInvalid, Input } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { IDLE } from "@/src/lib/action-result";
import { signUpAction } from "@/src/modules/auth/actions";
import type { Interval, PlanId } from "@/src/modules/billing/rules";

/** Show/Hide for one password field. The hidden words name the field for screen readers,
 *  since the page has two of these (#1). */
function ShowToggle({ shown, onToggle, field }: { shown: boolean; onToggle: () => void; field: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      className="text-[13px] font-bold text-accent hover:text-accent-dark shrink-0"
    >
      {shown ? "Hide" : "Show"}
      <span className="sr-only"> {field}</span>
    </button>
  );
}

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
  const [showConfirm, setShowConfirm] = useState(false);

  const fieldErrors = state.ok ? {} : (state.fieldErrors ?? {});
  // The panel is for failures that aren't attached to a single field.
  const panelError = state.ok || Object.keys(fieldErrors).length > 0 ? null : state.error;

  // After a refused submit, the first marked field (usability #2, PR #27): every error comes
  // back at once, and on a phone the first one is above the fold.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.ok && state.fieldErrors && Object.keys(state.fieldErrors).length > 0) {
      focusFirstInvalid(formRef.current);
    }
  }, [state]);

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
    <form ref={formRef} onSubmit={onSubmit} noValidate>
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
        <Field id="orgName" label="Organization name" error={fieldErrors.orgName}>
          {(props) => <Input {...props} name="orgName" className={AUTH_FIELD} required />}
        </Field>

        <Field id="name" label="Your name" error={fieldErrors.name}>
          {(props) => <Input {...props} name="name" autoComplete="name" className={AUTH_FIELD} required />}
        </Field>
      </div>

      <Field id="email" label="Email" error={fieldErrors.email} className="mb-4">
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@yourorganization.org"
            className={AUTH_FIELD}
            required
          />
        )}
      </Field>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4 mb-5">
        {/*
          The Show toggle sits at the end of its label row (`labelAside`). As a 44px-tall button
          next to the input it took a third of the field's width, and it is what stopped the two
          password fields from sharing a row.

          Each field has its own toggle and its own flag (#1): showing one never reveals the
          other.
        */}
        <Field
          id="password"
          label="Password"
          helper="At least 12 characters."
          error={fieldErrors.password}
          labelAside={
            <ShowToggle shown={showPassword} onToggle={() => setShowPassword((value) => !value)} field="password" />
          }
        >
          {(props) => (
            <Input
              {...props}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className={AUTH_FIELD}
              required
            />
          )}
        </Field>

        <Field
          id="confirmPassword"
          label="Confirm password"
          error={fieldErrors.confirmPassword}
          labelAside={
            <ShowToggle
              shown={showConfirm}
              onToggle={() => setShowConfirm((value) => !value)}
              field="confirm password"
            />
          }
        >
          {(props) => (
            <Input
              {...props}
              name="confirmPassword"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              className={AUTH_FIELD}
              required
            />
          )}
        </Field>
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
