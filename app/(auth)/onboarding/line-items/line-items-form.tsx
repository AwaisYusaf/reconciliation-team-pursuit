"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/src/components/ui/button";
import { Input, MoneyInput } from "@/src/components/ui/field";
import { DangerPanel } from "@/src/components/ui/surfaces";
import { Td, Th } from "@/src/components/ui/table";
import { formatMoney } from "@/src/domain/format";
import { parseMoneyToCents } from "@/src/domain/money";
import { IDLE } from "@/src/lib/action-result";
import { saveOnboardingLineItemsAction } from "@/src/modules/auth/actions";

type Row = { name: string; budget: string };

export function OnboardingLineItemsForm({ initialRows }: { initialRows: Row[] }) {
  const [state, setState] = useState(IDLE);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(initialRows);

  const error = state.ok ? null : state.error;

  // The running total is computed with the same parser the server uses, so what the
  // user sees here is exactly what gets stored.
  const totalCents = rows.reduce((sum, row) => sum + (parseMoneyToCents(row.budget) ?? 0), 0);
  const canContinue = rows.some((row) => row.name.trim() !== "" && (parseMoneyToCents(row.budget) ?? 0) > 0);

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // A plain onSubmit (rather than a `<form action>`) so a rejected submission never triggers
  // React's automatic form reset — that reset fires whenever the action resolves, including
  // on a validation failure, and was wiping every typed row over one bad entry.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await saveOnboardingLineItemsAction(state, formData));
    });
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <DangerPanel className="mb-5">{error}</DangerPanel>}

      <div className="border border-line rounded-[3px] overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse bg-surface">
          <thead>
            <tr>
              <Th>Line item</Th>
              <Th align="right" className="w-[220px]">
                Budget
              </Th>
              <Th align="right" className="w-[110px]">
                Remove
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <Td className="py-2.5!">
                  <Input
                    name="lineItemName"
                    value={row.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    aria-label={`Line item ${index + 1} name`}
                    placeholder="Line item name"
                  />
                </Td>
                <Td className="py-2.5!">
                  <MoneyInput
                    name="lineItemBudget"
                    value={row.budget}
                    onChange={(event) => update(index, { budget: event.target.value })}
                    aria-label={`Line item ${index + 1} budget`}
                    placeholder="0.00"
                  />
                </Td>
                <Td align="right" className="py-2.5!">
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    className="py-2.5 text-[15px] text-accent underline hover:text-accent-dark"
                  >
                    Remove
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mt-5">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setRows((current) => [...current, { name: "", budget: "" }])}
        >
          Add line item
        </Button>
        <div className="text-base font-bold tabular-nums text-ink">
          Total budget: {formatMoney(totalCents)}
        </div>
      </div>

      <div className="h-6" />
      <Button type="submit" fullWidth disabled={pending || !canContinue}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
