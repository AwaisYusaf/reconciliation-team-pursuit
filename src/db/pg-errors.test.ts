import { describe, expect, it } from "vitest";

import {
  isCheckViolation,
  isDeadlock,
  isForeignKeyViolation,
  isMissingLineItem,
  isUniqueViolation,
  LINE_ITEM_GONE,
  unlessLineItemGone,
} from "./pg-errors";

/** What the pg driver throws, and how Drizzle wraps it (`cause`). */
const pgError = (code: string, constraint?: string) => Object.assign(new Error("pg"), { code, constraint });
const wrapped = (inner: Error) => Object.assign(new Error("Failed query"), { cause: inner });

describe("pg error checks", () => {
  it("read the code raw or wrapped, and nothing else", () => {
    expect(isUniqueViolation(pgError("23505"))).toBe(true);
    expect(isUniqueViolation(wrapped(pgError("23505")))).toBe(true);
    expect(isForeignKeyViolation(wrapped(pgError("23503")))).toBe(true);
    expect(isCheckViolation(pgError("23514"))).toBe(true);
    expect(isDeadlock(wrapped(pgError("40P01")))).toBe(true);
    expect(isUniqueViolation(pgError("23503"))).toBe(false);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("isMissingLineItem: only a foreign-key refusal on a line item link", () => {
    expect(isMissingLineItem(wrapped(pgError("23503", "expenses_line_item_id_funding_source_id_line_items_id_funding_source_id_fk")))).toBe(true);
    expect(isMissingLineItem(pgError("23503", "recurring_items_line_item_id_line_items_id_fk"))).toBe(true);
    expect(isMissingLineItem(pgError("23503", "vendor_defaults_default_line_item_id_line_items_id_fk"))).toBe(true);
    // Another missing link is not reported as the line item.
    expect(isMissingLineItem(pgError("23503", "expenses_funding_source_id_funding_sources_id_fk"))).toBe(false);
    expect(isMissingLineItem(pgError("23503"))).toBe(false);
    expect(isMissingLineItem(pgError("23505", "line_items_source_name_uq"))).toBe(false);
  });

  it("unlessLineItemGone returns the result, the marker, or rethrows anything else", async () => {
    expect(await unlessLineItemGone(async () => 7)).toBe(7);
    expect(
      await unlessLineItemGone(async () => {
        throw wrapped(pgError("23503", "line_item_performances_line_item_id_line_items_id_fk"));
      }),
    ).toBe(LINE_ITEM_GONE);
    const other = wrapped(pgError("23505", "line_items_source_name_uq"));
    await expect(
      unlessLineItemGone(async () => {
        throw other;
      }),
    ).rejects.toBe(other);
  });
});
