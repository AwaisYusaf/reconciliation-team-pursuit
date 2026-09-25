"use client";

/**
 * The org page's four staff actions (Phase 9 §6, Appendix A §5-§7): change plan, complimentary
 * access, suspend, reinstate. Errors render inside the open dialog only — `reportResult` would
 * also raise a toast behind it, doubling the message (same pattern as `month-lock.tsx`).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Dialog } from "@/src/components/ui/dialog";
import { Helper, Input, Label, Textarea } from "@/src/components/ui/field";
import { Modal } from "@/src/components/ui/modal";
import { Select } from "@/src/components/ui/select";
import { reportResult } from "@/src/components/ui/toast";
import type { IsoDate } from "@/src/domain/dates";
import { ACCOUNT_NOTE_MAX_LENGTH, PLAN_LABELS, STATUS_LABELS, UI } from "@/src/domain/strings";
import type { OrgPlan, SubscriptionStatus } from "@/src/modules/admin/directory";
import {
  changePlanAction,
  reinstateOrgAction,
  setComplimentaryAction,
  suspendOrgAction,
} from "@/src/modules/admin/actions";

export type ActionsOrg = {
  id: string;
  name: string;
  plan: OrgPlan;
  subscriptionStatus: SubscriptionStatus;
  complimentary: boolean;
  complimentaryUntil: IsoDate | null;
  suspendedAt: Date | null;
};

/**
 * `stripeManaged`: billing is on and a subscription is live, so Stripe is the one writer of plan
 * and status (P16). The server refuses the change anyway; this only stops offering it.
 */
