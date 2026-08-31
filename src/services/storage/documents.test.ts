/**
 * The storage quota arithmetic (R13.1).
 *
 * Split out of `orgStorageError` so the decision can be tested without a database — the
 * query around it only supplies `usedBytes`.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_DOCUMENTS_PER_EXPENSE,
  MAX_EXPENSE_BYTES,
  MAX_EXPENSE_PAGES,
  MAX_ORG_BYTES,
  expenseBudgetError,
  storageQuotaError,
} from "./documents";

const MB = 1024 * 1024;

describe("storageQuotaError", () => {
  it("allows an upload that fits", () => {
    expect(storageQuotaError(MAX_ORG_BYTES / 2, 10 * MB)).toBeNull();
  });

  it("allows one that lands exactly on the cap", () => {
    // A soft cap blocks going *over*, so the byte that reaches it is still allowed.
    expect(storageQuotaError(MAX_ORG_BYTES - 10, 10)).toBeNull();
  });

  it("blocks the byte that goes over", () => {
    expect(storageQuotaError(MAX_ORG_BYTES - 10, 11)).not.toBeNull();
  });

  it("names the real figures, so the message is actionable (R13.1)", () => {
    // Expressed against the cap rather than a literal, so retuning it does not break the
    // test that checks the message reports the cap correctly.
    const used = MAX_ORG_BYTES - MB;
    const message = storageQuotaError(used, 2 * MB);
    expect(message).toContain(`${Math.round(used / MB)} MB`);
    expect(message).toContain(`${Math.round(MAX_ORG_BYTES / MB)} MB`);
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

describe("expenseBudgetError", () => {
  const empty = { files: 0, bytes: 0, pages: 0 };
  const oneSmallPage = { bytes: 100 * 1024, pages: 1 };

  it("lets an expense hold far more than the twenty files it used to", () => {
    // The whole point of F1: a month of Lyft receipts is one expense, not four line items
    // invented to get around a file count.
    expect(expenseBudgetError({ files: 60, bytes: 30 * MB, pages: 60 }, oneSmallPage)).toBeNull();
  });

  it("allows the first file into an empty expense", () => {
    expect(expenseBudgetError(empty, oneSmallPage)).toBeNull();
  });

  it("blocks on total size, naming what is held and what the limit is", () => {
    const message = expenseBudgetError(
      { files: 5, bytes: MAX_EXPENSE_BYTES - 1024, pages: 5 },
      { bytes: 2048, pages: 1 },
    );
    expect(message).toContain("200 MB");
    expect(message).toContain("Split the receipts");
  });

  it("lets a file land exactly on the size budget", () => {
    expect(
      expenseBudgetError({ files: 1, bytes: MAX_EXPENSE_BYTES - 2048, pages: 1 }, { bytes: 2048, pages: 1 }),
    ).toBeNull();
  });

  it("blocks on pages even when the bytes are trivial", () => {
    // Pages are what packet assembly costs: every uploaded page becomes a packet page. A
    // 400-page text PDF is small on disk and expensive to submit.
    const message = expenseBudgetError(
      { files: 1, bytes: 1024, pages: MAX_EXPENSE_PAGES - 10 },
      { bytes: 1024, pages: 40 },
    );
    expect(message).toContain("pages");
    expect(message).toContain("packet");
  });

  it("counts a multi-page PDF as all of its pages, not as one file", () => {
    // The failure the old count cap could not see: one file, three hundred pages.
    expect(
      expenseBudgetError(empty, { bytes: 1024, pages: MAX_EXPENSE_PAGES + 1 }),
    ).not.toBeNull();
  });

  it("still stops a runaway, but at a number no person reaches", () => {
    const message = expenseBudgetError(
      { files: MAX_DOCUMENTS_PER_EXPENSE, bytes: 1024, pages: 1 },
      oneSmallPage,
    );
    expect(message).toContain(String(MAX_DOCUMENTS_PER_EXPENSE));
  });

  it("reports size before pages when both are over, since size is the harder limit", () => {
    const message = expenseBudgetError(
      { files: 1, bytes: MAX_EXPENSE_BYTES, pages: MAX_EXPENSE_PAGES },
      oneSmallPage,
    );
    expect(message).toContain("MB");
  });
});
