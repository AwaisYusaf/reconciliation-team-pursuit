"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

import { Button } from "@/src/components/ui/button";
import { ConfirmButton } from "@/src/components/ui/confirm-button";
import {
  DocumentThumbnail,
  inlineSrc,
  isPdf,
  thumbnailSrc,
  useDocumentViewer,
} from "@/src/components/ui/document-viewer";
import { EmptyState } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { reportResult } from "@/src/components/ui/toast";
import { formatMoney } from "@/src/domain/format";
import {
  permanentlyDeleteExpenseAction,
  restoreExpenseAction,
} from "@/src/modules/expenses/actions";
import type { ActionResult } from "@/src/lib/action-result";
import type { RowDocument } from "../expenses-table";

export type TrashRow = {
  id: string;
  name: string;
  lineItemName: string;
  /** Already formatted for display (`monthLabel`). */
  month: string;
  amountCents: number;
  /** Already formatted for display (`formatDateUS`). */
  deletedAt: string;
  documents: RowDocument[];
};

export function TrashTable({ rows }: { rows: TrashRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { open, viewer } = useDocumentViewer();

  const openDocuments = useCallback(
    (documents: RowDocument[], index: number) => {
      open(
        documents.map((document) => ({
          src: inlineSrc(document.id),
          filename: document.filename,
          mimeType: document.mimeType,
        })),
        index,
      );
    },
    [open],
  );

  function run(work: () => Promise<ActionResult<unknown>>, successMessage: string) {
    startTransition(async () => {
      if (reportResult(await work(), successMessage)) router.refresh();
    });
  }

  if (rows.length === 0) return <EmptyState>Nothing in the trash.</EmptyState>;

  return (
    <>
      <TableCard minWidth={980}>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Line Item</Th>
          <Th>Month</Th>
          <Th align="right">Amount</Th>
          <Th>Files</Th>
          <Th>Deleted</Th>
          <Th align="right" stickyEnd />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>{row.name}</Td>
            <Td>{row.lineItemName}</Td>
            <Td>{row.month}</Td>
            <Td align="right" numeric>
              {formatMoney(row.amountCents)}
            </Td>
            <Td>
              {row.documents.length === 0 ? (
                <span className="text-sub">No files</span>
              ) : (
                <button
                  type="button"
                  onClick={() => openDocuments(row.documents, 0)}
                  title={`Open the ${row.documents.length} document(s) attached to ${row.name}`}
                  className="flex items-center gap-2 whitespace-nowrap text-left rounded-[2px] hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <DocumentThumbnail
                    src={thumbnailSrc(row.documents[0].id, row.documents[0].mimeType)}
                    pdf={isPdf(row.documents[0].mimeType)}
                    size="sm"
                  />
                  <span className="text-base underline decoration-line underline-offset-2">
                    {row.documents.length}
                  </span>
                </button>
              )}
            </Td>
            <Td className="text-sub">{row.deletedAt}</Td>
            <Td align="right" stickyEnd className="whitespace-nowrap">
              <div className="flex gap-4 justify-end">
                <Button
                  variant="quiet"
                  disabled={pending}
                  onClick={() => run(() => restoreExpenseAction(row.id), `${row.name} restored`)}
                >
                  Restore
                </Button>
                <ConfirmButton
                  variant="quiet"
                  disabled={pending}
                  title="Delete this expense permanently?"
                  confirmLabel="Delete permanently"
                  body={
                    <>
                      <strong>{row.name}</strong> — {formatMoney(row.amountCents)}. Its attached
                      files are removed too. This cannot be undone.
                    </>
                  }
                  onConfirm={() =>
                    run(
                      () => permanentlyDeleteExpenseAction(row.id),
                      `${row.name} deleted permanently`,
                    )
                  }
                >
                  Delete permanently
                </ConfirmButton>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
      </TableCard>
      {viewer}
    </>
  );
}
