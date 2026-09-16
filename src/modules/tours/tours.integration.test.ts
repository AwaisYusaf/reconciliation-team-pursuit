/**
 * `hasSeenTour` / `completeTourAction` / `resetToursAction` against a real database
 * (Phase 7, D-94).
 *
 * The whole feature rests on one guarantee: tour-seen state is per **user**, never per
 * organisation. Two users in the same org must not share it (a teammate added later sees every
 * tour once, same as a brand-new sign-up), and "Show the app guide again" must only ever reset
 * the calling user's own rows. Both are the â˜… invariants this file proves. Skipped when
 * DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn() }));

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("tour progress (integration)", async () => {
  const { db } = await import("@/src/db");
  const { organizations, userTourProgress, users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { actionSession } = await import("@/src/lib/action-session");
  const { fail, SESSION_EXPIRED } = await import("@/src/lib/action-result");
  const { completeTourAction, replayTourAction, resetToursAction } = await import("./actions");
  const { hasSeenTour } = await import("./queries");

  const session = vi.mocked(actionSession);

  const createdOrgIds: string[] = [];
  afterAll(async () => {
    // Cascades through users to user_tour_progress â€” no separate cleanup needed there.
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
  });

  async function createUser(orgId: string, role: "admin" | "manager" = "admin") {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email: `tour-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: "x",
        role,
      })
      .returning({ id: users.id });
    return row.id;
  }

  function asUser(orgId: string, userId: string) {
    session.mockResolvedValue({
      orgId,
      userId,
      email: "e@example.com",
      role: "admin",
      orgName: "Org",
      docName: "Doc",
      activeMonth: "2026-02",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  }

  it("a user with no rows has not seen any tour", async () => {
    const { orgId } = await createTestOrg({ name: "Tour Org 1" });
    createdOrgIds.push(orgId);
    const userId = await createUser(orgId);

    expect(await hasSeenTour(userId, "dashboard")).toBe(false);
    expect(await hasSeenTour(userId, "add_expense")).toBe(false);
    expect(await hasSeenTour(userId, "recurring")).toBe(false);
    expect(await hasSeenTour(userId, "packet")).toBe(false);
  });

  it("completing a tour marks only that tour seen, for only that user", async () => {
    const { orgId } = await createTestOrg({ name: "Tour Org 2" });
    createdOrgIds.push(orgId);
    const userA = await createUser(orgId);
    const userB = await createUser(orgId); // same org â€” the â˜… invariant

    asUser(orgId, userA);
    const result = await completeTourAction("dashboard");
    expect(result.ok).toBe(true);

    expect(await hasSeenTour(userA, "dashboard")).toBe(true);
    // A different tour, same user: untouched.
    expect(await hasSeenTour(userA, "add_expense")).toBe(false);
    // A different user, same org, same tour: untouched â€” this is the guarantee the whole
    // "teammates added later see every tour" requirement depends on.
    expect(await hasSeenTour(userB, "dashboard")).toBe(false);
  });

  it("completing an already-completed tour is idempotent, not an error", async () => {
    const { orgId } = await createTestOrg({ name: "Tour Org 3" });
    createdOrgIds.push(orgId);
    const userId = await createUser(orgId);
    asUser(orgId, userId);

    const first = await completeTourAction("packet");
    const second = await completeTourAction("packet");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const rows = await db
      .select()
      .from(userTourProgress)
      .where(eq(userTourProgress.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it("resetting tours clears only the calling user's own rows", async () => {
    const { orgId } = await createTestOrg({ name: "Tour Org 4" });
    createdOrgIds.push(orgId);
    const userA = await createUser(orgId);
    const userB = await createUser(orgId);

    asUser(orgId, userA);
    await completeTourAction("dashboard");
    await completeTourAction("recurring");

    asUser(orgId, userB);
    await completeTourAction("dashboard");

    asUser(orgId, userA);
    const reset = await resetToursAction();
    expect(reset.ok).toBe(true);

    expect(await hasSeenTour(userA, "dashboard")).toBe(false);
    expect(await hasSeenTour(userA, "recurring")).toBe(false);
    // userB's own completion survives userA's reset â€” not an org-wide clear.
    expect(await hasSeenTour(userB, "dashboard")).toBe(true);
  });

  it("replaying one tour clears only that tour, for only that user", async () => {
    const { orgId } = await createTestOrg({ name: "Tour Org 6" });
    createdOrgIds.push(orgId);
    const userA = await createUser(orgId);
    const userB = await createUser(orgId);

    asUser(orgId, userA);
    await completeTourAction("settings");
    await completeTourAction("packet");

    asUser(orgId, userB);
    await completeTourAction("settings");

    asUser(orgId, userA);
    const replay = await replayTourAction("settings");
    expect(replay.ok).toBe(true);

    // The named tour re-arms...
    expect(await hasSeenTour(userA, "settings")).toBe(false);
    // ...and nothing else does. This is the whole difference from `resetToursAction`: the
    // (i) button must not quietly reset all nine tours.
    expect(await hasSeenTour(userA, "packet")).toBe(true);
    // Another user's copy of the same tour is untouched, same invariant as everywhere else.
    expect(await hasSeenTour(userB, "settings")).toBe(true);
  });

  it("replaying a tour that was never seen is a no-op, not an error", async () => {
    const { orgId } = await createTestOrg({ name: "Tour Org 7" });
    createdOrgIds.push(orgId);
    const userId = await createUser(orgId);
    asUser(orgId, userId);

    const result = await replayTourAction("line_items");
    expect(result.ok).toBe(true);
    expect(await hasSeenTour(userId, "line_items")).toBe(false);
  });

  it("an expired session refuses every action and writes nothing", async () => {
    const { orgId } = await createTestOrg({ name: "Tour Org 5" });
    createdOrgIds.push(orgId);
    const userId = await createUser(orgId);

    // Seeded through a live session first, so the refusals below have something they could
    // have destroyed if the guard weren't there.
    asUser(orgId, userId);
    await completeTourAction("dashboard");

    session.mockResolvedValue({ expired: fail(SESSION_EXPIRED) });

    const complete = await completeTourAction("packet");
    const reset = await resetToursAction();
    const replay = await replayTourAction("dashboard");
    expect(complete).toMatchObject({ ok: false });
    expect(reset).toMatchObject({ ok: false });
    expect(replay).toMatchObject({ ok: false });

    expect(await hasSeenTour(userId, "packet")).toBe(false);
    // Still seen â€” neither the reset nor the replay deleted anything.
    expect(await hasSeenTour(userId, "dashboard")).toBe(true);
  });
});
