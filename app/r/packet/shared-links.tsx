"use client";

/**
 * The "Shared links" box on the Month-End Packet tab, and the row it lists (PHASE-12 §7,
 * Appendix A §3–§4). The same row appears inside the share dialog when an already-shared file is
 * picked, so a file's link has one look wherever it shows.
 *
 * Change password opens inline under its row rather than as another dialog, so it works the same
 * in the box and inside the share dialog.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { FieldError, Input, Label } from "@/src/components/ui/field";
import { DangerPanel, SubsectionTitle } from "@/src/components/ui/surfaces";
import { reportResult, toast } from "@/src/components/ui/toast";
import { UI } from "@/src/domain/strings";
import type { ActionResult } from "@/src/lib/action-result";
import { changeSharedLinkPasswordAction, stopSharingAction } from "@/src/modules/sharing/actions";
import type { SharedLinkView } from "@/src/modules/sharing/queries";

/** The shortest password a share accepts (P5); the server checks it again. */
export const SHARE_PASSWORD_MIN = 6;

/**
 * POST to one of the long-running share routes and read back its ActionResult. A network drop or
 * an unexpected body becomes an ordinary failure the screen can show.
 */
export async function postShareRoute<T>(path: string, body: unknown): Promise<ActionResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as ActionResult<T>;
  } catch {
    return { ok: false, error: "Couldn't reach the server — check your connection and try again." };
  }
}

export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(UI.shareCopied);
  } catch {
    toast.error(UI.shareCopyRefused);
  }
}

export function kindLabel(kind: SharedLinkView["kind"]): string {
  return kind === "packet" ? UI.shareChoicePacket : UI.shareChoiceSummary;
}

export function SharedLinksBox({
  links,
  monthLabel,
  blocked,
  orgCancelled,
  updatingId,
  onUpdate,
}: {
  links: SharedLinkView[];
  monthLabel: string;
  blocked: boolean;
  orgCancelled: boolean;
  updatingId: string | null;
  onUpdate: (link: SharedLinkView) => void;
}) {
  if (links.length === 0) return null;
  return (
    <div className="mt-6 border border-line rounded-md p-4">
      <SubsectionTitle className="mb-1">{UI.sharedLinksTitle}</SubsectionTitle>
      {orgCancelled && <p className="text-sm text-danger mb-2">{UI.shareCancelledNote}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {links.map((link) => (
          <li key={link.id} className="py-3 first:pt-1 last:pb-0">
            <SharedLinkRow
              link={link}
              monthLabel={monthLabel}
              blocked={blocked}
              updating={updatingId === link.id}
              onUpdate={() => onUpdate(link)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SharedLinkRow({
  link,
  monthLabel,
  blocked,
  updating,
  onUpdate,
}: {
  link: SharedLinkView;
  monthLabel: string;
  blocked: boolean;
  updating: boolean;
  onUpdate: () => void;
}) {
  const router = useRouter();
  const [stopping, startStopping] = useTransition();
  const [changingPassword, setChangingPassword] = useState(false);

  function stop() {
    startStopping(async () => {
      // Refreshed either way: a failure here means the link was already stopped elsewhere.
      reportResult(await stopSharingAction({ shareId: link.id }));
      router.refresh();
    });
  }

  return (
    <div className="text-[15px] text-ink">
      <div>
        <span className="font-bold">{kindLabel(link.kind)}</span>
        <span className="text-sub"> · {link.hasPassword ? UI.sharedPasswordProtected : UI.sharedNoPassword}</span>
      </div>
      <div className="text-sm text-muted mt-0.5">{UI.sharedOn(link.sharedOn, link.sharedBy)}</div>

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input
          readOnly
          value={link.url}
          aria-label={`${kindLabel(link.kind)} link`}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 basis-56 font-mono text-sm text-ink bg-section border border-line rounded-[3px] px-2.5 py-2"
        />
        <Button variant="secondary" className="min-h-9 px-3 text-[15px]" onClick={() => void copyLink(link.url)}>
          {UI.shareCopy}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[15px]">
        <button
          type="button"
          className="underline text-accent hover:text-accent-dark disabled:opacity-50"
          aria-expanded={changingPassword}
          disabled={stopping}
          onClick={() => setChangingPassword((open) => !open)}
        >
          {UI.shareChangePassword}
        </button>
        <span aria-hidden className="text-muted">·</span>
        <ConfirmButton
          variant="quiet"
          className="min-h-0 px-0 py-0 underline text-danger font-normal"
          disabled={stopping}
          title={UI.shareStopTitle(monthLabel, link.kind)}
          body={UI.shareStopBody}
          confirmLabel={UI.shareStop}
          dismissLabel="Cancel"
          onConfirm={stop}
        >
          {UI.shareStop}
        </ConfirmButton>
      </div>

      {changingPassword && (
        <PasswordEditor
          link={link}
          onDone={() => {
            setChangingPassword(false);
            router.refresh();
          }}
          onCancel={() => setChangingPassword(false)}
        />
      )}

      {link.recordsChanged && (
        <DangerPanel tone="notice" className="mt-3">
          <p>{UI.shareRecordsChanged(link.sharedOn)}</p>
          <Button variant="secondary" className="mt-2.5" disabled={blocked || updating} onClick={onUpdate}>
            {updating ? (link.kind === "packet" ? UI.shareCreatingPacket : UI.shareCreatingSummary) : UI.shareUpdate}
          </Button>
        </DangerPanel>
      )}
    </div>
  );
}

/**
 * Set, replace or remove the password. The current one is never shown (Appendix A §3): a user
 * who forgot it sets a new one. Unticking the box removes it.
 */
function PasswordEditor({
  link,
  onDone,
  onCancel,
}: {
  link: SharedLinkView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [required, setRequired] = useState(link.hasPassword);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Nothing to save: still protected with no new password typed, or still open.
  const unchanged = (required && link.hasPassword && password === "") || (!required && !link.hasPassword);

  function save() {
    if (required && password.length < SHARE_PASSWORD_MIN) {
      setError(UI.sharePasswordTooShort);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await changeSharedLinkPasswordAction({ shareId: link.id, password: required ? password : null });
      const message = !required ? UI.sharePasswordRemoved : link.hasPassword ? UI.sharePasswordChanged : UI.sharePasswordAdded;
      if (reportResult(result, message)) onDone();
      else if (result.fieldErrors?.password) setError(result.fieldErrors.password);
    });
  }

  const fieldId = `share-password-${link.id}`;
  return (
    <div className="mt-3 border border-line rounded-md p-3 bg-section">
      <label className="flex items-center gap-2.5 text-[15px] text-ink cursor-pointer">
        <input
          type="checkbox"
          className="w-[18px] h-[18px] accent-accent"
          checked={required}
          onChange={(event) => setRequired(event.target.checked)}
        />
        {UI.shareRequirePassword}
      </label>
      {required && (
        <div className="mt-3">
          <Label htmlFor={fieldId}>{UI.sharePasswordLabel}</Label>
          <Input
            id={fieldId}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={error ? `${fieldId}-error` : undefined}
          />
          {error && <FieldError id={`${fieldId}-error`}>{error}</FieldError>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        <Button className="min-h-9 px-3 text-[15px]" disabled={saving || unchanged} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="quiet" className="min-h-9 px-3 text-[15px]" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
