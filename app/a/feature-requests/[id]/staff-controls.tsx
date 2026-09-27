"use client";

/**
 * What staff change on one request (PHASE-17, ticket §7): its wording, its status, and whether
 * other organizations see it. Each saves on its own and refreshes the page, as the other `/a`
 * actions do; a refusal inside the Edit dialog stays in the dialog.
 */
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Field, Input, Label, Textarea } from "@/src/components/ui/field";
import { Modal } from "@/src/components/ui/modal";
import { Select } from "@/src/components/ui/select";
import { Switch } from "@/src/components/ui/switch";
import { reportResult } from "@/src/components/ui/toast";
import type { FeatureRequestStatus } from "@/src/db/schema";
import {
  canShowToAll,
  FEATURE_REQUEST_DETAILS_MAX,
  FEATURE_REQUEST_TITLE_MAX,
} from "@/src/domain/feature-requests";
import {
  FEATURE_REQUEST_STATUS_DESCRIPTIONS,
  FEATURE_REQUEST_STATUS_LABELS,
  UI,
} from "@/src/domain/strings";
import {
  editFeatureRequestAction,
  setFeatureRequestShownAction,
  setFeatureRequestStatusAction,
} from "@/src/modules/feature-requests/staff-actions";

export function EditWording({
  requestId,
  title,
  details,
}: {
  requestId: string;
  title: string;
  details: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDetails, setDraftDetails] = useState(details);
  const [errors, setErrors] = useState<{ title?: string; details?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();

  // Seeded on open, not on close: `router.refresh()` lands the new wording after the dialog
  // has closed, so seeding on the way out would put the old words back (as `account-actions`).
  function openWithCurrent() {
    setDraftTitle(title);
    setDraftDetails(details);
    setErrors({});
    setOpen(true);
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    // Nothing to save: close, rather than answer "Nothing changed." as if it were a mistake.
    if (draftTitle === title && draftDetails === details) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await editFeatureRequestAction({ requestId, title: draftTitle, details: draftDetails });
      if (!result.ok) {
        const fields = result.fieldErrors ?? {};
        setErrors(fields.title || fields.details ? fields : { form: result.error });
        return;
      }
      reportResult(result, UI.staffFeatureRequestSaved);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" className="min-h-11 px-4 text-[15px] shrink-0 whitespace-nowrap" onClick={openWithCurrent}>
        {UI.staffFeatureRequestEdit}
      </Button>
      <Modal open={open} title={UI.staffFeatureRequestEdit} onClose={() => setOpen(false)} dismissDisabled={pending}>
        <form noValidate onSubmit={save} className="flex flex-col gap-4">
          <Field label={UI.staffFeatureRequestTitleField} error={errors.title}>
            {(props) => (
              <Input
                {...props}
                value={draftTitle}
                maxLength={FEATURE_REQUEST_TITLE_MAX}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
            )}
          </Field>
          <Field label={UI.staffFeatureRequestDetailsField} error={errors.details}>
            {(props) => (
              <Textarea
                {...props}
                rows={6}
                value={draftDetails}
                maxLength={FEATURE_REQUEST_DETAILS_MAX}
                onChange={(event) => setDraftDetails(event.target.value)}
              />
            )}
          </Field>
          {errors.form && (
            <p className="m-0 text-sm font-semibold text-danger" role="alert">
              {errors.form}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? UI.saving : UI.save}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {UI.cancel}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function StatusAndVisibility({
  requestId,
  status,
  shownToAll,
}: {
  requestId: string;
  status: FeatureRequestStatus;
  shownToAll: boolean;
}) {
  const router = useRouter();
  const helpId = useId();
  const [pending, startTransition] = useTransition();
  const blocked = !canShowToAll(status);

  function changeStatus(next: string) {
    if (next === status) return;
    startTransition(async () => {
      const result = await setFeatureRequestStatusAction({ requestId, status: next });
      if (!result.ok) {
        reportResult(result);
        return;
      }
      reportResult(result, result.data.hidden ? UI.staffFeatureRequestStatusSavedHidden : UI.staffFeatureRequestStatusSaved);
      router.refresh();
    });
  }

  function changeShown(next: boolean) {
    startTransition(async () => {
      const result = await setFeatureRequestShownAction({ requestId, shown: next });
      if (!reportResult(result, next ? UI.staffFeatureRequestShown : UI.staffFeatureRequestHidden)) return;
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="max-w-[340px]">
        {/* Named for screen readers only: the card's own heading already reads "Status". */}
        <Label id="requestStatusSelect-label" htmlFor="requestStatusSelect" className="sr-only">
          {UI.staffFeatureRequestStatus}
        </Label>
        <Select
          id="requestStatusSelect"
          aria-labelledby="requestStatusSelect-label"
          value={status}
          disabled={pending}
          onValueChange={changeStatus}
        >
          {(Object.keys(FEATURE_REQUEST_STATUS_LABELS) as FeatureRequestStatus[]).map((key) => (
            <option key={key} value={key}>
              {FEATURE_REQUEST_STATUS_LABELS[key]}
            </option>
          ))}
        </Select>
        {/* What the customer reads for this status, so staff see when it promises a reply
            ("A reply says why.") before moving on. */}
        <p className="m-0 mt-1.5 text-sm text-sub">{FEATURE_REQUEST_STATUS_DESCRIPTIONS[status]}</p>
      </div>
      <div>
        <Switch checked={shownToAll} disabled={pending || blocked} onChange={changeShown} describedBy={helpId}>
          {UI.staffFeatureRequestShowToAll}
        </Switch>
        <p id={helpId} className="m-0 mt-1 text-sm text-sub leading-relaxed max-w-[560px]">
          {UI.staffFeatureRequestShowToAllHelp}
          {blocked && ` ${UI.staffFeatureRequestShowBlocked}`}
        </p>
      </div>
    </div>
  );
}
