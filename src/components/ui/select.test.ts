/**
 * `optionsFromChildren` is the part of the Select that has to stay flat: the listbox's
 * keyboard walk, active descendant and Home/End are all index-based, so grouping is only
 * safe as long as flattening preserves document order and adds nothing to the list.
 *
 * Written with `createElement` rather than JSX so it runs under the suite's `*.test.ts`
 * glob without widening it to TSX.
 */
import { Fragment, createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { optionsFromChildren } from "./select";

const option = (value: string, label: string, props: Record<string, unknown> = {}) =>
  createElement("option", { key: value, value, ...props }, label);

const group = (label: string, children: ReactNode[]) =>
  createElement("optgroup", { key: label, label }, ...children);

describe("optionsFromChildren", () => {
  it("reads plain options, defaulting a missing value to the label", () => {
    const options = optionsFromChildren([
      option("a", "Alpha"),
      createElement("option", { key: "b" }, "All Line Items"),
    ]);
    expect(options).toEqual([
      { value: "a", label: "Alpha", disabled: undefined, group: undefined },
      { value: "All Line Items", label: "All Line Items", disabled: undefined, group: undefined },
    ]);
  });

  it("flattens optgroups in order, tagging each option with its group", () => {
    const options = optionsFromChildren([
      group("2027", [option("2027-01", "January 2027")]),
      group("2026", [option("2026-12", "December 2026"), option("2026-11", "November 2026")]),
    ]);

    expect(options.map((entry) => entry.value)).toEqual(["2027-01", "2026-12", "2026-11"]);
    expect(options.map((entry) => entry.group)).toEqual(["2027", "2026", "2026"]);
  });

  it("keeps ungrouped options alongside grouped ones", () => {
    // The month selector's "Other month…" sits outside every year group.
    const options = optionsFromChildren([
      group("2026", [option("2026-01", "January 2026")]),
      option("__other__", "Other month…"),
    ]);

    expect(options).toHaveLength(2);
    expect(options[1]).toMatchObject({ value: "__other__", group: undefined });
  });

  it("carries disabled through a group", () => {
    const options = optionsFromChildren([group("2026", [option("x", "X", { disabled: true })])]);
    expect(options[0].disabled).toBe(true);
  });

  it("ignores anything that is not an option or optgroup", () => {
    const options = optionsFromChildren([
      "loose text",
      null,
      createElement("div", { key: "d" }, "not an option"),
      option("a", "Alpha"),
    ]);
    expect(options).toEqual([{ value: "a", label: "Alpha", disabled: undefined, group: undefined }]);
  });

  it("adds nothing for an empty group, so no index is spent on a heading", () => {
    const options = optionsFromChildren([group("2026", []), option("a", "Alpha")]);
    expect(options).toHaveLength(1);
  });

  it("reads options wrapped in a fragment", () => {
    const options = optionsFromChildren(
      createElement(Fragment, null, option("a", "Alpha"), option("b", "Beta")),
    );
    expect(options.map((entry) => entry.value)).toEqual(["a", "b"]);
  });
});
