/**
 * PHASE-16 I-9 / I-16 (integration, real Postgres): no free use at every entry point (§4.7).
 *
 * I-9 (billing on, unpaid org): an action from several modules, every download route and a
 * files route, a page render, and a shared link all refuse; allow-listed entries still work.
 * I-16 (billing unset): the same organisation passes every one of those guards exactly as it
 * did before this phase, and a shared link still obeys the old `subscription_status` rule.
 *
 * Real cookie-backed sessions, same mocking approach as `action-session.staff.integration.test.ts`:
 * `next/headers` is faked with an in-memory cookie jar and `next/navigation`'s `redirect()`
 * throws a sentinel the tests can assert on.
 *
 * Skipped when DATABASE_URL is absent.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("next/headers", () => {
  let cookieValue: string | undefined;
  return {
    cookies: async () => ({
      get: (name: string) => (name === "session" && cookieValue !== undefined ? { name, value: cookieValue } : undefined),
      set: (name: string, value: string) => {
        if (name === "session") cookieValue = value;
      },
      delete: (name: string) => {
        if (name === "session") cookieValue = undefined;
      },
    }),
    headers: async () => ({ get: () => null }),
    __setSessionCookie: (value: string | undefined) => {
      cookieValue = value;
    },
  };
});

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("no free use at every entry point (I-9, I-16)", async () => {
  const { db } = await import("@/src/db");
  const { generatedArtifacts, organizations, sharedLinks, users } = await import("@/src/db/schema");
  const { createTestOrg, setBillingCopy } = await import("@/src/db/test-org");
  // Random per run: fixed tokens hit the global unique index after any run that died before cleanup.
  const { generateShareToken } = await import("@/src/modules/sharing/token");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { startSession, endSession } = await import("@/src/services/auth/session");
  const nextHeaders = (await import("next/headers")) as unknown as {
    __setSessionCookie: (v: string | undefined) => void;
  };
  const { UI } = await import("@/src/domain/strings");
  const { createExpenseAction } = await import("@/src/modules/expenses/actions");
  const {
    setActiveMonthAction,
    signUpAction,
    signInAction,
    saveOnboardingLineItemsAction,
    completeOnboardingAction,
  } = await import("@/src/modules/auth/actions");
  const { planPageSession } = await import("@/src/lib/page-session");
  const { todayIso } = await import("@/src/domain/dates");
  const { saveLabelAction, changePasswordAction } = await import("@/src/modules/settings/actions");
  const { listOrgUsersAction, setUserNameAction } = await import("@/src/modules/users/actions");
  const { loadPublicShare } = await import("@/src/modules/sharing/public");
  const { stopSharedLinkAction } = await import("@/src/modules/sharing/actions");
  const { deleteRecurringItemAction } = await import("@/src/modules/recurring/actions");
  const { deleteLineItemAction } = await import("@/src/modules/line-items/actions");
  const { saveSummaryAction } = await import("@/src/modules/monthly-summary/actions");
  const { markMonthSubmittedAction } = await import("@/src/modules/packet/actions");
  const { completeTourAction } = await import("@/src/modules/tours/actions");
  const { discardDraftAction } = await import("@/src/modules/expense-imports/draft-actions");
  const { updateFundingSourceAction } = await import("@/src/modules/funding-sources/actions");
  const { GET: downloadSummary } = await import("@/app/api/downloads/summary/route");
  const { GET: downloadPacket } = await import("@/app/api/downloads/packet/route");
  const { GET: downloadCoverSheet } = await import("@/app/api/downloads/cover-sheet/route");
  const { GET: downloadMonthlySummary } = await import("@/app/api/downloads/monthly-summary/route");
  const { POST: createSharedLink } = await import("@/app/api/shared-links/create/route");
  const { GET: fileRoute } = await import("@/app/api/files/[id]/route");
  const { GET: avatarGet } = await import("@/app/api/me/avatar/route");
  const { NextRequest } = await import("next/server");
  const DashboardPage = (await import("@/app/r/page")).default;

  let orgId: string;
  let sourceId: string;
  let adminId: string;
  let adminPassword: string;

  /** A minimal, directly-inserted shared link — `loadPublicShare` never touches storage, so it
   *  needs no real generation pipeline behind it.
   *
   *  Each call gets its own month: `generated_artifacts_live_uq` is one live (undownloaded)
   *  artifact per org/source/month/type, so two calls sharing a month for the same org and
   *  source would collide on that index rather than testing the guard. */
  let shareMonthCounter = 0;
  async function insertShare(token: string, subscriptionStatus: "trial" | "cancelled" = "trial") {
    shareMonthCounter += 1;
    const month = `2026-${String(shareMonthCounter).padStart(2, "0")}`;
    await db.update(organizations).set({ subscriptionStatus }).where(eq(organizations.id, orgId));
    const [artifact] = await db
      .insert(generatedArtifacts)
      .values({
        orgId,
        fundingSourceId: sourceId,
        month,
        type: "packet_pdf",
        inputsHash: "test-hash",
        s3Key: `org/${orgId}/packets/${month}.pdf`,
      })
      .returning({ id: generatedArtifacts.id });
    await db.insert(sharedLinks).values({
      orgId,
      fundingSourceId: sourceId,
      month,
      artifactType: "packet_pdf",
      artifactId: artifact.id,
      token,
      filename: "packet.pdf",
      recordsHash: "test-records-hash",
      sharedAt: new Date(),
    });
  }

  beforeAll(async () => {
    adminPassword = "correct-horse-battery-1";
    const org = await createTestOrg({ name: `No Free Use ${Date.now()}`, complimentary: false });
    orgId = org.orgId;
    sourceId = org.fundingSourceId;

    const [admin] = await db
      .insert(users)
      .values({
        orgId,
        email: `nofreeuse-admin-${Date.now()}@example.test`,
        passwordHash: await hashPassword(adminPassword),
        role: "admin",
      })
      .returning({ id: users.id });
    adminId = admin.id;
  });

  afterAll(async () => {
    if (orgId) await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  beforeEach(() => {
    nextHeaders.__setSessionCookie(undefined);
    vi.unstubAllEnvs();
  });

  describe("I-9: billing on, unpaid org", () => {
    beforeEach(() => {
      vi.stubEnv("BILLING_ENABLED", "true");
    });

    it("a plan on hold shows its Plan & billing panel on /r/plan instead of the chooser, which would only refuse", async () => {
      const { orgBilling } = await import("@/src/db/schema");
      // Stripe stopped retrying: the org is unpaid, but its plan still exists in Stripe.
      await setBillingCopy(orgId, { stripeStatus: "unpaid", syncedAt: new Date() });
      await startSession(adminId);
      try {
        const PlanPage = (await import("@/app/r/plan/page")).default;
        const page = await PlanPage({ searchParams: Promise.resolve({}) });
        expect(page.props.children.props.data).toMatchObject({
          isAdmin: true,
          view: { kind: "subscribed", paymentFailed: true, onHold: true },
        });
      } finally {
        await endSession();
        await db.delete(orgBilling).where(eq(orgBilling.orgId, orgId));
      }
    });

    it("D2: an unpaid org's admin can archive a funding source (to choose Reconciliation); a manager can't", async () => {
      const { fundingSources } = await import("@/src/db/schema");
      const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
      const { archiveFundingSourceAction } = await import("@/src/modules/funding-sources/actions");
      const [second] = await db
        .insert(fundingSources)
        .values({ orgId, name: `Second ${Date.now()}`, type: "grant", sortOrder: 1, ...ORIGINAL_RULES })
        .returning({ id: fundingSources.id });
      const [manager] = await db
        .insert(users)
        .values({ orgId, email: `nofreeuse-mgr-${Date.now()}@example.test`, passwordHash: "x", role: "manager" })
        .returning({ id: users.id });
      const archivedAt = async () =>
        (await db.select({ at: fundingSources.archivedAt }).from(fundingSources).where(eq(fundingSources.id, second.id)))[0].at;

      await startSession(manager.id);
      expect(await archiveFundingSourceAction(second.id)).toEqual({ ok: false, error: UI.billingPlanRequired });
      await endSession();
      expect(await archivedAt()).toBeNull();

      await startSession(adminId);
      expect(await archiveFundingSourceAction(second.id)).toEqual({ ok: true, data: undefined });
      await endSession();
      expect(await archivedAt()).not.toBeNull();
    });

    it("with two active sources, /r/plan disables Reconciliation with the reason and lists the sources to archive", async () => {
      const { fundingSources } = await import("@/src/db/schema");
      const { ORIGINAL_RULES } = await import("@/src/modules/expenses/reimbursement");
      const { ArchiveSources } = await import("@/app/r/plan/archive-sources");
      const { SubscribeButton } = await import("@/app/r/plan/subscribe-button");
      const [extra] = await db
        .insert(fundingSources)
        .values({ orgId, name: `Extra ${Date.now()}`, type: "grant", sortOrder: 2, ...ORIGINAL_RULES })
        .returning({ id: fundingSources.id });

      /** Every element of `type` in a rendered tree, calling render props (`actions`) on the way. */
      const find = (node: unknown, type: unknown, out: Array<{ props: Record<string, unknown> }> = []) => {
        if (Array.isArray(node)) node.forEach((child) => find(child, type, out));
        else if (node && typeof node === "object" && "props" in node) {
          const el = node as { type: unknown; props: Record<string, unknown> };
          if (el.type === type) out.push(el);
          find(el.props.children, type, out);
          if (typeof el.props.actions === "function") {
            for (const plan of ["reconciliation", "reconciliation_ai"]) find((el.props.actions as (p: string) => unknown)(plan), type, out);
          }
        }
        return out;
      };

      await startSession(adminId);
      try {
        const PlanPage = (await import("@/app/r/plan/page")).default;
        const page = await PlanPage({ searchParams: Promise.resolve({}) });
        const buttons = find(page, SubscribeButton);
        const reconciliation = buttons.find((b) => b.props.plan === "reconciliation");
        expect(reconciliation?.props.disabledReason).toMatch(/^Reconciliation includes one active funding source/);
        expect(buttons.find((b) => b.props.plan === "reconciliation_ai")?.props.disabledReason).toBeUndefined();
        expect(find(page, ArchiveSources)).toHaveLength(1);
      } finally {
        await endSession();
        await db.delete(fundingSources).where(eq(fundingSources.id, extra.id));
      }
    });

    it("an unpaid org can see its own photo but not change it: avatar POST and DELETE answer 403", async () => {
      const avatarRoute = await import("@/app/api/me/avatar/route");
      await startSession(adminId);
      try {
        const post = await avatarRoute.POST(new Request("http://localhost/api/me/avatar", { method: "POST" }));
        expect(post.status).toBe(403);
        expect(await post.json()).toEqual({ ok: false, error: UI.billingPlanRequired });
        const del = await avatarRoute.DELETE(new Request("http://localhost/api/me/avatar", { method: "DELETE" }));
        expect(del.status).toBe(403);
      } finally {
        await endSession();
      }
    });

    it("createExpenseAction (expenses module) refuses before validation even runs", async () => {
      await startSession(adminId);
      const result = await createExpenseAction({} as never);
      expect(result).toEqual({ ok: false, error: UI.billingPlanRequired });
      await endSession();
    });

    it("setActiveMonthAction (auth/shell module) refuses and writes nothing", async () => {
      await startSession(adminId);
      const before = await db.select({ m: organizations.activeMonth }).from(organizations).where(eq(organizations.id, orgId));
      const result = await setActiveMonthAction("2026-06");
      expect(result).toEqual({ ok: false, error: UI.billingPlanRequired });
      const after = await db.select({ m: organizations.activeMonth }).from(organizations).where(eq(organizations.id, orgId));
      expect(after[0].m).toBe(before[0].m);
      await endSession();
    });

    it("saveLabelAction (settings module) refuses", async () => {
      await startSession(adminId);
      const result = await saveLabelAction({ kind: "paymentSource", label: "New Source" });
      expect(result).toEqual({ ok: false, error: UI.billingPlanRequired });
      await endSession();
    });

    it("every download route (all 4) refuses with a 403 carrying the billing message", async () => {
      await startSession(adminId);
      const routes: Array<[string, (req: Request) => Promise<Response>]> = [
        ["summary", downloadSummary],
        ["packet", downloadPacket],
        ["cover-sheet", downloadCoverSheet],
        ["monthly-summary", downloadMonthlySummary],
      ];
      for (const [name, handler] of routes) {
        const response = await handler(new Request(`http://localhost/api/downloads/${name}`));
        expect(response.status, `${name} route`).toBe(403);
        expect(await response.text(), `${name} route`).toBe(UI.billingPlanRequired);
      }
      await endSession();
    });

    it("readSignedInJson route (/api/shared-links/create) refuses with a 403 JSON body", async () => {
      await startSession(adminId);
      const response = await createSharedLink(
        new NextRequest("http://localhost/api/shared-links/create", {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: UI.billingPlanRequired });
      await endSession();
    });

    it("one guarded action from every other module with a \"use server\" file refuses, writing nothing", async () => {
      await startSession(adminId);

      const bogusId = "00000000-0000-0000-0000-000000000000";

      // recurring
      expect(await deleteRecurringItemAction(bogusId)).toEqual({ ok: false, error: UI.billingPlanRequired });
      // line-items
      expect(await deleteLineItemAction(bogusId)).toEqual({ ok: false, error: UI.billingPlanRequired });
      // monthly-summary (valid shape so the billing check, not the shape check, is what refuses)
      expect(
        await saveSummaryAction({ sourceId, month: "2026-01", markdown: "x", expectedVersion: 1 }),
      ).toEqual({ ok: false, error: UI.billingPlanRequired });
      // packet
      expect(await markMonthSubmittedAction("2026-01", sourceId)).toEqual({
        ok: false,
        error: UI.billingPlanRequired,
      });
      // tours
      expect(await completeTourAction("welcome" as never)).toEqual({ ok: false, error: UI.billingPlanRequired });
      // expense-imports
      expect(await discardDraftAction(bogusId)).toEqual({ ok: false, error: UI.billingPlanRequired });
      // funding-sources (excluded from production edits in this task, but its guard is still proven here)
      expect(
        await updateFundingSourceAction({ id: bogusId, name: "x", type: "grant" } as never),
      ).toEqual({ ok: false, error: UI.billingPlanRequired });
      // sharing (a mutating action, distinct from the allow-listed read-only ones below)
      const beforeShare = await db.select({ id: sharedLinks.id }).from(sharedLinks).where(eq(sharedLinks.orgId, orgId));
      expect(await stopSharedLinkAction({ shareId: bogusId })).toEqual({ ok: false, error: UI.billingPlanRequired });
      const afterShare = await db.select({ id: sharedLinks.id }).from(sharedLinks).where(eq(sharedLinks.orgId, orgId));
      expect(afterShare).toEqual(beforeShare);
      // users (admin-only action, requireAdmin also refuses on billing before the role check runs)
      expect(await setUserNameAction(bogusId, "New Name")).toEqual({ ok: false, error: UI.billingPlanRequired });

      // admin/actions.ts is guarded by requireStaff, not actionSession/requireAdmin — staff have
      // no organization and are unaffected by *this* org's billing state, so it is intentionally
      // not exercised here (it is exempt from U-18's plan-guard check for the same reason).

      await endSession();
    });

    it("a files route refuses with a 403 carrying the billing message", async () => {
      await startSession(adminId);
      const response = await fileRoute(new Request("http://localhost/api/files/00000000-0000-0000-0000-000000000000"), {
        params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
      });
      expect(response.status).toBe(403);
      await endSession();
    });

    it("a page render (app/r/page) redirects to /r/plan without ever loading its data", async () => {
      await startSession(adminId);
      await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/r/plan");
      await endSession();
    });

    it("an existing shared link refuses to open", async () => {
      const token = generateShareToken();
      await insertShare(token, "trial");
      const share = await loadPublicShare(token);
      expect(share).toBeNull();
    });

    it("allow-listed changePasswordAction still runs (reaches its own logic, not the billing refusal)", async () => {
      await startSession(adminId);
      const result = await changePasswordAction({
        currentPassword: "definitely-the-wrong-password",
        newPassword: "irrelevant-new-password-1",
        confirmPassword: "irrelevant-new-password-1",
      });
      expect(result).toEqual({ ok: false, error: "That is not your current password." });
      await endSession();
    });

    it("allow-listed listOrgUsersAction still works and returns data", async () => {
      await startSession(adminId);
      const result = await listOrgUsersAction();
      expect(result.ok).toBe(true);
      await endSession();
    });

    it("allow-listed /api/me/avatar GET still works (404, no photo, not 403)", async () => {
      await startSession(adminId);
      const response = await avatarGet();
      expect(response.status).toBe(404);
      await endSession();
    });
  });

  describe("I-16: billing off (unset) — this organisation behaves exactly as before this phase", () => {
    beforeEach(() => {
      vi.stubEnv("BILLING_ENABLED", "false");
    });

    it("setActiveMonthAction succeeds", async () => {
      await startSession(adminId);
      const result = await setActiveMonthAction("2026-07");
      expect(result).toEqual({ ok: true });
      await endSession();
    });

    it("saveLabelAction succeeds", async () => {
      await startSession(adminId);
      const result = await saveLabelAction({ kind: "paymentSource", label: `Source ${Date.now()}` });
      expect(result.ok).toBe(true);
      await endSession();
    });

    it("listOrgUsersAction succeeds", async () => {
      await startSession(adminId);
      const result = await listOrgUsersAction();
      expect(result.ok).toBe(true);
      await endSession();
    });

    it("a page render (app/r/page) does not redirect to /r/plan", async () => {
      await startSession(adminId);
      await expect(DashboardPage()).resolves.toBeDefined();
      await endSession();
    });

    it("a shared link still obeys the old rule: 'cancelled' subscription_status refuses", async () => {
      const token = generateShareToken();
      await insertShare(token, "cancelled");
      expect(await loadPublicShare(token)).toBeNull();
    });

    it("a shared link with a healthy subscription_status still opens", async () => {
      const token = generateShareToken();
      await insertShare(token, "trial");
      expect(await loadPublicShare(token)).not.toBeNull();
    });
  });

  describe("I-10: complimentary_until, billing on (§4.2 step 3, orgEntitlement)", () => {
    let compOrgId: string;
    let compAdminId: string;

    beforeAll(async () => {
      const org = await createTestOrg({ name: `Comp Until ${Date.now()}`, complimentary: false });
      compOrgId = org.orgId;
      const [admin] = await db
        .insert(users)
        .values({
          orgId: compOrgId,
          email: `comp-until-admin-${Date.now()}@example.test`,
          passwordHash: await hashPassword(adminPassword),
          role: "admin",
        })
        .returning({ id: users.id });
      compAdminId = admin.id;
    });

    afterAll(async () => {
      if (compOrgId) await db.delete(organizations).where(eq(organizations.id, compOrgId));
    });

    beforeEach(() => {
      vi.stubEnv("BILLING_ENABLED", "true");
    });

    /** A calendar date one day before `todayIso()`, built without going through any timezone
     *  conversion (`Date.UTC` of the parsed parts is already midnight of that date). */
    function yesterdayIso(): string {
      const [y, m, d] = todayIso().split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
    }

    async function setComplimentaryUntil(value: string | null) {
      await db
        .update(organizations)
        .set({ complimentary: true, complimentaryUntil: value })
        .where(eq(organizations.id, compOrgId));
    }

    it("until today: paid — the guarded action works", async () => {
      await setComplimentaryUntil(todayIso());
      await startSession(compAdminId);
      const result = await setActiveMonthAction("2026-08");
      expect(result).toEqual({ ok: true });
      await endSession();
    });

    it("until yesterday: unpaid — the guarded action refuses and the page redirects to /r/plan", async () => {
      await setComplimentaryUntil(yesterdayIso());
      await startSession(compAdminId);
      const result = await setActiveMonthAction("2026-08");
      expect(result).toEqual({ ok: false, error: UI.billingPlanRequired });
      await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/r/plan");
      await endSession();
    });

    it("null (open-ended): paid — the guarded action works", async () => {
      await setComplimentaryUntil(null);
      await startSession(compAdminId);
      const result = await setActiveMonthAction("2026-08");
      expect(result).toEqual({ ok: true });
      await endSession();
    });
  });

  describe("I-11: unpaid then paid — nothing lost, everything works again", () => {
    let scopedOrgId: string;
    let scopedSourceId: string;
    let scopedAdminId: string;
    let scopedLineItemId: string;

    // Every table `organizations.id`-scoped, per `src/db/schema.ts` (grep `orgId: uuid("org_id")`).
    const ORG_SCOPED_TABLES = [
      "users",
      "orgAccountEvents",
      "contractSettings",
      "paymentSources",
      "supportingDocTypes",
      "fundingSources",
      "lineItems",
      "lineItemPerformances",
      "expenses",
      "expenseAuditEvents",
      "expenseDocuments",
      "monthDocuments",
      "monthStatuses",
      "monthLockEvents",
      "monthSnapshots",
      "monthSnapshotTotals",
      "vendorDefaults",
      "recurringItems",
      "expenseImports",
      "expenseDrafts",
      "expenseDraftDocuments",
      "generatedArtifacts",
      "sharedLinks",
      "aiUsageEvents",
      "monthlySummaries",
    ] as const;

    async function snapshotOrgTables(orgId: string): Promise<Record<string, { count: number; checksum: string }>> {
      const crypto = await import("node:crypto");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic table introspection
      const schemaModule = (await import("@/src/db/schema")) as unknown as Record<string, any>;
      const out: Record<string, { count: number; checksum: string }> = {};
      for (const name of ORG_SCOPED_TABLES) {
        const table = schemaModule[name];
        const rows = await db.select().from(table).where(eq(table.orgId, orgId));
        // Sorted by their own JSON so the comparison doesn't depend on a stable row order from
        // Postgres (none is guaranteed without an ORDER BY) or on every table having an `id`.
        const sorted = rows.map((r: unknown) => JSON.stringify(r)).sort();
        out[name] = {
          count: rows.length,
          checksum: crypto.createHash("md5").update(sorted.join("\n")).digest("hex"),
        };
      }
      return out;
    }

    beforeAll(async () => {
      const org = await createTestOrg({ name: `No Loss ${Date.now()}`, complimentary: false });
      scopedOrgId = org.orgId;
      scopedSourceId = org.fundingSourceId;
      const [admin] = await db
        .insert(users)
        .values({
          orgId: scopedOrgId,
          email: `no-loss-admin-${Date.now()}@example.test`,
          passwordHash: await hashPassword(adminPassword),
          role: "admin",
        })
        .returning({ id: users.id });
      scopedAdminId = admin.id;

      // Seed rows in a representative spread of org-scoped tables, not just one.
      const { lineItems, expenses, recurringItems, paymentSources: paymentSourcesTable } = await import("@/src/db/schema");
      const [item] = await db
        .insert(lineItems)
        .values({ orgId: scopedOrgId, fundingSourceId: scopedSourceId, name: "Salary", scheduledValueCents: 100_000, sortOrder: 0 })
        .returning({ id: lineItems.id });
      scopedLineItemId = item.id;
      await db.insert(expenses).values({
        orgId: scopedOrgId,
        fundingSourceId: scopedSourceId,
        lineItemId: scopedLineItemId,
        month: "2026-05",
        date: "2026-05-01",
        name: "Office supplies",
        paymentSource: "x",
        subtotalCents: 5_000,
        sortOrder: 1,
        referenceSeq: 1,
        taxReimbursable: false,
        feesReimbursable: true,
      });
      await db.insert(recurringItems).values({
        orgId: scopedOrgId,
        lineItemId: scopedLineItemId,
        name: "Rent",
        amountCents: 10_000,
        defaultPaymentSource: "x",
        sortOrder: 0,
      });
      await db.insert(paymentSourcesTable).values({ orgId: scopedOrgId, label: "Check", sortOrder: 1 });
    });

    afterAll(async () => {
      if (scopedOrgId) await db.delete(organizations).where(eq(organizations.id, scopedOrgId));
    });

    it("counts and checksums are identical before an unpaid spell, during refused writes, and after paying again", async () => {
      // Paid (complimentary by default from createTestOrg... except this org opted out, so make
      // it paid via a live Stripe status the same way `syncOrgBilling` would).
      vi.stubEnv("BILLING_ENABLED", "true");
      await setBillingCopy(scopedOrgId, { stripeStatus: "active" });

      const before = await snapshotOrgTables(scopedOrgId);

      // Flip to unpaid.
      await setBillingCopy(scopedOrgId, { stripeStatus: "canceled" });

      await startSession(scopedAdminId);
      expect(await setActiveMonthAction("2026-06")).toEqual({ ok: false, error: UI.billingPlanRequired });
      expect(await deleteLineItemAction(scopedLineItemId)).toEqual({ ok: false, error: UI.billingPlanRequired });
      expect(await createExpenseAction({} as never)).toEqual({ ok: false, error: UI.billingPlanRequired });
      await endSession();

      const duringUnpaid = await snapshotOrgTables(scopedOrgId);
      expect(duringUnpaid).toEqual(before);

      // Pay again.
      await setBillingCopy(scopedOrgId, { stripeStatus: "active" });

      const after = await snapshotOrgTables(scopedOrgId);
      expect(after).toEqual(before);

      await startSession(scopedAdminId);
      expect(await setActiveMonthAction("2026-06")).toEqual({ ok: true });
      await endSession();
    });
  });

  describe("I-12: sign-up, no free use, no redirect loop", () => {
    beforeEach(() => {
      vi.stubEnv("BILLING_ENABLED", "true");
      vi.stubEnv("SIGNUP_ENABLED", "true");
    });

    /** Every address signed up with here, so `afterAll` can delete the orgs sign-up created. */
    const signUpEmails: string[] = [];

    afterAll(async () => {
      if (signUpEmails.length === 0) return;
      const created = await db
        .select({ orgId: users.orgId })
        .from(users)
        .where(sql`lower(${users.email}) in (${sql.join(signUpEmails.map((e) => sql`lower(${e})`), sql`, `)})`);
      for (const { orgId: id } of created) await db.delete(organizations).where(eq(organizations.id, id));
    });

    function signUpForm(overrides: Record<string, string> = {}): FormData {
      const form = new FormData();
      const email = overrides.email ?? `signup-${Date.now()}-${Math.random()}@example.test`;
      signUpEmails.push(email);
      form.set("orgName", overrides.orgName ?? `Signup Org ${Date.now()}-${Math.random()}`);
      form.set("name", "New Admin");
      form.set("email", email);
      form.set("password", "correct-horse-battery-1");
      form.set("confirmPassword", "correct-horse-battery-1");
      for (const [key, value] of Object.entries(overrides)) form.set(key, value);
      return form;
    }

    it("redirects to /r/plan, preserving a valid plan/interval and dropping an invalid one", async () => {
      await expect(
        signUpAction({ ok: false, error: "" }, signUpForm({ plan: "reconciliation", interval: "month" })),
      ).rejects.toThrow("NEXT_REDIRECT:/r/plan?plan=reconciliation&interval=month");
      // `signUpAction` starts a session before it redirects; end it so the next call sees no
      // "already signed in" session and actually exercises the drop-invalid-plan path.
      await endSession();

      // Anchored so this fails if a stray query string sneaks onto the redirect — an invalid
      // plan/interval must be dropped, not merely "also matched by a substring".
      await expect(
        signUpAction({ ok: false, error: "" }, signUpForm({ plan: "not-a-real-plan", interval: "decade" })),
      ).rejects.toThrow(/^NEXT_REDIRECT:\/r\/plan$/);
      await endSession();
    });

    it("the new org's onboarding page redirects to /r/plan, and its onboarding actions refuse", async () => {
      const email = `signup-onb-${Date.now()}@example.test`;
      await expect(signUpAction({ ok: false, error: "" }, signUpForm({ email }))).rejects.toThrow("NEXT_REDIRECT:/r/plan");
      // `signUpAction` already started a session for this new admin.

      const OnboardingLineItemsPage = (await import("@/app/(auth)/onboarding/line-items/page")).default;
      await expect(OnboardingLineItemsPage()).rejects.toThrow("NEXT_REDIRECT:/r/plan");

      const lineItemForm = new FormData();
      lineItemForm.set("lineItemName", "Salary");
      lineItemForm.set("lineItemBudget", "1000.00");
      expect(await saveOnboardingLineItemsAction({ ok: false, error: "" }, lineItemForm)).toEqual({
        ok: false,
        error: UI.billingPlanRequired,
      });
      expect(await completeOnboardingAction({ ok: false, error: "" }, new FormData())).toEqual({
        ok: false,
        error: UI.billingPlanRequired,
      });

      // planPageSession never loops a still-unpaid org back through /r/plan.
      await expect(planPageSession()).resolves.toBeDefined();

      await endSession();

      // Pay, then re-check: planPageSession sends a paid, not-yet-onboarded org onward.
      const [row] = await db
        .select({ id: users.id, orgId: users.orgId })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .limit(1);
      await setBillingCopy(row.orgId, { stripeStatus: "active" });

      await startSession(row.id);
      await expect(planPageSession()).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");
      // Success redirects on to step 2 rather than returning an ActionResult — proves the action
      // itself now runs, not merely that it stopped refusing.
      await expect(saveOnboardingLineItemsAction({ ok: false, error: "" }, lineItemForm)).rejects.toThrow(
        "NEXT_REDIRECT:/onboarding/contract",
      );
      await endSession();
    });

    it("signInAction: unpaid -> /r/plan; paid, not onboarded -> /onboarding/line-items", async () => {
      const email = `signup-signin-${Date.now()}@example.test`;
      await expect(signUpAction({ ok: false, error: "" }, signUpForm({ email }))).rejects.toThrow("NEXT_REDIRECT:/r/plan");
      await endSession();

      const loginForm = (pw = "correct-horse-battery-1") => {
        const f = new FormData();
        f.set("email", email);
        f.set("password", pw);
        return f;
      };

      await expect(signInAction({ ok: false, error: "" }, loginForm())).rejects.toThrow("NEXT_REDIRECT:/r/plan");
      await endSession();

      const [row] = await db
        .select({ orgId: users.orgId })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .limit(1);
      await setBillingCopy(row.orgId, { stripeStatus: "active" });

      await expect(signInAction({ ok: false, error: "" }, loginForm())).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");
      await endSession();
    });

    it("billing off: sign-up goes straight to /onboarding/line-items", async () => {
      vi.stubEnv("BILLING_ENABLED", "false");
      await expect(signUpAction({ ok: false, error: "" }, signUpForm())).rejects.toThrow("NEXT_REDIRECT:/onboarding/line-items");
      await endSession();
    });
  });
});
