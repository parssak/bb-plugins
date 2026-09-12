import { Extension, InputRule } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";

const JournalEditingShortcuts = Extension.create({
  name: "journalEditingShortcuts",
  priority: 50,

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!(this.editor.state.selection instanceof TextSelection)) return true;
        return this.editor.commands.insertContent("  ");
      },
      "Shift-Tab": () => {
        const { selection } = this.editor.state;
        if (!(selection instanceof TextSelection) || !selection.empty) return true;
        const available = Math.min(2, selection.$from.parentOffset);
        const before = this.editor.state.doc.textBetween(selection.from - available, selection.from);
        const indentation = before.match(/ {1,2}$/)?.[0];
        if (indentation === undefined) return true;
        return this.editor.commands.deleteRange({
          from: selection.from - indentation.length,
          to: selection.from,
        });
      },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\|---\|$/,
        handler: ({ range, chain }) => {
          chain()
            .deleteRange(range)
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
        },
      }),
    ];
  },
});

export function journalMarkdownExtensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        protocols: ["threadflow"],
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit,
    Placeholder.configure({ placeholder: "What are you trying to achieve today?" }),
    Markdown.configure({
      indentation: { style: "space", size: 2 },
      markedOptions: { gfm: true },
    }),
    JournalEditingShortcuts,
  ];
}
