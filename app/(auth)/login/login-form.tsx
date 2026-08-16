"use client";

import { useActionState } from "react";

import { Button } from "@/src/components/ui/button";
import { Input, Label } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { UI } from "@/src/domain/strings";
import { IDLE } from "@/src/lib/action-result";
import { signInAction } from "@/src/modules/auth/actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, IDLE);
  const error = state.ok ? null : state.error;

  return (
    <form action={formAction} noValidate>
      {error && <DangerPanel className="mb-[22px]">{error}</DangerPanel>}

      <div className="mb-[18px]">
        <Label htmlFor="email">Organisation email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@yourorganisation.org"
          required
        />
      </div>

      <div className="mb-6">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <div className="text-center text-[15px] text-sub mt-5">{UI.forgotPassword}</div>
    </form>
  );
}
