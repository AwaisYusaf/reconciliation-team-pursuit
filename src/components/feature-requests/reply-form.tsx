"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { FieldError, Label, Textarea } from "@/src/components/ui/field";
import { reportResult } from "@/src/components/ui/toast";
import { FEATURE_REQUEST_REPLY_MAX } from "@/src/domain/feature-requests";
import { UI } from "@/src/domain/strings";
import type { ActionResult } from "@/src/lib/action-result";

/**
 * The reply box under a request's conversation. One component for both sides: the customer's
 * page passes `replyToFeatureRequestAction`, `/a` passes `staffReplyToFeatureRequestAction`, and
 * only the label differs ("Add a reply" / "Reply to {organization}", ticket §4 and §7).
 *
 * What was typed stays in the box when sending fails, and clears only once it is sent.
 */
export function ReplyForm({
  requestId,
  label,
  send,
}: {
  requestId: string;
  label: string;
  send: (input: { requestId: string; body: string }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const id = useId();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await send({ requestId, body });
      if (!result.ok) {
        // A problem with the text belongs under the box; anything else is a toast.
        if (result.fieldErrors?.body) setError(result.fieldErrors.body);
        else reportResult(result);
        return;
      }
      reportResult(result, UI.featureRequestReplySent);
      setBody("");
      router.refresh();
    });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Textarea
          id={id}
          rows={3}
          maxLength={FEATURE_REQUEST_REPLY_MAX}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
        />
        {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      </div>
      <div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {UI.featureRequestReplySend}
        </Button>
      </div>
    </form>
  );
}
