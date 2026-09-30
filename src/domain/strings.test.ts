import { describe, expect, it } from "vitest";

import { formatBytes } from "./format";
import {
  APP_NAME,
  coverSheetFilename,
  coverSheetHeading,
  coverSheetTitle,
  downloadBlockedReason,
  FEATURE_REQUEST_STATUS_DESCRIPTIONS,
  FEATURE_REQUEST_STATUS_LABELS,
  lineItemDeleteBlocked,
  monthlySummaryFilename,
  monthlySummaryTitle,
  noReceiptNote,
  packetFilename,
  packetFooter,
  packetIndexTitle,
  packetSummaryTitle,
  pageTitle,
  PLAN_LABELS,
  sanitiseForFilename,
  SEE_BELOW,
  STATUS_LABELS,
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
      "(Note: No receipt available. Reason: Paid via CashApp; payment screenshot attached as proof.)",
    );
  });

  it("uses the singular Statement, as the approved packet does", () => {
    expect(TAX_NOTE).toContain("Statement includes");
    expect(TAX_NOTE).not.toContain("Statements include");
  });

  it("trims the caller's reason without altering its wording", () => {
    expect(noReceiptNote("  CashApp only  ")).toBe("(Note: No receipt available. Reason: CashApp only)");
  });
});

describe("UI copy (R12)", () => {
  it("pins the strings the rules fix", () => {
    expect(UI.reimburseHint).toBe("Sales tax is excluded. The funder does not reimburse it.");
    expect(UI.blockedTitle).toBe("This packet cannot be downloaded yet.");
    expect(UI.blockedTitleLineItem).toBe("This cover sheet cannot be downloaded yet.");
    expect(UI.blockedIntro).toBe(
      "The following records are missing a receipt/justification, proof of payment, or narrative:",
    );
    expect(UI.forgotPassword).toBe("Forgot your password? Email");
    expect(UI.supportEmail).toBe("tech@authenticbusiness.io");
    expect(UI.taxExceedsSubtotalWarning).toBe(
      "Tax is more than the subtotal. Double-check this entry.",
    );
    expect(UI.subtotalIsZeroWarning).toBe("Subtotal is $0.00. Double-check this entry.");
  });

  it("quotes the line item name in the delete refusal", () => {
    expect(lineItemDeleteBlocked("Salary")).toBe(
      '"Salary" has expenses recorded against it and cannot be deleted.',
    );
  });
});

describe("admin dashboard strings (Phase 9, verbatim)", () => {
  it("shows the paused message only after a correct password (§3.5)", () => {
    expect(UI.orgAccessPaused).toBe(
      "Your organization's access is paused. Please contact support.",
    );
  });

  it("matches the suspend dialog's title and body verbatim (Appendix A §7)", () => {
    expect(UI.suspendDialogTitle("Eastside Youth Alliance")).toBe(
      "Suspend Eastside Youth Alliance?",
    );
    expect(UI.suspendDialogText).toBe(
      "Everyone in this organization will be signed out and won't be able to sign in until you reinstate it. None of their data is changed or deleted.",
    );
    expect(UI.reinstateDialogTitle("Eastside Youth Alliance")).toBe(
      "Reinstate Eastside Youth Alliance?",
    );
  });

  it("labels every plan and status", () => {
    expect(PLAN_LABELS.reconciliation).toBe("Reconciliation");
    expect(PLAN_LABELS.reconciliation_ai).toBe("Reconciliation + AI");
    expect(STATUS_LABELS.trial).toBe("Trial");
    expect(STATUS_LABELS.active).toBe("Active");
    expect(STATUS_LABELS.past_due).toBe("Past due");
    expect(STATUS_LABELS.cancelled).toBe("Cancelled");
  });
});

describe("pageTitle (product rename)", () => {
  it("joins section and app name with a bar, never a dash (D-113)", () => {
    expect(pageTitle("Dashboard")).toBe(`Dashboard | ${APP_NAME}`);
    expect(pageTitle("Dashboard")).not.toMatch(/[\u2013\u2014]/);
    expect(pageTitle("Dashboard")).not.toMatch(/ - /); // hyphen with spaces
  });

  it("still prepends the separator and app name for an empty section, rather than throwing", () => {
    expect(pageTitle("")).toBe(` | ${APP_NAME}`);
  });

  it("does not collide with a section that already contains a bar", () => {
    expect(pageTitle("Before | After")).toBe(`Before | After | ${APP_NAME}`);
  });

  it("does not truncate a very long section label", () => {
    const longSection = "A".repeat(500);
    const title = pageTitle(longSection);
    expect(title).toBe(`${longSection} | ${APP_NAME}`);
    expect(title.startsWith(longSection)).toBe(true);
  });
});

