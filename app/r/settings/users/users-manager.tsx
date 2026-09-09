"use client";

/**
 * User management (RBAC phase 1, admin-only). Mirrors the settings-sections / vendor-table
 * style: a card, a table, an inline add form, toasts for feedback.
 *
 * Manager visibility of this screen is out of scope — the actions refuse server-side
 * regardless of what the page renders, which is the real boundary (D-85).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/src/components/ui/button";
import { Input, Label } from "@/src/components/ui/field";
import { Card, CARD_PADDING, DangerPanel, SectionTitle } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { reportResult } from "@/src/components/ui/toast";
import type { UserRole } from "@/src/db/schema";
import { createOrgUserAction, setUserPasswordAction } from "@/src/modules/users/actions";

export type OrgUser = { id: string; email: string; role: UserRole; createdAt: Date };

/** Shown once, right after a password is generated — never persisted anywhere. */
function GeneratedPasswordPanel({
  password,
  onDismiss,
}: {
  password: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <DangerPanel tone="notice" className="mt-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="font-bold">Password (shown once): {password}</div>
          <div className="mt-1">Hand it over out of band. It cannot be shown again.</div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="min-h-9 px-3 text-[15px]"
            onClick={async () => {
              await navigator.clipboard.writeText(password);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="quiet" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </DangerPanel>
  );
}

export function UsersManager({ users }: { users: OrgUser[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [shownPassword, setShownPassword] = useState<{ userId: string; password: string } | null>(
    null,
  );

  return (
    <Card className={CARD_PADDING}>
      <SectionTitle className="mb-5">Users</SectionTitle>

      {users.length === 0 ? (
        <p className="text-[15px] text-sub">No users yet.</p>
      ) : (
        <TableCard minWidth={640}>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Added</Th>
              <Th align="right" className="w-[160px]" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <Td>{user.email}</Td>
                <Td className="capitalize">{user.role}</Td>
                <Td>{formatDateUS(todayIso(user.createdAt))}</Td>
                <Td align="right">
                  <Button
                    variant="quiet"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setUserPasswordAction(user.id);
                        if (reportResult(result, "Password reset")) {
                          if (result.data) setShownPassword({ userId: user.id, password: result.data.password });
                          router.refresh();
                        }
                      })
                    }
                  >
                    Set password
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {shownPassword && (
        <GeneratedPasswordPanel
          password={shownPassword.password}
          onDismiss={() => setShownPassword(null)}
        />
      )}

      <div className="mt-6 pt-6 border-t border-line">
        <Label htmlFor="newUserEmail">Add user</Label>
        <div className="flex gap-3">
          <Input
            id="newUserEmail"
            type="email"
            value={email}
            placeholder="name@organization.org"
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            disabled={pending || email.trim() === ""}
            onClick={() =>
              startTransition(async () => {
                const result = await createOrgUserAction(email);
                if (reportResult(result, "User added")) {
                  setShownPassword({ userId: "new", password: result.data.password });
                  setEmail("");
                  router.refresh();
                }
              })
            }
          >
            Add
          </Button>
        </div>
      </div>
    </Card>
  );
}
