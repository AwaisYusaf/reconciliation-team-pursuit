"use client";

/**
 * The password form on a shared link (Appendix A §5).
 *
 * A real `<form method="post">` to `/s/{token}/unlock`, so the password never lands in a URL: a
 * visitor who presses Enter before the page's script has loaded (a slow phone) still posts it,
 * and the route answers that with a redirect — to the file, or back here with `?e=` (PHASE-12
 * review). Once the script runs, the submit is taken over and sent as JSON, and the answer is
 * shown in place.
 *
 * Never a Server Action: setting the unlock cookie from one re-renders this page in the same round
 * trip, and its "unlocked → go to the file" redirect would send the client router to fetch a PDF
 * as page data (P7). On success the browser goes to the file with a full navigation: `replace`
 * for the PDF, so Back doesn't land on a page that redirects forward again; the workbook downloads
 * and the page stays, so it says so.
 */
import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { Input, Label } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import type { SharedFileKind } from "@/src/domain/shared-links";
import { UI } from "@/src/domain/strings";

import { readUnlockAnswer } from "./unlock-answer";

export function UnlockForm({
  token,
  kind,
  initialError,
}: {
  token: string;
  kind: SharedFileKind;
  initialError: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [downloaded, setDownloaded] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = field.current?.value ?? "";
    // An empty Enter is a slip, not a guess: nothing is sent, so it can't cost one of the tries.
    if (password === "") {
      field.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    setDownloaded(false);
    let answer: Awaited<ReturnType<typeof readUnlockAnswer>>;
    try {
      const response = await fetch(`/s/${token}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      answer = await readUnlockAnswer(response);
    } catch {
      answer = { ok: false, error: UI.shareOpenFailed };
    }
    setPending(false);
    if (!answer.ok) {
      setError(answer.error);
      field.current?.select();
      return;
    }
    if (kind === "packet") {
      window.location.replace(answer.url);
    } else {
      window.location.assign(answer.url);
      setDownloaded(true);
    }
  }

  return (
    <form method="post" action={`/s/${token}/unlock`} onSubmit={onSubmit} noValidate>
      {error && <DangerPanel className="mb-[22px]">{error}</DangerPanel>}
      {downloaded && (
        <p role="status" className="text-[15px] text-ink mb-[22px]">
          {UI.shareDownloadStarted}
        </p>
      )}

      <div className="mb-6">
        <Label htmlFor="share-password">{UI.sharePasswordLabel}</Label>
        <Input
          ref={field}
          id="share-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
        />
      </div>

      <Button type="submit" fullWidth disabled={pending}>
        {UI.shareOpenFile}
      </Button>
    </form>
  );
}
