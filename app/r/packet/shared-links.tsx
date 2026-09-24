"use client";

/**
 * The "Shared links" box on the Month-End Packet tab, the row it lists, and the pieces the share
 * dialog reuses (PHASE-12 §7, Appendix A §3–§4). The same row appears inside the share dialog when
 * an already-shared file is picked, so a file's link has one look wherever it shows.
 *
 * Change password opens inline under its row rather than as another dialog, so it works the same
 * in the box and inside the share dialog.
 */
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import { FieldError, Helper, Input, Label } from "@/src/components/ui/field";
import { DangerPanel, SubsectionTitle } from "@/src/components/ui/surfaces";
import { reportResult, toast } from "@/src/components/ui/toast";
import { SHARE_PASSWORD_MIN, type SharedFileKind } from "@/src/domain/shared-links";
import { UI } from "@/src/domain/strings";
import { fail, SESSION_EXPIRED, type ActionResult } from "@/src/lib/action-result";
import { changeSharedLinkPasswordAction, stopSharedLinkAction } from "@/src/modules/sharing/actions";
import type { SharedLinkView } from "@/src/modules/sharing/queries";

/** The Share link button's id, where focus goes when a row it was on disappears. */
export const SHARE_BUTTON_ID = "share-link-button";

/**
 * POST to one of the long-running share routes and read back its ActionResult. A dropped
 * connection, a signed-out session and an answer that isn't the route's JSON each get their own
 * words, rather than all reading as "check your connection" after a two-minute build.
 * `unexpected` is the fault message, since a failed update must not read as "couldn't be shared".
 */
export async function postShareRoute<T>(
  path: string,
  body: unknown,
  unexpected: string = UI.shareUnexpected,
): Promise<ActionResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return fail(UI.shareNetworkFailed);
  }
  if (response.status === 401) return fail(SESSION_EXPIRED);
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return fail(unexpected);
  try {
    return (await response.json()) as ActionResult<T>;
  } catch {
    return fail(unexpected);
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

export function kindLabel(kind: SharedFileKind): string {
  return kind === "packet" ? UI.shareChoicePacket : UI.shareChoiceSummary;
}

/** What a button says while its file builds — the ticket names the packet's wording. */
export function buildingLabel(kind: SharedFileKind): string {
  return kind === "packet" ? UI.shareCreatingPacket : UI.shareCreatingSummary;
}

/** A link, selectable in one tap, with its Copy link button. */
export function LinkField({ url, kind }: { url: string; kind: SharedFileKind }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <input
        readOnly
        value={url}
        aria-label={`${kindLabel(kind)} link`}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 basis-56 font-mono text-sm text-ink bg-section border border-line rounded-[3px] px-2.5 py-2.5"
      />
      <Button variant="secondary" onClick={() => void copyLink(url)}>
        {UI.shareCopy}
      </Button>
    </div>
  );
}

/**
 * "Require a password" and, when ticked, the password itself — with Show, since the sharer has
 * to send it to the City by text and the app never shows it again, and the minimum stated up
 * front rather than learned by failing.
 */
