/**
 * TEMPLATE for a throwaway review probe. Copy to
 *   src/modules/<module>/zz-review-probe.integration.test.ts
 * run `npx vitest run <that path>`, then delete it. Never commit it.
 *
 * Write the bug as PASSING assertions: "1 passed" then means "reproduced".
 * vitest swallows console.log, so do not rely on printed output.
 */
import { config } from "dotenv";

// Server actions call these; mock them exactly like the repo's own integration tests do.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn(), requireAdmin: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

describe("review probe: <one-line claim>", async () => {
  const { db } = await import("@/src/db");
  const { organizations, users /* , expenses, lineItems, fundingSources, ... */ } = await import(
    "@/src/db/schema"
  );
  const { createTestOrg } = await import("@/src/db/test-org"); // org + its first funding source
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { actionSession } = await import("@/src/lib/action-session");
  // const { someAction } = await import("@/src/modules/<module>/actions");

  const session = vi.mocked(actionSession);
  const MONTH = "2099-10"; // far-future month so it never collides with real data
  let orgId = "";

  afterAll(async () => {
    // Cascades to users, funding sources, line items, expenses, audit events, month rows.
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("<the defect, stated as what happens>", async () => {
    const org = await createTestOrg({ name: "Review Probe Org", activeMonth: MONTH });
    orgId = org.orgId;

    // Audit events need a real users row (actor FK).
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `probe-${Date.now()}@example.test`,
        passwordHash: await hashPassword("probe-password-123"),
        role: "admin",
      })
      .returning({ id: users.id });

    session.mockResolvedValue({
      orgId,
      userId: user.id,
      email: "probe@example.test",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: MONTH,
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
    } as never);

    // Arrange the state, call the real action(s), then assert the WRONG outcome:
    // expect(result.ok).toBe(true);
    // expect(rowThatShouldBeUntouched.deletedAt).not.toBeNull();
    expect(true).toBe(true);
  });
});
