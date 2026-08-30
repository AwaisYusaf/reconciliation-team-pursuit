import { describe, expect, it } from "vitest";
import { expenseReference } from "./strings";

describe("expenseReference (R2.6)", () => {
  it("prints the month and a three-digit sequence", () => {
    expect(expenseReference("2026-02", 1)).toBe("2026-02-001");
    expect(expenseReference("2026-02", 14)).toBe("2026-02-014");
    expect(expenseReference("2026-11", 999)).toBe("2026-11-999");
  });

  it("grows past three digits rather than truncating", () => {
    // A reference that silently collides is worse than one that is a character wider.
    expect(expenseReference("2026-02", 1000)).toBe("2026-02-1000");
  });

  it("sorts into entry order as plain text", () => {
    const refs = [14, 2, 100, 1].map((n) => expenseReference("2026-02", n));
    expect([...refs].sort()).toEqual([
      "2026-02-001", "2026-02-002", "2026-02-014", "2026-02-100",
    ]);
  });
});
