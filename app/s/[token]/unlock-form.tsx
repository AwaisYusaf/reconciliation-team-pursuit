"use client";

/**
 * The password form on a shared link (Appendix A §5).
 *
 * It posts to `/s/{token}/unlock`, a route handler, never a Server Action: setting the unlock
 * cookie from an action re-renders this page in the same round trip, and its "unlocked → go to
 * the file" redirect would then send the client router to fetch a PDF as page data (PHASE-12 P7).
 * On success the browser is sent to the file with a full navigation. `replace` for the PDF, so
 * Back doesn't land on a page that immediately redirects forward again; the workbook downloads
 * and the page stays, so it says so.
 */
import { useState, type FormEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { Input, Label } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { UI } from "@/src/domain/strings";

type Result = { ok: true; url: string } | { ok: false; error: string };

export function UnlockForm({ token, kind }: { token: string; kind: "packet" | "summary" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/s/${token}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as Result;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (kind === "packet") {
        window.location.replace(result.url);
      } else {
        window.location.assign(result.url);
        setDownloaded(true);
      }
    } catch {
      setError(UI.shareOpenFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <DangerPanel className="mb-[22px]">{error}</DangerPanel>}
      {downloaded && !error && (
        <p role="status" className="text-[15px] text-ink mb-[22px]">
          {UI.shareDownloadStarted}
        </p>
      )}

      <div className="mb-6">
        <Label htmlFor="share-password">{UI.sharePasswordLabel}</Label>
        <Input
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
