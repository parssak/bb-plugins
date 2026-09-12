import { Extension, InputRule, type NodeViewRenderer } from "@tiptap/core";
import CodeBlock, { type CodeBlockOptions } from "@tiptap/extension-code-block";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";

export type JournalMermaidRenderer = (
  host: HTMLElement,
  source: string,
) => void | (() => void);

type JournalCodeBlockOptions = CodeBlockOptions & {
  renderMermaid: JournalMermaidRenderer | null;
};

const JournalCodeBlock = CodeBlock.extend<JournalCodeBlockOptions>({
  addOptions() {
    return {
      languageClassPrefix: "language-",
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      exitOnArrowUp: true,
      defaultLanguage: null,
      enableTabIndentation: false,
      tabSize: 4,
      HTMLAttributes: {},
      renderMermaid: null,
    };
  },

  addNodeView(): NodeViewRenderer {
    const renderMermaid = this.options.renderMermaid;

    return ({ node }) => {
      const wrapper = document.createElement("div");
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      const preview = document.createElement("div");
      let currentNode = node;
      let disposePreview: (() => void) | undefined;

      wrapper.className = "threadflow-journal-code-block";
      pre.append(code);
      wrapper.append(pre, preview);

      const updatePreview = () => {
        disposePreview?.();
        disposePreview = undefined;
        const language = typeof currentNode.attrs.language === "string"
          ? currentNode.attrs.language.toLowerCase()
          : "";
        code.className = language === "" ? "" : `language-${language}`;
        preview.replaceChildren();
        preview.hidden = language !== "mermaid";
        preview.className = "threadflow-journal-mermaid-preview";
        preview.contentEditable = "false";
        if (language === "mermaid" && renderMermaid !== null) {
          disposePreview = renderMermaid(preview, currentNode.textContent) ?? undefined;
        }
      };

      updatePreview();

      return {
        dom: wrapper,
        contentDOM: code,
        update(nextNode) {
          if (nextNode.type !== currentNode.type) return false;
          currentNode = nextNode;
          updatePreview();
          return true;
        },
        ignoreMutation(mutation) {
          return preview.contains(mutation.target);
        },
        stopEvent(event) {
          return preview.contains(event.target as Node);
        },
        destroy() {
          disposePreview?.();
        },
      };
    };
  },
});

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

export function journalMarkdownExtensions(renderMermaid: JournalMermaidRenderer | null = null) {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: {
        openOnClick: false,
        protocols: ["threadflow"],
      },
    }),
    JournalCodeBlock.configure({ renderMermaid }),
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