export function AccountActions({
  org,
  stripeManaged = false,
  customerUrl = null,
}: {
  org: ActionsOrg;
  stripeManaged?: boolean;
  customerUrl?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <ChangePlan org={org} disabled={stripeManaged} />
        <ComplimentaryAccess org={org} paying={stripeManaged && !org.complimentary} />
        {org.suspendedAt === null ? <Suspend org={org} /> : <Reinstate org={org} />}
      </div>
      {stripeManaged && (
        <p className="text-[15px] text-sub">
          {UI.staffStripeManaged}{" "}
          {customerUrl && (
            <a
              href={customerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:no-underline"
            >
              {UI.staffBillingOpenCustomer}
            </a>
          )}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- change plan */

function ChangePlan({ org, disabled }: { org: ActionsOrg; disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<OrgPlan>(org.plan);
  const [status, setStatus] = useState<SubscriptionStatus>(org.subscriptionStatus);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Seeded on *open*, not on close: after a save, `router.refresh()` lands the new `org` prop
  // asynchronously, so resetting on the way out would put the pre-save values back and the next
  // open would show a stale plan. Opening reads whatever props the latest render carries.
  function openWithCurrent() {
    setPlan(org.plan);
    setStatus(org.subscriptionStatus);
    setNote("");
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await changePlanAction(org.id, plan, status, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reportResult(result, "Plan updated.");
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        className="min-h-11 px-4 text-[15px]"
        disabled={disabled}
        title={disabled ? UI.staffStripeManaged : undefined}
        onClick={openWithCurrent}
      >
        {UI.changePlanTitle}
      </Button>
      <Modal open={open} title={UI.changePlanTitle} onClose={close}>
        <div className="flex flex-col gap-4">
          <div>
            <Label id="changePlan-plan-label" htmlFor="changePlan-plan">
              Plan
            </Label>
            <Select
              id="changePlan-plan"
              aria-labelledby="changePlan-plan-label"
              value={plan}
              onValueChange={(value) => setPlan(value as OrgPlan)}
            >
              {(Object.keys(PLAN_LABELS) as OrgPlan[]).map((key) => (
                <option key={key} value={key}>
                  {PLAN_LABELS[key]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label id="changePlan-status-label" htmlFor="changePlan-status">
              Status
            </Label>
            <Select
              id="changePlan-status"
              aria-labelledby="changePlan-status-label"
              value={status}
              onValueChange={(value) => setStatus(value as SubscriptionStatus)}
            >
              {(Object.keys(STATUS_LABELS) as SubscriptionStatus[]).map((key) => (
                <option key={key} value={key}>
                  {STATUS_LABELS[key]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="changePlan-note">
              Note <span className="font-normal">(optional)</span>
            </Label>
            <Textarea
              id="changePlan-note"
              rows={2}
              maxLength={ACCOUNT_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Upgraded after call with Misty"
            />
          </div>
          {error && (
            <p className="text-sm font-semibold text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending} onClick={save}>
              Save
            </Button>
            <Button variant="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ----------------------------------------------------------- complimentary access */

/** `paying`: granting free access must also end the paid plan (§4.6), now or at period end. */
function ComplimentaryAccess({ org, paying }: { org: ActionsOrg; paying: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(org.complimentary);
  const [until, setUntil] = useState(org.complimentaryUntil ?? "");
  const [cancelPaid, setCancelPaid] = useState<"now" | "period_end" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Seeded on open for the same reason as `ChangePlan` above — see that comment.
  function openWithCurrent() {
    setEnabled(org.complimentary);
    setUntil(org.complimentaryUntil ?? "");
    setCancelPaid(null);
    setNote("");
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setComplimentaryAction(org.id, enabled, until, note, paying ? cancelPaid : null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reportResult(result, "Complimentary access updated.");
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" className="min-h-11 px-4 text-[15px]" onClick={openWithCurrent}>
        {UI.complimentaryAccessTitle}
      </Button>
      <Modal open={open} title={UI.complimentaryAccessTitle} onClose={close}>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-[15px] text-ink">
            <input
              type="checkbox"
              className="w-[18px] h-[18px] accent-accent"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            {UI.complimentaryCheckboxLabel}
          </label>
          <div>
            <Label htmlFor="complimentary-until">
              End date <span className="font-normal">(optional)</span>
            </Label>
            <Input
              id="complimentary-until"
              type="date"
              disabled={!enabled}
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </div>
          {paying && enabled && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[15px] font-semibold text-ink mb-1">{UI.staffCompPaying}</legend>
              {(
                [
                  ["period_end", UI.staffCompCancelAtEnd],
                  ["now", UI.staffCompCancelNow],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-[15px] text-ink">
                  <input
                    type="radio"
                    name="complimentary-cancel"
                    className="w-[18px] h-[18px] accent-accent"
                    checked={cancelPaid === value}
                    onChange={() => setCancelPaid(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <Label htmlFor="complimentary-note">
              Note <span className="font-normal">(optional)</span>
            </Label>
            <Textarea
              id="complimentary-note"
              rows={2}
              maxLength={ACCOUNT_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Pilot partner until year end"
            />
          </div>
          {error && (
            <p className="text-sm font-semibold text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending} onClick={save}>
              Save
            </Button>
            <Button variant="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- suspend / reinstate */

function Suspend({ org }: { org: ActionsOrg }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setReason("");
    setError(null);
  }

  function suspend() {
    setError(null);
    startTransition(async () => {
      const result = await suspendOrgAction(org.id, reason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reportResult(result, "Organization suspended.");
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" className="min-h-11 px-4 text-[15px]" onClick={() => setOpen(true)}>
        Suspend
      </Button>
      <Dialog
        open={open}
        tone="danger"
        title={UI.suspendDialogTitle(org.name)}
        dismissLabel="Cancel"
        dismissDisabled={pending}
        onDismiss={close}
        confirm={{ label: "Suspend", disabled: pending || reason.trim() === "", onConfirm: suspend }}
      >
        <p className="mb-3">{UI.suspendDialogText}</p>
        <Label htmlFor="suspend-reason">Reason</Label>
        <Textarea
          id="suspend-reason"
          rows={2}
          required
          maxLength={ACCOUNT_NOTE_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Payment 30 days overdue"
          aria-describedby="suspend-reason-help"
        />
        <Helper id="suspend-reason-help">{UI.suspendReasonShownToCustomer}</Helper>
        {error && (
          <p className="mt-2 text-sm font-semibold text-danger" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}

function Reinstate({ org }: { org: ActionsOrg }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setNote("");
    setError(null);
  }

  function reinstate() {
    setError(null);
    startTransition(async () => {
      const result = await reinstateOrgAction(org.id, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reportResult(result, "Organization reinstated.");
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" className="min-h-11 px-4 text-[15px]" onClick={() => setOpen(true)}>
        Reinstate
      </Button>
      <Dialog
        open={open}
        tone="neutral"
        title={UI.reinstateDialogTitle(org.name)}
        dismissLabel="Cancel"
        dismissDisabled={pending}
        onDismiss={close}
        confirm={{ label: "Reinstate", disabled: pending, onConfirm: reinstate }}
      >
        <Label htmlFor="reinstate-note">
          Note <span className="font-normal">(optional)</span>
        </Label>
        <Textarea
          id="reinstate-note"
          rows={2}
          maxLength={ACCOUNT_NOTE_MAX_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {error && (
          <p className="mt-2 text-sm font-semibold text-danger" role="alert">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}
