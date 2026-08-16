import { describe, expect, it } from "vitest";

import { contractContextItems, contractContextLine } from "./contract-context";

const FEB = "2026-02";

const FULL = {
  contractNumber: "6007211",
  basePoNumber: "3086984",
  performancePoNumber: "3089749",
  contractValueCents: 94_000_000,
  scheduledTotalCents: 85_491_667,
};

describe("contract context strip (R7.3)", () => {
  it("reads exactly as the design specifies", () => {
    expect(contractContextItems(FULL, FEB).map((item) => item.text)).toEqual([
      "Contract 6007211",
      "Contract total: $940,000.00",
      "Base PO 3086984",
      "Performance PO 3089749",
      "Invoice period: 2/1/2026 to 2/28/2026",
    ]);
  });

  it("omits settings the organisation has not filled in", () => {
    const items = contractContextItems(
      { ...FULL, contractNumber: "", basePoNumber: "", performancePoNumber: "" },
      FEB,
    );
    expect(items.map((item) => item.label)).toEqual(["Contract total", "Invoice period"]);
  });

  it("treats whitespace-only settings as empty", () => {
    const items = contractContextItems({ ...FULL, contractNumber: "   " }, FEB);
    expect(items.map((item) => item.label)).not.toContain("Contract");
  });

  it("falls back to the scheduled total when no contract value is set (R7.3)", () => {
    const items = contractContextItems({ ...FULL, contractValueCents: 0 }, FEB);
    expect(items.find((item) => item.label === "Contract total")?.value).toBe("$854,916.67");
  });

  it("drops the total entirely when there is no budget either", () => {
    const items = contractContextItems(
      { ...FULL, contractValueCents: 0, scheduledTotalCents: 0 },
      FEB,
    );
    expect(items.map((item) => item.label)).not.toContain("Contract total");
  });

  it("always shows the invoice period, since it needs no configuration", () => {
    const items = contractContextItems(
      {
        contractNumber: "",
        basePoNumber: "",
        performancePoNumber: "",
        contractValueCents: 0,
        scheduledTotalCents: 0,
      },
      FEB,
    );
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Invoice period: 2/1/2026 to 2/28/2026");
  });

  it("uses the right last day for a short month and a leap February", () => {
    expect(contractContextItems(FULL, "2026-04")[4].value).toBe("4/1/2026 to 4/30/2026");
    expect(contractContextItems(FULL, "2024-02")[4].value).toBe("2/1/2024 to 2/29/2024");
  });

  it("joins into the packet's single subtitle line", () => {
    expect(contractContextLine(FULL, FEB)).toBe(
      "Contract 6007211  ·  Contract total: $940,000.00  ·  Base PO 3086984  ·  " +
        "Performance PO 3089749  ·  Invoice period: 2/1/2026 to 2/28/2026",
    );
  });
});
