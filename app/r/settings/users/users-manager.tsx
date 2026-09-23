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
import { Dialog } from "@/src/components/ui/dialog";
import { Menu, MenuItem } from "@/src/components/ui/menu";
import { Input, Label } from "@/src/components/ui/field";
import { Card, CARD_PADDING, DangerPanel, SectionTitle } from "@/src/components/ui/surfaces";
import { TableCard, Td, Th } from "@/src/components/ui/table";
import { formatDateUS, todayIso } from "@/src/domain/dates";
import { userDisplay } from "@/src/domain/user-display";
import { reportResult } from "@/src/components/ui/toast";
import type { UserRole } from "@/src/db/schema";
import {
  createOrgUserAction,
  deleteUserAccountAction,
  reinstateUserAccessAction,
  revokeUserAccessAction,
  setUserNameAction,
  setUserPasswordAction,
} from "@/src/modules/users/actions";

export type OrgUser = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  createdAt: Date;
  /** Set once an admin revoked this account; null while it is active. */
  deactivatedAt: Date | null;
  /** Whether a permanent delete would actually succeed — see `listOrgUsersAction`. */
  deletable: boolean;
};

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
          <div className="mt-1">
            Give it to the user yourself, for example by text. It can&apos;t be shown again.
          </div>
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [shownPassword, setShownPassword] = useState<{ userId: string; password: string } | null>(
    null,
  );
  // Inline row edit state — which row's name cell is swapped for an Input, and its draft value.
  /** The manager a confirmation is open for, or null. The menu closes on click, so the
   *  question has to live outside it. */
  const [confirmRevoke, setConfirmRevoke] = useState<OrgUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OrgUser | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  return (
    <Card className={CARD_PADDING}>
      {/* `gradient`, like every other heading in Settings. This one lives on its own route
          rather than in `settings-sections.tsx`, which is how it got missed. */}
      <SectionTitle gradient className="mb-5">
        Users
      </SectionTitle>

      {users.length === 0 ? (
        <p className="text-[15px] text-sub">No users yet.</p>
      ) : (
        <TableCard minWidth={640}>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Added</Th>
              <Th align="right" className="w-[240px]" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <Td>
                  {editingId === user.id ? (
                    <div className="flex gap-2 items-center">
                      <Input
                        aria-label={`Name for ${user.email}`}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        className="min-w-[160px]"
                      />
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 text-[15px]"
                        disabled={pending || editingName.trim() === ""}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await setUserNameAction(user.id, editingName);
                            if (reportResult(result, "Name updated.")) {
                              setEditingId(null);
                              router.refresh();
                            }
                          })
                        }
                      >
                        Save
                      </Button>
                      <Button variant="quiet" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <div>{userDisplay(user.name, user.email)}</div>
                      {/* When name is null the fallback above already IS the email — printing
                          it again would be redundant, so only show it alongside a real name. */}
                      {user.name?.trim() && (
                        <div className="text-[13px] text-sub">{user.email}</div>
                      )}
                    </div>
                  )}
                </Td>
                <Td className="capitalize">
                  {user.role}
                  {user.deactivatedAt && (
                    <span className="block text-[11px] uppercase tracking-[0.06em] font-bold text-danger normal-case">
                      Access removed
                    </span>
                  )}
                </Td>
                <Td>{formatDateUS(todayIso(user.createdAt))}</Td>
                <Td align="right">
                  {/*
                    One menu, so every row is the same shape whatever it offers.

                    These were four underlined links in a row, which wrapped onto two ragged
                    lines and made rows with a Delete look arbitrarily different from rows
                    without one. A menu is also the pattern the expenses table already uses for
                    per-row actions.
                  */}
                  {editingId !== user.id && (
                    <Menu label={`Actions for ${userDisplay(user.name, user.email)}`}>
                      <MenuItem
                        disabled={pending}
                        onClick={() => {
                          setEditingId(user.id);
                          setEditingName(user.name ?? "");
                        }}
                      >
                        Edit name
                      </MenuItem>

                      <MenuItem
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await setUserPasswordAction(user.id);
                            if (reportResult(result, "Password reset.")) {
                              if (result.data) {
                                setShownPassword({ userId: user.id, password: result.data.password });
                              }
                              router.refresh();
                            }
                          })
                        }
                      >
                        Reset password
                      </MenuItem>

                      {/* Managers only — an admin row offers neither, matching what the
                          actions accept, so the organisation cannot lock itself out here. */}
                      {user.role === "manager" &&
                        (user.deactivatedAt ? (
                          <MenuItem
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const result = await reinstateUserAccessAction(user.id);
                                if (reportResult(result, "Access restored.")) router.refresh();
                              })
                            }
                          >
                            Restore access
                          </MenuItem>
                        ) : (
                          <MenuItem disabled={pending} onClick={() => setConfirmRevoke(user)}>
                            Remove access
                          </MenuItem>
                        ))}

                      {/*
                        Always listed for a manager, and disabled with the reason when it would
                        fail, rather than appearing on some rows and not others. The database
                        refuses to delete anyone who has recorded anything — `actor_user_id` on
                        the audit log is NOT NULL with no cascade — so this is a real limit, not
                        a policy, and saying so is better than an unexplained gap.
                      */}
                      {user.role === "manager" && (
                        <>
                          <MenuItem
                            disabled={pending || !user.deletable}
                            onClick={() => setConfirmDelete(user)}
                          >
                            Delete account
                          </MenuItem>
                          {!user.deletable && (
                            <p className="px-3.5 pb-2.5 pt-0 m-0 text-[12px] text-sub max-w-[230px] leading-snug">
                              This account has recorded work, so it can only have its access
                              removed.
                            </p>
                          )}
                        </>
                      )}
                    </Menu>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      <Dialog
        open={confirmRevoke !== null}
        title="Remove this person's access?"
        dismissLabel="Keep it"
        onDismiss={() => setConfirmRevoke(null)}
        confirm={{
          label: "Remove access",
          disabled: pending,
          onConfirm: () => {
            const target = confirmRevoke!;
            startTransition(async () => {
              const result = await revokeUserAccessAction(target.id);
              if (reportResult(result, "Access removed.")) {
                setConfirmRevoke(null);
                router.refresh();
              }
            });
          },
        }}
      >
        {confirmRevoke &&
          `${userDisplay(confirmRevoke.name, confirmRevoke.email)} will be signed out everywhere and won't be able to sign in. Everything they recorded stays, and you can restore their access later.`}
      </Dialog>

      <Dialog
        open={confirmDelete !== null}
        title="Delete this account?"
        dismissLabel="Keep it"
        onDismiss={() => setConfirmDelete(null)}
        confirm={{
          label: "Delete account",
          disabled: pending,
          onConfirm: () => {
            const target = confirmDelete!;
            startTransition(async () => {
              const result = await deleteUserAccountAction(target.id);
              if (reportResult(result, "Account deleted.")) {
                setConfirmDelete(null);
                router.refresh();
              }
            });
          },
        }}
      >
        {confirmDelete &&
          `${userDisplay(confirmDelete.name, confirmDelete.email)} has never recorded anything, so the account can be removed completely. This can't be undone.`}
      </Dialog>

      {shownPassword && (
        <GeneratedPasswordPanel
          password={shownPassword.password}
          onDismiss={() => setShownPassword(null)}
        />
      )}

      <div className="mt-6 pt-6 border-t border-line">
        <Label htmlFor="newUserName">Add user</Label>
        <div className="flex gap-3">
          {/* "Add user" heads the pair, so each field names itself — without this the name
              input would announce as "Add user" and the email input as nothing at all. */}
          <Input
            id="newUserName"
            aria-label="Name"
            value={name}
            placeholder="Name"
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            id="newUserEmail"
            aria-label="Email"
            type="email"
            value={email}
            placeholder="name@organization.org"
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            disabled={pending || name.trim() === "" || email.trim() === ""}
            onClick={() =>
              startTransition(async () => {
                const result = await createOrgUserAction({ name, email });
                if (reportResult(result, "User added.")) {
                  setShownPassword({ userId: "new", password: result.data.password });
                  setName("");
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
