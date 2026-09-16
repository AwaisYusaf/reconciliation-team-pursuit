/**
 * `db:create-staff` and the staff fallback in `db:reset-password` (Phase 9, D-98), run as real
 * subprocesses the way an operator actually invokes them — this is the only way to prove the
 * CLI argument parsing, exit codes and stdout messaging, not just the underlying functions.
 *
 * Skipped when DATABASE_URL is absent. Slower than the rest of the suite (each case spawns
 * `tsx`); kept to the handful of cases that need a real process boundary.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("db:create-staff / db:reset-password staff fallback (subprocess, integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, staffSessions, staffUsers, users } = await import("./schema");
  const { verifyPassword } = await import("@/src/services/auth/passwords");

  let customerOrgId: string;
  let customerEmail: string;
  const createdStaffEmails: string[] = [];

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Create-Staff Script Org", docName: "Create-Staff", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    customerOrgId = org.id;
    customerEmail = `create-staff-customer-${Date.now()}@example.test`;
    await db.insert(users).values({ orgId: customerOrgId, email: customerEmail, passwordHash: "unused", role: "admin" });
  });

  afterAll(async () => {
    if (customerOrgId) await db.delete(organizations).where(eq(organizations.id, customerOrgId));
    for (const email of createdStaffEmails) {
      await db.delete(staffUsers).where(eq(staffUsers.email, email));
    }
  });

  async function runScript(script: string, args: string[]) {
    try {
      const { stdout } = await run("npx", ["tsx", "--conditions=react-server", script, ...args], {
        cwd: process.cwd(),
        env: process.env,
        shell: true,
      });
      return { exitCode: 0, stdout };
    } catch (error) {
      const err = error as { code?: number; stdout?: string; stderr?: string };
      return { exitCode: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
  }

  it("refuses a customer email: non-zero exit, no staff row created", async () => {
    const result = await runScript("src/db/create-staff.ts", [
      "--email",
      customerEmail,
      "--name",
      "Should Not Be Staff",
    ]);
    expect(result.exitCode).not.toBe(0);

    const rows = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, customerEmail));
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("creates a staff row with valid args, prints the password once, and the password verifies", async () => {
    const email = `create-staff-new-${Date.now()}@example.test`;
    createdStaffEmails.push(email);

    const result = await runScript("src/db/create-staff.ts", ["--email", email, "--name", "New Staff Person"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Password \(shown once/);

    const passwordMatch = result.stdout.match(/Password \(shown once[^\n]*\n\n\s*(\S+)/);
    expect(passwordMatch).not.toBeNull();
    const password = passwordMatch![1];

    const [row] = await db
      .select({ passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(eq(staffUsers.email, email));
    expect(row).toBeDefined();
    expect(await verifyPassword(row.passwordHash, password)).toBe(true);
  }, 30_000);

  it("refuses an existing staff email in a different case, no second row", async () => {
    const email = `create-staff-dup-${Date.now()}@example.test`;
    createdStaffEmails.push(email);

    const first = await runScript("src/db/create-staff.ts", ["--email", email, "--name", "First"]);
    expect(first.exitCode).toBe(0);

    const second = await runScript("src/db/create-staff.ts", ["--email", email.toUpperCase(), "--name", "Second"]);
    expect(second.exitCode).not.toBe(0);

    const rows = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, email));
    expect(rows).toHaveLength(1);
  }, 30_000);

  it("refuses a weak --password, no row created", async () => {
    const email = `create-staff-weak-${Date.now()}@example.test`;

    const result = await runScript("src/db/create-staff.ts", [
      "--email",
      email,
      "--name",
      "Weak Password",
      "--password",
      "short",
    ]);
    expect(result.exitCode).not.toBe(0);

    const rows = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, email));
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("db:reset-password on a staff email: new hash verifies, that staff's staff_sessions are deleted", async () => {
    const email = `create-staff-reset-${Date.now()}@example.test`;
    createdStaffEmails.push(email);

    const create = await runScript("src/db/create-staff.ts", ["--email", email, "--name", "Reset Target"]);
    expect(create.exitCode).toBe(0);

    const [staff] = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, email));
    const { createStaffSession } = await import("@/src/services/auth/store");
    await createStaffSession(staff.id);

    const reset = await runScript("src/db/reset-password.ts", ["--email", email]);
    expect(reset.exitCode).toBe(0);
    expect(reset.stdout).toMatch(/New password \(shown once/);

    const passwordMatch = reset.stdout.match(/New password \(shown once[^\n]*\n\n\s*(\S+)/);
    expect(passwordMatch).not.toBeNull();
    const newPassword = passwordMatch![1];

    const [row] = await db
      .select({ passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(eq(staffUsers.id, staff.id));
    expect(await verifyPassword(row.passwordHash, newPassword)).toBe(true);

    const remainingSessions = await db
      .select({ id: staffSessions.id })
      .from(staffSessions)
      .where(eq(staffSessions.staffUserId, staff.id));
    expect(remainingSessions).toHaveLength(0);
  }, 30_000);
});