export function PasswordFields({
  required,
  onRequiredChange,
  password,
  onPasswordChange,
  error,
  disabled = false,
}: {
  required: boolean;
  onRequiredChange: (required: boolean) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  error: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label className="flex items-center gap-2.5 min-h-11 text-[15px] text-ink cursor-pointer">
        <input
          type="checkbox"
          className="w-[18px] h-[18px] accent-accent"
          checked={required}
          disabled={disabled}
          onChange={(event) => onRequiredChange(event.target.checked)}
        />
        {UI.shareRequirePassword}
      </label>
      {required && (
        <div className="mt-2">
          <Label htmlFor={id}>{UI.sharePasswordLabel}</Label>
          <div className="flex gap-2">
            <Input
              id={id}
              type={shown ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              disabled={disabled}
              onChange={(event) => onPasswordChange(event.target.value)}
              aria-describedby={`${id}-${error ? "error" : "hint"}`}
              className="flex-1 min-w-0"
            />
            <Button variant="secondary" disabled={disabled} aria-pressed={shown} onClick={() => setShown(!shown)}>
              {shown ? UI.shareHidePassword : UI.shareShowPassword}
            </Button>
          </div>
          {error ? (
            <FieldError id={`${id}-error`}>{error}</FieldError>
          ) : (
            <Helper id={`${id}-hint`}>{UI.sharePasswordHint}</Helper>
          )}
        </div>
      )}
    </div>
  );
}

export function SharedLinksBox({
  links,
  monthLabel,
  updateBlocked,
  orgCancelled,
  updatingIds,
  onUpdate,
}: {
  links: SharedLinkView[];
  monthLabel: string;
  /** Update shared file is held by the same rules as a download (Appendix A §4). */
  updateBlocked: boolean;
  orgCancelled: boolean;
  updatingIds: ReadonlySet<string>;
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
              updateBlocked={updateBlocked}
              updating={updatingIds.has(link.id)}
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
  updateBlocked,
  updating,
  onUpdate,
}: {
  link: SharedLinkView;
  monthLabel: string;
  updateBlocked: boolean;
  updating: boolean;
  onUpdate: () => void;
}) {
  const router = useRouter();
  const [stopping, startStopping] = useTransition();
  const [changingPassword, setChangingPassword] = useState(false);
  const changeToggle = useRef<HTMLButtonElement>(null);

  function stop() {
    startStopping(async () => {
      // Refreshed either way: a failure here means the link was already stopped elsewhere.
      reportResult(await stopSharedLinkAction({ shareId: link.id }));
      router.refresh();
      // This row is about to disappear; the Share link button is where the next step starts.
      document.getElementById(SHARE_BUTTON_ID)?.focus();
    });
  }

  return (
    <div className="text-[15px] text-ink">
      <div>
        <span className="font-bold">{kindLabel(link.kind)}</span>
        <span className="text-sub"> · {link.hasPassword ? UI.sharedPasswordProtected : UI.sharedNoPassword}</span>
      </div>
      <div className="text-sm text-sub mt-0.5">{UI.sharedOn(link.sharedOn, link.sharedBy)}</div>

      <LinkField url={link.url} kind={link.kind} />

      <div className="flex flex-wrap items-center gap-x-3 mt-1">
        <Button
          ref={changeToggle}
          variant="quiet"
          aria-expanded={changingPassword}
          disabled={stopping}
          onClick={() => setChangingPassword((open) => !open)}
        >
          {UI.shareChangePassword}
        </Button>
        <span aria-hidden className="text-sub">
          ·
        </span>
        <ConfirmButton
          variant="quiet"
          className="text-danger!"
          disabled={stopping}
          title={UI.shareStopTitle(monthLabel, link.kind)}
          body={UI.shareStopBody}
          confirmLabel={UI.shareStop}
          dismissLabel={UI.cancel}
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
            changeToggle.current?.focus();
          }}
          onCancel={() => {
            setChangingPassword(false);
            changeToggle.current?.focus();
          }}
        />
      )}

      {link.recordsChanged && (
        <DangerPanel tone="notice" className="mt-3">
          <p>{UI.shareRecordsChanged(link.sharedOn)}</p>
          <Button variant="secondary" className="mt-2.5" disabled={updateBlocked || updating} onClick={onUpdate}>
            {updating ? buildingLabel(link.kind) : UI.shareUpdate}
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

  // A form so Enter in the password field saves, as it would anywhere else.
  return (
    <form
      noValidate
      className="mt-2 border border-line rounded-md p-3 bg-section"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && !unchanged) save();
      }}
    >
      <PasswordFields
        required={required}
        onRequiredChange={(value) => {
          setRequired(value);
          setError(null);
        }}
        password={password}
        onPasswordChange={setPassword}
        error={error}
        disabled={saving}
      />
      <div className="flex flex-wrap gap-3 mt-3">
        <Button type="submit" disabled={saving || unchanged}>
          {saving ? UI.saving : UI.save}
        </Button>
        <Button variant="quiet" disabled={saving} onClick={onCancel}>
          {UI.cancel}
        </Button>
      </div>
    </form>
  );
}
