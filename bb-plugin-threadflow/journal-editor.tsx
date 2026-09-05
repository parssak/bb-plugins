import { useEffect, useRef } from "react";
import { Editor } from "@tiptap/core";
import { journalMarkdownExtensions } from "./journal-markdown";

type JournalMarkdownEditorProps = {
  initialMarkdown: string;
  ariaLabel: string;
  onBlur: () => void;
  onMarkdownChange: (markdown: string) => void;
};

export function JournalMarkdownEditor({
  initialMarkdown,
  ariaLabel,
  onBlur,
  onMarkdownChange,
}: JournalMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(initialMarkdown);
  const ariaLabelRef = useRef(ariaLabel);
  const onBlurRef = useRef(onBlur);
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  onBlurRef.current = onBlur;
  onMarkdownChangeRef.current = onMarkdownChange;

  useEffect(() => {
    if (hostRef.current === null) return;
    const editor = new Editor({
      element: hostRef.current,
      extensions: journalMarkdownExtensions(),
      content: initialMarkdownRef.current,
      contentType: "markdown",
      autofocus: "end",
      editorProps: {
        attributes: {
          "aria-label": ariaLabelRef.current,
          class: "tiptap",
          spellcheck: "true",
        },
        handleDOMEvents: {
          blur: () => {
            onBlurRef.current();
            return false;
          },
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        onMarkdownChangeRef.current(nextEditor.getMarkdown());
      },
    });
    return () => editor.destroy();
  }, []);

  return <div ref={hostRef} className="threadflow-journal-editor min-h-0 flex-1 overflow-y-auto" />;
}
