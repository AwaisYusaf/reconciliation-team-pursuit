"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, buttonClassName } from "@/src/components/ui/button";
import { Helper, Input, Label, MoneyInput } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { Card, CARD_PADDING, DangerPanel, SectionTitle } from "@/src/components/ui/surfaces";
import { reportResult } from "@/src/components/ui/toast";
import { formatDateUS } from "@/src/domain/dates";
import { formatMoney } from "@/src/domain/format";
import { parseMoneyToCents } from "@/src/domain/money";
import { cn } from "@/src/lib/cn";
import { resetToursAction } from "@/src/modules/tours/actions";
import type { ActionResult } from "@/src/lib/action-result";
import {
  archiveFundingSourceAction,
  createFundingSourceAction,
  unarchiveFundingSourceAction,
  updateFundingSourceAction,
} from "@/src/modules/funding-sources/actions";
import {
  changePasswordAction,
  saveLabelAction,
  setLabelActiveAction,
  updateOrganisationAction,
} from "@/src/modules/settings/actions";
import { VendorTable, type LabelRow, type Vendor } from "./vendor-table";
import { UsersManager, type OrgUser } from "./users/users-manager";

/** One entry per sidebar item — a settings screen used to be a long scroll of cards; this is
 *  the same content, just one section shown at a time instead of stacked. */
const SECTION_IDS = [
  "organization",
  "fundingSources",
  "labels",
  "vendors",
  "users",
  "account",
] as const;
type SectionId = (typeof SECTION_IDS)[number];

const SECTION_LABELS: Record<SectionId, string> = {
  organization: "Organization",
  fundingSources: "Funding Sources",
  labels: "Lists",
  vendors: "Vendor Library",
  users: "Users",
  account: "Account",
};

export type FundingSourceRow = {
  id: string;
  name: string;
  type: string;
  docName: string;
  projectName: string;
  contractNumber: string;
  basePoNumber: string;
  performancePoNumber: string;
  contractValue: string;
  contractStart: string;
  contractEnd: string;
  fiduciaryName: string;
  advancesReceived: string;
  taxReimbursable: boolean;
  feesReimbursable: boolean;
  archived: boolean;
};

const FUNDING_SOURCE_TYPES = [
  ["grant", "Grant"],
  ["donation", "Donation"],
  ["line_of_credit", "Line of credit"],
  ["other", "Other"],
] as const;

const EMPTY_FUNDING_SOURCE_DRAFT = {
  name: "",
  type: "grant" as string,
  docName: "",
  projectName: "",
  contractNumber: "",
  basePoNumber: "",
  performancePoNumber: "",
  contractValue: "0.00",
  contractStart: "",
  contractEnd: "",
  fiduciaryName: "",
  advancesReceived: "0.00",
  taxReimbursable: false,
  feesReimbursable: true,
};

/** One small stroke icon per section, matching the plain geometric style already used
 *  elsewhere in this app (the trash icon on the Expenses screen, the Select chevron) rather
 *  than pulling in an icon library for seven glyphs. */
