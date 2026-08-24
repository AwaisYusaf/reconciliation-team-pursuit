import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { optionsFromChildren, Select } from "./select";

describe("optionsFromChildren", () => {
  it("reads an explicit value attribute", () => {
    const children = createElement("option", { value: "x" }, "Label");
    expect(optionsFromChildren(children)).toEqual([{ value: "x", label: "Label", disabled: undefined }]);
  });

  it("falls back to the text content when there is no value attribute", () => {
    const children = createElement("option", null, "All Line Items");
    expect(optionsFromChildren(children)).toEqual([
      { value: "All Line Items", label: "All Line Items", disabled: undefined },
    ]);
  });

  it("flattens options produced by .map()", () => {
    const items = ["a", "b", "c"];
    const children = items.map((item) => createElement("option", { key: item, value: item }, item.toUpperCase()));
    expect(optionsFromChildren(children)).toEqual([
      { value: "a", label: "A", disabled: undefined },
      { value: "b", label: "B", disabled: undefined },
      { value: "c", label: "C", disabled: undefined },
    ]);
  });

  it("keeps an explicit empty value instead of falling back to the label", () => {
    // The "None" / "Choose a line item" placeholders rely on this: a `||` fallback here
    // would silently turn value="" into value="None" and break saving a cleared field.
    const children = createElement("option", { value: "" }, "None");
    expect(optionsFromChildren(children)).toEqual([{ value: "", label: "None", disabled: undefined }]);
  });

  it("carries through disabled", () => {
    const children = createElement("option", { value: "x", disabled: true }, "Label");
    expect(optionsFromChildren(children)).toEqual([{ value: "x", label: "Label", disabled: true }]);
  });

  it("ignores non-option children instead of crashing", () => {
    const children = [
      createElement("div", { key: "d" }, "not an option"),
      "a stray string",
      null,
      createElement("option", { key: "real", value: "real" }, "Real option"),
    ];
    expect(optionsFromChildren(children)).toEqual([{ value: "real", label: "Real option", disabled: undefined }]);
  });
});

/**
 * The packet upload form reads `formData.get("category")` from a native FormData, so the
 * custom trigger has to keep contributing a real form-submitted value. These render the
 * component for real (SSR markup, no DOM needed) rather than trusting that it does.
 */
describe("Select form submission", () => {
  const categories = [
    createElement("option", { key: "bank_statement", value: "bank_statement" }, "Bank statement"),
    createElement("option", { key: "timesheet", value: "timesheet" }, "Timesheet"),
  ];

  it("emits a hidden input carrying the selected value under the given name", () => {
    const html = renderToStaticMarkup(
      createElement(Select, { name: "category", value: "timesheet" }, categories),
    );
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="category"');
    expect(html).toContain('value="timesheet"');
  });

  it("submits the default value when nothing has been picked yet", () => {
    const html = renderToStaticMarkup(
      createElement(Select, { name: "category", defaultValue: "bank_statement" }, categories),
    );
    expect(html).toContain('name="category"');
    expect(html).toContain('value="bank_statement"');
  });

  it("omits the hidden input entirely when no name is given", () => {
    const html = renderToStaticMarkup(createElement(Select, { value: "timesheet" }, categories));
    expect(html).not.toContain('type="hidden"');
  });

  it("submits the first option when uncontrolled with no defaultValue, matching native <select>", () => {
    const html = renderToStaticMarkup(createElement(Select, { name: "category" }, categories));
    expect(html).toContain('value="bank_statement"');
    // The trigger's displayed label must agree with what's actually submitted.
    expect(html).toContain("Bank statement");
  });

  it("required: submits through a real (non-hidden) input, since type=hidden is barred from constraint validation", () => {
    const html = renderToStaticMarkup(
      createElement(Select, { name: "category", value: "timesheet", required: true }, categories),
    );
    expect(html).not.toContain('type="hidden"');
    expect(html).toContain('type="text"');
    expect(html).toContain("required");
    expect(html).toContain('name="category"');
    expect(html).toContain('value="timesheet"');
  });

  it("not required: still submits through the plain hidden input", () => {
    const html = renderToStaticMarkup(
      createElement(Select, { name: "category", value: "timesheet" }, categories),
    );
    expect(html).toContain('type="hidden"');
  });

  it("wires aria-labelledby onto the trigger, since a plain <label for> is not guaranteed to name a role=combobox element", () => {
    const html = renderToStaticMarkup(
      createElement(
        Select,
        { name: "category", value: "timesheet", "aria-labelledby": "category-label" },
        categories,
      ),
    );
    expect(html).toContain('aria-labelledby="category-label"');
  });

  it("renders the trigger as type=button so it cannot submit its enclosing form", () => {
    const html = renderToStaticMarkup(
      createElement(Select, { name: "category", value: "timesheet" }, categories),
    );
    expect(html).toContain('type="button"');
  });

  it("shows the selected option's label on the trigger", () => {
    const html = renderToStaticMarkup(createElement(Select, { value: "timesheet" }, categories));
    expect(html).toContain("Timesheet");
  });
});
