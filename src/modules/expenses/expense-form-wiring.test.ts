/**
 * The Add/Edit expense form's error and label wiring (usability #24, #25, #26, #27, #28, #29,
 * #30), pinned as source text. `vitest.config.mts` runs `environment: "node"` with no render
 * harness, so this is the repo's structural style (see `expense-form-upload-target.test.ts`).
 * What it cannot prove, it leaves to the browser: that the focus lands and the page scrolls.
 *
 * The list of fields is taken from `validateFields` itself, not typed out here, so a rule added
 * there without a place to show its message fails this file.
 */
import { describe, expect, it } from "vitest";

import { sourceCode } from "@/src/lib/source-code.test-helper";

import type { ExpenseInput } from "./actions";
import { validateFields } from "./validation";

const form = sourceCode("src/modules/expenses/expense-form.tsx");

/** Every field `validateFields` can name, from an input that breaks every rule. */
const EVERY_FIELD = Object.keys(
  validateFields({
    name: "",
    fundingSourceId: "x",
    lineItemId: "",
    paymentSource: "",
    taxReimbursable: false,
    feesReimbursable: false,
    month: "x",
    date: "x",
    description: "",
    subtotal: "x",
    tax: "x",
    fees: "x",
    note: "",
    narrative: "",
    noReceipt: true,
    noReceiptReason: "",
  } satisfies ExpenseInput),
);
const MONEY = ["subtotal", "tax", "fees"];

/** The source between `start` and the first `end` after it. */
function slice(start: string, end: string): string {
  const from = form.indexOf(start);
  expect(from, `missing marker: ${start}`).toBeGreaterThan(-1);
  const to = form.indexOf(end, from + start.length);
  expect(to, `missing end marker: ${end}`).toBeGreaterThan(from);
  return form.slice(from, to);
}

describe("every field validateFields can name has its own message and invalid state (#24, AC4)", () => {
  it("covers all eleven fields", () => {
    expect(EVERY_FIELD).toHaveLength(11);
  });

  for (const field of EVERY_FIELD) {
    it(`${field}: the control is marked invalid and its message sits under it`, () => {
      if (MONEY.includes(field)) {
        // The three money inputs are rendered by one map over their names.
        expect(form).toContain('(["subtotal", "tax", "fees"] as const).map((field) =>');
        expect(form).toContain("{...invalid(field)}");
        expect(form).toContain("{errorFor(field)}");
      } else {
        expect(form).toContain(`{errorFor("${field}")}`);
        // The single-source funding "field" is static text with nothing to mark; the Select is.
        expect(form).toContain(`{...invalid("${field}")}`);
      }
    });
  }

  it("the invalid state carries aria-invalid and aria-describedby pointing at that message's id", () => {
    expect(form).toMatch(/const errorId = \(field: keyof ExpenseInput\) => fieldId\(`\$\{field\}-error`\)/);
    expect(form).toContain('fieldErrors[field] ? { "aria-invalid": true as const, "aria-describedby": errorId(field) } : {}');
    expect(form).toContain("fieldErrors[field] ? <FieldError id={errorId(field)}>{fieldErrors[field]}</FieldError> : null");
  });

  it("a Select receives the invalid props (it forwards aria-invalid to its trigger)", () => {
    const select = sourceCode("src/components/ui/select.tsx");
    expect(select).toContain('"aria-invalid"?: boolean;');
    expect(select).toContain("aria-invalid={ariaInvalid || undefined}");
  });

  it("an invalid control gets a red border: CONTROL for inputs and the Select trigger, the wrapper for MoneyInput", () => {
    const field = sourceCode("src/components/ui/field.tsx");
    const control = field.slice(field.indexOf("export const CONTROL"), field.indexOf("export function Label"));
    expect(control).toContain("aria-[invalid=true]:border-danger");
    const money = field.slice(field.indexOf("export function MoneyInput"));
    expect(money).toContain("has-[[aria-invalid=true]]:border-danger");
    expect(sourceCode("src/components/ui/select.tsx")).toMatch(/\$\{CONTROL\} px-3/);
  });
});