function SectionIcon({ id }: { id: SectionId }) {
  const paths: Record<SectionId, React.ReactNode> = {
    organization: (
      <>
        <rect x="4" y="3" width="12" height="14" rx="1" />
        <path d="M7.5 7h1.5M11 7h1.5M7.5 10h1.5M11 10h1.5M7.5 13h1.5M11 13h1.5" />
      </>
    ),
    fundingSources: (
      <>
        <path d="M6 3h6l3 3v11a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" />
        <path d="M7.5 9h5M7.5 12h5M7.5 15h3" />
      </>
    ),
    labels: (
      <>
        <path d="M4 5.5h12M4 10h12M4 14.5h8" />
        <circle cx="16" cy="14.5" r="0.75" fill="currentColor" stroke="none" />
      </>
    ),
    vendors: (
      <>
        <path d="M3.5 7l1-3.5h11l1 3.5" />
        <path d="M3.5 7h13v8.5a1 1 0 01-1 1H4.5a1 1 0 01-1-1V7z" />
        <path d="M8 16.5V12h4v4.5" />
      </>
    ),
    users: (
      <>
        <circle cx="7.5" cy="7" r="2.5" />
        <path d="M3 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
        <circle cx="14" cy="7.5" r="2" />
        <path d="M13 12.2c1.9.3 3.5 1.6 3.5 3.8" />
      </>
    ),
    account: (
      <>
        <circle cx="10" cy="7" r="3" />
        <path d="M4 16.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[id]}
    </svg>
  );
}

export function SettingsSections({
  email,
  organisation,
  fundingSources,
  paymentSources,
  supportingDocTypes,
  vendors,
  vendorCount,
  lineItems,
  isAdmin,
  users,
  usersError,
}: {
  email: string;
  organisation: { name: string; docName: string };
  fundingSources: FundingSourceRow[];
  paymentSources: LabelRow[];
  supportingDocTypes: LabelRow[];
  /** A short preview only — the full, searchable, paginated library lives at /settings/vendors. */
  vendors: Vendor[];
  vendorCount: number;
  lineItems: Array<{ id: string; name: string }>;
  isAdmin: boolean;
  /** Admin-only (D-89 pattern); empty for a manager, never fetched for one (see page.tsx). */
  users: OrgUser[];
  /** Set when the users list failed to load — shown instead of an empty "No users yet.",
   *  which would read as the accounts being gone. */
  usersError?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<SectionId>("organization");

  const [org, setOrg] = useState(organisation);

  function run(
    work: () => Promise<ActionResult<unknown>>,
    successMessage: string,
    onDone?: () => void,
  ) {
    startTransition(async () => {
      if (reportResult(await work(), successMessage)) {
        onDone?.();
        router.refresh();
      }
    });
  }

  // "Users" is the only item a manager never sees — same rule D-85 already established for
  // the nav and the old /settings/users route: identity/user-management is admin-only.
  const visibleSections = SECTION_IDS.filter((id) => id !== "users" || isAdmin);

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* ------------------------------------------------------------- sidebar */}
      {/* Always a vertical list on a light track, the active item a raised white pill — a
          horizontal scrolling row on mobile looked cramped with no scroll affordance, and
          plain text with no card/border underneath didn't read as a sidebar at all. Stacked
          above the panel on mobile, pinned to the side on desktop. `top-24` clears the app's
          own sticky tab bar (~71px tall at lg, app/r/layout.tsx), which would otherwise draw
          over the top of this list once the page scrolls. */}
      <div className="w-full lg:w-[220px] lg:flex-none lg:sticky lg:top-24 bg-section border-2 border-line rounded-[10px] p-2">
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
          {visibleSections.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setActive(id)}
              aria-current={active === id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 text-left px-3.5 py-2.5 rounded-[8px] text-[15px] font-medium transition-colors",
                active === id
                  ? "bg-accent text-white shadow-sm"
                  : "text-sub hover:bg-surface/60 hover:text-ink",
              )}
            >
              <SectionIcon id={id} />
              {SECTION_LABELS[id]}
            </button>
          ))}
        </nav>
      </div>

      {/* -------------------------------------------------------------- panel */}
      <div className="flex-1 min-w-0 w-full">
        {active === "organization" && (
          <Card className={CARD_PADDING}>
            <SectionTitle className="mb-5">Organization</SectionTitle>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <Label htmlFor="orgName">Organization name</Label>
                <Input
                  id="orgName"
                  value={org.name}
                  onChange={(event) => setOrg({ ...org, name: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="docName">Document display name</Label>
                <Input
                  id="docName"
                  value={org.docName}
                  onChange={(event) => setOrg({ ...org, docName: event.target.value })}
                />
                <Helper>Printed on cover sheets and the packet.</Helper>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <Button
                disabled={pending}
                onClick={() => run(() => updateOrganisationAction(org), "Organization saved")}
              >
                Save
              </Button>
            </div>
          </Card>
        )}

        {active === "fundingSources" && (
          <Card className={CARD_PADDING}>
            <SectionTitle className="mb-5">Funding Sources</SectionTitle>
            <FundingSourcesSection
              fundingSources={fundingSources}
              orgDocName={org.docName}
              pending={pending}
              run={run}
            />
          </Card>
        )}

        {active === "labels" && (
          <Card className={CARD_PADDING}>
            <SectionTitle className="mb-5">Lists</SectionTitle>
            <div className="grid gap-8 lg:grid-cols-2">
              <LabelList
                title="Payment sources"
                kind="paymentSource"
                rows={paymentSources}
                pending={pending}
                run={run}
              />
              <LabelList
                title="Supporting document types"
                kind="supportingDocType"
                rows={supportingDocTypes}
                pending={pending}
                run={run}
              />
            </div>

            <Helper className="mt-5">
              Payment sources are only how something was paid &mdash; &ldquo;Paid by
              us&rdquo;, &ldquo;Paid directly by fiduciary&rdquo;. Tax and fee reimbursement
              rules now live on each funding source, in
              the Funding Sources section. Renames apply to menus going forward; saved expenses
              keep the label they were entered with, which is what keeps their documents
              reproducible.
            </Helper>
          </Card>
        )}

        {active === "vendors" && (
          <Card className={CARD_PADDING}>
            <SectionTitle className="mb-5">Vendor library</SectionTitle>
            <VendorLibrary
              vendors={vendors}
              vendorCount={vendorCount}
              lineItems={lineItems}
              paymentSources={paymentSources}
              pending={pending}
              run={run}
            />
            <Helper className="mt-4">
              The library learns automatically every time you save an expense.
            </Helper>
          </Card>
        )}

        {active === "users" &&
          isAdmin &&
          (usersError ? (
            <p className="text-[15px] text-danger">{usersError}</p>
          ) : (
            <UsersManager users={users} />
          ))}

        {active === "account" && (
          <>
            <Card className={CARD_PADDING}>
              <SectionTitle className="mb-5">Account</SectionTitle>
              <AccountSection email={email} pending={pending} startTransition={startTransition} />
            </Card>

            <Card className={cn(CARD_PADDING, "mt-6")}>
              <SectionTitle className="mb-2">App guide</SectionTitle>
              <Helper>
                The short walkthroughs on Dashboard, Add Expense, Recurring and Month-End
                Packet show once each and then stay out of the way. Bring them all back if
                you&apos;d like to see them again.
              </Helper>
              <div className="flex justify-end mt-4">
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => run(() => resetToursAction(), "App guide will show again")}
                >
                  Show the app guide again
                </Button>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- funding sources */

/** Sentinel `editingId` value meaning "the add form, not an edit". */
const NEW_FUNDING_SOURCE = "new";

/** A funding source's details, read-only — what clicking its name in the list reveals. */
function FundingSourceDetails({
  source,
  orgDocName,
}: {
  source: FundingSourceRow;
  orgDocName: string;
}) {
  const money = (value: string) => formatMoney(parseMoneyToCents(value) ?? 0);
  const date = (value: string) => (value ? formatDateUS(value) : null);
  const period =
    source.contractStart || source.contractEnd
      ? `${date(source.contractStart) ?? "Not set"} – ${date(source.contractEnd) ?? "Not set"}`
      : null;

  // The two figures people come here for, then when the money runs — read at a glance.
  const tiles: Array<[string, string | null, boolean]> = [
    ["Contract value", money(source.contractValue), true],
    ["Advances received", money(source.advancesReceived), true],
    ["Contract period", period, false],
  ];

  const details: Array<[string, string | null]> = [
    ["Project name", source.projectName || null],
    ["Contract number", source.contractNumber || null],
    ["Base PO number", source.basePoNumber || null],
    ["Performance PO number", source.performancePoNumber || null],
    ["Fiduciary", source.fiduciaryName || null],
  ];

  return (
    <div
      id={`funding-source-details-${source.id}`}
      className="basis-full mt-1 rounded-[3px] bg-section p-4 flex flex-col gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map(([label, value, figure]) => (
          <div key={label} className="rounded-[3px] border border-line bg-surface px-4 py-3">
            <div className="text-[13px] text-sub">{label}</div>
            <div
              className={cn(
                "mt-1 tabular-nums",
                value === null
                  ? "text-[15px] text-sub"
                  : figure
                    ? "text-xl font-semibold text-ink"
                    : "text-base font-medium text-ink",
              )}
            >
              {value ?? "Not set"}
            </div>
          </div>
        ))}
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[13px] text-sub">{label}</dt>
            <dd className={cn("text-[15px]", value === null ? "text-sub" : "text-ink font-medium")}>
              {value ?? "Not set"}
            </dd>
          </div>
        ))}
        <div>
          {/* What prints on this source's documents: its own name if set, else the org's (R6.1). */}
          <dt className="text-[13px] text-sub">Document name</dt>
          <dd className="text-[15px] text-ink font-medium">
            {source.docName || orgDocName}
            {!source.docName && (
              <span className="ml-1.5 font-normal text-sub">(organization&apos;s)</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-sub mr-1">This funder</span>
        <RuleBadge reimbursed={source.taxReimbursable} label="sales tax" />
        <RuleBadge reimbursed={source.feesReimbursable} label="fees" />
      </div>
    </div>
  );
}

