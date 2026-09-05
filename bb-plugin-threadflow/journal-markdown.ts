import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

export function journalMarkdownExtensions() {
  return [
    StarterKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: "What are you trying to achieve today?" }),
    Markdown.configure({
      markedOptions: { gfm: true },
    }),
  ];
}
