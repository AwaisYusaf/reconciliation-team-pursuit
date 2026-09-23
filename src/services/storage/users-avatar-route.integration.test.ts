/**
 * `/api/users/avatar` — a colleague's profile photo, for the places that name who did something.
 *
 * Unlike `/api/me/avatar` this one takes an identifier, so the guards are the whole story. It
 * is keyed rather than id'd, which removes the enumeration surface: the key carries a uuid, so
 * there is nothing to guess and a caller only learns one by being served a page that already
 * decided to show them that person.
 *
 * The check that does the real work is the third: the key must genuinely be some user's live
 * `avatar_key` in the caller's organisation. Without it the org prefix alone would let any
 * signed-in person pass *any* key under their own org — a receipt, a signed packet — and have
 * it streamed back, because a prefix says where an object lives, not what it is. That case is
 * the reason this file exists, and it is written so that removing the lookup fails it.
 *
 * Skipped when DATABASE_URL is absent.
 */
vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn() }));

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("colleague avatar route (integration)", async () => {
  const { db } = await import("@/src/db");
  const { users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { getSession } = await import("@/src/services/auth/session");
  const { storage } = await import("@/src/services/storage/driver");
  const { avatarKey } = await import("@/src/services/storage/keys");

  const { GET } = await import("@/app/api/users/avatar/route");

  const getSessionMock = vi.mocked(getSession);

  let orgId: string;
  let otherOrgId: string;
  /** Two colleagues in one organisation, and one person in a different one. */
  let aliceId: string;
  let bobId: string;
  let outsiderId: string;

  let bobKey: string;
  let outsiderKey: string;

  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  async function insertUser(theOrgId: string): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({
        orgId: theOrgId,
        email: `colleague-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    return row.id;
  }

  /** Give someone a real photo: an object in the store and the key on their row. */
  async function giveAvatar(theOrgId: string, userId: string): Promise<string> {
    const key = avatarKey({
      orgId: theOrgId,
      userId,
      uploadId: crypto.randomUUID(),
      mimeType: "image/png",
    });
    await storage().put({ key, body: PNG_1X1, contentType: "image/png" });
    await db.update(users).set({ avatarKey: key }).where(eq(users.id, userId));
    return key;
  }

  function signIn(userId: string, theOrgId: string) {
    getSessionMock.mockResolvedValue({
      orgId: theOrgId,
      userId,
      email: "e@example.com",
      role: "admin" as const,
      orgName: "Colleague Org",
      docName: "Colleague Org",
      activeMonth: "2091-03",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  }

  function get(key: string | null): Promise<Response> {
    const url = key === null
      ? "http://localhost/api/users/avatar"
      : `http://localhost/api/users/avatar?key=${encodeURIComponent(key)}`;
    return GET(new Request(url));
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Colleague Org" });
    orgId = org.orgId;
    const other = await createTestOrg({ name: "Other Colleague Org" });
    otherOrgId = other.orgId;

    aliceId = await insertUser(orgId);
    bobId = await insertUser(orgId);
    outsiderId = await insertUser(otherOrgId);

    bobKey = await giveAvatar(orgId, bobId);
    outsiderKey = await giveAvatar(otherOrgId, outsiderId);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    signIn(aliceId, orgId);
  });

  it("serves a colleague's photo to someone in the same organisation", async () => {
    const response = await get(bobKey);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // Private, never a shared cache: this is a photo of a person.
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_1X1);
  });

  it("refuses anyone who is not signed in", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await get(bobKey)).status).toBe(401);
  });

  it("refuses a key under the caller's own org that is not anybody's avatar", async () => {
    // The case the org-prefix check alone would wave through. A receipt lives under the same
    // `org/{orgId}/` prefix as an avatar, so without the lookup against `users.avatar_key`
    // this would stream a document back to anyone signed in to the organisation.
    const receiptKey = `org/${orgId}/expenses/${crypto.randomUUID()}/receipt.png`;
    await storage().put({ key: receiptKey, body: PNG_1X1, contentType: "image/png" });

    const response = await get(receiptKey);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("No profile photo.");

    await storage().delete(receiptKey);
  });

  it("refuses a real avatar belonging to another organisation", async () => {
    // The object exists and is genuinely somebody's avatar — just not in this org.
    await expect(storage().get(outsiderKey)).resolves.toEqual(PNG_1X1);

    const response = await get(outsiderKey);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("No profile photo.");
  });

  it("refuses a stale key after that person replaced or removed their photo", async () => {
    const oldKey = await giveAvatar(orgId, bobId);
    // Bob removes the photo; the object is still in the store but no row points at it.
    await db.update(users).set({ avatarKey: null }).where(eq(users.id, bobId));

    expect((await get(oldKey)).status).toBe(404);

    await db.update(users).set({ avatarKey: bobKey }).where(eq(users.id, bobId));
    await storage().delete(oldKey);
  });

  it("refuses a missing key, traversal and an absolute path", async () => {
    for (const key of [
      null,
      "",
      `org/${orgId}/../../etc/passwd`,
      `/org/${orgId}/users/x/avatar/y.png`,
      `org/${crypto.randomUUID()}/users/x/avatar/y.png`,
    ]) {
      const response = await get(key);
      expect(response.status, String(key)).toBe(404);
      // Always the same body: a 403 here and a 404 there is the enumeration signal the whole
      // endpoint is shaped to avoid.
      await expect(response.text(), String(key)).resolves.toBe("No profile photo.");
    }
  });

  it("404s rather than serving a broken image when the object is gone", async () => {
    const key = await giveAvatar(orgId, bobId);
    await storage().delete(key);

    expect((await get(key)).status).toBe(404);

    await db.update(users).set({ avatarKey: bobKey }).where(eq(users.id, bobId));
  });
});
