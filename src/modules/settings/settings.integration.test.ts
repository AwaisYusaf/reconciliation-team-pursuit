/**
 * Settings rules against a real database (m09).
 *
 * The actions themselves need a request context, so what is exercised here is the
 * behaviour that has to hold in the data: label uniqueness, the deactivation rule that
 * keeps history readable, and password hashing with session revocation.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("settings (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, paymentSources, sessions, supportingDocTypes, users } = await import(
    "@/src/db/schema"
  );
  const { activePaymentSources, isKnownPaymentSource, isKnownSupportingDocType } = await import(
    "./labels"
  );
  const { createSession, deleteOtherSessions } = await import("@/src/services/auth/store");
  const { hashPassword, verifyPassword } = await import("@/src/services/auth/passwords");

  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Settings Org", docName: "Settings", activeMonth: "2026-02" })
      .returning({ id: organizations.id });
    orgId = org.id;

    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `settings-${Date.now()}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
      })
      .returning({ id: users.id });
    userId = user.id;

    await db.insert(paymentSources).values([
      { orgId, label: "Paid by us, reimbursement requested", sortOrder: 0 },
      { orgId, label: "Invoiced to fiduciary in advance", sortOrder: 1 },
    ]);
    await db.insert(supportingDocTypes).values([{ orgId, label: "Check copy", sortOrder: 0 }]);
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("offers only active labels", async () => {
    expect(await activePaymentSources(orgId)).toEqual([
      "Paid by us, reimbursement requested",
      "Invoiced to fiduciary in advance",
    ]);

    await db
      .update(paymentSources)
      .set({ active: false })
      .where(
        and(
          eq(paymentSources.orgId, orgId),
          eq(paymentSources.label, "Invoiced to fiduciary in advance"),
        ),
      );

    expect(await activePaymentSources(orgId)).toEqual(["Paid by us, reimbursement requested"]);
  });

  it("refuses a label the organisation does not offer, so it cannot reach a document", async () => {
    expect(await isKnownPaymentSource(orgId, "Paid by us, reimbursement requested")).toBe(true);
    expect(await isKnownPaymentSource(orgId, "Anything I Like")).toBe(false);
    // A deactivated label is no longer selectable either.
    expect(await isKnownPaymentSource(orgId, "Invoiced to fiduciary in advance")).toBe(false);
  });

  it("refuses an unknown supporting document type", async () => {
    expect(await isKnownSupportingDocType(orgId, "Check copy")).toBe(true);
    expect(await isKnownSupportingDocType(orgId, "Forged Label")).toBe(false);
  });

  it("rejects a duplicate label case-insensitively at the database", async () => {
    const duplicate = db
      .insert(paymentSources)
      .values({ orgId, label: "PAID BY US, REIMBURSEMENT REQUESTED", sortOrder: 9 });

    await expect(duplicate).rejects.toThrow();
  });

  it("changing a password revokes every other session but keeps the caller's", async () => {
    const mine = await createSession(userId);
    await createSession(userId);
    await createSession(userId);

    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(3);

    await db
      .update(users)
      .set({ passwordHash: await hashPassword("a-replacement-password") })
      .where(eq(users.id, userId));
    await deleteOtherSessions(userId, mine);

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(remaining).toHaveLength(1);

    const [user] = await db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId));
    expect(await verifyPassword(user.hash, "a-replacement-password")).toBe(true);
    expect(await verifyPassword(user.hash, "original-password-here")).toBe(false);
  });
});
