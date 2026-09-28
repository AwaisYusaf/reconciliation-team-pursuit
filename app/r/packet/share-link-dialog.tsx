"use client";

/**
 * "Share {Month} files" (PHASE-12 §7, Appendix A §2).
 *
 * Opened only after the same checks as a download — the red panel disables the button, and the
 * deleted-items dialog comes first — so `confirmedDeletions` arrives already answered. The file is
 * saved and linked by `POST /api/shared-links/create`, a route rather than a Server Action because
 * a big packet takes a minute or two to build (P12). The dialog holds itself open while that runs:
 * closing it wouldn't stop the build, only hide the link it produces.
 *
 * Mounted while open and while it fades out, and keyed on the opening (`packet-download-buttons.tsx`),
 * so every opening starts fresh.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import { Modal } from "@/src/components/ui/modal";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { SHARE_PASSWORD_MIN, type SharedFileKind } from "@/src/domain/shared-links";
import { UI } from "@/src/domain/strings";
import type { SharedLinkCreated } from "@/src/modules/sharing/actions";
import type { SharedLinkView } from "@/src/modules/sharing/queries";

import { initialShareKind, sharedLinkFor } from "./share-choice";
import { buildingLabel, kindLabel, LinkField, PasswordFields, postShareRoute, SharedLinkRow } from "./shared-links";

const CHOICES: Array<{ kind: SharedFileKind; hint: string }> = [
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
  updateBlocked,
  updatingIds,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  month: string;
  monthLabel: string;
  fundingSourceId: string;
  confirmedDeletions: boolean;
  links: SharedLinkView[];
  updateBlocked: boolean;
  updatingIds: ReadonlySet<string>;
  onUpdate: (link: SharedLinkView, confirmedDeletions: boolean) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<SharedFileKind>(() => initialShareKind(links));
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<SharedLinkCreated | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const sharedKinds = new Set(links.map((link) => link.kind));
  const existing = sharedLinkFor(kind, links);

  // The Create link button that had focus is gone once the link is ready; put the keyboard on the
  // new link's Copy link so it is announced and one key away.
  useEffect(() => {
    if (created) resultRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [created]);

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
    <Modal open={open} title={UI.shareDialogTitle(monthLabel)} onClose={onClose} dismissDisabled={busy}>
      {created ? (
        <div ref={resultRef} className="text-[15px] text-ink" role="status">
          <div className="font-bold">{kindLabel(created.kind)}</div>
          <LinkField url={created.url} kind={created.kind} />
          {created.hasPassword && <p className="mt-3 text-sub">{UI.sharePasswordNote}</p>}
          <div className="flex justify-end mt-4">
            <Button variant="quiet" onClick={onClose}>
              {UI.done}
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-[15px] text-ink">
          {error && <DangerPanel className="mb-4">{error}</DangerPanel>}

          {/* A form so Enter in the password field creates the link. The already-shared row stays
              outside it: that row has its own password form, and forms can't nest. */}
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && !existing) void create();
            }}
          >
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

            {!existing && (
              <>
                <div className="mt-3">
                  <PasswordFields
                    required={requirePassword}
                    onRequiredChange={(value) => {
                      setRequirePassword(value);
                      setPasswordError(null);
                    }}
                    password={password}
                    onPasswordChange={setPassword}
                    error={passwordError}
                    disabled={busy}
                  />
                </div>

                <div className="flex flex-wrap gap-3 mt-4">
                  <Button type="submit" disabled={busy}>
                    {busy ? buildingLabel(kind) : UI.shareCreate}
                  </Button>
                  <Button variant="quiet" disabled={busy} onClick={onClose}>
                    {UI.cancel}
                  </Button>
                </div>
              </>
            )}
          </form>

          {existing && (
            // Appendix A §2: picking an already-shared file shows its row instead of the form.
            <div className="mt-4 border-t border-line pt-4">
              <SharedLinkRow
                link={existing}
                monthLabel={monthLabel}
                updateBlocked={updateBlocked}
                updating={updatingIds.has(existing.id)}
                onUpdate={() => onUpdate(existing, confirmedDeletions)}
              />
              <div className="flex justify-end mt-4">
                <Button variant="quiet" onClick={onClose}>
                  {UI.done}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
