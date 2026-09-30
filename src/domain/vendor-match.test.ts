/**
 * Receipt vendor to vendor library (Phase 19): what counts as the same business, and what is
 * deliberately not matched.
 */
import { describe, expect, it } from "vitest";

import { matchLibraryVendor, sameName, vendorKey } from "./vendor-match";

describe("vendorKey", () => {
  it("ignores capitals, a leading The, store numbers and legal endings", () => {
    expect(vendorKey("THE HOME DEPOT #2718")).toBe("home depot");
    expect(vendorKey("Home Depot")).toBe("home depot");
    expect(vendorKey("Amazon.com Services LLC")).toBe("amazon services");
    expect(vendorKey("Amazon.com")).toBe("amazon");
    expect(vendorKey("Staples Inc.")).toBe("staples");
    expect(vendorKey("Kroger Store 512")).toBe("kroger");
    expect(vendorKey("Lowe's")).toBe("lowes");
    expect(vendorKey("Lowe’s")).toBe("lowes");
    expect(vendorKey("Crème Café")).toBe("creme cafe");
    expect(vendorKey("JDS Silkscreen & Embroidery")).toBe("jds silkscreen and embroidery");
  });

  it("never strips a name down to nothing", () => {
    expect(vendorKey("The")).toBe("the");
    expect(vendorKey("Store")).toBe("store");
    expect(vendorKey("7-Eleven")).toBe("7 eleven");
    expect(vendorKey("#2718")).toBe("");
    expect(vendorKey("   ")).toBe("");
  });
});

describe("matchLibraryVendor", () => {
  const library = [
    "Home Depot",
    "Amazon",
    "Lowes",
    "Staples",
    "Payroll - Pay Period 1",
    "Reimbursed Purchases",
    "Emerald Sims",
  ];

  it("offers the library's spelling for the same business", () => {
    expect(matchLibraryVendor("THE HOME DEPOT #2718", library)).toBe("Home Depot");
    expect(matchLibraryVendor("The Home Depot", library)).toBe("Home Depot");
    expect(matchLibraryVendor("Amazon.com", library)).toBe("Amazon");
    expect(matchLibraryVendor("Lowe's", library)).toBe("Lowes");
    expect(matchLibraryVendor("STAPLES INC", library)).toBe("Staples");
  });

  it("does not match a longer or different name that merely starts the same", () => {
    expect(matchLibraryVendor("Amazon Web Services", library)).toBeNull();
    expect(matchLibraryVendor("Home Depot Pro", library)).toBeNull();
    expect(matchLibraryVendor("Staples Center", library)).toBeNull();
  });

  it("never lands on a label or a person by accident", () => {
    expect(matchLibraryVendor("Walmart", library)).toBeNull();
    expect(matchLibraryVendor("ADP Payroll", library)).toBeNull();
    expect(matchLibraryVendor("Emerald", library)).toBeNull();
  });

  it("a short trailing number is part of the name, not a store number", () => {
    const labels = ["Payroll - Pay Period 1", "Lot 12", "Motel", "Studio"];
    expect(matchLibraryVendor("Payroll Pay Period 3", labels)).toBeNull();
    expect(matchLibraryVendor("Lot 49", labels)).toBeNull();
    expect(matchLibraryVendor("Motel 6", labels)).toBeNull();
    expect(matchLibraryVendor("Studio 54", labels)).toBeNull();
    expect(matchLibraryVendor("Payroll - Pay Period 1", labels)).toBe("Payroll - Pay Period 1");
    expect(vendorKey("Walgreens 04512")).toBe("walgreens");
  });

  it("names in another alphabet keep their letters, so two different ones never match", () => {
    expect(vendorKey("東京ラーメン")).toBe("東京ラーメン");
    expect(matchLibraryVendor("大阪ラーメン", ["東京ラーメン"])).toBeNull();
    expect(matchLibraryVendor("東京ラーメン", ["東京ラーメン"])).toBe("東京ラーメン");
  });

  it("a person's own timesheet does match their remembered name", () => {
    expect(matchLibraryVendor("EMERALD SIMS", library)).toBe("Emerald Sims");
  });

  it("two library names for the same business are a tie, and a tie is not guessed", () => {
    expect(matchLibraryVendor("Lowe's", ["Lowes", "Lowe's", "Staples"])).toBeNull();
  });

  it("nothing to match with an empty read or an empty library", () => {
    expect(matchLibraryVendor("#2718", library)).toBeNull();
    expect(matchLibraryVendor("Home Depot", [])).toBeNull();
  });
});

describe("sameName", () => {
  it("capitals and spacing aside, the same text", () => {
    expect(sameName("home  depot ", "Home Depot")).toBe(true);
    expect(sameName("Home Depot", "Home Depot")).toBe(true);
    expect(sameName("The Home Depot", "Home Depot")).toBe(false);
    expect(sameName("", "Home Depot")).toBe(false);
  });
});
