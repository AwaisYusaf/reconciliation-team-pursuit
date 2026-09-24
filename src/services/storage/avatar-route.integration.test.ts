/**
 * `/api/me/avatar` — the signed-in person's own profile photo (D-117).
 *
 * The route takes no user id anywhere, so the property worth pinning is that it can only ever
 * reach the session's own row: a second person signed in against the same organisation reads
 * and writes their own photo and never the first one's. The rest is input validation on an
 * upload endpoint — size, type, empty, missing — and the object bookkeeping around a replace,
 * which has to leave exactly one object behind.
 *
 * Phase 15 (D-119) added the guards every other upload route already had: the bytes are decoded
 * and re-encoded rather than trusted by their label, the origin is checked, the body is capped
 * before it is buffered, the rate is limited, and the stored size counts against the storage cap.
 *
 * Drives the real route handlers against a real database and the local storage driver.
 *
 * Skipped when DATABASE_URL is absent.
 */
vi.mock("@/src/services/auth/session", () => ({ getSession: vi.fn() }));

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("profile photo route (integration, D-117)", async () => {
  const { rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const sharp = (await import("sharp")).default;
  const { db } = await import("@/src/db");
  const { monthLockEvents, organizations, users } = await import("@/src/db/schema");
  const { createTestOrg } = await import("@/src/db/test-org");
  const { hashPassword } = await import("@/src/services/auth/passwords");
  const { getSession } = await import("@/src/services/auth/session");
  const { clearAll: clearRateLimit, LIMITS } = await import("@/src/services/rate-limit");
  const { AVATAR_PX } = await import("@/src/services/storage/avatar");
  const { MAX_ORG_BYTES, orgStorageBytes } = await import("@/src/services/storage/documents");
  const { storage } = await import("@/src/services/storage/driver");
  const { MAX_AVATAR_BYTES } = await import("@/src/services/storage/keys");

  // Lives here rather than beside the route because vitest only collects `src/**/*.test.ts`,
  // which is why `download-routes.integration.test.ts` sits under `src/modules/packet` too.
  const { GET, POST, DELETE } = await import("@/app/api/me/avatar/route");

  const getSessionMock = vi.mocked(getSession);

  let orgId: string;
  let fundingSourceId: string;
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

  /** What a same-origin `fetch` from the app's own page carries; the route refuses anything else. */
  const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };

  function upload(bytes: Buffer, type: string, headers: Record<string, string> = SAME_ORIGIN): Request {
    const body = new FormData();
    body.append("file", new File([new Uint8Array(bytes)], "avatar.jpg", { type }));
    return new Request("http://localhost/api/me/avatar", { method: "POST", body, headers });
  }

  function remove(headers: Record<string, string> = SAME_ORIGIN): Request {
    return new Request("http://localhost/api/me/avatar", { method: "DELETE", headers });
  }

  /** A JPEG as a phone takes it: large, and carrying EXIF that must never reach a colleague. */
  async function phonePhoto(): Promise<Buffer> {
    return sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#7a5230" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "home-address-marker", Artist: "exif-owner-marker" } })
      .toBuffer();
  }

  async function avatarBytesOf(userId: string): Promise<number> {
    const [row] = await db
      .select({ bytes: users.avatarBytes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row.bytes;
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
    fundingSourceId = org.fundingSourceId;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    aliceId = await insertUser(`alice-${stamp}@example.test`);
    bobId = await insertUser(`bob-${stamp}@example.test`);
  });

  afterAll(async () => {
    if (!orgId) return;
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await rm(path.join(process.cwd(), ".storage", "org", orgId), { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Every POST spends from the per-person bucket, and this file makes more than an hour's worth.
    clearRateLimit();
  });

  describe("signed out", () => {
    it("refuses every method with 401 and writes nothing", async () => {
      getSessionMock.mockResolvedValue(null);

      expect((await GET()).status).toBe(401);
      expect((await POST(upload(PNG_1X1, "image/png"))).status).toBe(401);
      expect((await DELETE(remove())).status).toBe(401);
    });
  });

  describe("request guards", () => {
    beforeEach(() => signIn(aliceId));

    it("refuses a cross-site POST or DELETE with 403 and changes nothing", async () => {
      await POST(upload(PNG_1X1, "image/png"));
      const before = await avatarKeyOf(aliceId);

      for (const headers of <Record<string, string>[]>[
        { origin: "https://evil.example", host: "localhost" },
        { "sec-fetch-site": "cross-site" },
        {},
      ]) {
        const posted = await POST(upload(PNG_1X1, "image/png", headers));
        expect(posted.status, JSON.stringify(headers)).toBe(403);
        const removed = await DELETE(remove(headers));
        expect(removed.status, JSON.stringify(headers)).toBe(403);
      }

      expect(await avatarKeyOf(aliceId)).toBe(before);
      await expect(storage().get(before!)).resolves.toBeInstanceOf(Buffer);
    });

    it("refuses a body declared over the cap with 413 before reading it", async () => {
      const request = new Request("http://localhost/api/me/avatar", {
        method: "POST",
        headers: { ...SAME_ORIGIN, "content-length": String(MAX_AVATAR_BYTES * 4) },
        // Not multipart at all: if the route reached `formData()` this would be a 400, not a 413.
        body: "x",
      });
      const response = await POST(request);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "That photo is over 5 MB. Choose a smaller one.",
      });
    });

    it("limits uploads per person, and the limit is theirs alone", async () => {
      const { limit } = LIMITS.avatarUpload;
      for (let i = 0; i < limit; i++) {
        // Empty files: refused after the limit is spent, so this costs no decoding.
        expect((await POST(upload(Buffer.alloc(0), "image/png"))).status).toBe(400);
      }
      const refused = await POST(upload(PNG_1X1, "image/png"));
      expect(refused.status).toBe(429);

      signIn(bobId);
      expect((await POST(upload(PNG_1X1, "image/png"))).status).toBe(200);
      await DELETE(remove());
    });
  });

  describe("input validation", () => {
    beforeEach(() => signIn(aliceId));

    it("refuses a request carrying no file", async () => {
      const body = new FormData();
      body.append("file", "not-a-file");
      const response = await POST(
        new Request("http://localhost/api/me/avatar", { method: "POST", body, headers: SAME_ORIGIN }),
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

    it("refuses a file over the 5 MB ceiling", async () => {
      const tooBig = await POST(upload(Buffer.alloc(MAX_AVATAR_BYTES + 1), "image/png"));
      expect(tooBig.status).toBe(400);
      await expect(tooBig.json()).resolves.toEqual({
        ok: false,
        error: "That photo is over 5 MB. Choose a smaller one.",
      });
    });

    it("accepts a real photo right at the ceiling — the size check is `>`, not `>=`", async () => {
      // Random pixels do not compress, so a PNG of them can be padded to exactly the ceiling
      // with trailing bytes after IEND, which decoders ignore.
      const noise = await sharp(Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 97) % 256)), {
        raw: { width: 64, height: 64, channels: 3 },
      })
        .png()
        .toBuffer();
      const exactly = Buffer.concat([noise, Buffer.alloc(MAX_AVATAR_BYTES - noise.byteLength)]);
      expect(exactly.byteLength).toBe(MAX_AVATAR_BYTES);

      expect((await POST(upload(exactly, "image/png"))).status).toBe(200);
    });

    it("decides by the bytes, not the label: an SVG sent as image/png is refused and nothing is stored", async () => {
      const before = await avatarKeyOf(aliceId);
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
      );

      const response = await POST(upload(svg, "image/png"));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "Profile photos can be PNG, JPG or WebP.",
      });
      expect(await avatarKeyOf(aliceId)).toBe(before);
    });

    it("refuses bytes that are no image at all", async () => {
      const response = await POST(upload(Buffer.from("definitely not a photo"), "image/jpeg"));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "That photo couldn't be read. Choose a PNG, JPG or WebP photo.",
      });
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
      // Always a JPEG, whatever was sent: the photo is re-encoded, never stored as posted.
      expect(key).toMatch(new RegExp(`^org/${orgId}/users/${aliceId}/avatar/[0-9a-f-]+\\.jpg$`));
      // The version returned is the key's own uuid — it is what busts the browser cache, so a
      // version that did not track the key would serve the previous photo forever.
      expect(key).toContain(version);

      const served = await GET();
      expect(served.status).toBe(200);
      expect(served.headers.get("Content-Type")).toBe("image/jpeg");
      expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
      // Private, never shared: a photo of a person may not sit in a shared cache.
      expect(served.headers.get("Cache-Control")).toBe("private, max-age=3600");
      const body = Buffer.from(await served.arrayBuffer());
      expect((await sharp(body).metadata()).format).toBe("jpeg");
      // The stored size is recorded, and it is the size of what is actually stored.
      expect(await avatarBytesOf(aliceId)).toBe(body.byteLength);
    });

    it("strips a phone photo's EXIF and cuts it to the avatar square", async () => {
      signIn(aliceId);
      const original = await phonePhoto();
      // The fixture really does carry the metadata, or the assertion below proves nothing.
      expect(original.includes("exif-owner-marker")).toBe(true);

      expect((await POST(upload(original, "image/jpeg"))).status).toBe(200);

      const stored = await storage().get((await avatarKeyOf(aliceId))!);
      const meta = await sharp(stored).metadata();
      expect(meta.exif).toBeUndefined();
      expect(stored.includes("exif-owner-marker")).toBe(false);
      expect(stored.includes("home-address-marker")).toBe(false);
      expect([meta.width, meta.height]).toEqual([AVATAR_PX, AVATAR_PX]);
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

    it("two uploads racing each other leave exactly one stored photo", async () => {
      signIn(aliceId);
      const { readdir } = await import("node:fs/promises");
      const dir = path.join(process.cwd(), ".storage", "org", orgId, "users", aliceId, "avatar");

      // The org upload lock (and the row lock inside it) makes each wait for the one before,
      // then replace it. With neither, all three read the same previous key and two of the new
      // objects are left with nothing naming them; this fails every time that way.
      const results = await Promise.all([
        POST(upload(await phonePhoto(), "image/jpeg")),
        POST(upload(await phonePhoto(), "image/jpeg")),
        POST(upload(await phonePhoto(), "image/jpeg")),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);

      const key = await avatarKeyOf(aliceId);
      expect(await readdir(dir)).toEqual([key!.slice(key!.lastIndexOf("/") + 1)]);
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

      const removed = await DELETE(remove());
      expect(removed.status).toBe(200);
      await expect(removed.json()).resolves.toEqual({ ok: true });

      expect(await avatarKeyOf(aliceId)).toBeNull();
      expect(await avatarBytesOf(aliceId)).toBe(0);
      await expect(storage().get(key!)).rejects.toThrow();
      expect((await GET()).status).toBe(404);
    });

    it("DELETE with no photo set is not an error", async () => {
      signIn(bobId);
      expect(await avatarKeyOf(bobId)).toBeNull();

      const response = await DELETE(remove());
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
      await DELETE(remove());
      expect(await avatarKeyOf(bobId)).toBeNull();
      expect(await avatarKeyOf(aliceId)).toBe(aliceKey);
    });

    it("refuses to serve a key that is not under the session's organisation", async () => {
      // Runs last in this describe: it leaves Alice's row pointing at a foreign key.
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

  describe("storage quota (R13.1)", () => {
    it("counts each photo once in the organisation's storage", async () => {
      signIn(bobId);
      const before = await orgStorageBytes(db, orgId);
      expect((await POST(upload(await phonePhoto(), "image/jpeg"))).status).toBe(200);
      const bytes = await avatarBytesOf(bobId);
      expect(bytes).toBeGreaterThan(0);
      expect(await orgStorageBytes(db, orgId)).toBe(before! + bytes);

      await DELETE(remove());
      expect(await orgStorageBytes(db, orgId)).toBe(before);
    });

    it("at the cap: a first photo is refused, a same-size replacement is not", async () => {
      signIn(aliceId);
      // A known photo on Alice's row, so the org's usage is exactly known.
      await db.update(users).set({ avatarKey: null, avatarBytes: 0 }).where(eq(users.id, aliceId));
      expect((await POST(upload(PNG_1X1, "image/png"))).status).toBe(200);
      const used = (await orgStorageBytes(db, orgId))!;

      // Ballast fills the rest of the organisation's storage to the byte.
      await db.insert(monthLockEvents).values({
        orgId,
        fundingSourceId,
        month: "2095-01",
        s3Key: `org/${orgId}/ballast.pdf`,
        sizeBytes: MAX_ORG_BYTES - used,
      });
      try {
        // Bob has no photo, so his whole photo is new spend: refused, and nothing left behind.
        signIn(bobId);
        const refused = await POST(upload(PNG_1X1, "image/png"));
        expect(refused.status).toBe(400);
        expect(((await refused.json()) as { error: string }).error).toMatch(/of its \d+ MB of storage/);
        expect(await avatarKeyOf(bobId)).toBeNull();

        // Alice swaps her photo for the same one: the old bytes are freed, so there is no growth.
        signIn(aliceId);
        const first = await avatarKeyOf(aliceId);
        expect((await POST(upload(PNG_1X1, "image/png"))).status).toBe(200);
        expect(await avatarKeyOf(aliceId)).not.toBe(first);
      } finally {
        await db.delete(monthLockEvents).where(eq(monthLockEvents.orgId, orgId));
      }
    });
  });
});
