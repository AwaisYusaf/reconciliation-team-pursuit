"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { toast } from "@/src/components/ui/toast";
import { AvatarCropper } from "@/src/components/app-shell/avatar-cropper";
import { useOverlayPresence } from "@/src/components/ui/overlay-shell";
import { initialsFor } from "@/src/domain/user-display";

/**
 * Set or remove the signed-in person's profile photo (Settings, Account).
 *
 * Uploads straight to `/api/me/avatar`, which takes the user from the session rather than
 * from anything this sends, so there is no id here to tamper with. The file input is hidden
 * behind a real button: a bare `input[type=file]` cannot be styled to match the app's
 * controls, and clicking a button that forwards to it is the usual way round that.
 */
const ACCEPT = "image/png,image/jpeg,image/webp";

export function AvatarField({
  name,
  email,
  initialVersion,
}: {
  name: string | null;
  email: string;
  /** The current photo's cache-busting version, or null when no photo is set. */
  initialVersion: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  /** The file chosen but not yet cropped. Its presence is what opens the cropper. */
  const [picked, setPicked] = useState<File | null>(null);
  // Keeps the cropper mounted, on the same file, while it fades out; keyed on the opening so
  // the next file starts from a fresh crop.
  const cropper = useOverlayPresence(picked !== null, picked);

  async function upload(blob: Blob, type: string) {
    setBusy(true);
    try {
      const body = new FormData();
      // Named so the server sees a filename, but the name is never used to build the object
      // key — keys come from `avatarKey` and never carry anything a user supplied.
      body.append("file", new File([blob], "avatar.jpg", { type }));
      const response = await fetch("/api/me/avatar", { method: "POST", body });
      const result = (await response.json()) as
        | { ok: true; version: string }
        | { ok: false; error: string };

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setVersion(result.version);
      toast.success("Profile photo updated.");
      // The header renders the avatar from the session, which this has just changed.
      router.refresh();
    } catch {
      toast.error("The photo couldn't be uploaded. Check your connection and try again.");
    } finally {
      setBusy(false);
      // Cleared so choosing the same file twice in a row still fires a change event.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch("/api/me/avatar", { method: "DELETE" });
      const result = (await response.json()) as { ok: boolean; error?: string };
      if (!result.ok) {
        toast.error(result.error ?? "The photo couldn't be removed. Try again.");
        return;
      }
      setVersion(null);
      toast.success("Profile photo removed.");
      router.refresh();
    } catch {
      toast.error("The photo couldn't be removed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {cropper.mounted && cropper.shown && (
        <AvatarCropper
          key={cropper.key}
          open={picked !== null}
          file={cropper.shown}
          onCancel={() => {
            setPicked(null);
            // Cleared so choosing the same file again still fires a change event.
            if (inputRef.current) inputRef.current.value = "";
          }}
          onDone={(result) => {
            setPicked(null);
            void upload(result.blob, result.type);
          }}
        />
      )}

      {/*
        The helper sits under the whole row rather than beside the button. Stacked next to the
        avatar it made the group top-heavy and left the button sitting above the avatar's
        centre line; on its own line the button and the avatar are simply centred on each other.
      */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full overflow-hidden border border-line bg-section flex items-center justify-center shrink-0">
        {version ? (
          /* Same reasoning as the header's avatar: a runtime, session-scoped route with
             nothing for the build-time image optimiser to fetch. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/me/avatar?v=${version}`}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <span aria-hidden="true" className="text-lg font-bold text-ink">
            {initialsFor(name, email)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label="Choose a profile photo"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Straight to the cropper, not to the upload: the position is chosen first and
            // the square that comes back is what is stored.
            if (file) setPicked(file);
          }}
        />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="min-h-11"
        >
          {busy ? "Working…" : version ? "Change photo" : "Add photo"}
        </Button>
        {version && (
          <ConfirmButton
            variant="quiet"
            disabled={busy}
            title="Remove your profile photo?"
            body="Your initials will be shown instead."
            confirmLabel="Remove"
            dismissLabel="Keep it"
            onConfirm={remove}
          >
            Remove
          </ConfirmButton>
        )}
        </div>
      </div>

      <p className="text-[13px] text-sub mt-2.5 mb-0 max-w-[62ch]">
        PNG, JPG or WebP, up to 5 MB. You choose which part of the photo to show. It appears
        on your own screen only, never on anything the app prints.
      </p>
    </div>
  );
}
