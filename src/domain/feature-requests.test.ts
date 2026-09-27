import { describe, expect, it } from "vitest";

import { UI } from "./strings";
import {
  backHref,
  canShowToAll,
  checkReplyBody,
  checkWording,
  FEATURE_REQUEST_SEARCH_MAX,
  likePattern,
  listHref,
  normalizeTitle,
  parseFeatureRequestStatus,
  parseListParams,
  parseStaffFilter,
  searchWords,
  staffListHref,
  votingOpen,
  withoutNul,
} from "./feature-requests";

describe("which statuses allow what (ticket §2, §5; PHASE-17 Q3)", () => {
  it("never shows Waiting for review or Already requested to other organizations", () => {
    expect(canShowToAll("waiting_for_review")).toBe(false);
    expect(canShowToAll("already_requested")).toBe(false);
    for (const status of ["considering", "planned", "in_progress", "released", "not_planned"] as const) {
      expect(canShowToAll(status), status).toBe(true);
    }
  });

  it("closes voting on Released, Not planned and Already requested, and only those", () => {
    expect(votingOpen("released")).toBe(false);
    expect(votingOpen("not_planned")).toBe(false);
    expect(votingOpen("already_requested")).toBe(false);
    for (const status of ["waiting_for_review", "considering", "planned", "in_progress"] as const) {
      expect(votingOpen(status), status).toBe(true);
    }
  });
});

describe("NUL characters, which Postgres refuses in text", () => {
  it("are taken out of typed text, titles, replies and a search from the URL", () => {
    expect(withoutNul("a\u0000b\u0000")).toBe("ab");
    expect(checkWording({ title: "Split\u0000 it", details: "x\u0000" })).toEqual({ ok: true, title: "Split it", details: "x" });
    expect(checkReplyBody("\u0000")).toEqual({ ok: false, error: UI.featureRequestReplyRequired });
    expect(parseListParams({ q: "\u0000receipts" }).q).toBe("receipts");
    expect(parseStaffFilter({ q: "\u0000" }).filter.q).toBe("");
  });
});

describe("the wording both Suggest and the staff Edit save", () => {
  it("folds the title, trims both, and names each field's problem", () => {
    expect(checkWording({ title: " A\nB ", details: " x " })).toEqual({ ok: true, title: "A B", details: "x" });
    expect(checkWording({ title: " ", details: "" })).toEqual({
      ok: false,
      fieldErrors: { title: UI.featureRequestTitleRequired, details: UI.featureRequestDetailsRequired },
    });
    expect(checkWording({ title: "t".repeat(100), details: "d".repeat(2000) }).ok).toBe(true);
    expect(checkWording({ title: "t".repeat(101), details: "d".repeat(2001) })).toEqual({
      ok: false,
      fieldErrors: { title: UI.featureRequestTooLong(100), details: UI.featureRequestTooLong(2000) },
    });
  });

  it("takes a reply of up to 2,000 characters after trimming", () => {
    expect(checkReplyBody(`  ${"r".repeat(2000)}  `)).toEqual({ ok: true, body: "r".repeat(2000) });
    expect(checkReplyBody("r".repeat(2001))).toEqual({ ok: false, error: UI.featureRequestTooLong(2000) });
    expect(checkReplyBody("   ")).toEqual({ ok: false, error: UI.featureRequestReplyRequired });
  });
});

describe("reading a status from the URL", () => {
  it("accepts the seven statuses and nothing else, prototype names included", () => {
    expect(parseFeatureRequestStatus("planned")).toBe("planned");
    for (const crafted of ["constructor", "__proto__", "toString", "hasOwnProperty", "PLANNED", "", undefined]) {
      expect(parseFeatureRequestStatus(crafted), String(crafted)).toBeNull();
    }
  });
});

describe("text", () => {
  it("folds a title onto one line", () => {
    expect(normalizeTitle("  Split one\nreceipt \t across  sources ")).toBe("Split one receipt across sources");
  });

  it("splits a search into words and ignores spaces only", () => {
    expect(searchWords("missing   receipts")).toEqual(["missing", "receipts"]);
    expect(searchWords("")).toEqual([]);
  });

  it("escapes the ilike wildcards so they search for themselves", () => {
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("c:\\x")).toBe("%c:\\\\x%");
  });
});

describe("the customer list URL", () => {
  it("reads tab=org as the org tab and anything else as All", () => {
    expect(parseListParams({ tab: "org" }).tab).toBe("org");
    expect(parseListParams({ tab: "ORG" }).tab).toBe("all");
    expect(parseListParams({ tab: ["org", "all"] }).tab).toBe("org");
    expect(parseListParams({}).tab).toBe("all");
  });

  it("trims the search and caps it", () => {
    expect(parseListParams({ q: "  receipts  " }).q).toBe("receipts");
    expect(parseListParams({ q: "   " }).q).toBe("");
    expect(parseListParams({ q: "x".repeat(500) }).q).toHaveLength(FEATURE_REQUEST_SEARCH_MAX);
  });

  it("builds the same URL it reads", () => {
    expect(listHref({ tab: "all", q: "" })).toBe("/r/feature-requests");
    expect(listHref({ tab: "org", q: "missing receipts" })).toBe("/r/feature-requests?tab=org&q=missing+receipts");
    const params = Object.fromEntries(new URL(listHref({ tab: "org", q: "a&b" }), "http://x").searchParams);
    expect(parseListParams(params)).toEqual({ tab: "org", q: "a&b" });
  });
});

describe("the back link", () => {
  it("keeps a query string and refuses anything else", () => {
    expect(backHref("/r/feature-requests", "?tab=org&q=x")).toBe("/r/feature-requests?tab=org&q=x");
    expect(backHref("/r/feature-requests", "https://evil.example")).toBe("/r/feature-requests");
    expect(backHref("/r/feature-requests", "//evil.example")).toBe("/r/feature-requests");
    expect(backHref("/r/feature-requests", undefined)).toBe("/r/feature-requests");
  });
});

describe("the /a list URL", () => {
  it("drops a crafted status and a nonsense page rather than passing them on", () => {
    expect(parseStaffFilter({ status: "constructor", page: "abc" })).toEqual({
      filter: { q: "", status: null, attention: false },
      page: 1,
    });
  });

  it("round-trips a full filter", () => {
    const filter = { q: "receipts", status: "planned" as const, attention: true };
    const params = Object.fromEntries(new URL(staffListHref(filter, 3), "http://x").searchParams);
    expect(parseStaffFilter(params)).toEqual({ filter, page: 3 });
    expect(staffListHref({ q: "", status: null, attention: false }, 1)).toBe("/a/feature-requests");
  });
});
