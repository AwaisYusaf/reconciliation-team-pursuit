/**
 * `/api/me/avatar` — the signed-in person's own profile photo (D-117).
 *
 * The route takes no user id anywhere, so the property worth pinning is that it can only ever
 * reach the session's own row: a second person signed in against the same organisation reads
 * and writes their own photo and never the first one's. The rest is input validation on an
 * upload endpoint — size, type, empty, missing — and the object bookkeeping around a replace,
 * which has to leave exactly one object behind.
 *
 * Drives the real route handlers against a real database and the local storage driver.
 *
 * Skipped when DATABASE_URL is absent.
 */
vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn() }));

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("profile photo route (integration, D-117)", async () => {
  const { db } = await import("@/src/db");
  const { users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { getSession } = await import("@/src/services/auth/session");
  const { storage } = await import("@/src/services/storage/driver");
  const { MAX_AVATAR_BYTES } = await import("@/src/services/storage/keys");

  // Lives here rather than beside the route because vitest only collects `src/**/*.test.ts`,
  // which is why `download-routes.integration.test.ts` sits under `src/modules/packet` too.
  const { GET, POST, DELETE } = await import("@/app/api/me/avatar/route");

  const getSessionMock = vi.mocked(getSession);

  let orgId: string;
  /** Two people in the same organisation: the route must never let one reach the other. */
  let aliceId: string;
  let bobId: string;

  async function insertUser(email: string): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({
        orgId,
        email,
        passwordHash: await hashPassword("original-password-here"),
        role: "admin",
      })
      .returning({ id: users.id });
    return row.id;
  }

  function signIn(userId: string) {
    getSessionMock.mockResolvedValue({
      orgId,
      userId,
      email: "e@example.com",
      role: "admin" as const,
      orgName: "Avatar Org",
      docName: "Avatar Org",
      activeMonth: "2091-03",
      activeFundingSourceId: null,
      onboarded: true,
      welcomeDismissed: true,
      plan: "reconciliation" as const,
    });
  }

  /** A real, decodable 1x1 PNG, so nothing here depends on the bytes being image-shaped. */
  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  function upload(bytes: Buffer, type: string): Request {
    const body = new FormData();
    body.append("file", new File([new Uint8Array(bytes)], "avatar.jpg", { type }));
    return new Request("http://localhost/api/me/avatar", { method: "POST", body });
  }

  async function avatarKeyOf(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ key: users.avatarKey })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.key ?? null;
  }

  beforeAll(async () => {
    const org = await createTestOrg({ name: "Avatar Org" });
    orgId = org.orgId;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    aliceId = await insertUser(`alice-${stamp}@example.test`);
    bobId = await insertUser(`bob-${stamp}@example.test`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("signed out", () => {
    it("refuses every method with 401 and writes nothing", async () => {
      getSessionMock.mockResolvedValue(null);

      expect((await GET()).status).toBe(401);
      expect((await POST(upload(PNG_1X1, "image/png"))).status).toBe(401);
      expect((await DELETE()).status).toBe(401);
    });
  });

  describe("input validation", () => {
    beforeEach(() => signIn(aliceId));

    it("refuses a request carrying no file", async () => {
      const body = new FormData();
      body.append("file", "not-a-file");
      const response = await POST(
        new Request("http://localhost/api/me/avatar", { method: "POST", body }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Choose a photo to upload.",
      });
    });

    it("refuses an empty file", async () => {
      const response = await POST(upload(Buffer.alloc(0), "image/png"));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "That file is empty." });
    });

    it("refuses a file over the 5 MB ceiling, and accepts one exactly at it", async () => {
      const tooBig = await POST(upload(Buffer.alloc(MAX_AVATAR_BYTES + 1), "image/png"));
      expect(tooBig.status).toBe(400);
      await expect(tooBig.json()).resolves.toEqual({
        ok: false,
        error: "That photo is over 5 MB. Choose a smaller one.",
      });

      // The boundary itself is allowed — the check is `>`, not `>=`.
      const exactly = await POST(upload(Buffer.alloc(MAX_AVATAR_BYTES), "image/png"));
      expect(exactly.status).toBe(200);
    });

    it("refuses a type that is not PNG, JPEG or WebP — SVG and PDF especially", async () => {
      for (const type of ["image/svg+xml", "application/pdf", "text/html", "image/heic", ""]) {
        const response = await POST(upload(PNG_1X1, type));
        expect(response.status, type).toBe(400);
        await expect(response.json(), type).resolves.toEqual({
          ok: false,
          error: "Profile photos can be PNG, JPG or WebP.",
        });
      }
    });

    it("accepts each allowed type", async () => {
      for (const type of ["image/png", "image/jpeg", "image/webp"]) {
        const response = await POST(upload(PNG_1X1, type));
        expect(response.status, type).toBe(200);
      }
    });
  });

  describe("storing and serving", () => {
    it("puts the object under the org and user prefix, and serves it back", async () => {
      signIn(aliceId);
      const posted = await POST(upload(PNG_1X1, "image/png"));
      expect(posted.status).toBe(200);
      const { version } = (await posted.json()) as { ok: true; version: string };

      const key = await avatarKeyOf(aliceId);
      expect(key).toMatch(new RegExp(`^org/${orgId}/users/${aliceId}/avatar/[0-9a-f-]+\\.png$`));
      // The version returned is the key's own uuid — it is what busts the browser cache, so a
      // version that did not track the key would serve the previous photo forever.
      expect(key).toContain(version);

      const served = await GET();
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Type")).toBe("image/png");
      expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
      // Private, never shared: a photo of a person may not sit in a shared cache.
      expect(served.headers.get("Cache-Control")).toBe("private, max-age=3600");
      expect(Buffer.from(await served.arrayBuffer())).toEqual(PNG_1X1);
    });

    it("replacing a photo deletes the old object and leaves exactly one behind", async () => {
      signIn(aliceId);
      await POST(upload(PNG_1X1, "image/png"));
      const first = await avatarKeyOf(aliceId);

      await POST(upload(PNG_1X1, "image/jpeg"));
      const second = await avatarKeyOf(aliceId);

      expect(second).not.toBe(first);
      // The new object is there and the old one is gone — not merely unreferenced.
      await expect(storage().get(second!)).resolves.toBeInstanceOf(Buffer);
      await expect(storage().get(first!)).rejects.toThrow();
    });

    it("404s rather than serving a broken image when the object is gone", async () => {
      signIn(aliceId);
      await POST(upload(PNG_1X1, "image/png"));
      const key = await avatarKeyOf(aliceId);

      // The row still points at it; the object does not exist. The avatar must fall back to
      // initials, which means an honest 404 rather than a 200 carrying nothing.
      await storage().delete(key!);

      const response = await GET();
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("No profile photo.");
    });

    it("404s when no photo is set, and DELETE clears the row and the object", async () => {
      signIn(aliceId);
      await POST(upload(PNG_1X1, "image/png"));
      const key = await avatarKeyOf(aliceId);

      const removed = await DELETE();
      expect(removed.status).toBe(200);
      await expect(removed.json()).resolves.toEqual({ ok: true });

      expect(await avatarKeyOf(aliceId)).toBeNull();
      await expect(storage().get(key!)).rejects.toThrow();
      expect((await GET()).status).toBe(404);
    });

    it("DELETE with no photo set is not an error", async () => {
      signIn(bobId);
      expect(await avatarKeyOf(bobId)).toBeNull();

      const response = await DELETE();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    });
  });

  describe("one person can never reach another's photo", () => {
    it("reads and writes only the session's own row", async () => {
      signIn(aliceId);
      await POST(upload(PNG_1X1, "image/png"));
      const aliceKey = await avatarKeyOf(aliceId);

      // Bob signs in against the same organisation and uploads his own.
      signIn(bobId);
      await POST(upload(PNG_1X1, "image/jpeg"));
      const bobKey = await avatarKeyOf(bobId);

      expect(bobKey).not.toBe(aliceKey);
      expect(bobKey).toContain(`/users/${bobId}/`);
      // Alice's row and object are untouched by anything Bob did.
      expect(await avatarKeyOf(aliceId)).toBe(aliceKey);
      await expect(storage().get(aliceKey!)).resolves.toBeInstanceOf(Buffer);

      // Bob's GET serves Bob's photo; there is no id he could have supplied to get Alice's.
      expect((await GET()).headers.get("Content-Type")).toBe("image/jpeg");

      // And his DELETE removes only his own.
      await DELETE();
      expect(await avatarKeyOf(bobId)).toBeNull();
      expect(await avatarKeyOf(aliceId)).toBe(aliceKey);
    });

    it("refuses to serve a key that is not under the session's organisation", async () => {
      signIn(aliceId);
      await POST(upload(PNG_1X1, "image/png"));

      // A real object belonging to a different organisation, and the row forced to point at
      // it — the state a cross-tenant bug elsewhere would produce. The object has to actually
      // exist, or the route would 404 merely because the store came up empty and this would
      // pass with `keyBelongsToOrg` deleted. With the guard gone, the GET below serves another
      // organisation's bytes; with it, the answer is an honest 404.
      // Any org id but this session's; the guard compares the prefix, so it need not be a row.
      const foreignKey = `org/${crypto.randomUUID()}/users/${aliceId}/avatar/planted.png`;
      await storage().put({ key: foreignKey, body: PNG_1X1, contentType: "image/png" });
      await expect(storage().get(foreignKey)).resolves.toEqual(PNG_1X1);

      await db.update(users).set({ avatarKey: foreignKey }).where(eq(users.id, aliceId));

      const response = await GET();
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("No profile photo.");

      await storage().delete(foreignKey);
    });
  });
});
