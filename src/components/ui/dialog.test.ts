import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DialogPanel } from "./dialog";

/**
 * `DialogPanel` is deliberately portal-free and effect-free (see dialog.tsx), so it renders
 * the same way `select-options.test.ts` renders `Select`: real SSR markup, no DOM needed.
 *
 * `children` is required on `DialogPanel`, so it has to travel as a prop rather than a
 * `createElement` rest argument — routed through this helper so `react/no-children-prop`
 * (which only looks at inline object literals) never sees it directly.
 */
function renderPanel(props: ComponentProps<typeof DialogPanel>): string {
  return renderToStaticMarkup(createElement(DialogPanel, props));
}

const BASE = { title: "Something went wrong", dismissLabel: "OK", onDismiss: () => {} };

describe("DialogPanel", () => {
  it("is an alertdialog", () => {
    const html = renderPanel({ ...BASE, children: "Could not save." });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it("renders exactly one button, the dismiss button, when there is no confirm", () => {
    const html = renderPanel({ ...BASE, children: "Could not save." });
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(html).toContain(">OK</button>");
  });

  it("renders both buttons, confirm before dismiss, when a confirm is given", () => {
    const html = renderPanel({
      title: "Delete this expense?",
      dismissLabel: "Keep it",
      onDismiss: () => {},
      confirm: { label: "Delete expense", onConfirm: () => {} },
      children: "This cannot be undone.",
    });
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(html.indexOf("Delete expense")).toBeLessThan(html.indexOf("Keep it"));
  });

  it("wires aria-labelledby / aria-describedby to ids that actually appear in the markup", () => {
    const html = renderPanel({ ...BASE, children: "Could not save." });
    const labelledby = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    const describedby = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(labelledby).toBeTruthy();
    expect(describedby).toBeTruthy();
    expect(html).toContain(`id="${labelledby}"`);
    expect(html).toContain(`id="${describedby}"`);
  });

  it("carries the danger tone tokens", () => {
    const html = renderPanel({ ...BASE, children: "Could not save." });
    expect(html).toContain("bg-danger-bg");
    expect(html).toContain("border-danger");
    expect(html).toContain("text-danger");
  });
});
