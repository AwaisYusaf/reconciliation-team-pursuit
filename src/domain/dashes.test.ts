/**
 * `replaceDashes`: the monthly summary draft comes out with no dash (D-113, PHASE-13 §5). The
 * dashes are written as escapes, like the module itself, so this file reads the same to the
 * no-dashes guard as any other.
 */
import { describe, expect, it } from "vitest";

import { replaceDashes, textsWithDashes } from "./dashes";

const EM = "\u2014";
const EN = "\u2013";

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
    expect(replaceDashes(messy)).not.toMatch(/[\u2013\u2014]/);
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

describe("replaceDashes, after the adversarial review (PHASE-13 Phase 4)", () => {
  it("writes 'to' only between figures of a kind, never between money and a percentage", () => {
    expect(replaceDashes(`$5,000.00 ${EN} 40% of spending`)).toBe("$5,000.00, 40% of spending");
    expect(replaceDashes(`12% ${EN} $300.00 more`)).toBe("12%, $300.00 more");
    expect(replaceDashes(`$5${EN}10`)).toBe("$5 to 10");
  });

  it("reads a dash between a number and a word by which side the number is on", () => {
    expect(replaceDashes(`January 1${EN}March 31`)).toBe("January 1 to March 31");
    expect(replaceDashes(`FY2025${EN}FY2026`)).toBe("FY2025 to FY2026");
    expect(replaceDashes(`Form W${EN}2`)).toBe("Form W-2");
    expect(replaceDashes(`COVID${EN}19`)).toBe("COVID-19");
  });

  it("keeps the minus wherever a dash touches a figure on its right", () => {
    expect(replaceDashes(`Rent change:${EN}$300.00`)).toBe("Rent change: -$300.00");
    expect(replaceDashes(`- Refunds\n${EN}$145.00 from Acme`)).toBe("- Refunds\n-$145.00 from Acme");
    expect(replaceDashes(`(${EN}$300.00, ${EN}25%)`)).toBe("(-$300.00, -25%)");
  });

  it("tidies runs, thin spaces, list numbers, bold and headings", () => {
    expect(replaceDashes(`a ${EM}${EM} b`)).toBe("a, b");
    expect(replaceDashes(`Payroll\u2009${EM}\u2009the largest`)).toBe("Payroll, the largest");
    expect(replaceDashes(`1. ${EM} Payroll`)).toBe("1. Payroll");
    expect(replaceDashes(`- **Payroll ${EM}** $5,000.00`)).toBe("- **Payroll** $5,000.00");
    expect(replaceDashes(`## ${EM} Overview`)).toBe("## Overview");
  });

  it("is not switched off by a typed value that is only a dash", () => {
    const draft = `Spending rose ${EM} driven by payroll ${EN} as expected.`;
    const keep = textsWithDashes({ description: EM, note: ` ${EN} `, name: `Payroll ${EM} Staff` });
    expect(keep).toEqual([`Payroll ${EM} Staff`]);
    expect(replaceDashes(draft, { keep })).toBe("Spending rose, driven by payroll, as expected.");
  });

  it("drops the private marks it uses, rather than letting a draft's own copy swap in a name", () => {
    const name = `Payroll ${EM} Staff`;
    expect(replaceDashes(`\uE0000\uE001 rose ${EM} a lot`, { keep: [name] })).toBe("0 rose, a lot");
  });

  it("is idempotent even when kept names leave dashes for a second pass", () => {
    const name = `Payroll ${EM} Staff`;
    const once = replaceDashes(`${name} rose ${EM} by $5.00 ${EN} as planned.`, { keep: [name] });
    expect(once).toBe(`${name} rose, by $5.00, as planned.`);
    expect(replaceDashes(once, { keep: [name] })).toBe(once);
  });

  it("stays quick on a reply padded with a long run of digits", () => {
    const padded = `${"9".repeat(200_000)} ${EM} ${"1".repeat(200_000)} ${EN} x`.repeat(3);
    const started = performance.now();
    expect(replaceDashes(padded)).not.toMatch(/[\u2013\u2014]/);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
