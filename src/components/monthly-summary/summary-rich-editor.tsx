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
import { EditorContent, Extension, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

import { cn } from "@/src/lib/cn";
import { UI } from "@/src/domain/strings";
import { serializeSummaryMarkdown, toEditorDoc, type EditorDoc } from "@/src/domain/summary-markdown";

/**
 * No sub-lists: the stored Markdown is flat (PR #18 round 2, #2). Both the list item and the list
 * keymap indent on Tab, so this claims Tab/Shift-Tab first inside a list and does nothing with
 * them. A nested list that arrives another way (pasted) is flattened by the serializer on save.
 */
const FlatLists = Extension.create({
  name: "flatLists",
  priority: 1000,
  addKeyboardShortcuts() {
    const inList = () => this.editor.isActive("listItem");
    return { Tab: inList, "Shift-Tab": inList };
  },
});

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
      FlatLists,
    ],
    content: toEditorDoc(markdown),
    // Required for Next's SSR: without it, the editor renders its first paint on the server,
    // which never matches the client's (node_modules/next/dist/docs).
    immediatelyRender: false,
    editable: !readOnly,
    onUpdate: ({ editor: instance }) => {
      // Only a real change is reported. Tiptap also fires update for things that change nothing
      // (and the loaded Markdown can serialize differently from how it was stored, e.g. `*` bullets
      // as `-`), and each report would autosave — so merely opening a summary marked it "Last
      // edited by" whoever looked and bumped its version (PR #18 round 2, #3).
      const next = serializeSummaryMarkdown(instance.getJSON() as EditorDoc);
      if (next === lastKnown.current) return;
      lastKnown.current = next;
      onChange(next);
    },
  });

  // The Markdown the editor currently holds, as this serializer writes it. Compared against the
  // last value *known* (not the loaded one), so undoing back to the original still saves.
  const lastKnown = useRef(serializeSummaryMarkdown(toEditorDoc(markdown)));

  const mounted = useRef(false);
  useEffect(() => {
    // Skip the mount itself — `content` above already set the initial doc; this effect is only
    // for a later, explicit reset.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    lastKnown.current = serializeSummaryMarkdown(toEditorDoc(markdown));
    editor?.commands.setContent(toEditorDoc(markdown), { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resets only on an explicit resetVersion bump, not on every keystroke's markdown (autosave would fight the caret)
  }, [resetVersion]);

  useEffect(() => {
    // `setEditable` fires an update by default, which on mount was enough to autosave.
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  if (!editor) return null;

  // One framed "page": the toolbar is its top strip rather than buttons floating above it, and the
  // document grows with its text instead of scrolling inside a box. Typography: `.summary-doc`
  // in app/globals.css.
  return (
    <div className="border border-line rounded-[3px] bg-surface">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-line bg-paper rounded-t-[3px]" role="toolbar">
        <ToolbarButton
          label={UI.summaryBold}
          active={editor.isActive("bold")}
          disabled={readOnly}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <span className="font-serif text-[17px] font-bold leading-none">B</span>
        </ToolbarButton>
        <ToolbarButton
          label={UI.summaryBulletList}
          active={editor.isActive("bulletList")}
          disabled={readOnly}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <svg aria-hidden viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="currentColor">
            <circle cx="4" cy="5.5" r="1.5" />
            <circle cx="4" cy="10" r="1.5" />
            <circle cx="4" cy="14.5" r="1.5" />
            <rect x="8" y="4.75" width="10" height="1.5" rx="0.75" />
            <rect x="8" y="9.25" width="10" height="1.5" rx="0.75" />
            <rect x="8" y="13.75" width="10" height="1.5" rx="0.75" />
          </svg>
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} className="summary-doc px-4 py-5 sm:px-8 sm:py-7" />
    </div>
  );
}

/** An icon button; `label` is its accessible name and hover tooltip, since the icon carries no text. */
function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-[3px] border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? "bg-surface border-line text-accent shadow-sm"
          : "border-transparent text-sub hover:bg-surface hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
