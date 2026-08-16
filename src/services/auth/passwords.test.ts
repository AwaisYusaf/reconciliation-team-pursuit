import { describe, expect, it } from "vitest";

import { hashPassword, MIN_PASSWORD_LENGTH, validatePasswordPolicy, verifyPassword } from "./passwords";

describe("password policy (D-24)", () => {
  it("requires at least 12 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(validatePasswordPolicy("short")).toBe("Password must be at least 12 characters.");
    expect(validatePasswordPolicy("elevenchars")).not.toBeNull();
    expect(validatePasswordPolicy("twelvechars!")).toBeNull();
    expect(validatePasswordPolicy("a very long passphrase indeed")).toBeNull();
  });

  it("imposes no composition rules beyond length", () => {
    expect(validatePasswordPolicy("aaaaaaaaaaaa")).toBeNull();
    expect(validatePasswordPolicy("correct horse battery staple")).toBeNull();
  });
});

describe("hashing (argon2id)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("development-only-password");
    expect(await verifyPassword(hash, "development-only-password")).toBe(true);
    expect(await verifyPassword(hash, "Development-only-password")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("salts: the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same password!"), hashPassword("same password!")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same password!")).toBe(true);
    expect(await verifyPassword(b, "same password!")).toBe(true);
  });

  it("produces an argon2id hash, not argon2i or argon2d", async () => {
    expect(await hashPassword("development-only-password")).toMatch(/^\$argon2id\$/);
  });

  it("reads a corrupt stored hash as a wrong password rather than throwing", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });
});
