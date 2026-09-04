"use client";

/**
 * Download button for a generated output.
 *
 * A plain link would work until the server refuses: the browser would replace the app with
 * a page of plain text explaining the documentation gate. Fetching instead keeps the user
 * on the screen and turns a refusal into a toast, which matters because a refusal is a
 * normal, expected outcome here (R4.3) rather than an error.
 */
import { useState } from "react";
import toast from "react-hot-toast";

import { buttonClassName, type ButtonVariant } from "./button";

export function DownloadButton({
  href,
  children,
  variant = "primary",
  disabled = false,
  pendingLabel = "Preparing…",
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(href);

      if (!response.ok) {
        // The route answers a refusal in plain text, listing what is missing.
        const message = (await response.text()).trim();
        toast.error(message || "That download is not available right now.");
        return;
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filenameFrom(response.headers.get("Content-Disposition"));
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      toast.success("Download started.");
    } catch {
      toast.error("Download failed — check your connection and try again.");
    } finally {
      // Revoking synchronously can cancel the download before the browser has finished
      // reading the blob, so the handle is released a little later instead.
      const created = objectUrl;
      if (created) setTimeout(() => URL.revokeObjectURL(created), 60_000);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled || busy}
      className={buttonClassName(variant)}
    >
      {busy ? pendingLabel : children}
    </button>
  );
}

/**
 * The server's filename, so the saved file matches R10.3.
 *
 * `filename*` is read first because it carries the exact name; the quoted form is the
 * fallback. An empty result lets the browser derive a name from the URL rather than saving
 * something misleading.
 */
function filenameFrom(header: string | null): string {
  if (!header) return "";

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // Fall through to the quoted form.
    }
  }

  return /filename="([^"]*)"/i.exec(header)?.[1] ?? "";
}
