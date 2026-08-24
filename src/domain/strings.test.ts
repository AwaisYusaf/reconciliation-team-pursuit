import { describe, expect, it } from "vitest";

import {
  coverSheetFilename,
  coverSheetTitle,
  lineItemDeleteBlocked,
  noReceiptNote,
  packetFilename,
  packetFooter,
  packetSummaryTitle,
  sanitiseForFilename,
  SEE_BELOW,
  summaryFilename,
  TAX_NOTE,
  UI,
} from "./strings";

describe("canonical document strings (R12)", () => {
  it("matches the rulebook byte for byte", () => {
    expect(TAX_NOTE).toBe(
      "(Note: Statement includes tax which was excluded from reimbursement amount)",
    );
    expect(SEE_BELOW).toBe(
      "Please see below for additional information for some of the above items.",
    );
    expect(noReceiptNote("Paid via CashApp; payment screenshot attached as proof.")).toBe(
      "(Note: No receipt available — Paid via CashApp; payment screenshot attached as proof.)",
    );
  });

  it("uses the singular Statement, as the approved packet does", () => {
    expect(TAX_NOTE).toContain("Statement includes");
    expect(TAX_NOTE).not.toContain("Statements include");
  });

  it("trims the caller's reason without altering its wording", () => {
    expect(noReceiptNote("  CashApp only  ")).toBe("(Note: No receipt available — CashApp only)");
  });
});

describe("UI copy (R12)", () => {
  it("pins the strings the rules fix", () => {
    expect(UI.reimburseHint).toBe("Sales tax is excluded. The city does not reimburse it.");
    expect(UI.blockedTitle).toBe("This packet cannot be downloaded yet.");
    expect(UI.blockedTitleLineItem).toBe("Downloads unavailable for this line item.");
    expect(UI.blockedIntro).toBe(
      "The following records are missing a receipt/justification or proof of payment:",
    );
    expect(UI.forgotPassword).toBe("Forgot your password? Email");
    expect(UI.supportEmail).toBe("tech@teampursuit.org");
    expect(UI.taxExceedsSubtotalWarning).toBe(
      "Tax is more than the subtotal — double-check this entry.",
    );
    expect(UI.subtotalIsZeroWarning).toBe("Subtotal is $0.00 — double-check this entry.");
  });

  it("quotes the line item name in the delete refusal", () => {
    expect(lineItemDeleteBlocked("Salary")).toBe(
      '"Salary" has expenses recorded against it and cannot be deleted.',
    );
  });
});

describe("document titles (R6.1, R10.5)", () => {
  it("builds the cover sheet title the client already receives", () => {
    expect(coverSheetTitle("Team Pursuit", "February 2026", "Analytical Support")).toBe(
      "Team Pursuit February 2026 Analytical Support Breakdown",
    );
  });

  it("builds the packet footer and summary title", () => {
    expect(packetFooter("Team Pursuit", "February 2026", 7, 128)).toBe(
      "Team Pursuit — February 2026 — Page 7 of 128",
    );
    expect(packetSummaryTitle("Team Pursuit", "February 2026")).toBe(
      "Team Pursuit — Contract Summary — February 2026",
    );
  });
});

describe("filenames (R10.3)", () => {
  it("names cover sheets with spaces and the right extension", () => {
    expect(coverSheetFilename("Team Pursuit", "February 2026", "Salary", "docx")).toBe(
      "Team Pursuit February 2026 Salary Breakdown.docx",
    );
    expect(coverSheetFilename("Team Pursuit", "February 2026", "Salary", "pdf")).toBe(
      "Team Pursuit February 2026 Salary Breakdown.pdf",
    );
  });

  it("underscores packet and summary names", () => {
    expect(summaryFilename("Team Pursuit", "February 2026")).toBe(
      "Team_Pursuit_February_2026_Summary.xlsx",
    );
    expect(packetFilename("Team Pursuit", "February 2026")).toBe(
      "Team_Pursuit_February_2026_Packet.pdf",
    );
  });

  it("sanitises names that would break a path or an S3 key", () => {
    expect(sanitiseForFilename("Social Services / Support")).toBe("Social Services Support");
    // Dot runs collapse, so a sanitised value can never contain ".." — the key builder
    // and the keyBelongsToOrg guard must agree about what a legal key looks like.
    expect(sanitiseForFilename("../../etc/passwd")).toBe("etcpasswd");
    expect(sanitiseForFilename("..")).toBe("");
    expect(sanitiseForFilename("report..final.pdf")).toBe("report.final.pdf");
    expect(sanitiseForFilename(".hidden")).toBe("hidden");
    expect(sanitiseForFilename("Promo & Marketing")).toBe("Promo Marketing");
    expect(sanitiseForFilename("a".repeat(200))).toHaveLength(80);
    expect(sanitiseForFilename("  spaced   out  ")).toBe("spaced out");
  });

  it("keeps a slashed line item name out of the generated filename", () => {
    expect(coverSheetFilename("Team Pursuit", "March 2026", "Social/Services", "docx")).toBe(
      "Team Pursuit March 2026 SocialServices Breakdown.docx",
    );
  });
});
