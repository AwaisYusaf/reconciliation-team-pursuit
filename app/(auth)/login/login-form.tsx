"use client";

import { useState, useTransition, type FormEvent } from "react";

import { AUTH_FIELD } from "@/src/components/ui/auth-card";
import { Button } from "@/src/components/ui/button";
import { Input, Label } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { UI } from "@/src/domain/strings";
import { IDLE } from "@/src/lib/action-result";
import { signInAction } from "@/src/modules/auth/actions";

export function LoginForm() {
  const [state, setState] = useState(IDLE);
  const [pending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const error = state.ok ? null : state.error;

  // A plain onSubmit (rather than a `<form action>`) so a failed sign-in never triggers
  // React's automatic form reset — that reset fires whenever the action resolves, including
  // on a validation failure, and was wiping both fields over one wrong entry.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await signInAction(state, formData));
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <DangerPanel className="mb-[22px]">{error}</DangerPanel>}

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
      </div>

      <div className="mb-5">
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
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          className={AUTH_FIELD}
          required
        />
      </div>

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <div className="text-center text-[15px] text-sub mt-5">
        {UI.forgotPassword}{" "}
        <a
          href={`mailto:${UI.supportEmail}`}
          className="text-accent underline hover:text-accent-dark"
        >
          {UI.supportEmail}
        </a>
      </div>
    </form>
  );
}
