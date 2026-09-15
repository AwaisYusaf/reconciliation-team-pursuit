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
    expect(UI.reimburseHint).toBe("Sales tax is excluded. The funder does not reimburse it.");
    expect(UI.blockedTitle).toBe("This packet cannot be downloaded yet.");
    expect(UI.blockedTitleLineItem).toBe("Downloads unavailable for this line item.");
    expect(UI.blockedIntro).toBe(
      "The following records are missing a receipt/justification, proof of payment, or narrative:",
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

  it("inserts the source name between the doc name and the month when given (D-93 decision 2.12)", () => {
    expect(
      coverSheetFilename("Team Pursuit", "February 2026", "Salary", "docx", "Foundation grant"),
    ).toBe("Team Pursuit Foundation grant February 2026 Salary Breakdown.docx");
    expect(summaryFilename("Team Pursuit", "February 2026", "Foundation grant")).toBe(
      "Team_Pursuit_Foundation_grant_February_2026_Summary.xlsx",
    );
    expect(packetFilename("Team Pursuit", "February 2026", "Foundation grant")).toBe(
      "Team_Pursuit_Foundation_grant_February_2026_Packet.pdf",
    );
  });

  it("shortens a source name that genuinely doesn't fit, keeping the month and line item whole", () => {
    // The guarantee, not the mechanism: whatever happens to the source name, the month, the
    // document type and the line item name survive intact. A 300-character source cannot fit
    // any budget, so it gives way — but only it. (There is no fixed source cap any more; a
    // name that fits is printed in full. See `fitSourceName`.)
    const longName = "A".repeat(300);

    const packetName = packetFilename("Team Pursuit", "February 2026", longName);
    expect(packetName.startsWith("Team_Pursuit_")).toBe(true);
    expect(packetName.endsWith("_February_2026_Packet.pdf")).toBe(true);

    const summaryName = summaryFilename("Team Pursuit", "February 2026", longName);
    expect(summaryName.endsWith("_February_2026_Summary.xlsx")).toBe(true);

    const coverName = coverSheetFilename("Team Pursuit", "February 2026", "Salary", "docx", longName);
    expect(coverName.startsWith("Team Pursuit ")).toBe(true);
    expect(coverName.endsWith(" February 2026 Salary Breakdown.docx")).toBe(true);
  });

  it("prints a source name that fits in full, rather than cutting it mid-word", () => {
    // "Community Violence Intervention" is 31 characters. The old flat 30-character cap sliced
    // its last letter off with most of the stem still unused, which is exactly the reported
    // `…Community Violence Interventio September 2026…`.
    const source = "Community Violence Intervention";
    expect(coverSheetFilename("Team Pursuit", "September 2026", "Salary", "docx", source)).toContain(
      source,
    );
    expect(packetFilename("Team Pursuit", "September 2026", source)).toContain(
      source.replace(/ /g, "_"),
    );
  });

  it("keeps the month, the document type and the full line item name with real long org/source/line-item names (review fix)", () => {
    // The exact shape that shipped broken: a real org name, a real long source name and a
    // real long line item name together pushed past 80 chars, and the blind slice cut
    // "Breakdown" and half the line item name instead of only the source.
    const docName = "Team Pursuit";
    const sourceName = "Community Violence Intervention Grant";
    const month = "September 2026";
    const lineItem = "Professional Development And Training";

    const cover = coverSheetFilename(docName, month, lineItem, "docx", sourceName);
    expect(cover.endsWith(`${lineItem} Breakdown.docx`)).toBe(true);
    expect(cover).toContain(month);

    const packet = packetFilename(docName, month, sourceName);
    expect(packet.endsWith(`${month.replace(/ /g, "_")}_Packet.pdf`)).toBe(true);

    const summary = summaryFilename(docName, month, sourceName);
    expect(summary.endsWith(`${month.replace(/ /g, "_")}_Summary.xlsx`)).toBe(true);
  });

  it("never gives two line items differing only in name the same cover sheet filename, even under a long source name", () => {
    const longSource = "Community Engagement and Outreach Programming Grant";
    const a = coverSheetFilename(
      "Team Pursuit",
      "September 2026",
      "Community Engagement Events A",
      "docx",
      longSource,
    );
    const b = coverSheetFilename(
      "Team Pursuit",
      "September 2026",
      "Community Engagement Events B",
      "docx",
      longSource,
    );
    expect(a).not.toBe(b);
    expect(a.endsWith("Community Engagement Events A Breakdown.docx")).toBe(true);
    expect(b.endsWith("Community Engagement Events B Breakdown.docx")).toBe(true);
  });

  it("keeps two long line item names apart even with no source name in play at all", () => {
    // The residual hole after the first review fix: shortening the *source* name only protects
    // the rest while the rest already fits. With a real org name, a real month and "Breakdown"
    // eating ~45 characters, an 80-character stem left barely 35 for the line item name — so
    // two long names sharing a prefix still collided, the source simply wasn't the part giving
    // way any more. Both names below are 46 characters; they fit whole now.
    const docName = "Team Pursuit Global";
    const month = "September 2026";
    const a = coverSheetFilename(docName, month, "Community Violence Intervention Program Staff A", "docx");
    const b = coverSheetFilename(docName, month, "Community Violence Intervention Program Staff B", "docx");

    expect(a).not.toBe(b);
    expect(a.endsWith("Community Violence Intervention Program Staff A Breakdown.docx")).toBe(true);
    expect(b.endsWith("Community Violence Intervention Program Staff B Breakdown.docx")).toBe(true);
  });

  it("reproduces the reported truncation with Team Pursuit's own source name, in full", () => {
    // Reported verbatim as:
    //   Team Pursuit Community Violence Interventio September 2026 Professional Developm.docx
    // — "Intervention" cut mid-word, "Breakdown" gone entirely, line item name cut.
    const filename = coverSheetFilename(
      "Team Pursuit",
      "September 2026",
      "Professional Development",
      "docx",
      "Community Violence Intervention",
    );

    expect(filename).toBe(
      "Team Pursuit Community Violence Intervention September 2026 Professional Development Breakdown.docx",
    );
  });

  it("gives two different months two different filenames even with a long source name", () => {
    const longName = "B".repeat(60);
    const february = packetFilename("Team Pursuit", "February 2026", longName);
    const march = packetFilename("Team Pursuit", "March 2026", longName);
    expect(february).not.toBe(march);

    const febCover = coverSheetFilename("Team Pursuit", "February 2026", "Salary", "docx", longName);
    const marCover = coverSheetFilename("Team Pursuit", "March 2026", "Salary", "docx", longName);
    expect(febCover).not.toBe(marCover);
  });

  it("omits the source segment for an empty, blank or absent sourceName — byte-identical to the single-source filename", () => {
    expect(coverSheetFilename("Team Pursuit", "February 2026", "Salary", "docx", null)).toBe(
      "Team Pursuit February 2026 Salary Breakdown.docx",
    );
    expect(coverSheetFilename("Team Pursuit", "February 2026", "Salary", "docx", "")).toBe(
      "Team Pursuit February 2026 Salary Breakdown.docx",
    );
    expect(coverSheetFilename("Team Pursuit", "February 2026", "Salary", "docx", "   ")).toBe(
      "Team Pursuit February 2026 Salary Breakdown.docx",
    );
    expect(summaryFilename("Team Pursuit", "February 2026", null)).toBe(
      "Team_Pursuit_February_2026_Summary.xlsx",
    );
    expect(packetFilename("Team Pursuit", "February 2026", undefined)).toBe(
      "Team_Pursuit_February_2026_Packet.pdf",
    );
  });
});
