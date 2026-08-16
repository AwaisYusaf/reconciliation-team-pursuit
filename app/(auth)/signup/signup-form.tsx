"use client";

import { useActionState, useState } from "react";

import { Button } from "@/src/components/ui/button";
import { FieldError, Input, Label } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { IDLE } from "@/src/lib/action-result";
import { signUpAction } from "@/src/modules/auth/actions";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpAction, IDLE);
  const [showPassword, setShowPassword] = useState(false);

  const fieldErrors = state.ok ? {} : (state.fieldErrors ?? {});
  // The panel is for failures that aren't attached to a single field.
  const panelError = state.ok || Object.keys(fieldErrors).length > 0 ? null : state.error;
  const passwordType = showPassword ? "text" : "password";

  return (
    <form action={formAction} noValidate>
      {panelError && <DangerPanel className="mb-[22px]">{panelError}</DangerPanel>}

      <div className="mb-[18px]">
        <Label htmlFor="orgName">Organisation name</Label>
        <Input id="orgName" name="orgName" required />
        {fieldErrors.orgName && <FieldError>{fieldErrors.orgName}</FieldError>}
      </div>

      <div className="mb-[18px]">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@yourorganisation.org"
          required
        />
        {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
      </div>

      <div className="mb-[18px]">
        <Label htmlFor="password">Password</Label>
        <div className="flex gap-2">
          <Input
            id="password"
            name="password"
            type={passwordType}
            autoComplete="new-password"
            placeholder="At least 12 characters"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="min-h-11 px-4 bg-surface border border-accent rounded-[3px] text-accent text-[15px] font-bold whitespace-nowrap"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        {fieldErrors.password && <FieldError>{fieldErrors.password}</FieldError>}
      </div>

      <div className="mb-6">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type={passwordType}
          autoComplete="new-password"
          required
        />
        {fieldErrors.confirmPassword && <FieldError>{fieldErrors.confirmPassword}</FieldError>}
      </div>

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </Button>
    </form>
  );
}
