"use client";

/**
 * The vendor library table, shared between the Settings page's short preview (VendorLibrary
 * in settings-sections.tsx) and the full, searchable, paginated library at /settings/vendors —
 * one row-rendering and edit implementation rather than two copies that could drift apart.
 */
import { useState } from "react";

import { Button } from "@/src/components/ui/button";
import { Input, MoneyInput } from "@/src/components/ui/field";
import { Select } from "@/src/components/ui/select";
import { EmptyState } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatMoney } from "@/src/domain/format";
import type { ActionResult } from "@/src/lib/action-result";
import { deleteVendorAction, saveVendorAction } from "@/src/modules/settings/actions";

export type LabelRow = {
  id: string;
  label: string;
  active: boolean;
  /** Payment sources only: what this funder reimburses (R1.3, D-67). */
  taxReimbursable?: boolean;
  feesReimbursable?: boolean;
};

export type Vendor = {
  id: string;
  name: string;
  defaultLineItemId: string | null;
  defaultDescription: string;
  defaultPaymentSource: string | null;
  /** Null means nothing learned yet, which the table shows as "—" rather than as $0.00. */
  defaultSubtotalCents: number | null;
  defaultTaxCents: number | null;
  defaultFeesCents: number | null;
};

/**
 * A vendor being edited. The amounts become text while the inputs own them, so clearing a
 * box is expressible — it stores null again, rather than being read as zero.
 */
type VendorEdit = Vendor & { subtotal: string; tax: string; fees: string };

function toEdit(vendor: Vendor): VendorEdit {
  const text = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
  return {
    ...vendor,
    subtotal: text(vendor.defaultSubtotalCents),
    tax: text(vendor.defaultTaxCents),
    fees: text(vendor.defaultFeesCents),
  };
}

/**
 * The remembered amounts as one line, or an em dash when nothing has been learned.
 *
 * Each field is judged on its own: clearing the subtotal in this table leaves a remembered
 * tax behind, and keying the whole cell off the subtotal hid it — the value was still there,
 * still being offered on the expense form, and no longer visible anywhere.
 *
 * A zero tax or fee is real but not worth a line of its own, so it is only spelled out when
 * there is no subtotal to show instead.
 */
function rememberedAmounts(vendor: Vendor): string {
  const { defaultSubtotalCents: subtotal, defaultTaxCents: tax, defaultFeesCents: fees } = vendor;
  const parts: string[] = [];
  if (subtotal !== null) parts.push(formatMoney(subtotal));
  if (tax !== null && (tax > 0 || subtotal === null)) parts.push(`+${formatMoney(tax)} tax`);
  if (fees !== null && (fees > 0 || subtotal === null)) parts.push(`+${formatMoney(fees)} fees`);
  return parts.length > 0 ? parts.join(" ") : "—";
}

export function VendorTable({
  vendors,
  lineItems,
  paymentSources,
  pending,
  run,
  emptyMessage,
}: {
  vendors: Vendor[];
  lineItems: Array<{ id: string; name: string }>;
  paymentSources: LabelRow[];
  pending: boolean;
  run: (work: () => Promise<ActionResult<unknown>>, successMessage: string) => void;
  emptyMessage: string;
}) {
  const [editing, setEditing] = useState<VendorEdit | null>(null);

  if (vendors.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;

  return (
    <TableCard minWidth={1220}>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Default line item</Th>
          <Th>Default payment source</Th>
          <Th>Default description</Th>
          <Th align="right">Last amounts</Th>
          <Th align="right" className="w-[170px]" />
        </tr>
      </thead>
      <tbody>
        {vendors.map((vendor) => {
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
                    onValueChange={(value) =>
                      setEditing({ ...editing, defaultLineItemId: value || null })
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
                  <Select
                    value={editing.defaultPaymentSource ?? ""}
                    aria-label="Default payment source"
                    onValueChange={(value) =>
                      setEditing({ ...editing, defaultPaymentSource: value || null })
                    }
                  >
                    <option value="">None</option>
                    {/* Retired labels are not offered: R5.2 keeps them readable on the
                        records that carry them, never newly chosen. The one this vendor
                        already holds is listed so editing something else cannot silently
                        discard it. */}
                    {paymentSources
                      .filter(
                        (source) =>
                          source.active || source.label === editing.defaultPaymentSource,
                      )
                      .map((source) => (
                        <option key={source.id} value={source.label}>
                          {source.label}
                          {source.active ? "" : " (retired)"}
                        </option>
                      ))}
                  </Select>
                ) : (
                  vendor.defaultPaymentSource || "—"
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
              <Td align="right" className="text-[15px] text-sub whitespace-nowrap">
                {isEditing ? (
                  <span className="flex gap-1.5 justify-end">
                    {(["subtotal", "tax", "fees"] as const).map((field) => (
                      <MoneyInput
                        key={field}
                        value={editing[field]}
                        aria-label={`Default ${field}`}
                        placeholder={field}
                        className="w-[104px]"
                        onChange={(event) => setEditing({ ...editing, [field]: event.target.value })}
                      />
                    ))}
                  </span>
                ) : (
                  <span className="tabular-nums">{rememberedAmounts(vendor)}</span>
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
                          run(
                            () =>
                              saveVendorAction({
                                id: editing.id,
                                name: editing.name,
                                defaultLineItemId: editing.defaultLineItemId,
                                defaultDescription: editing.defaultDescription,
                                defaultPaymentSource: editing.defaultPaymentSource,
                                defaultSubtotal: editing.subtotal,
                                defaultTax: editing.tax,
                                defaultFees: editing.fees,
                              }),
                            "Vendor saved",
                          );
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
                      <Button variant="quiet" onClick={() => setEditing(toEdit(vendor))}>
                        Edit
                      </Button>
                      <Button
                        variant="quiet"
                        disabled={pending}
                        onClick={() => run(() => deleteVendorAction(vendor.id), "Vendor removed")}
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
  );
}
