/**
 * `replaceDashes`: the monthly summary draft comes out with no dash (D-113, PHASE-13 §5). The
 * dashes are written as escapes, like the module itself, so this file reads the same to the
 * no-dashes guard as any other.
 */
import { describe, expect, it } from "vitest";

import { replaceDashes, textsWithDashes } from "./dashes";

const EM = "—";
const EN = "–";

describe("replaceDashes", () => {
  it("leaves text without a dash untouched, byte for byte", () => {
    const text = "## Overview\n\n- Payroll: $5,000.00 (12 expenses).\n";
    expect(replaceDashes(text)).toBe(text);
  });

  it("turns an aside or a second clause into commas", () => {
    expect(replaceDashes(`Payroll ${EM} the largest line item ${EM} rose.`)).toBe("Payroll, the largest line item, rose.");
    expect(replaceDashes(`Spending rose${EM}driven by payroll.`)).toBe("Spending rose, driven by payroll.");
    expect(replaceDashes(`Spending rose ${EN} driven by payroll.`)).toBe("Spending rose, driven by payroll.");
    expect(replaceDashes(`**Payroll** ${EM} $5,000.00`)).toBe("**Payroll**, $5,000.00");
  });

  it("writes a range with 'to'", () => {
    expect(replaceDashes(`2${EN}3 expenses`)).toBe("2 to 3 expenses");
    expect(replaceDashes(`$1,000.00 ${EN} $2,000.00`)).toBe("$1,000.00 to $2,000.00");
    expect(replaceDashes(`from 10%${EN}12%`)).toBe("from 10% to 12%");
    expect(replaceDashes(`2${EM}3 expenses`)).toBe("2 to 3 expenses");
  });

  it("keeps a spaced em dash between two figures as two clauses, not a range", () => {
    expect(replaceDashes(`$5,000.00 ${EM} $3,000.00 of it on payroll`)).toBe("$5,000.00, $3,000.00 of it on payroll");
  });

  it("keeps a minus sign a minus, so the figure check sees the sign the model meant", () => {
    expect(replaceDashes(`a refund of ${EN}$145.00`)).toBe("a refund of -$145.00");
    expect(replaceDashes(`a refund (${EM}$145.00)`)).toBe("a refund (-$145.00)");
    expect(replaceDashes(`changed by ${EN}12%`)).toBe("changed by -12%");
  });

  it("joins two words with no spaces: an en dash is a hyphen, an em dash an aside", () => {
    expect(replaceDashes(`January${EN}March`)).toBe("January-March");
    expect(replaceDashes(`rent${EM}not payroll${EM}rose`)).toBe("rent, not payroll, rose");
  });

  it("drops a dash that punctuation already does the work of", () => {
    expect(replaceDashes(`Nothing to note ${EM}.`)).toBe("Nothing to note.");
    expect(replaceDashes(`Items to note: ${EM} none.`)).toBe("Items to note: none.");
    expect(replaceDashes(`(${EM} see below)`)).toBe("(see below)");
    expect(replaceDashes(`one item ${EM})`)).toBe("one item)");
  });

  it("keeps Markdown lines: a dash bullet becomes a Markdown bullet, a trailing dash goes", () => {
    expect(replaceDashes(`## Items to note\n${EM} Refund: -$145.00\n  ${EN} nested`)).toBe(
      "## Items to note\n- Refund: -$145.00\n  - nested",
    );
    expect(replaceDashes(`Overview ${EM}\nNext line`)).toBe("Overview\nNext line");
    expect(replaceDashes(`a ${EM}\r\nb`)).toBe("a\r\nb");
  });

  it("never leaves a dash behind, whatever the input", () => {
    const messy = `${EM}${EN} ${EM}a${EN}${EM}b ${EN}${EN} c${EM}\n${EN}\n1${EN}${EM}2 (${EN}) [${EM}$3]`;
    expect(replaceDashes(messy)).not.toMatch(/[–—]/);
  });

  it("is idempotent", () => {
    const once = replaceDashes(`Payroll ${EM} $5,000.00 ${EN} rose 2${EN}3%.`);
    expect(replaceDashes(once)).toBe(once);
  });

  it("puts names from the data back exactly as typed", () => {
    const name = `Payroll ${EM} Pay Period 1`;
    const vendor = `Smith${EN}Jones LLC`;
    const draft = `- ${name}: $2,282.06 ${EM} paid to ${vendor}.`;
    expect(replaceDashes(draft, { keep: [name, vendor] })).toBe(`- ${name}: $2,282.06, paid to ${vendor}.`);
  });

  it("protects the longer of two overlapping names whole", () => {
    const short = `A${EM}B`;
    const long = `A${EM}B${EM}C`;
    expect(replaceDashes(`${long} and ${short} ${EM} both`, { keep: [short, long] })).toBe(`${long} and ${short}, both`);
  });
});

describe("textsWithDashes", () => {
  it("collects every string with a dash, at any depth, once", () => {
    const facts = {
      month: "March 2026",
      lineItems: [{ name: `Payroll ${EM} Staff`, spent: { text: "$1.00" } }],
      expenses: [{ name: `Payroll ${EM} Staff` }, { description: `North${EN}South route` }, { name: "Plain" }],
      count: 3,
      none: null,
    };
    expect(textsWithDashes(facts).sort()).toEqual([`North${EN}South route`, `Payroll ${EM} Staff`].sort());
  });
});
