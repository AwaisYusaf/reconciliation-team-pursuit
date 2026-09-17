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

  async function runScript(script: string, args: string[], extraEnv: Record<string, string> = {}) {
    try {
      const { stdout } = await run("npx", ["tsx", "--conditions=react-server", script, ...args], {
        cwd: process.cwd(),
        env: { ...process.env, ...extraEnv },
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

  /* ----------------------------------------- the deploy path (--skip-existing + env vars) */

  it("--skip-existing with no STAFF_EMAIL does nothing and exits 0", async () => {
    const result = await runScript("src/db/create-staff.ts", ["--skip-existing"], { STAFF_EMAIL: "" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No STAFF_EMAIL configured/);
  }, 30_000);

  it("--skip-existing creates the account from the environment without printing the password", async () => {
    const email = `create-staff-deploy-${Date.now()}@example.test`;
    createdStaffEmails.push(email);

    const result = await runScript("src/db/create-staff.ts", ["--skip-existing"], {
      STAFF_EMAIL: email,
      STAFF_NAME: "Deploy Created",
      STAFF_PASSWORD: "a-configured-password-1",
    });
    expect(result.exitCode).toBe(0);
    // The deploy log must not carry a password someone already knows.
    expect(result.stdout).not.toMatch(/Password \(shown once/);
    expect(result.stdout).not.toContain("a-configured-password-1");

    const [row] = await db
      .select({ name: staffUsers.name, passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(eq(staffUsers.email, email));
    expect(row.name).toBe("Deploy Created");
    expect(await verifyPassword(row.passwordHash, "a-configured-password-1")).toBe(true);
  }, 30_000);

  it("a second --skip-existing run leaves the account and its password untouched", async () => {
    const email = `create-staff-redeploy-${Date.now()}@example.test`;
    createdStaffEmails.push(email);

    const first = await runScript("src/db/create-staff.ts", ["--skip-existing"], {
      STAFF_EMAIL: email,
      STAFF_NAME: "Original Name",
      STAFF_PASSWORD: "the-original-password-1",
    });
    expect(first.exitCode).toBe(0);

    const [before] = await db
      .select({ passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(eq(staffUsers.email, email));

    // A redeploy with a different password in .env: the account must NOT be reset to it,
    // since db:reset-password is the only lever that changes a live password.
    const second = await runScript("src/db/create-staff.ts", ["--skip-existing"], {
      STAFF_EMAIL: email.toUpperCase(),
      STAFF_NAME: "Changed Name",
      STAFF_PASSWORD: "a-different-password-12",
    });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toMatch(/already exists — left unchanged/);

    const rows = await db
      .select({ name: staffUsers.name, passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(eq(staffUsers.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Original Name");
    expect(rows[0].passwordHash).toBe(before.passwordHash);
    expect(await verifyPassword(rows[0].passwordHash, "the-original-password-1")).toBe(true);
  }, 60_000);

  it("--skip-existing with a blank STAFF_PASSWORD refuses to invent one, and creates nothing", async () => {
    const email = `create-staff-nopass-${Date.now()}@example.test`;

    // A `.env` line that exists but is empty arrives as "", not undefined. Generating a
    // password here would mean printing it, and the only place that output goes is the deploy
    // log — so the deploy path refuses instead.
    const result = await runScript("src/db/create-staff.ts", ["--skip-existing"], {
      STAFF_EMAIL: email,
      STAFF_NAME: "No Password",
      STAFF_PASSWORD: "",
    });
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr ?? ""}`).toMatch(/STAFF_PASSWORD/);
    expect(result.stdout).not.toMatch(/Password \(shown once/);

    const rows = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, email));
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("a whitespace-only STAFF_PASSWORD is treated as unset, not as a password", async () => {
    const email = `create-staff-spaces-${Date.now()}@example.test`;

    // `"   "` is a `.env` line someone left half-typed. Treated as a real password it reaches
    // the policy check and fails the deploy with a confusing "too short" instead of the
    // message that says what to set.
    const result = await runScript("src/db/create-staff.ts", ["--skip-existing"], {
      STAFF_EMAIL: email,
      STAFF_NAME: "Whitespace Password",
      STAFF_PASSWORD: "   ",
    });
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr ?? ""}`).toMatch(/STAFF_PASSWORD/);

    const rows = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, email));
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("a blank STAFF_PASSWORD on a redeploy is fine: the existing account is left alone, not refused", async () => {
    const email = `create-staff-blankpass-${Date.now()}@example.test`;
    createdStaffEmails.push(email);

    const create = await runScript("src/db/create-staff.ts", ["--email", email, "--name", "Already Here", "--password", "the-original-password-1"]);
    expect(create.exitCode).toBe(0);

    // Existence is checked before anything to do with the password, so an empty one on a
    // redeploy is a no-op rather than a failed deploy step.
    const redeploy = await runScript("src/db/create-staff.ts", ["--skip-existing"], {
      STAFF_EMAIL: email,
      STAFF_NAME: "Already Here",
      STAFF_PASSWORD: "",
    });
    expect(redeploy.exitCode).toBe(0);
    expect(redeploy.stdout).toMatch(/already exists — left unchanged/);

    const [row] = await db
      .select({ passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(eq(staffUsers.email, email));
    expect(await verifyPassword(row.passwordHash, "the-original-password-1")).toBe(true);
  }, 60_000);

  it("run by hand with a blank STAFF_PASSWORD in the environment: generates one rather than failing the policy check", async () => {
    const email = `create-staff-blankenv-${Date.now()}@example.test`;
    createdStaffEmails.push(email);

    // An empty STAFF_PASSWORD is "not set", not "the empty password". Passing "" through to
    // the policy check refused to create an account an operator was creating by hand, because
    // of a variable they never meant to supply.
    const result = await runScript("src/db/create-staff.ts", ["--email", email, "--name", "Blank Env"], {
      STAFF_PASSWORD: "",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Password \(shown once/);

    const passwordMatch = result.stdout.match(/Password \(shown once[^\n]*\n\n\s*(\S+)/);
    expect(passwordMatch).not.toBeNull();

    const [row] = await db
      .select({ passwordHash: staffUsers.passwordHash })
      .from(staffUsers)
      .where(eq(staffUsers.email, email));
    expect(await verifyPassword(row.passwordHash, passwordMatch![1])).toBe(true);
  }, 30_000);

  it("--skip-existing still refuses an email that belongs to a customer", async () => {
    const result = await runScript("src/db/create-staff.ts", ["--skip-existing"], {
      STAFF_EMAIL: customerEmail,
      STAFF_NAME: "Should Not Be Staff",
      STAFF_PASSWORD: "a-configured-password-1",
    });
    expect(result.exitCode).not.toBe(0);

    const rows = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, customerEmail));
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