describe("a refused save shows its field errors (#24, #25)", () => {
  it("showFailure sets the field errors and arms the focus when the refusal names fields, else the panel", () => {
    const body = slice("function showFailure(", "\n  }\n");
    expect(body).toMatch(/if \(result\.fieldErrors && Object\.keys\(result\.fieldErrors\)\.length > 0\) \{\s*focusFirstError\.current = true;\s*setFieldErrors\(result\.fieldErrors\);\s*\} else \{\s*setError\(result\.error\);/);
  });

  it("save(): the saveAction, editing, embedded and create branches all refuse through showFailure", () => {
    const save = slice("function save() {", "function saveDraft()");
    const draft = save.slice(save.indexOf("if (saveAction) {"), save.indexOf("if (editing) {"));
    const editing = save.slice(save.indexOf("if (editing) {"), save.indexOf("if (embedded) {"));
    const embedded = save.slice(save.indexOf("if (embedded) {"), save.indexOf("createExpenseAction(values)"));
    const create = save.slice(save.indexOf("createExpenseAction(values)"));
    expect(draft).toContain("showFailure(result)");
    expect(editing).toContain("showFailure(result)");
    expect(embedded).toContain("showFailure(created)");
    expect(create).toContain("showFailure(created)");
    // No save-path refusal bypasses it straight into the panel.
    expect(save).not.toMatch(/setError\((result|created)\.error\)/);
  });

  it("saveAndApprove and saveDraft refuse through showFailure too", () => {
    expect(slice("function saveAndApprove() {", "function save() {")).toContain("showFailure(saved)");
    expect(slice("function saveDraft() {", "startTransition(async () => {\n      const result")).toContain(
      "setFieldErrors({})",
    );
    const draft = form.slice(form.indexOf("function saveDraft() {"));
    expect(draft.slice(0, draft.indexOf("toast.success"))).toContain("showFailure(result)");
  });

  it("every save clears the previous field errors before trying again", () => {
    for (const start of ["function saveAndApprove() {", "function save() {", "function saveDraft() {"]) {
      const head = form.slice(form.indexOf(start), form.indexOf("startTransition(", form.indexOf(start)));
      expect(head, start).toContain("setFieldErrors({});");
    }
  });

  it("typing into a field clears that field's own error", () => {
    const set = slice("const set = useCallback(", "\n  );");
    expect(set).toMatch(/setFieldErrors\(\(current\) => \{\s*if \(!\(key in current\)\) return current;\s*const next = \{ \.\.\.current \};\s*delete next\[key\];/);
  });

  it("a field filled any other way (vendor autofill, funding source change, suggested amounts) loses its error too", () => {
    const effect = slice("const previousValues = useRef(values);", "}, [values]);");
    expect(effect).toContain("values[key as keyof ExpenseInput] !== previous[key as keyof ExpenseInput]");
    expect(effect).toContain("for (const key of changed) delete next[key];");
    // Every other value writer must exist, or this effect is covering nothing.
    for (const writer of ["fillFromTypedName(", "fillFromClick(", "fundingSourceId: value"]) {
      expect(form, writer).toContain(writer);
    }
  });

  it("unchecking No receipt drops the reason's error with the field it belonged to", () => {
    const apply = slice("function applyNoReceipt(checked: boolean) {", "\n  }\n");
    expect(apply).toContain("delete next.noReceiptReason;");
  });

  it("after a refusal the first invalid field is scrolled to the centre and focused, only when armed", () => {
    const effect = slice("useEffect(() => {\n    if (!focusFirstError.current) return;", "}, [fieldErrors]);");
    expect(effect).toContain("focusFirstError.current = false;");
    expect(effect).toContain(`formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')`);
    expect(effect).toContain('first?.scrollIntoView({ block: "center" });');
    expect(effect).toContain("first?.focus({ preventScroll: true });");
    expect(form).toContain("ref={formRef}");
  });

  it("the summary above Save says to check the highlighted fields, unless a panel message is already shown", () => {
    expect(form).toContain("{error && <DangerPanel>{error}</DangerPanel>}");
    expect(form).toMatch(/\{!error && Object\.keys\(fieldErrors\)\.length > 0 && \(\s*<DangerPanel>\{UI\.checkHighlightedFields\}<\/DangerPanel>/);
  });
});

describe("labels (#26, #28, #29)", () => {
  it("AC9: every htmlFor={fieldId(...)} has a control with the same id", () => {
    const labels = [...form.matchAll(/htmlFor=\{fieldId\(("[^"]+"|field)\)\}/g)].map((match) => match[1]);
    expect(labels.length).toBeGreaterThan(10);
    for (const label of labels) expect(form, label).toContain(`id={fieldId(${label})}`);
  });

  it("AC9: the money inputs take their id from fieldId, not the bare field name", () => {
    expect(form).toContain("<Label htmlFor={fieldId(field)}");
    expect(form).toMatch(/<MoneyInput\s+id=\{fieldId\(field\)\}/);
    expect(form).not.toMatch(/\sid=\{field\}/);
  });

  it("AC8: the month field is 'Reporting month' with its hint", () => {
    expect(form).toMatch(/htmlFor=\{fieldId\("month"\)\}>\s*Reporting month\s*<\/Label>/);
    expect(form).toContain("<Helper>The month whose packet this expense goes in. It can differ from the date.</Helper>");
  });

  it("AC6: Narrative is marked required; Description, Note and Narrative each say where they print", () => {
    const squash = (text: string) => text.replace(/\s+/g, " ");
    const flat = squash(form);
    expect(flat).toContain('Narrative <span className="font-normal text-sub">(required)</span>');
    expect(flat).toContain("Description / role</Label>");
    expect(flat).toContain(
      "Prints in the cover sheet table next to the name, exactly as typed. For a salary, the person&apos;s role.",
    );
    expect(flat).toContain("A short extra remark, highlighted next to this expense on the cover sheet.");
    expect(flat).toContain("The automatic note prints too: ${autoNote}");
    expect(flat).toContain(
      "A sentence or two on what this was for. Prints as a paragraph under this expense on the cover sheet.",
    );
  });
});

describe("the saved toast (#30)", () => {
  it("names every gap through the shared helper, with the invoice counted as the receipt only when a receipt is wanted", () => {
    expect(form).toContain('import { savedMessage as savedMessageFor } from "./saved-message";');
    const body = slice("function savedMessage(): string {", "\n  }\n");
    expect(body).toContain("noReceipt: values.noReceipt");
    expect(body).toContain("attached: existing?.documents ?? []");
    expect(body).toMatch(/\bqueued,/);
    expect(body).toContain("invoiceIsReceipt: invoiceReceipt !== undefined && !values.noReceipt");
    expect(form).not.toContain("savedMissingProof");
  });
});

describe("controls the browser scrolls to stop below the floating header (#27, AC7)", () => {
  it("form controls in main get a 6rem scroll margin", () => {
    const css = sourceCode("app/globals.css");
    expect(css).toMatch(/main :is\(input, textarea, select, button\) \{\s*scroll-margin-top: 6rem;\s*\}/);
  });
});