/** One reimbursement rule as a chip. "Not reimbursed" is a rule, not a problem, so it stays
 *  neutral rather than taking the danger colour. */
function RuleBadge({ reimbursed, label }: { reimbursed: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium",
        reimbursed ? "bg-success-bg text-success" : "bg-surface text-sub border border-line",
      )}
    >
      <span aria-hidden="true">{reimbursed ? "✓" : "✕"}</span>
      {reimbursed ? `Reimburses ${label}` : `Does not reimburse ${label}`}
    </span>
  );
}

function FundingSourcesSection({
  fundingSources,
  orgDocName,
  pending,
  run,
}: {
  fundingSources: FundingSourceRow[];
  orgDocName: string;
  pending: boolean;
  run: (
    work: () => Promise<ActionResult<unknown>>,
    successMessage: string,
    onDone?: () => void,
  ) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_FUNDING_SOURCE_DRAFT);

  function startAdd() {
    setDraft(EMPTY_FUNDING_SOURCE_DRAFT);
    setEditingId(NEW_FUNDING_SOURCE);
  }

  function startEdit(source: FundingSourceRow) {
    setDraft({
      name: source.name,
      type: source.type,
      docName: source.docName,
      projectName: source.projectName,
      contractNumber: source.contractNumber,
      basePoNumber: source.basePoNumber,
      performancePoNumber: source.performancePoNumber,
      contractValue: source.contractValue,
      contractStart: source.contractStart,
      contractEnd: source.contractEnd,
      fiduciaryName: source.fiduciaryName,
      advancesReceived: source.advancesReceived,
      taxReimbursable: source.taxReimbursable,
      feesReimbursable: source.feesReimbursable,
    });
    setEditingId(source.id);
  }

  function save() {
    const work =
      editingId === NEW_FUNDING_SOURCE
        ? () => createFundingSourceAction(draft)
        : () => updateFundingSourceAction({ ...draft, id: editingId! });
    // Closed only once the save succeeds: closing straight away threw the typed values away on
    // any refusal (duplicate name, end before start), and reopening reset the draft.
    run(
      work,
      editingId === NEW_FUNDING_SOURCE ? "Funding source added" : "Funding source saved",
      () => setEditingId(null),
    );
  }

  const activeCount = fundingSources.filter((s) => !s.archived).length;
  const archivedCount = fundingSources.length - activeCount;
  // Archived sources are finished work, so the list opens on the active ones; the toggle is
  // still one click away because Unarchive lives on the archived rows.
  const [showArchived, setShowArchived] = useState(false);
  /** Sources whose details are open, read-only — any number at once, so two can be compared
   *  side by side. Edit is still the way to change them. */
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // The row being edited always stays visible: hiding it would take its open form with it and
  // leave Edit and Add disabled with nothing on screen to finish or cancel.
  const visibleSources = showArchived
    ? fundingSources
    : fundingSources.filter((source) => !source.archived || source.id === editingId);

  return (
    <div>
      {archivedCount > 0 && (
        <div className="flex justify-end mb-3">
          {/* A switch, not a link: it flips a view, it does not go anywhere. `role="switch"` with
              `aria-checked` is what makes a screen reader announce it as on/off; being a real
              <button>, Space and Enter work without extra key handling. */}
          <button
            type="button"
            role="switch"
            aria-checked={showArchived}
            onClick={() => setShowArchived((current) => !current)}
            className="inline-flex items-center gap-2.5 text-[15px] text-ink rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span>Show archived ({archivedCount})</span>
            <span
              aria-hidden="true"
              className={`relative inline-block h-5 w-9 rounded-full transition-colors ${
                showArchived ? "bg-accent" : "bg-line"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform ${
                  showArchived ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3 mb-6">
        {visibleSources.map((source) => (
          <div
            key={source.id}
            className="flex flex-wrap items-center gap-3.5 justify-between border border-line rounded-[3px] px-4 py-3 bg-surface"
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-[220px]">
              <button
                type="button"
                aria-expanded={expandedIds.has(source.id)}
                aria-controls={`funding-source-details-${source.id}`}
                onClick={() => toggleExpanded(source.id)}
                className="inline-flex items-center gap-1.5 text-base text-ink font-medium hover:text-accent rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span
                  aria-hidden="true"
                  className={`text-sub text-[13px] transition-transform ${expandedIds.has(source.id) ? "rotate-90" : ""}`}
                >
                  ▶
                </span>
                {source.name}
              </button>
              <span className="text-[13px] text-sub uppercase tracking-[0.04em]">
                {FUNDING_SOURCE_TYPES.find(([value]) => value === source.type)?.[1] ?? source.type}
              </span>
              {source.archived && (
                <span className="text-[13px] text-sub bg-section px-2 py-0.5 rounded-full">
                  Archived
                </span>
              )}
            </div>
            <div className="flex items-center gap-3.5">
              <Button
                variant="quiet"
                disabled={pending || editingId !== null}
                onClick={() => startEdit(source)}
              >
                Edit
              </Button>
              {source.archived ? (
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() =>
                    run(() => unarchiveFundingSourceAction(source.id), "Funding source unarchived")
                  }
                >
                  Unarchive
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  disabled={pending || activeCount <= 1}
                  onClick={() =>
                    run(() => archiveFundingSourceAction(source.id), "Funding source archived")
                  }
                >
                  Archive
                </Button>
              )}
            </div>
            {/* Editing replaces this row's details in place with the same fields as inputs. */}
            {editingId === source.id ? (
              <div className="basis-full mt-1 rounded-[3px] bg-section p-4">
                <FundingSourceForm
                  draft={draft}
                  setDraft={setDraft}
                  orgDocName={orgDocName}
                  pending={pending}
                  onCancel={() => setEditingId(null)}
                  onSave={save}
                />
              </div>
            ) : (
              expandedIds.has(source.id) && (
                <FundingSourceDetails source={source} orgDocName={orgDocName} />
              )
            )}
          </div>
        ))}
      </div>

      {/* Only a NEW source's form sits down here — it has no row yet. Editing an existing source
          opens the same form inside that source's own row, above. */}
      {editingId === NEW_FUNDING_SOURCE ? (
        // Same card and panel as editing a row, so adding and editing look like one thing.
        <div className="flex flex-wrap items-center gap-3.5 border border-line rounded-[3px] px-4 py-3 bg-surface">
          <span className="text-base text-ink font-medium">New funding source</span>
          <div className="basis-full mt-1 rounded-[3px] bg-section p-4">
            <FundingSourceForm
              draft={draft}
              setDraft={setDraft}
              orgDocName={orgDocName}
              pending={pending}
              onCancel={() => setEditingId(null)}
              onSave={save}
            />
          </div>
        </div>
      ) : (
        // Disabled while a row is being edited: one draft at a time, and starting an add would
        // silently replace the edit in progress.
        <Button variant="secondary" disabled={pending || editingId !== null} onClick={startAdd}>
          Add funding source
        </Button>
      )}
    </div>
  );
}

type FundingSourceDraft = typeof EMPTY_FUNDING_SOURCE_DRAFT;

/** The add/edit form for one funding source — rendered in the row being edited, or at the
 *  bottom of the list for a new one. */
function FundingSourceForm({
  draft,
  setDraft,
  orgDocName,
  pending,
  onCancel,
  onSave,
}: {
  draft: FundingSourceDraft;
  setDraft: (next: FundingSourceDraft) => void;
  orgDocName: string;
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
        <div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <Label htmlFor="fsName">Name</Label>
              <Input
                id="fsName"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="fsType">Type</Label>
              <Select
                id="fsType"
                value={draft.type}
                onValueChange={(value) => setDraft({ ...draft, type: value })}
              >
                {FUNDING_SOURCE_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="fsDocName">Document name</Label>
              <Input
                id="fsDocName"
                placeholder={orgDocName}
                value={draft.docName}
                onChange={(event) => setDraft({ ...draft, docName: event.target.value })}
              />
              <Helper>Leave blank to use the organization&apos;s document name.</Helper>
            </div>
            <div>
              <Label htmlFor="fsProjectName">Project name</Label>
              <Input
                id="fsProjectName"
                value={draft.projectName}
                onChange={(event) => setDraft({ ...draft, projectName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="fsContractNumber">Contract number</Label>
              <Input
                id="fsContractNumber"
                value={draft.contractNumber}
                onChange={(event) => setDraft({ ...draft, contractNumber: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="fsBasePoNumber">Base PO number</Label>
              <Input
                id="fsBasePoNumber"
                value={draft.basePoNumber}
                onChange={(event) => setDraft({ ...draft, basePoNumber: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="fsPerformancePoNumber">Performance PO number</Label>
              <Input
                id="fsPerformancePoNumber"
                value={draft.performancePoNumber}
                onChange={(event) =>
                  setDraft({ ...draft, performancePoNumber: event.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="fsFiduciaryName">Fiduciary name</Label>
              <Input
                id="fsFiduciaryName"
                value={draft.fiduciaryName}
                onChange={(event) => setDraft({ ...draft, fiduciaryName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="fsContractValue">Total contract value</Label>
              <MoneyInput
                id="fsContractValue"
                value={draft.contractValue}
                onChange={(event) => setDraft({ ...draft, contractValue: event.target.value })}
              />
              <Helper>Leave at 0.00 to use the sum of scheduled values.</Helper>
            </div>
            <div>
              <Label htmlFor="fsAdvancesReceived">Advances received</Label>
              <MoneyInput
                id="fsAdvancesReceived"
                value={draft.advancesReceived}
                onChange={(event) =>
                  setDraft({ ...draft, advancesReceived: event.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="fsContractStart">Contract start</Label>
              <Input
                id="fsContractStart"
                type="date"
                value={draft.contractStart}
                onChange={(event) => setDraft({ ...draft, contractStart: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="fsContractEnd">Contract end</Label>
              <Input
                id="fsContractEnd"
                type="date"
                value={draft.contractEnd}
                onChange={(event) => setDraft({ ...draft, contractEnd: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2.5 mt-5">
            <label className="flex items-center gap-2.5 text-[15px] text-ink cursor-pointer">
              <input
                type="checkbox"
                className="w-[18px] h-[18px] accent-accent"
                checked={draft.taxReimbursable}
                onChange={(event) => setDraft({ ...draft, taxReimbursable: event.target.checked })}
              />
              Does this funder reimburse sales tax?
            </label>
            <label className="flex items-center gap-2.5 text-[15px] text-ink cursor-pointer">
              <input
                type="checkbox"
                className="w-[18px] h-[18px] accent-accent"
                checked={draft.feesReimbursable}
                onChange={(event) =>
                  setDraft({ ...draft, feesReimbursable: event.target.checked })
                }
              />
              Does this funder reimburse fees?
            </label>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="quiet" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={onSave}>
              Save
            </Button>
          </div>
        </div>
  );
}

/* ------------------------------------------------------------------ lists */

function LabelList({
  title,
  kind,
  rows,
  pending,
  run,
}: {
  title: string;
  kind: "paymentSource" | "supportingDocType";
  rows: LabelRow[];
  pending: boolean;
  run: (
    work: () => Promise<ActionResult<unknown>>,
    successMessage: string,
    onDone?: () => void,
  ) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState("");

  return (
    <div>
      <div className="text-[13px] uppercase tracking-[0.06em] text-sub font-bold mb-2">
        {title}
      </div>

      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center gap-3.5 justify-between py-2.5 border-t border-line"
        >
          {editingId === row.id ? (
            <>
              <Input
                value={draft}
                aria-label={`Rename ${row.label}`}
                onChange={(event) => setDraft(event.target.value)}
                className="flex-1"
              />
              <Button
                variant="secondary"
                className="min-h-11 px-3 text-[15px]"
                disabled={pending}
                onClick={() => {
                  run(() => saveLabelAction({ kind, id: row.id, label: draft }), "Label saved");
                  setEditingId(null);
                }}
              >
                Save
              </Button>
              <Button variant="quiet" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <div className={row.active ? "text-base" : "text-base text-sub line-through"}>
                {row.label}
              </div>
              <div className="flex items-center gap-3.5">
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => setLabelActiveAction({ kind, id: row.id, active: !row.active }),
                      row.active ? "Deactivated" : "Reactivated",
                    )
                  }
                >
                  {row.active ? "Deactivate" : "Reactivate"}
                </Button>
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() => {
                    setEditingId(row.id);
                    setDraft(row.label);
                  }}
                >
                  Edit
                </Button>
              </div>
            </>
          )}
        </div>
      ))}

      <div className="flex gap-3 mt-4">
        <Input
          value={adding}
          placeholder="New label"
          aria-label={`Add to ${title}`}
          onChange={(event) => setAdding(event.target.value)}
        />
        <Button
          variant="secondary"
          className="min-h-11 px-4 text-[15px] whitespace-nowrap"
          disabled={pending || adding.trim() === ""}
          onClick={() => {
            run(() => saveLabelAction({ kind, label: adding }), "Added");
            setAdding("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- vendor library */

/**
 * A short, unfiltered preview (however many rows the caller passes — see /settings/vendors,
 * which sends the first few). The full, searchable, paginated library is its own screen: a
 * library that grows for months would otherwise mean loading every vendor on every visit to
 * Settings just to show three of them.
 */
function VendorLibrary({
  vendors,
  vendorCount,
  lineItems,
  paymentSources,
  pending,
  run,
}: {
  vendors: Vendor[];
  vendorCount: number;
  lineItems: Array<{ id: string; name: string }>;
  paymentSources: LabelRow[];
  pending: boolean;
  run: (work: () => Promise<ActionResult<unknown>>, successMessage: string) => void;
}) {
  return (
    <div>
      <VendorTable
        vendors={vendors}
        lineItems={lineItems}
        paymentSources={paymentSources}
        pending={pending}
        run={run}
        emptyMessage="No vendors learned yet — they appear as you save expenses."
      />

      {vendorCount > vendors.length && (
        <div className="mt-4">
          <Link href="/r/settings/vendors" className={buttonClassName("secondary")}>
            Show all {vendorCount} vendors
          </Link>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- account */

function AccountSection({
  email,
  pending,
  startTransition,
}: {
  email: string;
  pending: boolean;
  startTransition: (callback: () => void) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} readOnly className="bg-section text-sub" />
        </div>
        <div>
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <Helper>At least 12 characters.</Helper>
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>
      </div>

      {error && (
        <DangerPanel tone="notice" className="mt-4">
          {error}
        </DangerPanel>
      )}

      <Helper className="mt-4">
        Changing your password signs out every other device.
      </Helper>

      <div className="flex justify-end mt-4">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await changePasswordAction({
                currentPassword: current,
                newPassword: next,
                confirmPassword: confirm,
              });
              if (reportResult(result, "Password changed — other devices signed out")) {
                setCurrent("");
                setNext("");
                setConfirm("");
              } else {
                setError(result.error);
              }
            })
          }
        >
          Change password
        </Button>
      </div>
    </div>
  );
}
