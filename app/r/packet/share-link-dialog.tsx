"use client";

/**
 * "Share {Month} files" (PHASE-12 §7, Appendix A §2).
 *
 * Opened only after the same checks as a download — the red panel disables the button, and the
 * deleted-items dialog comes first — so `confirmedDeletions` arrives already answered. The file is
 * saved and linked by `POST /api/shared-links/create`, a route rather than a Server Action because
 * a big packet takes a minute or two to build (P12).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/src/components/ui/button";
import { FieldError, Input, Label } from "@/src/components/ui/field";
import { Modal } from "@/src/components/ui/modal";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { UI } from "@/src/domain/strings";
import type { SharedLinkCreated } from "@/src/modules/sharing/actions";
import type { SharedLinkView } from "@/src/modules/sharing/queries";

import { copyLink, kindLabel, postShareRoute, SHARE_PASSWORD_MIN, SharedLinkRow } from "./shared-links";

type Kind = SharedLinkView["kind"];

const CHOICES: Array<{ kind: Kind; hint: string }> = [
  { kind: "packet", hint: UI.shareChoicePacketHint },
  { kind: "summary", hint: UI.shareChoiceSummaryHint },
];

export function ShareLinkDialog({
  open,
  onClose,
  month,
  monthLabel,
  fundingSourceId,
  confirmedDeletions,
  links,
  blocked,
  updatingId,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  month: string;
  monthLabel: string;
  fundingSourceId: string;
  confirmedDeletions: boolean;
  links: SharedLinkView[];
  blocked: boolean;
  updatingId: string | null;
  onUpdate: (link: SharedLinkView, confirmedDeletions: boolean) => void;
}) {
  const router = useRouter();
  const sharedKinds = new Set(links.map((link) => link.kind));
  const [kind, setKind] = useState<Kind>(sharedKinds.has("packet") && !sharedKinds.has("summary") ? "summary" : "packet");
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<SharedLinkCreated | null>(null);

  const existing = links.find((link) => link.kind === kind) ?? null;

  function close() {
    setCreated(null);
    setError(null);
    setPasswordError(null);
    setPassword("");
    setRequirePassword(false);
    onClose();
  }

  async function create() {
    if (requirePassword && password.length < SHARE_PASSWORD_MIN) {
      setPasswordError(UI.sharePasswordTooShort);
      return;
    }
    setPasswordError(null);
    setError(null);
    setBusy(true);
    const result = await postShareRoute<SharedLinkCreated>("/api/shared-links/create", {
      fundingSourceId,
      month,
      kind,
      password: requirePassword ? password : null,
      confirmedDeletions,
    });
    setBusy(false);
    // Refreshed on any answer: a success adds the row, and "already shared" means someone else
    // shared it first, whose row should now show.
    router.refresh();
    if (result.ok) {
      setCreated(result.data);
      setPassword("");
    } else if (result.fieldErrors?.password) {
      setPasswordError(result.fieldErrors.password);
    } else {
      setError(result.error);
    }
  }

  return (
    <Modal open={open} title={UI.shareDialogTitle(monthLabel)} onClose={close}>
      {created ? (
        <div className="text-[15px] text-ink">
          <div className="font-bold mb-2">{kindLabel(created.kind)}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={created.url}
              aria-label={`${kindLabel(created.kind)} link`}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 basis-56 font-mono text-sm text-ink bg-section border border-line rounded-[3px] px-2.5 py-2"
            />
            <Button variant="secondary" className="min-h-9 px-3 text-[15px]" onClick={() => void copyLink(created.url)}>
              {UI.shareCopy}
            </Button>
          </div>
          {created.hasPassword && <p className="mt-3 text-sub">{UI.sharePasswordNote}</p>}
          <div className="flex justify-end mt-5">
            <Button variant="quiet" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-[15px] text-ink">
          {error && <DangerPanel className="mb-4">{error}</DangerPanel>}

          <fieldset disabled={busy}>
            <legend className="font-bold mb-2">{UI.shareWhichFile}</legend>
            <div className="flex flex-col gap-2">
              {CHOICES.map((choice) => (
                <label
                  key={choice.kind}
                  className={`flex items-start gap-3 border rounded-md p-3 cursor-pointer ${
                    kind === choice.kind ? "border-accent bg-section" : "border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="share-kind"
                    className="mt-1 w-[18px] h-[18px] accent-accent"
                    checked={kind === choice.kind}
                    onChange={() => {
                      setKind(choice.kind);
                      setError(null);
                    }}
                  />
                  <span>
                    <span className="font-bold">{kindLabel(choice.kind)}</span>
                    {sharedKinds.has(choice.kind) && (
                      <span className="ml-2 text-sm text-sub">{UI.shareAlreadyShared}</span>
                    )}
                    <span className="block text-sm text-sub mt-0.5">{choice.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {existing ? (
            // Appendix A §2: picking an already-shared file shows its row instead of the form.
            <div className="mt-4 border-t border-line pt-4">
              <SharedLinkRow
                link={existing}
                monthLabel={monthLabel}
                blocked={blocked}
                updating={updatingId === existing.id}
                onUpdate={() => onUpdate(existing, confirmedDeletions)}
              />
              <div className="flex justify-end mt-5">
                <Button variant="quiet" onClick={close}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4">
                <label className="flex items-center gap-2.5 text-[15px] text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-[18px] h-[18px] accent-accent"
                    checked={requirePassword}
                    disabled={busy}
                    onChange={(event) => {
                      setRequirePassword(event.target.checked);
                      setPasswordError(null);
                    }}
                  />
                  {UI.shareRequirePassword}
                </label>
                {requirePassword && (
                  <div className="mt-3">
                    <Label htmlFor="share-new-password">{UI.sharePasswordLabel}</Label>
                    <Input
                      id="share-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      disabled={busy}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-describedby={passwordError ? "share-new-password-error" : undefined}
                    />
                    {passwordError && <FieldError id="share-new-password-error">{passwordError}</FieldError>}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3 mt-5">
                <Button disabled={busy} onClick={() => void create()}>
                  {busy ? (kind === "packet" ? UI.shareCreatingPacket : UI.shareCreatingSummary) : UI.shareCreate}
                </Button>
                <Button variant="quiet" onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
