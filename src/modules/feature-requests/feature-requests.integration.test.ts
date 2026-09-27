/**
 * Feature requests against a real Postgres (PHASE-17 §7): every "Done when" line of the ticket
 * that the database and the actions decide. The actions are called directly with the customer
 * session (`actionSession`) and the staff session (`requireStaff`) mocked, as the sibling suites
 * do; the guards themselves are proven in `action-session*.test.ts` and `guard-coverage.test.ts`.
 *
 * Other feature requests may already be in the database (dev data), so every title here carries
 * this run's `TOKEN` and every list assertion searches for it.
 *
 * Skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";

vi.mock("@/src/lib/action-session", () => ({ actionSession: vi.fn(), requireStaff: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

config({ path: ".env.local", quiet: true });

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("feature requests (integration, PHASE-17)", async () => {
  const { db } = await import("@/src/db");
  const {
    featureRequestReplies,
    featureRequestStatus,
    featureRequests,
    featureRequestVotes,
    organizations,
    staffUsers,
    users,
  } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { UI } = await import("@/src/domain/strings");
  const { canShowToAll, FEATURE_REQUEST_LIST_LIMIT, FEATURE_REQUESTS_PER_DAY, ORG_FEATURE_REQUESTS_LIMIT } =
    await import("@/src/domain/feature-requests");
  const { actionSession, requireStaff } = await import("@/src/lib/action-session");
  const actions = await import("./actions");
  const staffActions = await import("./staff-actions");
  const { loadFeatureRequest, loadFeatureRequestList } = await import("./queries");
  const {
    countFeatureRequestsNeedingAttention,
    loadOrgFeatureRequests,
    loadStaffFeatureRequest,
    loadStaffFeatureRequests,
  } = await import("./staff-queries");

  const sessionMock = vi.mocked(actionSession);
  const staffMock = vi.mocked(requireStaff);

  /** Unique to this run, in every title, so lists can be narrowed to this suite's rows. */
  const TOKEN = `zfr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgIds: string[] = [];
  let staffId: string;

  type Person = { orgId: string; userId: string };

  async function makeOrg(label: string): Promise<{ orgId: string; orgName: string; people: Person[] }> {
    const orgName = `FR ${label} ${TOKEN} ${Math.random().toString(36).slice(2, 6)}`;
    const { orgId } = await createTestOrg({ name: orgName });
    orgIds.push(orgId);
    const people: Person[] = [];
    for (const name of ["Misty", "Tasha"]) {
      const [user] = await db
        .insert(users)
        .values({
          orgId,
          email: `fr-${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
          name,
          passwordHash: "not-a-real-hash",
          role: name === "Misty" ? "admin" : "manager",
        })
        .returning({ id: users.id });
      people.push({ orgId, userId: user.id });
    }
    return { orgId, orgName, people };
  }

  function as(person: Person) {
    sessionMock.mockResolvedValue({
      orgId: person.orgId,
      userId: person.userId,
      email: "e@example.test",
      role: "admin",
      orgName: "Org",
      docName: "Org",
      activeMonth: "2026-09",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    } as Awaited<ReturnType<typeof actionSession>>);
  }

  function asStaff() {
    staffMock.mockResolvedValue({ staffId, email: "staff@example.test", name: "Staff Person" });
  }

  async function suggest(person: Person, title: string, details = `Details for ${title}`) {
    as(person);
    const result = await actions.suggestFeatureAction({ title: `${title} ${TOKEN}`, details });
    if (!result.ok) throw new Error(`suggest refused: ${result.error}`);
    return result.data.id;
  }

  async function show(requestId: string, status: "considering" | "planned" | "released" | "not_planned" = "considering") {
    asStaff();
    expect((await staffActions.setFeatureRequestStatusAction({ requestId, status })).ok).toBe(true);
    expect((await staffActions.setFeatureRequestShownAction({ requestId, shown: true })).ok).toBe(true);
  }

  function list(person: Person, tab: "all" | "org" = "all", q = TOKEN) {
    return loadFeatureRequestList(person, { tab, q });
  }

  function errorCode(error: unknown): unknown {
    const code = (value: unknown) => (value as { code?: unknown } | null)?.code;
    return code(error) ?? code((error as { cause?: unknown } | null)?.cause);
  }

  let orgA: Awaited<ReturnType<typeof makeOrg>>;
  let orgB: Awaited<ReturnType<typeof makeOrg>>;
  let misty: Person;
  let tasha: Person;
  let otherCustomer: Person;

  beforeAll(async () => {
    const [staff] = await db
      .insert(staffUsers)
      .values({ email: `fr-staff-${TOKEN}@example.test`, name: "Staff Person", passwordHash: "not-a-real-hash" })
      .returning({ id: staffUsers.id });
    staffId = staff.id;
  });

  // Fresh organizations for every test: each person may send ten a day, and a shared Misty
  // would reach that part-way through the file.
  beforeEach(async () => {
    orgA = await makeOrg("A");
    orgB = await makeOrg("B");
    [misty, tasha] = orgA.people;
    [otherCustomer] = orgB.people;
  });

  afterAll(async () => {
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
    await db.delete(staffUsers).where(eq(staffUsers.id, staffId));
  });

  describe("suggesting (ticket §3)", () => {
    it("lands at the top of From your organization, waiting for review, with the author's vote", async () => {
      await suggest(misty, "Older one");
      const id = await suggest(misty, "Remind us when receipts are missing");

      const { rows } = await list(tasha, "org");
      expect(rows[0]).toMatchObject({ id, status: "waiting_for_review", votes: 1, isOwn: true, shownToAll: false });
      // The author has voted; a colleague has not.
      expect(rows[0].voted).toBe(false);
      expect((await list(misty, "org")).rows[0].voted).toBe(true);
    });

    it("takes NUL characters out rather than failing on them", async () => {
      as(misty);
      const sent = await actions.suggestFeatureAction({ title: `Nul\u0000 ${TOKEN}`, details: "a\u0000b" });
      expect(sent.ok).toBe(true);
      const id = (sent as { data: { id: string } }).data.id;
      expect(await loadFeatureRequest(misty, id)).toMatchObject({ title: `Nul ${TOKEN}`, details: "ab" });
      expect((await actions.replyToFeatureRequestAction({ requestId: id, body: "hi\u0000" })).ok).toBe(true);
    });

    it("folds the title onto one line and refuses empty or over-long fields with field errors", async () => {
      as(misty);
      const folded = await actions.suggestFeatureAction({ title: `  Two\nlines ${TOKEN} `, details: " x " });
      expect(folded.ok).toBe(true);
      const [row] = await db
        .select({ title: featureRequests.title, details: featureRequests.details })
        .from(featureRequests)
        .where(eq(featureRequests.id, (folded as { data: { id: string } }).data.id));
      expect(row).toEqual({ title: `Two lines ${TOKEN}`, details: "x" });

      expect(await actions.suggestFeatureAction({ title: "   ", details: "" })).toEqual({
        ok: false,
        error: UI.featureRequestTitleRequired,
        fieldErrors: { title: UI.featureRequestTitleRequired, details: UI.featureRequestDetailsRequired },
      });
      const long = await actions.suggestFeatureAction({ title: "t".repeat(101), details: "d".repeat(2001) });
      expect(long).toMatchObject({ ok: false, fieldErrors: { title: UI.featureRequestTooLong(100), details: UI.featureRequestTooLong(2000) } });
      expect(await actions.suggestFeatureAction({ title: 5, details: "x" } as never)).toEqual({
        ok: false,
        error: UI.requestRefused,
      });
    });
  });

  describe("who sees what (ticket §2, §4, §5; PHASE-17 P1, P8, P9)", () => {
    it("another organization can't see, open, vote on or reply to a request until it is shown to all", async () => {
      const id = await suggest(misty, "Private until shown");

      expect((await list(otherCustomer)).rows.map((r) => r.id)).not.toContain(id);
      expect(await loadFeatureRequest(otherCustomer, id)).toBeNull();
      as(otherCustomer);
      expect(await actions.setFeatureRequestVoteAction({ requestId: id, want: true })).toEqual({
        ok: false,
        error: UI.featureRequestUnavailable,
      });

      await show(id);
      expect((await list(otherCustomer)).rows.map((r) => r.id)).toContain(id);
      expect(await loadFeatureRequest(otherCustomer, id)).not.toBeNull();
    });

    it("never shows Waiting for review: the switch is refused, and the database refuses it too", async () => {
      const id = await suggest(misty, "Still waiting");
      asStaff();
      expect(await staffActions.setFeatureRequestShownAction({ requestId: id, shown: true })).toEqual({
        ok: false,
        error: UI.staffFeatureRequestShowBlocked,
      });
      const raw = await db
        .update(featureRequests)
        .set({ shownToAllAt: new Date() })
        .where(eq(featureRequests.id, id))
        .then(() => null, (error: unknown) => error);
      expect(errorCode(raw)).toBe("23514");
    });

    it("the database allows 'shown' for exactly the statuses canShowToAll allows", async () => {
      // The rule lives twice: `canShowToAll` gives the friendly refusal, the CHECK is the guarantee.
      const id = await suggest(misty, "Every status");
      for (const status of featureRequestStatus.enumValues) {
        await db.update(featureRequests).set({ status, shownToAllAt: null }).where(eq(featureRequests.id, id));
        const outcome = await db
          .update(featureRequests)
          .set({ shownToAllAt: new Date() })
          .where(eq(featureRequests.id, id))
          .then(() => "allowed", (error: unknown) => errorCode(error));
        expect(outcome, status).toBe(canShowToAll(status) ? "allowed" : "23514");
      }
    });

    it("moving a shown request to Already requested hides it again and says so", async () => {
      const id = await suggest(misty, "A duplicate");
      await show(id);
      asStaff();
      expect(await staffActions.setFeatureRequestStatusAction({ requestId: id, status: "already_requested" })).toEqual({
        ok: true,
        data: { hidden: true },
      });
      expect(await loadFeatureRequest(otherCustomer, id)).toBeNull();
      // A status that keeps it shown leaves the switch alone.
      const other = await suggest(misty, "Stays shown");
      await show(other);
      asStaff();
      expect(await staffActions.setFeatureRequestStatusAction({ requestId: other, status: "planned" })).toEqual({
        ok: true,
        data: { hidden: false },
      });
      expect((await loadStaffFeatureRequest(other))?.shownToAll).toBe(true);
    });

    it("gives another organization only the title, details, status and votes: no author, org or replies", async () => {
      const id = await suggest(misty, "Shown with a reply");
      await show(id);
      asStaff();
      await staffActions.staffReplyToFeatureRequestAction({ requestId: id, body: "Thanks, Misty." });

      const detail = await loadFeatureRequest(otherCustomer, id);
      expect(Object.keys(detail ?? {}).sort()).toEqual(["details", "id", "kind", "status", "title", "voted", "votes"]);
      expect(detail).toMatchObject({ kind: "public", status: "considering", votes: 1, voted: false });

      const row = (await list(otherCustomer)).rows.find((r) => r.id === id);
      expect(Object.keys(row ?? {}).sort()).toEqual([
        "createdAt", "details", "id", "isOwn", "shownToAll", "status", "teamReplied", "title", "voted", "votes",
      ]);
      // "Our team replied" is only ever said to the request's own organization.
      expect(row).toMatchObject({ isOwn: false, teamReplied: false, shownToAll: true });
      expect((await list(misty, "org")).rows.find((r) => r.id === id)?.teamReplied).toBe(true);
    });

    it("answers a hidden, a foreign-but-shown, a random and a malformed id the same way where it must", async () => {
      const hidden = await suggest(misty, "Hidden from B");
      const shown = await suggest(misty, "Shown to B");
      await show(shown);
      as(otherCustomer);

      const unavailable = { ok: false, error: UI.featureRequestUnavailable };
      for (const requestId of [hidden, crypto.randomUUID(), "not-a-uuid", "' or 1=1 --"]) {
        expect(await actions.setFeatureRequestVoteAction({ requestId, want: true }), requestId).toEqual(unavailable);
        expect(await actions.replyToFeatureRequestAction({ requestId, body: "hi" }), requestId).toEqual(unavailable);
        expect(await loadFeatureRequest(otherCustomer, requestId), requestId).toBeNull();
      }
      // Shown to B: B may vote, but never reply (no comments on another organization's request).
      expect(await actions.replyToFeatureRequestAction({ requestId: shown, body: "hi" })).toEqual(unavailable);
    });

    it("a vote that arrives while staff are hiding the request waits for them, then is refused", async () => {
      const id = await suggest(misty, "Hidden mid-vote");
      await show(id);
      as(otherCustomer);
      let vote: ReturnType<typeof actions.setFeatureRequestVoteAction> | undefined;
      await db.transaction(async (tx) => {
        await tx.update(featureRequests).set({ shownToAllAt: null }).where(eq(featureRequests.id, id));
        // The vote's FOR SHARE read waits on this uncommitted hide, then sees it. Without the lock
        // it would read the committed "shown" row and the vote would land.
        vote = actions.setFeatureRequestVoteAction({ requestId: id, want: true });
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(await vote).toEqual({ ok: false, error: UI.featureRequestUnavailable });
      expect((await loadStaffFeatureRequest(id))?.votes).toBe(1);
    });

    it("refuses a vote on a hidden request as unavailable even when its voting is closed", async () => {
      const id = await suggest(misty, "Released then hidden");
      await show(id, "released");
      asStaff();
      await staffActions.setFeatureRequestShownAction({ requestId: id, shown: false });
      as(otherCustomer);
      expect(await actions.setFeatureRequestVoteAction({ requestId: id, want: true })).toEqual({
        ok: false,
        error: UI.featureRequestUnavailable,
      });
    });
  });

  describe("I want this too (ticket §2)", () => {
    it("is one vote per person, set rather than toggled, and can be taken back", async () => {
      const id = await suggest(misty, "Vote on me");
      await show(id);
      as(otherCustomer);
      await actions.setFeatureRequestVoteAction({ requestId: id, want: true });
      await actions.setFeatureRequestVoteAction({ requestId: id, want: true });
      expect((await loadFeatureRequest(otherCustomer, id))?.votes).toBe(2);

      await Promise.all([1, 2, 3].map(() => actions.setFeatureRequestVoteAction({ requestId: id, want: true })));
      expect((await loadFeatureRequest(otherCustomer, id))?.votes).toBe(2);

      await actions.setFeatureRequestVoteAction({ requestId: id, want: false });
      await actions.setFeatureRequestVoteAction({ requestId: id, want: false });
      expect(await loadFeatureRequest(otherCustomer, id)).toMatchObject({ votes: 1, voted: false });

      // The author can take back their own first vote.
      as(misty);
      await actions.setFeatureRequestVoteAction({ requestId: id, want: false });
      expect((await loadFeatureRequest(misty, id))?.votes).toBe(0);
    });

    it("is closed on Released, Not planned and Already requested", async () => {
      as(tasha);
      for (const status of ["released", "not_planned", "already_requested"] as const) {
        const id = await suggest(misty, `Closed ${status}`);
        asStaff();
        await staffActions.setFeatureRequestStatusAction({ requestId: id, status });
        as(tasha);
        expect(await actions.setFeatureRequestVoteAction({ requestId: id, want: true }), status).toEqual({
          ok: false,
          error: UI.featureRequestVotingClosed,
        });
      }
    });

    it("refuses a string where the choice should be a boolean", async () => {
      const id = await suggest(misty, "Strict boolean");
      as(tasha);
      expect(await actions.setFeatureRequestVoteAction({ requestId: id, want: "false" } as never)).toEqual({
        ok: false,
        error: UI.requestRefused,
      });
    });
  });

  describe("the two tabs, their order and search (ticket §2; PHASE-17 Q1, P6)", () => {
    it("All requests: most votes first, then newest. From your organization: newest first", async () => {
      const q = `${TOKEN}order`;
      as(misty);
      const make = async (title: string) => {
        const result = await actions.suggestFeatureAction({ title: `${title} ${q}`, details: "x" });
        return (result as { data: { id: string } }).data.id;
      };
      const popular = await make("Popular");
      const older = await make("Older");
      const newer = await make("Newer");
      as(tasha);
      await actions.setFeatureRequestVoteAction({ requestId: popular, want: true });

      const all = (await loadFeatureRequestList(misty, { tab: "all", q })).rows.map((r) => r.id);
      expect(all).toEqual([popular, newer, older]);
      const own = (await loadFeatureRequestList(misty, { tab: "org", q })).rows.map((r) => r.id);
      expect(own).toEqual([newer, older, popular]);
    });

    it("the org tab shows only this organization's requests, waiting ones included; All adds others once shown", async () => {
      const mine = await suggest(misty, "Mine tabs");
      const theirs = await suggest(otherCustomer, "Theirs tabs");
      await show(theirs);
      const orgTab = (await list(misty, "org")).rows.map((r) => r.id);
      expect(orgTab).toContain(mine);
      expect(orgTab).not.toContain(theirs);
      expect((await list(misty, "all")).rows.map((r) => r.id)).toEqual(expect.arrayContaining([mine, theirs]));
    });

    it("finds every word in the title or details, % literally, and never the original wording", async () => {
      as(misty);
      const created = await actions.suggestFeatureAction({
        title: `Split receipts ${TOKEN}`,
        details: "Charge Jane Doe 50% to grant one.",
      });
      const id = (created as { data: { id: string } }).data.id;
      const find = (q: string) => loadFeatureRequestList(misty, { tab: "all", q: `${TOKEN} ${q}` });

      expect((await find("grant receipts")).rows.map((r) => r.id)).toEqual([id]);
      expect((await find("50%")).rows.map((r) => r.id)).toEqual([id]);
      expect((await find("5_%")).rows).toEqual([]);
      expect((await find("Jane")).rows.map((r) => r.id)).toEqual([id]);

      asStaff();
      expect(
        await staffActions.editFeatureRequestAction({
          requestId: id,
          title: `Split receipts ${TOKEN}`,
          details: "Charge part of it to grant one.",
        }),
      ).toEqual({ ok: true, data: undefined });
      expect((await find("Jane")).rows).toEqual([]);
    });
  });

  describe("staff (ticket §6 to §8)", () => {
    it("keeps the customer's original wording through a second edit, and refuses an edit that changes nothing", async () => {
      as(misty);
      const created = await actions.suggestFeatureAction({ title: `First words ${TOKEN}`, details: "Misty at 555-0100." });
      const id = (created as { data: { id: string } }).data.id;
      asStaff();
      await staffActions.editFeatureRequestAction({ requestId: id, title: `Second ${TOKEN}`, details: "No phone." });
      await staffActions.editFeatureRequestAction({ requestId: id, title: `Third ${TOKEN}`, details: "No phone." });

      expect(await loadStaffFeatureRequest(id)).toMatchObject({
        title: `Third ${TOKEN}`,
        details: "No phone.",
        originalTitle: `First words ${TOKEN}`,
        originalDetails: "Misty at 555-0100.",
      });
      // The customer's own organization sees the edited version too.
      expect(await loadFeatureRequest(misty, id)).toMatchObject({ title: `Third ${TOKEN}`, details: "No phone." });
      expect(
        await staffActions.editFeatureRequestAction({ requestId: id, title: `Third ${TOKEN}`, details: "No phone." }),
      ).toEqual({ ok: false, error: UI.staffFeatureRequestNothingChanged });
    });

    it("counts votes by organization, and signs staff replies as the team", async () => {
      const id = await suggest(misty, "Counted");
      await show(id);
      as(tasha);
      await actions.setFeatureRequestVoteAction({ requestId: id, want: true });
      as(otherCustomer);
      await actions.setFeatureRequestVoteAction({ requestId: id, want: true });
      asStaff();
      await staffActions.staffReplyToFeatureRequestAction({ requestId: id, body: "Three days or a week?" });
      as(misty);
      await actions.replyToFeatureRequestAction({ requestId: id, body: "Three days, please." });

      const request = await loadStaffFeatureRequest(id);
      expect(request?.votes).toBe(3);
      expect(request?.votesByOrg).toEqual([
        { orgId: orgA.orgId, orgName: orgA.orgName, votes: 2 },
        { orgId: orgB.orgId, orgName: orgB.orgName, votes: 1 },
      ]);
      expect(request?.replies.map(({ fromStaff, authorName, body }) => ({ fromStaff, authorName, body }))).toEqual([
        { fromStaff: true, authorName: null, body: "Three days or a week?" },
        { fromStaff: false, authorName: "Misty", body: "Three days, please." },
      ]);
      const [staffRow] = await db
        .select({ authorStaffId: featureRequestReplies.authorStaffId, authorUserId: featureRequestReplies.authorUserId })
        .from(featureRequestReplies)
        .where(and(eq(featureRequestReplies.requestId, id), eq(featureRequestReplies.fromStaff, true)));
      expect(staffRow).toEqual({ authorStaffId: staffId, authorUserId: null });
    });

    it("lists newest first, filters by status, attention and organization name, and clamps the page", async () => {
      const planned = await suggest(misty, "Filter planned");
      asStaff();
      await staffActions.setFeatureRequestStatusAction({ requestId: planned, status: "planned" });
      const waiting = await suggest(otherCustomer, "Filter waiting");

      const base = { q: TOKEN, status: null, attention: false };
      const everything = await loadStaffFeatureRequests(base, 1, 500);
      expect(everything.rows[0].id).toBe(waiting);

      const byStatus = await loadStaffFeatureRequests({ ...base, status: "planned" }, 1, 500);
      expect(byStatus.rows.map((r) => r.id)).toContain(planned);
      expect(byStatus.rows.every((r) => r.status === "planned")).toBe(true);

      const byOrg = await loadStaffFeatureRequests({ ...base, q: `${orgB.orgName} Filter` }, 1, 500);
      expect(byOrg.rows.map((r) => r.id)).toEqual([waiting]);

      const attention = await loadStaffFeatureRequests({ ...base, attention: true }, 1, 500);
      expect(attention.rows.map((r) => r.id)).toContain(waiting);
      expect(attention.rows.map((r) => r.id)).not.toContain(planned);

      const past = await loadStaffFeatureRequests(base, 9999, 2);
      expect(past.page).toBe(past.pageCount);
    });

    it("lists an organization's requests for its page, newest first, 50 at most", async () => {
      const { orgId, people } = await makeOrg("Card");
      await db.insert(featureRequests).values(
        Array.from({ length: ORG_FEATURE_REQUESTS_LIMIT + 1 }, (_, n) => ({
          orgId,
          authorUserId: people[0].userId,
          title: `Card ${n}`,
          details: "x",
          status: "waiting_for_review" as const,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)),
        })),
      );
      const card = await loadOrgFeatureRequests(orgId);
      expect(card.rows).toHaveLength(ORG_FEATURE_REQUESTS_LIMIT);
      expect(card.capped).toBe(true);
      expect(card.rows[0].title).toBe(`Card ${ORG_FEATURE_REQUESTS_LIMIT}`);
      expect(await loadOrgFeatureRequests("not-a-uuid")).toEqual({ rows: [], capped: false });
    });
  });

  describe("Needs attention (ticket §6, §7; PHASE-17 Q2)", () => {
    const attention = async (id: string) =>
      (await loadStaffFeatureRequests({ q: TOKEN, status: null, attention: true }, 1, 1000)).rows.some((r) => r.id === id);

    it("a new request needs attention and raises the count", async () => {
      const before = await countFeatureRequestsNeedingAttention();
      const id = await suggest(misty, "Counts");
      expect(await countFeatureRequestsNeedingAttention()).toBe(before + 1);
      expect(await attention(id)).toBe(true);
    });

    it("a staff reply clears it; the customer's reply brings it back; the next staff reply clears it", async () => {
      const id = await suggest(misty, "Conversation");
      asStaff();
      await staffActions.staffReplyToFeatureRequestAction({ requestId: id, body: "A question." });
      expect(await attention(id)).toBe(false);
      as(misty);
      await actions.replyToFeatureRequestAction({ requestId: id, body: "An answer." });
      expect(await attention(id)).toBe(true);
      asStaff();
      await staffActions.staffReplyToFeatureRequestAction({ requestId: id, body: "Thanks." });
      expect(await attention(id)).toBe(false);
    });

    it("moving off Waiting for review clears it while nobody has replied", async () => {
      const id = await suggest(misty, "Moved on");
      asStaff();
      await staffActions.setFeatureRequestStatusAction({ requestId: id, status: "considering" });
      expect(await attention(id)).toBe(false);
    });

    it("Q2: when the customer wrote last, a status change alone does not clear it", async () => {
      const id = await suggest(misty, "Customer last");
      as(misty);
      await actions.replyToFeatureRequestAction({ requestId: id, body: "One more detail." });
      asStaff();
      await staffActions.setFeatureRequestStatusAction({ requestId: id, status: "planned" });
      expect(await attention(id)).toBe(true);
    });
  });

  describe("the list's cap (PHASE-17 P7)", () => {
    it("shows the first 100 and says there were more", async () => {
      const q = `${TOKEN}cap`;
      await db.insert(featureRequests).values(
        Array.from({ length: FEATURE_REQUEST_LIST_LIMIT + 1 }, (_, n) => ({
          orgId: misty.orgId,
          authorUserId: misty.userId,
          title: `Capped ${n} ${q}`,
          details: "x",
          status: "waiting_for_review" as const,
        })),
      );
      const full = await loadFeatureRequestList(misty, { tab: "org", q });
      expect(full.rows).toHaveLength(FEATURE_REQUEST_LIST_LIMIT);
      expect(full.capped).toBe(true);
      // Exactly the limit is not "more than": one fewer row and the note goes.
      await db.delete(featureRequests).where(eq(featureRequests.title, `Capped 0 ${q}`));
      const exact = await loadFeatureRequestList(misty, { tab: "org", q });
      expect(exact.rows).toHaveLength(FEATURE_REQUEST_LIST_LIMIT);
      expect(exact.capped).toBe(false);
    });
  });

  describe("replies (ticket §4)", () => {
    it("anyone in the organization can reply, oldest first, and an empty reply is refused", async () => {
      const id = await suggest(misty, "Thread");
      as(tasha);
      expect(await actions.replyToFeatureRequestAction({ requestId: id, body: "   " })).toEqual({
        ok: false,
        error: UI.featureRequestReplyRequired,
        fieldErrors: { body: UI.featureRequestReplyRequired },
      });
      const tooLong = UI.featureRequestTooLong(2000);
      expect(await actions.replyToFeatureRequestAction({ requestId: id, body: "r".repeat(2001) })).toEqual({
        ok: false,
        error: tooLong,
        fieldErrors: { body: tooLong },
      });
      asStaff();
      expect(await staffActions.staffReplyToFeatureRequestAction({ requestId: id, body: "r".repeat(2001) })).toEqual({
        ok: false,
        error: tooLong,
        fieldErrors: { body: tooLong },
      });
      as(tasha);
      await actions.replyToFeatureRequestAction({ requestId: id, body: "First" });
      as(misty);
      await actions.replyToFeatureRequestAction({ requestId: id, body: "Second" });
      const detail = await loadFeatureRequest(misty, id);
      expect(detail?.kind).toBe("own");
      if (detail?.kind !== "own") return;
      expect(detail.replies.map((r) => [r.authorName, r.body])).toEqual([
        ["Tasha", "First"],
        ["Misty", "Second"],
      ]);
      expect(detail.authorName).toBe("Misty");
    });
  });

  describe("ten a day (ticket §3; PHASE-17 P5)", () => {
    it("refuses the eleventh with the ticket's words, counting the America/Detroit day", async () => {
      const { people } = await makeOrg("Cap");
      const [person] = people;
      const [{ midnight }] = await db.execute<{ midnight: Date }>(
        sql`select (date_trunc('day', now() at time zone 'America/Detroit') at time zone 'America/Detroit') as midnight`,
      ).then((result) => result.rows);
      const at = (seconds: number) => new Date(new Date(midnight).getTime() + seconds * 1000);
      const insert = (count: number, createdAt: Date) =>
        db.insert(featureRequests).values(
          Array.from({ length: count }, (_, n) => ({
            orgId: person.orgId,
            authorUserId: person.userId,
            title: `Cap ${n}`,
            details: "x",
            status: "waiting_for_review" as const,
            createdAt,
          })),
        );

      // A second before Detroit midnight is yesterday: none of these count.
      await insert(FEATURE_REQUESTS_PER_DAY, at(-1));
      // A second after it is today.
      await insert(FEATURE_REQUESTS_PER_DAY - 1, at(1));
      await suggest(person, "The tenth today");
      as(person);
      expect(await actions.suggestFeatureAction({ title: `Eleventh ${TOKEN}`, details: "x" })).toEqual({
        ok: false,
        error: UI.featureRequestDailyLimit,
      });
      // Someone else in the same organization has their own ten.
      await suggest(people[1], "A colleague's first");
    });

    it("lets exactly one through when two are sent at once at nine today", async () => {
      const { people } = await makeOrg("Race");
      const [person] = people;
      await db.insert(featureRequests).values(
        Array.from({ length: FEATURE_REQUESTS_PER_DAY - 1 }, (_, n) => ({
          orgId: person.orgId,
          authorUserId: person.userId,
          title: `Earlier ${n}`,
          details: "x",
          status: "waiting_for_review" as const,
        })),
      );
      as(person);

      // Deterministic rather than hoping two promises overlap (the first version of this test,
      // twelve sends at once, still passed with the lock removed). SHARE mode lets both sends
      // count but holds back their inserts, so without the per-person advisory lock both would
      // see nine and both get in. With it, the second waits for the first to commit and sees ten.
      let pending: Array<ReturnType<typeof actions.suggestFeatureAction>> = [];
      await db.transaction(async (tx) => {
        await tx.execute(sql`lock table ${featureRequests} in share mode`);
        pending = [1, 2].map((n) => actions.suggestFeatureAction({ title: `Race ${n} ${TOKEN}`, details: "x" }));
        await new Promise((resolve) => setTimeout(resolve, 500));
      });
      const results = await Promise.all(pending);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: UI.featureRequestDailyLimit }]);
    });
  });

  describe("deleting (ticket, Good to know)", () => {
    it("a removed person's requests, votes and replies stay, with no name", async () => {
      const { orgId, people } = await makeOrg("Leaver");
      const [stays, leaves] = people;
      const id = await suggest(leaves, "Left behind");
      as(leaves);
      await actions.replyToFeatureRequestAction({ requestId: id, body: "Bye." });

      await db.delete(users).where(eq(users.id, leaves.userId));

      const detail = await loadFeatureRequest(stays, id);
      expect(detail).toMatchObject({ kind: "own", authorName: null, votes: 1 });
      if (detail?.kind === "own") expect(detail.replies.map((r) => [r.authorName, r.body])).toEqual([[null, "Bye."]]);
      expect((await loadStaffFeatureRequest(id))?.orgId).toBe(orgId);
    });

    it("deleting an organization removes its requests, its votes on others' requests, and their replies", async () => {
      const a = await makeOrg("Deleted A");
      const b = await makeOrg("Deleted B");
      const aRequest = await suggest(a.people[0], "A's request");
      const bRequest = await suggest(b.people[0], "B's request");
      await show(aRequest);
      await show(bRequest);
      as(a.people[0]);
      await actions.setFeatureRequestVoteAction({ requestId: bRequest, want: true });
      await actions.replyToFeatureRequestAction({ requestId: aRequest, body: "Reply" });
      as(b.people[0]);
      await actions.setFeatureRequestVoteAction({ requestId: aRequest, want: true });

      await db.delete(organizations).where(eq(organizations.id, a.orgId));

      expect(await loadStaffFeatureRequest(aRequest)).toBeNull();
      const votesOnA = await db.select().from(featureRequestVotes).where(eq(featureRequestVotes.requestId, aRequest));
      expect(votesOnA).toEqual([]);
      const repliesOnA = await db.select().from(featureRequestReplies).where(eq(featureRequestReplies.requestId, aRequest));
      expect(repliesOnA).toEqual([]);
      // B's request keeps only B's own vote: A's vote on it went with A.
      expect((await loadStaffFeatureRequest(bRequest))?.votesByOrg).toEqual([
        { orgId: b.orgId, orgName: b.orgName, votes: 1 },
      ]);
    });
  });
});
