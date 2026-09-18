"use client";

/**
 * The Monthly summary's rich text editor (PR #18 review #8), replacing the raw-Markdown
 * `<Textarea>` and the Preview/Edit tabs it needed to read as a report. The stored format is
 * still plain Markdown — `src/domain/summary-markdown.ts` still owns Word, PDF and Copy text —
 * so this component's only job is translating between that Markdown and the ProseMirror document
 * Tiptap edits, via `toEditorDoc`/`serializeSummaryMarkdown`. Content always goes in as a JSON
 * doc, never as an HTML string — React's raw-HTML escape hatch is never used here (P6;
 * `screen.test.ts` greps this file for that escape hatch by name, which is why it isn't written
 * here).
 */
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

import { cn } from "@/src/lib/cn";
import { UI } from "@/src/domain/strings";
import { serializeSummaryMarkdown, toEditorDoc, type EditorDoc } from "@/src/domain/summary-markdown";

export function SummaryRichEditor({
  markdown,
  onChange,
  readOnly,
  resetVersion,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  readOnly: boolean;
  /** Bumped by the parent (Write again landing, a conflict reset) to force the editor back to
   *  a fresh `markdown` without going through `onUpdate` — that would mark the new draft dirty
   *  and let autosave immediately overwrite it. */
  resetVersion: number;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Everything below is syntax `summary-markdown.ts` can't represent — disabled so editing
        // an existing summary can never silently produce Markdown this app can't read back. Bold
        // and bullet list are the only two the toolbar exposes; italic has no button but stays
        // enabled below, since an existing `*italic*` run must survive being edited.
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        horizontalRule: false,
        orderedList: false,
        hardBreak: false,
        link: false,
        underline: false,
      }),
    ],
    content: toEditorDoc(markdown),
    // Required for Next's SSR: without it, the editor renders its first paint on the server,
    // which never matches the client's (node_modules/next/dist/docs).
    immediatelyRender: false,
    editable: !readOnly,
    onUpdate: ({ editor: instance }) => onChange(serializeSummaryMarkdown(instance.getJSON() as EditorDoc)),
  });

  const mounted = useRef(false);
  useEffect(() => {
    // Skip the mount itself — `content` above already set the initial doc; this effect is only
    // for a later, explicit reset.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    editor?.commands.setContent(toEditorDoc(markdown), { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resets only on an explicit resetVersion bump, not on every keystroke's markdown (autosave would fight the caret)
  }, [resetVersion]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) return null;

  // One framed "page": the toolbar is its top strip rather than buttons floating above it, and the
  // document grows with its text instead of scrolling inside a box. Typography: `.summary-doc`
  // in app/globals.css.
  return (
    <div className="border border-line rounded-[3px] bg-surface">
      <div className="flex gap-1 px-2 py-1 border-b border-line bg-paper rounded-t-[3px]" role="toolbar">
        <ToolbarButton
          label={UI.summaryBold}
          active={editor.isActive("bold")}
          disabled={readOnly}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label={UI.summaryBulletList}
          active={editor.isActive("bulletList")}
          disabled={readOnly}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
      </div>
      <EditorContent editor={editor} className="summary-doc px-4 py-5 sm:px-8 sm:py-7" />
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-11 px-3 text-[15px] rounded-[3px] disabled:cursor-not-allowed disabled:opacity-60",
        active ? "bg-section text-accent font-semibold" : "text-sub hover:bg-section hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}
