import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME_TYPES,
  expenseDocumentKey,
  extensionFor,
  generatedArtifactKey,
  isAllowedMimeType,
  keyBelongsToOrg,
  MAX_UPLOAD_BYTES,
  monthDocumentKey,
  thumbnailKey,
} from "./keys";

const ORG = "01a00b6a-623a-71de-ba3a-a1b8fa8af39c";

describe("accepted uploads (R13.2)", () => {
  it("allows exactly the documented types", () => {
    expect(Object.keys(ALLOWED_MIME_TYPES).sort()).toEqual([
      "application/pdf",
      "image/heic",
      "image/heif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(isAllowedMimeType("image/jpeg")).toBe(true);
    expect(isAllowedMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("application/zip")).toBe(false);
  });

  it("caps a single upload at 25 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });

  it("maps types to canonical extensions", () => {
    expect(extensionFor("application/pdf")).toBe("pdf");
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/heif")).toBe("heic");
  });
});

describe("key construction (data-model §S3)", () => {
  it("builds expense document keys without any user-supplied filename", () => {
    const key = expenseDocumentKey({
      orgId: ORG,
      month: "2026-02",
      expenseId: "exp-1",
      scope: "proof",
      docId: "doc-9",
      mimeType: "image/png",
    });
    expect(key).toBe(`org/${ORG}/months/2026-02/expenses/exp-1/proof/doc-9.png`);
  });

  it("keeps a payslip's filename — and the person's name — out of the key", () => {
    const key = expenseDocumentKey({
      orgId: ORG,
      month: "2026-02",
      expenseId: "exp-1",
      scope: "receipt",
      docId: "doc-9",
      mimeType: "application/pdf",
    });
    expect(key).not.toMatch(/smith|payslip|statement/i);
    expect(key.endsWith("doc-9.pdf")).toBe(true);
  });

  it("builds month document keys by category", () => {
    expect(
      monthDocumentKey({
        orgId: ORG,
        month: "2026-02",
        category: "bank_statement",
        docId: "doc-3",
        mimeType: "application/pdf",
      }),
    ).toBe(`org/${ORG}/months/2026-02/month-docs/bank_statement/doc-3.pdf`);
  });

  const SOURCE = "01a00b6a-623a-71de-ba3a-a1b8fa8af39d";

  it("builds generated artifact keys, slugging the line item name", () => {
    expect(
      generatedArtifactKey({
        orgId: ORG,
        fundingSourceId: SOURCE,
        month: "2026-02",
        type: "cover_docx",
        lineItemName: "Social Services & Support",
        inputsHash: "abc123",
        extension: "docx",
      }),
    ).toBe(
      `org/${ORG}/months/2026-02/generated/${SOURCE}/cover_docx-social-services-support-abc123.docx`,
    );
  });

  it("omits the slug for packet and summary artifacts", () => {
    expect(
      generatedArtifactKey({
        orgId: ORG,
        fundingSourceId: SOURCE,
        month: "2026-02",
        type: "packet_pdf",
        lineItemName: null,
        inputsHash: "def456",
        extension: "pdf",
      }),
    ).toBe(`org/${ORG}/months/2026-02/generated/${SOURCE}/packet_pdf-def456.pdf`);
  });

  it("keeps a slashed line item name from breaking the key layout", () => {
    const build = (lineItemName: string) =>
      generatedArtifactKey({
        orgId: ORG,
        fundingSourceId: SOURCE,
        month: "2026-02",
        type: "cover_pdf",
        lineItemName,
        inputsHash: "h",
        extension: "pdf",
      });

    // A slash in the name must not introduce an extra path segment.
    expect(build("Social/Services").split("/")).toHaveLength(build("Social").split("/").length);
    expect(build("Social/Services")).toContain("cover_pdf-socialservices-h.pdf");
    expect(build("../../etc/passwd")).not.toContain("..");
  });

  it("puts thumbnails beside their source", () => {
    expect(thumbnailKey(`org/${ORG}/months/2026-02/expenses/e/proof/d.png`)).toBe(
      `org/${ORG}/months/2026-02/expenses/e/proof/d.thumb.jpg`,
    );
  });
});

describe("keyBelongsToOrg", () => {
  it("accepts this organisation's prefix only", () => {
    expect(keyBelongsToOrg(`org/${ORG}/months/2026-02/x.png`, ORG)).toBe(true);
    expect(keyBelongsToOrg("org/other-org/months/2026-02/x.png", ORG)).toBe(false);
  });

  it("rejects traversal and absolute paths", () => {
    expect(keyBelongsToOrg(`org/${ORG}/../other/x.png`, ORG)).toBe(false);
    expect(keyBelongsToOrg(`/org/${ORG}/x.png`, ORG)).toBe(false);
    expect(keyBelongsToOrg("", ORG)).toBe(false);
  });

  it("is not fooled by an organisation id that merely starts the same", () => {
    expect(keyBelongsToOrg(`org/${ORG}-evil/months/x.png`, ORG)).toBe(false);
  });
});