describe("document titles (R6.1, R10.5)", () => {
  it("builds the cover sheet title the client already receives", () => {
    expect(coverSheetTitle("Team Pursuit", "February 2026", "Analytical Support")).toBe(
      "Team Pursuit February 2026 Analytical Support Breakdown",
    );
  });

  it("builds the packet footer and the summary and index titles (D-113)", () => {
    expect(packetFooter("Team Pursuit", "February 2026", 7, 128)).toBe(
      "Team Pursuit | February 2026 | Page 7 of 128",
    );
    expect(packetFooter("Team Pursuit", "February 2026", 7, 128, "2026-02-014")).toBe(
      "Team Pursuit | February 2026 | 2026-02-014 | Page 7 of 128",
    );
    expect(packetSummaryTitle("Team Pursuit", "February 2026")).toBe(
      "Team Pursuit February 2026 Contract Summary",
    );
    expect(packetIndexTitle("Team Pursuit", "February 2026")).toBe("Team Pursuit February 2026 Expense Index");
  });

  it("puts the reference in brackets on the cover sheet heading, colon attached (R6.4, D-113)", () => {
    expect(coverSheetHeading("Jane Doe Pay Period 1", "2026-02-014")).toBe("Jane Doe Pay Period 1 (2026-02-014):");
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

describe("monthly summary title and filename (Phase 11 §7.4, U-21)", () => {
  it("builds the title and filename with no source name", () => {
    expect(monthlySummaryTitle("Team Pursuit", "March 2026")).toBe(
      "Team Pursuit March 2026 Monthly Summary",
    );
    expect(monthlySummaryFilename("Team Pursuit", "March 2026", "docx")).toBe(
      "Team Pursuit March 2026 Monthly Summary.docx",
    );
    expect(monthlySummaryFilename("Team Pursuit", "March 2026", "pdf")).toBe(
      "Team Pursuit March 2026 Monthly Summary.pdf",
    );
  });

  it("inserts the source name between the doc name and the month when given", () => {
    expect(monthlySummaryTitle("Team Pursuit", "March 2026", "City of Detroit")).toBe(
      "Team Pursuit City of Detroit March 2026 Monthly Summary",
    );
    expect(monthlySummaryFilename("Team Pursuit", "March 2026", "docx", "City of Detroit")).toBe(
      "Team Pursuit City of Detroit March 2026 Monthly Summary.docx",
    );
  });

  it("empty-string docName override: no leading space", () => {
    expect(monthlySummaryFilename("", "March 2026", "docx")).toBe(
      "March 2026 Monthly Summary.docx",
    );
    expect(monthlySummaryTitle("", "March 2026")).toBe("March 2026 Monthly Summary");
  });

  it("shortens only a very long source name, keeping the month and 'Monthly Summary' whole", () => {
    const longSource = "A".repeat(300);
    const name = monthlySummaryFilename("Team Pursuit", "March 2026", "docx", longSource);
    expect(name.startsWith("Team Pursuit ")).toBe(true);
    expect(name.endsWith(" March 2026 Monthly Summary.docx")).toBe(true);
    expect(name.length - ".docx".length).toBeLessThanOrEqual(150);
  });

  it("strips unsafe filename characters from every part", () => {
    const name = monthlySummaryFilename(
      'Team/Pursuit\\:*?"<>|',
      "March 2026",
      "docx",
      "../../etc\r\nSource",
    );
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).not.toContain("..");
    expect(name).not.toContain("\r");
    expect(name).not.toContain("\n");
    expect(name.endsWith("March 2026 Monthly Summary.docx")).toBe(true);
  });

  it("skips empty parts in the title rather than leaving a doubled space", () => {
    expect(monthlySummaryTitle("Team Pursuit", "March 2026", null)).toBe(
      "Team Pursuit March 2026 Monthly Summary",
    );
    expect(monthlySummaryTitle("Team Pursuit", "March 2026", "")).toBe(
      "Team Pursuit March 2026 Monthly Summary",
    );
    expect(monthlySummaryTitle("Team Pursuit", "March 2026", "   ")).toBe(
      "Team Pursuit March 2026 Monthly Summary",
    );
  });
});

describe("one plan name (PR #18 review #13): \"Plus\" in badges/tours, \"Reconciliation + AI\" only in plan/billing text", () => {
  it("no tour* string or the badge ever spells out the plan's billing name", () => {
    const tourKeys = Object.keys(UI).filter((key) => key.startsWith("tour"));
    expect(tourKeys.length).toBeGreaterThan(0);
    for (const key of tourKeys) {
      const value = (UI as Record<string, unknown>)[key];
      const text = typeof value === "string" ? value : (value as (...args: unknown[]) => string)("x");
      expect(text).not.toContain("Reconciliation + AI");
    }
    expect(UI.planPlusBadge).not.toContain("Reconciliation + AI");
    expect(UI.planPlusBadge).toBe("Plus");
  });

  it("plan/billing text spells out the full name", () => {
    expect(UI.summaryPlanNote).toContain("Reconciliation + AI");
    expect(PLAN_LABELS.reconciliation_ai).toBe("Reconciliation + AI");
  });
});

describe("`/a` staff dashboard UI strings (Phase 9 Phase 4)", () => {
  it("never doubles the period after a reason that already ends in one (PHASE-13 review)", () => {
    expect(UI.orgAccessPausedWithReason("Invoice unpaid.")).toBe(
      "Your organization's access is paused: Invoice unpaid. Please contact support.",
    );
    expect(UI.orgAccessPausedWithReason("Invoice unpaid")).toBe(
      "Your organization's access is paused: Invoice unpaid. Please contact support.",
    );
  });

  it("organizationsCount is singular only at exactly 1", () => {
    expect(UI.organizationsCount(0)).toBe("0 organizations");
    expect(UI.organizationsCount(1)).toBe("1 organization");
    expect(UI.organizationsCount(2)).toBe("2 organizations");
  });

  it("usageFundingSources pins the exact sentence, including the all-zero boundary", () => {
    expect(UI.usageFundingSources(2, 1)).toBe("2 active, 1 archived");
    expect(UI.usageFundingSources(0, 0)).toBe("0 active, 0 archived");
  });

  it("usageExpenses pins the exact sentence, including the all-zero boundary", () => {
    expect(UI.usageExpenses(412, 38, "September 2026")).toBe("412 total · 38 in September 2026");
    expect(UI.usageExpenses(0, 0, "September 2026")).toBe("0 total · 0 in September 2026");
  });

  it("usageStorage composes with the real formatBytes, at the zero and multi-GB boundaries", () => {
    const MB = 1024 * 1024;
    const GB = 1024 * MB;
    expect(UI.usageStorage(formatBytes(212 * MB), formatBytes(5 * GB))).toBe("212 MB of 5 GB");
    expect(UI.usageStorage(formatBytes(0), formatBytes(5 * GB))).toBe("0 B of 5 GB");
  });

  it("American spelling guard: no UI/PLAN_LABELS/STATUS_LABELS value ever regresses to 'organisation'", () => {
    for (const text of sampleUiTexts()) {
      expect(text.toLowerCase()).not.toContain("organisation");
    }
  });

  it("no-dash guard: no UI/PLAN_LABELS/STATUS_LABELS value contains an em or en dash (D-113)", () => {
    const texts = sampleUiTexts();
    expect(texts.length).toBeGreaterThan(200);
    const withDash = texts.filter((text) => /[\u2013\u2014]/.test(text));
    expect(withDash).toEqual([]);
  });
});

/**
 * Every `UI`, `PLAN_LABELS` and `STATUS_LABELS` value, plus the refusal helpers after them, with
 * each function-valued `UI` entry called on plausible arguments so its output text is checked
 * too, not just the literal entries. An entry with two shapes (a refund, a missing reason or
 * name) is called both ways.
 */
function sampleUiTexts(): string[] {
  const amounts = { subtotalCents: 15000, taxCents: 900, feesCents: 600, totalCents: 16500 };
  const refund = { subtotalCents: -14500, taxCents: 0, feesCents: 0, totalCents: -14500 };
  return [
    ...Object.values(PLAN_LABELS),
    ...Object.values(STATUS_LABELS),
    ...Object.values(FEATURE_REQUEST_STATUS_LABELS),
    ...Object.values(FEATURE_REQUEST_STATUS_DESCRIPTIONS),
    downloadBlockedReason(1),
    downloadBlockedReason(3),
    lineItemDeleteBlocked("Salary"),
    ...Object.entries(UI).flatMap(([key, value]): string[] => {
      if (typeof value === "string") return [value];
      switch (key) {
        case "amountsSummary":
        case "receiptLineAmounts":
          return [amounts, refund].map((sample) => (value as (a: typeof amounts) => string)(sample));
        case "unlockEventLine":
          return [
            (value as (d: string, n: string, r: string | null) => string)("9/1/2026", "Misty", "City asked"),
            (value as (d: string, n: string, r: string | null) => string)("9/1/2026", "Misty", null),
          ];
        case "summaryMetaEdited":
          return [
            (value as (d: string, n: string | null) => string)("9/1/2026", "Misty"),
            (value as (d: string, n: string | null) => string)("9/1/2026", null),
          ];
        case "summarySavedRowDate":
          return [true, false].map((edited) => (value as (d: string, e: boolean) => string)("9/1/2026", edited));
        case "shareStopTitle":
          return (["packet", "summary"] as const).map((noun) =>
            (value as (m: string, n: "packet" | "summary") => string)("March 2026", noun),
          );
        case "suspendDialogTitle":
        case "reinstateDialogTitle":
          return [(value as (name: string) => string)("Eastside Youth Alliance")];
        case "noReceiptNote":
          return [(value as (reason: string) => string)("reason")];
        case "complimentaryUntil":
        case "complimentaryEnded":
          return [(value as (date: string) => string)("1 Jan 2027")];
        // The entries that take a list rather than a string: called with a real one, or
        // the generic "x" below would sample a sentence about a file named undefined.
        case "draftSavedNotApproved":
          return [(value as (needs: string[]) => string)(["Needs a line item", "Needs a narrative"])];
        case "coverSheetFollowingDocs":
          return [(value as (filenames: string[]) => string)(["receipt.pdf", "check.pdf"])];
        // Usability round 1: an object argument, and count-first entries sampled at 1 and many,
        // so every sentence each can produce reaches the dash and spelling guards.
        case "invoiceWholeBillCharge":
          return [
            { tax: "$12.00", fees: null },
            { tax: null, fees: "$3.50" },
            { tax: "$12.00", fees: "$3.50" },
          ].map((sample) => (value as (a: { tax: string | null; fees: string | null }) => string)(sample));
        case "draftsWaitingTitle":
          return [1, 3].map((n) => (value as (c: number, a: string) => string)(n, "$120.00"));
        case "draftsWaitingLockedBody":
          return [1, 3].map((n) => (value as (c: number, m: string) => string)(n, "September 2026"));
        case "draftsWaitingBody":
        case "summaryDraftsWaiting":
        case "markSubmittedMissing":
        case "pageCount":
          return [1, 3].map((n) => (value as (c: number) => string)(n));
        case "invoiceCheckHeading":
          return [
            [1, "Eastside Catering", "2210"],
            [3, "Eastside Catering", null],
            [3, null, "2210"],
            [3, null, null],
          ].map((args) => (value as (...a: unknown[]) => string)(...args));
        case "invoiceFilesNotAttached":
          return [
            [{ filename: "timesheet.png", reason: "Choose a document type first." }],
            [
              { filename: "timesheet.png", reason: "Choose a document type first." },
              { filename: "receipt.png", reason: "That file could not be uploaded." },
            ],
          ].map((sample) =>
            (value as (files: Array<{ filename: string; reason: string }>) => string)(sample),
          );
        case "usageFundingSources":
          return [(value as (a: number, b: number) => string)(2, 1)];
        case "usageExpenses":
          return [(value as (t: number, m: number, label: string) => string)(412, 38, "September 2026")];
        case "usageStorage":
          return [(value as (used: string, limit: string) => string)("212 MB", "5 GB")];
        case "organizationsCount":
          return [(value as (n: number) => string)(2)];
        case "featureRequestVotes":
        case "staffFeatureRequestsCount":
        case "staffFeatureRequestsNeedingAttention":
        case "staffFeatureRequestsShowAttention":
          return [0, 1, 7].map((n) => (value as (n: number) => string)(n));
        case "featureRequestsCapped":
        case "staffFeatureRequestsCapped":
          return [(value as (n: number) => string)(100)];
        case "featureRequestTooLong":
          return [(value as (n: number) => string)(2000)];
        case "featureRequestSuggestedBy":
          return [
            (value as (n: string | null, d: string) => string)("Misty", "3/12/2026"),
            (value as (n: string | null, d: string) => string)(null, "3/12/2026"),
          ];
        case "staffFeatureRequestVotesFrom":
          return [
            (value as (v: number, o: number) => string)(1, 1),
            (value as (v: number, o: number) => string)(7, 4),
          ];
        case "historyPlanChanged":
          return [(value as (from: string, to: string) => string)("Reconciliation", "Reconciliation + AI")];
        case "historyStatusChanged":
          return [(value as (from: string, to: string) => string)("Trial", "Active")];
        case "historyPlanAndStatusChanged":
          return [(value as (a: string, b: string, c: string, d: string) => string)(
            "Reconciliation",
            "Reconciliation + AI",
            "Trial",
            "Active",
          )];
        case "expenseSaved":
          return [null, ["proof", "receipt", "narrative"] as const].map((missing) =>
            (value as (m: readonly string[] | null) => string)(missing),
          );
        case "recurringAdded":
          return [null, ["proof", "receipt", "narrative"] as const].map((missing) =>
            (value as (n: string, mo: string, m: readonly string[] | null) => string)("Adobe", "September 2026", missing),
          );
        case "historyComplimentaryGrantedUntil":
        case "historyComplimentaryChangedUntil":
          return [(value as (date: string) => string)("30 Jun 2027")];
        default:
          // Any other function-valued entry: call with a generic string arg as a best effort.
          return [(value as (...args: unknown[]) => string)("x")];
      }
    }),
  ];
}

describe("sharing copy (PHASE-12, Appendix A verbatim)", () => {
  it("pins the ticket's wording", () => {
    expect(UI.shareButton).toBe("Share link");
    expect(UI.shareDialogTitle("March 2026")).toBe("Share March 2026 files");
    expect(UI.shareChoicePacketHint).toBe("Opens in the browser. Clickable references work in Chrome, Edge and Safari.");
    expect(UI.shareChoiceSummaryHint).toBe("Downloads the Excel file.");
    expect(UI.shareCreatingPacket).toBe("Preparing the packet…");
    expect(UI.sharePasswordNote).toBe("Password protected. Send the password separately, for example by text.");
    expect(UI.sharedOn("4/8/2026", "Misty")).toBe("Shared on 4/8/2026 by Misty");
    expect(UI.shareStopTitle("March 2026", "packet")).toBe("Stop sharing the March 2026 packet?");
    expect(UI.shareStopTitle("March 2026", "summary")).toBe("Stop sharing the March 2026 summary?");
    expect(UI.shareStopBody).toBe("Anyone who has the link won't be able to open it.");
    expect(UI.shareRecordsChanged("4/8/2026")).toBe(
      "Your records changed since you shared this file on 4/8/2026. The link still gives the older file.",
    );
    expect(UI.sharePasswordProtected).toBe("This file is password protected.");
    expect(UI.sharePasswordWrong).toBe("That password isn't right.");
    expect(UI.shareTooManyTries).toBe("Too many tries. Please wait 15 minutes and try again.");
    expect(UI.shareUnavailable).toBe("This link is no longer available. Please ask the sender for a new one.");
  });
});

describe("funding source limit copy (Phase 16 Track C, C8 verbatim)", () => {
  it("pins the ticket's wording", () => {
    expect(UI.fundingSourceLimitReached).toBe(
      "Reconciliation includes one active funding source. To add more, switch to Reconciliation + AI.",
    );
    expect(UI.fundingSourceLimitManager).toBe(
      "Reconciliation includes one active funding source. Ask your admin about upgrading.",
    );
    expect(UI.fundingSourceLimitQueued("10/1/2026")).toBe(
      "Your plan switches to Reconciliation on 10/1/2026, which includes one active funding source. To add another, cancel that switch in Plan & billing.",
    );
    expect(UI.billingSeePlans).toBe("See plans");
  });
});

describe("feature requests copy (PHASE-17, Appendix A verbatim)", () => {
  it("pins the ticket's wording", () => {
    expect(UI.featureRequestsIntro).toBe(
      "Tell us what would make Stay Funded 360 work better for you. Our team reads every request and replies here.",
    );
    expect(UI.featureRequestSuggest).toBe("Suggest a feature");
    expect(UI.featureRequestSearchLabel).toBe("Search requests");
    expect(UI.featureRequestTabAll).toBe("All requests");
    expect(UI.featureRequestTabOrg).toBe("From your organization");
    expect(UI.featureRequestWaitingNote).toBe("Only your organization can see this until our team reviews it.");
    expect(UI.featureRequestTeamReplied).toBe("Our team replied");
    expect(UI.featureRequestVote).toBe("I want this too");
    expect(UI.featureRequestVoted).toBe("You want this");
    expect(UI.featureRequestTitleLabel).toBe("What would you like?");
    expect(UI.featureRequestTitlePlaceholder).toBe(
      "For example: Remind us when receipts are missing before month end",
    );
    expect(UI.featureRequestDetailsLabel).toBe("Tell us more");
    expect(UI.featureRequestDetailsHelp).toBe("What are you trying to do, and how would it help your team?");
    expect(UI.featureRequestSend).toBe("Send request");
    expect(UI.featureRequestSent).toBe("Thanks. Your request was sent to our team.");
    expect(UI.featureRequestDailyLimit).toBe("You've sent a lot of requests today. Please try again tomorrow.");
    expect(UI.featureRequestTeamSignature).toBe("Stay Funded 360 team");
    expect(UI.featureRequestSuggestedBy("Misty", "3/12/2026")).toBe("Suggested by Misty on 3/12/2026");
    expect(UI.featureRequestSuggestedBy(null, "3/12/2026")).toBe("Suggested on 3/12/2026");
    expect(UI.featureRequestVotes(1)).toBe("1 vote");
    expect(UI.featureRequestVotes(7)).toBe("7 votes");
    expect(UI.featureRequestTooLong(2000)).toBe("Keep this to 2,000 characters or fewer.");
    expect(UI.staffFeatureRequestShowToAll).toBe("Show to all organizations");
    expect(UI.staffFeatureRequestShowToAllHelp).toBe(
      "Other organizations see only the title, details, status and votes. They never see who asked or any replies.",
    );
    expect(UI.staffFeatureRequestVotesFrom(7, 4)).toBe("7 votes from 4 organizations");
    expect(UI.staffFeatureRequestReplyTo("Team Pursuit")).toBe("Reply to Team Pursuit");
  });

  it("names every status as ticket §5 does", () => {
    expect(Object.values(FEATURE_REQUEST_STATUS_LABELS)).toEqual([
      "Waiting for review",
      "Considering",
      "Planned",
      "In progress",
      "Released",
      "Not planned",
      "Already requested",
    ]);
    expect(FEATURE_REQUEST_STATUS_DESCRIPTIONS.not_planned).toBe("It won't be built. A reply says why.");
  });
});

describe("usability round 1, batch A copy (#30, #44, #49, #51)", () => {
  const DASH = /[–—]/;

  it("expenseSaved: the plain line when nothing is missing (null or empty)", () => {
    expect(UI.expenseSaved(null)).toBe("Expense saved.");
    expect(UI.expenseSaved([])).toBe("Expense saved.");
  });

  it("expenseSaved: one, two and three gaps, Oxford comma for three, never R4.4's 'both'", () => {
    expect(UI.expenseSaved(["proof"])).toBe("Expense saved. It's still missing proof of payment.");
    expect(UI.expenseSaved(["receipt"])).toBe("Expense saved. It's still missing a receipt.");
    expect(UI.expenseSaved(["proof", "receipt"])).toBe(
      "Expense saved. It's still missing proof of payment and a receipt.",
    );
    expect(UI.expenseSaved(["proof", "receipt", "narrative"])).toBe(
      "Expense saved. It's still missing proof of payment, a receipt, and a narrative.",
    );
    expect(UI.expenseSaved(["proof", "receipt"])).not.toMatch(/\bboth\b/);
  });

  it("recurringAdded: names the item, the month and every gap", () => {
    expect(UI.recurringAdded("Adobe", "September 2026", null)).toBe("Adobe added to September 2026.");
    expect(UI.recurringAdded("Adobe", "September 2026", [])).toBe("Adobe added to September 2026.");
    expect(UI.recurringAdded("Adobe", "September 2026", ["proof", "receipt"])).toBe(
      "Adobe added to September 2026. It's still missing proof of payment and a receipt.",
    );
    expect(UI.recurringAdded("Adobe", "September 2026", ["proof", "receipt", "narrative"])).toBe(
      "Adobe added to September 2026. It's still missing proof of payment, a receipt, and a narrative.",
    );
  });

  it("newUserSignIn: one ready-to-send sentence with the link and the password", () => {
    expect(UI.newUserSignIn("https://app.example.org/login", "Pw-123456789")).toBe(
      "Sign in at https://app.example.org/login with your email address and this password: Pw-123456789",
    );
  });

  it("pins the fixed lines", () => {
    expect(UI.openExpense).toBe("Open expense");
    expect(UI.checkHighlightedFields).toBe("Check the highlighted fields.");
    expect(UI.managerRoleHint).toBe(
      "New users are added as Managers. A Manager can do everything except manage users, change the plan or billing, change AI settings, and see an expense's History.",
    );
  });

  it("no em or en dash in any of them", () => {
    const all = [
      UI.expenseSaved(null),
      UI.expenseSaved(["proof", "receipt", "narrative"]),
      UI.recurringAdded("A", "B", ["proof", "receipt", "narrative"]),
      UI.newUserSignIn("u", "p"),
      UI.openExpense,
      UI.checkHighlightedFields,
      UI.managerRoleHint,
    ];
    for (const line of all) expect(line).not.toMatch(DASH);
    expect(all).toHaveLength(7);
  });
});

describe("usability round 1 copy: dashboard, packet, cover sheets, tours, AI screens (2026-09-29)", () => {
  it("fixed lines, verbatim", () => {
    expect(UI.dashboardAiIntro).toBe(
      "Your plan includes AI. It reads receipt amounts and turns invoices into expenses on Add Expense, and writes your monthly summary on the Month-End Packet page.",
    );
    expect(UI.dashboardAiIntroSummaryOnly).toBe(
      "Your plan includes AI. It writes your monthly summary on the Month-End Packet page.",
    );
    expect(UI.draftsReviewLink).toBe("Review drafts");
    expect(UI.packetReadyNextSteps).toBe(
      "The packet is ready. Next: 1. Download the packet. 2. Send it to your funder. 3. Mark as submitted. 4. When the signed copy comes back, Lock month.",
    );
    expect(UI.packetSubmittedNextStep).toBe(
      "The packet is marked as submitted. When the signed copy comes back, Lock month.",
    );
    expect(UI.markSubmittedButton).toBe("Mark as submitted");
    expect(UI.markSubmittedBody).toBe(
      "Do this once you've sent the packet to your funder. The month's figures are saved as they are now, so any later change is shown to you. You can still make corrections.",
    );
    expect(UI.markSubmittedAnyway).toBe("You can still mark the month as submitted.");
    expect(UI.undoSubmittedBody).toBe(
      "The month goes back to not submitted. If you mark it again later, the figures are saved fresh at that time.",
    );
    expect(UI.coverSheetWhatItIs).toBe(
      "A cover sheet lists this line item's expenses for the month, with each proof of payment. It goes into the packet for your funder.",
    );
    expect(UI.amountsUsed).toBe("Amounts used");
    expect(UI.invoiceExtractFromInvoice).toBe("Extract from invoice");
    expect(UI.invoiceExtractHint).toBe(
      "Upload one invoice. Each charge on it is read out for you to check before anything is saved.",
    );
    expect(UI.invoiceDoneHint).toBe(
      "Nothing is saved until you press Done. Then charges marked Saving as expense become expenses, and the rest become drafts waiting for review on the Expenses page.",
    );
    expect(UI.tourContinueButton).toBe("Continue the tour");
    expect(UI.tourSkipAllButton).toBe("Skip all tours");
  });

  it("the Continue button names no plan at all", () => {
    expect(UI.tourContinueButton).not.toMatch(/Plus|Reconciliation|AI/);
  });

  it("the limit text names the plan in full, not Plus (#23, P18)", () => {
    expect(UI.fundingSourceLimitReached).toContain("switch to Reconciliation + AI.");
    expect(UI.fundingSourceLimitReached).not.toContain("Plus");
  });

  it("drafts card: title singular at one, plural otherwise, the amount as given (E10, E14)", () => {
    expect(UI.draftsWaitingTitle(1, "$120.00")).toBe("1 draft waiting for review · $120.00");
    expect(UI.draftsWaitingTitle(3, "$0.00")).toBe("3 drafts waiting for review · $0.00");
    expect(UI.draftsWaitingTitle(2, "-$10.00")).toBe("2 drafts waiting for review · -$10.00");
    expect(UI.draftsWaitingBody(1)).toBe("It isn't in your totals or the packet until you approve it.");
    expect(UI.draftsWaitingBody(3)).toBe("They aren't in your totals or the packet until you approve them.");
  });

  it("drafts card on a locked month: no promise of approval, singular and plural", () => {
    expect(UI.draftsWaitingLockedBody(1, "September 2026")).toBe(
      "September 2026 is locked, so it can't be approved until the month is unlocked.",
    );
    expect(UI.draftsWaitingLockedBody(3, "September 2026")).toBe(
      "September 2026 is locked, so they can't be approved until the month is unlocked.",
    );
    expect(UI.draftsWaitingLockedBody(3, "September 2026")).not.toContain("until you approve");
  });

  it("summaryDraftsWaiting: singular at one, plural otherwise", () => {
    expect(UI.summaryDraftsWaiting(1)).toBe("1 draft is still waiting for review, so it isn't in this summary.");
    expect(UI.summaryDraftsWaiting(4)).toBe("4 drafts are still waiting for review, so they aren't in this summary.");
  });

  it("pageCount: '1 page', '0 pages', '2 pages' (E28)", () => {
    expect(UI.pageCount(1)).toBe("1 page");
    expect(UI.pageCount(0)).toBe("0 pages");
    expect(UI.pageCount(2)).toBe("2 pages");
  });

  it("markSubmittedTitle and markSubmittedMissing, singular and plural (E23, E24)", () => {
    expect(UI.markSubmittedTitle("September 2026")).toBe("Mark September 2026 as submitted?");
    // Undo is worded the same way, naming the month (usability #36).
    expect(UI.undoSubmittedTitle("September 2026")).toBe("Undo marking September 2026 as submitted?");
    expect(UI.markSubmittedMissing(1)).toBe(
      "1 expense is still missing documents, so the packet can't be downloaded yet:",
    );
    expect(UI.markSubmittedMissing(3)).toBe(
      "3 expenses are still missing documents, so the packet can't be downloaded yet:",
    );
  });

  it("coverSheetFollowingDocs lists the files in the order given (E38)", () => {
    expect(UI.coverSheetFollowingDocs(["receipt.pdf", "check.pdf"])).toBe(
      "In the packet, after this cover sheet: receipt.pdf, check.pdf.",
    );
  });

  it("invoiceCheckHeading: vendor and number, either, or neither; one charge; never '##' (E48)", () => {
    expect(UI.invoiceCheckHeading(3, "Eastside Catering", "2210")).toBe(
      "3 charges from Eastside Catering, invoice #2210",
    );
    expect(UI.invoiceCheckHeading(3, "Eastside Catering", null)).toBe("3 charges from Eastside Catering");
    expect(UI.invoiceCheckHeading(3, null, "2210")).toBe("3 charges from invoice #2210");
    expect(UI.invoiceCheckHeading(3, null, null)).toBe("3 charges from this invoice");
    expect(UI.invoiceCheckHeading(1, "Eastside Catering", null)).toBe("1 charge from Eastside Catering");
    expect(UI.invoiceCheckHeading(2, null, "#2210")).toBe("2 charges from invoice #2210");
    expect(UI.invoiceCheckHeading(2, null, "## 2210")).toBe("2 charges from invoice #2210");
  });

  it("invoiceCheckHeading drops a label the reader kept with the number, never part of the number (review)", () => {
    expect(UI.invoiceCheckHeading(2, "Eastside", "Invoice #2210")).toBe("2 charges from Eastside, invoice #2210");
    expect(UI.invoiceCheckHeading(2, "Eastside", "invoice no. 2210")).toBe("2 charges from Eastside, invoice #2210");
    expect(UI.invoiceCheckHeading(2, "Eastside", "No. 2210")).toBe("2 charges from Eastside, invoice #2210");
    expect(UI.invoiceCheckHeading(2, "Eastside", "Invoice number: 2210")).toBe("2 charges from Eastside, invoice #2210");
    // "No", "Number" and "ID", with or without a dot, before a space, "#", ":" or ".".
    const labelled = ["No.2210", "No 2210", "no: 2210", "Number #2210", "ID: 2210", "ID.2210", "Invoice ID 2210"];
    for (const input of labelled) {
      expect(UI.invoiceCheckHeading(2, "Eastside", input), input).toBe("2 charges from Eastside, invoice #2210");
    }
    // "Invoice" or "Inv." only before a space, "#" or ":".
    expect(UI.invoiceCheckHeading(2, "Eastside", "Inv. 2210")).toBe("2 charges from Eastside, invoice #2210");
    expect(UI.invoiceCheckHeading(2, "Eastside", "Invoice: 2210")).toBe("2 charges from Eastside, invoice #2210");
    // A number that merely starts with letters is the number itself.
    const whole = ["INV-2210", "INVOICE-2210", "NOV2210", "Number2210", "IDA-5", "Inv.2210"];
    for (const input of whole) {
      expect(UI.invoiceCheckHeading(2, "Eastside", input), input).toBe(`2 charges from Eastside, invoice #${input}`);
    }
    // Only a label, no number: none.
    expect(UI.invoiceCheckHeading(2, "Eastside", "Invoice #")).toBe("2 charges from Eastside");
    expect(UI.invoiceCheckHeading(2, "Eastside", "Invoice No.")).toBe("2 charges from Eastside");
  });

  it("invoiceCheckHeading treats a blank vendor or number as none", () => {
    expect(UI.invoiceCheckHeading(2, "   ", "  ")).toBe("2 charges from this invoice");
    expect(UI.invoiceCheckHeading(2, "  Eastside  ", "#")).toBe("2 charges from Eastside");
  });

  it("invoiceCheckHeading on a check kept from before the field existed (E49)", () => {
    // An old stored check has no invoiceNumber at all: the function itself copes with undefined,
    // whatever the screen passes (the screen also reads `check.invoiceNumber ?? null`).
    expect(UI.invoiceCheckHeading(2, "Eastside Catering", undefined as unknown as null)).toBe(
      "2 charges from Eastside Catering",
    );
  });

  it("invoiceWholeBillCharge: tax only, fees only, both, neither (E52)", () => {
    expect(UI.invoiceWholeBillCharge({ tax: "$12.00", fees: null })).toBe(
      "This invoice has $12.00 of tax on the whole bill, not on any one line, so it isn't in the charges below. Add the $12.00 tax as its own expense if your funder reimburses tax.",
    );
    expect(UI.invoiceWholeBillCharge({ tax: null, fees: "$3.50" })).toBe(
      "This invoice has $3.50 of fees on the whole bill, not on any one line, so they aren't in the charges below. Add the $3.50 fees as their own expense if your funder reimburses fees.",
    );
    expect(UI.invoiceWholeBillCharge({ tax: "$12.00", fees: "$3.50" })).toBe(
      "This invoice has $12.00 of tax and $3.50 of fees on the whole bill, not on any one line, so they aren't in the charges below. Add the $12.00 tax and the $3.50 fees as their own expenses if your funder reimburses them.",
    );
    expect(UI.invoiceWholeBillCharge({ tax: null, fees: null })).toBe("");
  });
});
