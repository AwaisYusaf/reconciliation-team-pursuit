"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { Helper, Input, Label, MoneyInput, Select } from "@/src/components/ui/field";
import { Card, CARD_PADDING, DangerPanel, SectionTitle } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { reportResult } from "@/src/components/ui/toast";
import type { ActionResult } from "@/src/lib/action-result";
import {
  changePasswordAction,
  deleteVendorAction,
  saveLabelAction,
  saveVendorAction,
  setLabelActiveAction,
  updateContractAction,
  updateGrantSettingsAction,
  updateOrganisationAction,
} from "@/src/modules/settings/actions";

type LabelRow = { id: string; label: string; active: boolean };
type Vendor = {
  id: string;
  name: string;
  defaultLineItemId: string | null;
  defaultDescription: string;
};

export function SettingsSections({
  email,
  organisation,
  contract,
  grant,
  paymentSources,
  supportingDocTypes,
  vendors,
  lineItems,
}: {
  email: string;
  organisation: { name: string; docName: string };
  contract: Record<string, string>;
  grant: Record<string, string>;
  paymentSources: LabelRow[];
  supportingDocTypes: LabelRow[];
  vendors: Vendor[];
  lineItems: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [org, setOrg] = useState(organisation);
  const [contractDraft, setContractDraft] = useState(contract);
  const [grantDraft, setGrantDraft] = useState(grant);

  function run(work: () => Promise<ActionResult<unknown>>, successMessage: string) {
    startTransition(async () => {
      if (reportResult(await work(), successMessage)) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* -------------------------------------------------------- organisation */}
      <Card className={CARD_PADDING}>
        <SectionTitle className="mb-5">Organisation</SectionTitle>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Label htmlFor="orgName">Organisation name</Label>
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
            onClick={() => run(() => updateOrganisationAction(org), "Organisation saved")}
          >
            Save
          </Button>
        </div>
      </Card>

      {/* ------------------------------------------------------------ contract */}
      <Card className={CARD_PADDING}>
        <SectionTitle className="mb-5">Contract</SectionTitle>
        <div className="grid gap-5 lg:grid-cols-2">
          {[
            ["projectName", "Project name"],
            ["contractNumber", "Contract number"],
            ["basePoNumber", "Base PO number"],
            ["performancePoNumber", "Performance PO number"],
            ["fiduciaryName", "Fiduciary name"],
          ].map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={key}>{label}</Label>
              <Input
                id={key}
                value={contractDraft[key] ?? ""}
                onChange={(event) =>
                  setContractDraft({ ...contractDraft, [key]: event.target.value })
                }
              />
            </div>
          ))}
          <div>
            <Label htmlFor="contractValue">Total contract value</Label>
            <MoneyInput
              id="contractValue"
              value={contractDraft.contractValue ?? ""}
              onChange={(event) =>
                setContractDraft({ ...contractDraft, contractValue: event.target.value })
              }
            />
            <Helper>Leave at 0.00 to use the sum of scheduled values.</Helper>
          </div>
          <div>
            <Label htmlFor="contractStart">Contract start</Label>
            <Input
              id="contractStart"
              type="date"
              value={contractDraft.contractStart ?? ""}
              onChange={(event) =>
                setContractDraft({ ...contractDraft, contractStart: event.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="contractEnd">Contract end</Label>
            <Input
              id="contractEnd"
              type="date"
              value={contractDraft.contractEnd ?? ""}
              onChange={(event) =>
                setContractDraft({ ...contractDraft, contractEnd: event.target.value })
              }
            />
          </div>
        </div>
        <div className="flex justify-end mt-6">
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateContractAction({
                    projectName: contractDraft.projectName ?? "",
                    contractNumber: contractDraft.contractNumber ?? "",
                    basePoNumber: contractDraft.basePoNumber ?? "",
                    performancePoNumber: contractDraft.performancePoNumber ?? "",
                    contractValue: contractDraft.contractValue ?? "",
                    contractStart: contractDraft.contractStart ?? "",
                    contractEnd: contractDraft.contractEnd ?? "",
                    fiduciaryName: contractDraft.fiduciaryName ?? "",
                  }),
                "Contract saved",
              )
            }
          >
            Save
          </Button>
        </div>
      </Card>

      {/* ------------------------------------------ performance grant & advances */}
      <Card className={CARD_PADDING}>
        <SectionTitle className="mb-5">Performance grant &amp; advances</SectionTitle>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="perfScheduled">Performance Grant 1 scheduled value</Label>
            <MoneyInput
              id="perfScheduled"
              value={grantDraft.perfGrantScheduled ?? ""}
              onChange={(event) =>
                setGrantDraft({ ...grantDraft, perfGrantScheduled: event.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="perfBilled">Performance grant billed to date</Label>
            <MoneyInput
              id="perfBilled"
              value={grantDraft.perfGrantBilled ?? ""}
              onChange={(event) =>
                setGrantDraft({ ...grantDraft, perfGrantBilled: event.target.value })
              }
            />
            <Helper>
              Maintained manually — performance billing happens outside this system.
            </Helper>
          </div>
          <div>
            <Label htmlFor="advances">Total advances received</Label>
            <MoneyInput
              id="advances"
              value={grantDraft.advancesReceived ?? ""}
              onChange={(event) =>
                setGrantDraft({ ...grantDraft, advancesReceived: event.target.value })
              }
            />
            <Helper>Appears in the reconciliation section of the summary.</Helper>
          </div>
        </div>
        <div className="flex justify-end mt-6">
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateGrantSettingsAction({
                    perfGrantScheduled: grantDraft.perfGrantScheduled ?? "",
                    perfGrantBilled: grantDraft.perfGrantBilled ?? "",
                    advancesReceived: grantDraft.advancesReceived ?? "",
                  }),
                "Grant settings saved",
              )
            }
          >
            Save
          </Button>
        </div>
      </Card>

      {/* --------------------------------------------------------------- lists */}
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
          Renames apply to menus going forward; saved expenses keep the label they were
          entered with, which is what keeps their documents reproducible.
        </Helper>
      </Card>

      {/* ------------------------------------------------------ vendor library */}
      <Card className={CARD_PADDING}>
        <SectionTitle className="mb-5">Vendor library</SectionTitle>
        <VendorLibrary vendors={vendors} lineItems={lineItems} pending={pending} run={run} />
        <Helper className="mt-4">
          The library learns automatically every time you save an expense.
        </Helper>
      </Card>

      {/* -------------------------------------------------------------- account */}
      <Card className={CARD_PADDING}>
        <SectionTitle className="mb-5">Account</SectionTitle>
        <AccountSection email={email} pending={pending} startTransition={startTransition} />
      </Card>
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
  run: (work: () => Promise<ActionResult<unknown>>, successMessage: string) => void;
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

function VendorLibrary({
  vendors,
  lineItems,
  pending,
  run,
}: {
  vendors: Vendor[];
  lineItems: Array<{ id: string; name: string }>;
  pending: boolean;
  run: (work: () => Promise<ActionResult<unknown>>, successMessage: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Vendor | null>(null);

  const visible = vendors.filter((vendor) =>
    vendor.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div>
      <div className="max-w-[360px] mb-5">
        <Label htmlFor="vendorSearch">Search vendors</Label>
        <Input
          id="vendorSearch"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {vendors.length === 0 ? (
        <Helper>No vendors learned yet — they appear as you save expenses.</Helper>
      ) : (
        <TableCard minWidth={800}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Default line item</Th>
              <Th>Default description</Th>
              <Th align="right" className="w-[170px]" />
            </tr>
          </thead>
          <tbody>
            {visible.map((vendor) => {
              const isEditing = editing?.id === vendor.id;
              return (
                <tr key={vendor.id}>
                  <Td>
                    {isEditing ? (
                      <Input
                        value={editing.name}
                        aria-label="Vendor name"
                        onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                      />
                    ) : (
                      vendor.name
                    )}
                  </Td>
                  <Td>
                    {isEditing ? (
                      <Select
                        value={editing.defaultLineItemId ?? ""}
                        aria-label="Default line item"
                        onChange={(event) =>
                          setEditing({ ...editing, defaultLineItemId: event.target.value || null })
                        }
                      >
                        <option value="">None</option>
                        {lineItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      lineItems.find((item) => item.id === vendor.defaultLineItemId)?.name ?? "—"
                    )}
                  </Td>
                  <Td className="text-[15px] text-sub leading-snug">
                    {isEditing ? (
                      <Input
                        value={editing.defaultDescription}
                        aria-label="Default description"
                        onChange={(event) =>
                          setEditing({ ...editing, defaultDescription: event.target.value })
                        }
                      />
                    ) : (
                      vendor.defaultDescription || "—"
                    )}
                  </Td>
                  <Td align="right">
                    <div className="flex gap-4 justify-end">
                      {isEditing ? (
                        <>
                          <Button
                            variant="secondary"
                            className="min-h-11 px-3 text-[15px]"
                            disabled={pending}
                            onClick={() => {
                              run(() => saveVendorAction(editing), "Vendor saved");
                              setEditing(null);
                            }}
                          >
                            Save
                          </Button>
                          <Button variant="quiet" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="quiet" onClick={() => setEditing(vendor)}>
                            Edit
                          </Button>
                          <Button
                            variant="quiet"
                            disabled={pending}
                            onClick={() =>
                              run(() => deleteVendorAction(vendor.id), "Vendor removed")
                            }
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableCard>
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
