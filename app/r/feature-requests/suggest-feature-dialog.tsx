"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Field, Input, Textarea } from "@/src/components/ui/field";
import { Modal } from "@/src/components/ui/modal";
import { reportResult } from "@/src/components/ui/toast";
import {
  FEATURE_REQUEST_DETAILS_MAX,
  FEATURE_REQUEST_TITLE_MAX,
  listHref,
} from "@/src/domain/feature-requests";
import { UI } from "@/src/domain/strings";
import { suggestFeatureAction } from "@/src/modules/feature-requests/actions";

/**
 * "Suggest a feature" and its dialog (ticket §3).
 *
 * The typed text is held here, outside the `Modal`, which unmounts its content when it closes:
 * Cancel keeps what was written for the next open, and only a request that was sent clears it
 * (PHASE-17 P15). Every refusal, the ten-a-day one included, shows inside the dialog, beside
 * the text it is about.
 *
 * After sending, the reader lands on "From your organization", where the new request is at the
 * top (Q1), rather than staying on a search that may not match it.
 */
export function SuggestFeature() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [errors, setErrors] = useState<{ title?: string; details?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setErrors({});
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await suggestFeatureAction({ title, details });
      if (!result.ok) {
        const fields = result.fieldErrors ?? {};
        setErrors(
          fields.title || fields.details
            ? { title: fields.title, details: fields.details }
            : { form: result.error },
        );
        return;
      }
      reportResult(result, UI.featureRequestSent);
      setTitle("");
      setDetails("");
      setOpen(false);
      router.push(listHref({ tab: "org", q: "" }));
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>{UI.featureRequestSuggest}</Button>
      <Modal
        open={open}
        title={UI.featureRequestDialogTitle}
        onClose={close}
        dismissDisabled={pending}
      >
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Field label={UI.featureRequestTitleLabel} error={errors.title}>
            {(props) => (
              <Input
                {...props}
                value={title}
                maxLength={FEATURE_REQUEST_TITLE_MAX}
                placeholder={UI.featureRequestTitlePlaceholder}
                onChange={(event) => setTitle(event.target.value)}
                aria-invalid={errors.title ? true : undefined}
              />
            )}
          </Field>
          <Field
            label={UI.featureRequestDetailsLabel}
            helper={UI.featureRequestDetailsHelp}
            error={errors.details}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={5}
                value={details}
                maxLength={FEATURE_REQUEST_DETAILS_MAX}
                onChange={(event) => setDetails(event.target.value)}
                aria-invalid={errors.details ? true : undefined}
              />
            )}
          </Field>
          {errors.form && (
            <p className="m-0 text-[15px] font-semibold text-danger" role="alert">
              {errors.form}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {UI.featureRequestSend}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={close}>
              {UI.cancel}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
