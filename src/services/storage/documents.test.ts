/**
 * The storage quota arithmetic (R13.1).
 *
 * Split out of `orgStorageError` so the decision can be tested without a database — the
 * query around it only supplies `usedBytes`.
 */
import { describe, expect, it } from "vitest";

import { MAX_ORG_BYTES, storageQuotaError } from "./documents";

const MB = 1024 * 1024;

describe("storageQuotaError", () => {
  it("allows an upload that fits", () => {
    expect(storageQuotaError(100 * MB, 10 * MB)).toBeNull();
  });

  it("allows one that lands exactly on the cap", () => {
    // A soft cap blocks going *over*, so the byte that reaches it is still allowed.
    expect(storageQuotaError(MAX_ORG_BYTES - 10, 10)).toBeNull();
  });

  it("blocks the byte that goes over", () => {
    expect(storageQuotaError(MAX_ORG_BYTES - 10, 11)).not.toBeNull();
  });

  it("names the real figures, so the message is actionable (R13.1)", () => {
    const message = storageQuotaError(400 * MB, 200 * MB);
    expect(message).toContain("400 MB");
    expect(message).toContain("500 MB");
    expect(message).toContain("contact Mantaq");
  });

  it("allows an empty organisation's first upload", () => {
    expect(storageQuotaError(0, 25 * MB)).toBeNull();
  });

  it("blocks further uploads once already over", () => {
    // Possible whenever stored bytes exceeded the check that admitted them — the drift this
    // fix removes, and which historical rows may still carry.
    expect(storageQuotaError(MAX_ORG_BYTES + 1, 1)).not.toBeNull();
  });
});
