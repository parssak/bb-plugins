import { useEffect, useRef } from "react";
import { Editor } from "@tiptap/core";
import { journalMarkdownExtensions } from "./journal-markdown";
import {
  parseThreadReferenceDrag,
  parseThreadReferenceHref,
  THREAD_REFERENCE_DRAG_TYPE,
  threadReferenceHref,
} from "./thread-reference";

type JournalMarkdownEditorProps = {
  initialMarkdown: string;
  ariaLabel: string;
  onBlur: () => void;
  onMarkdownChange: (markdown: string) => void;
  onOpenThread: (threadId: string) => void;
  threadStatuses: Readonly<Record<string, "archived" | "in-progress">>;
};

function applyThreadStatuses(
  root: HTMLElement,
  statuses: JournalMarkdownEditorProps["threadStatuses"],
): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href^="threadflow://thread/"]')) {
    const threadId = parseThreadReferenceHref(anchor.getAttribute("href") ?? "");
    const status = threadId === null ? undefined : statuses[threadId];
    if (status === undefined) delete anchor.dataset.threadflowThreadStatus;
    else anchor.dataset.threadflowThreadStatus = status;
  }
}

export function JournalMarkdownEditor({
  initialMarkdown,
  ariaLabel,
  onBlur,
  onMarkdownChange,
  onOpenThread,
  threadStatuses,
}: JournalMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const initialMarkdownRef = useRef(initialMarkdown);
  const ariaLabelRef = useRef(ariaLabel);
  const onBlurRef = useRef(onBlur);
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  const onOpenThreadRef = useRef(onOpenThread);
  const threadStatusesRef = useRef(threadStatuses);
  onBlurRef.current = onBlur;
  onMarkdownChangeRef.current = onMarkdownChange;
  onOpenThreadRef.current = onOpenThread;
  threadStatusesRef.current = threadStatuses;

  useEffect(() => {
    if (hostRef.current !== null) applyThreadStatuses(hostRef.current, threadStatuses);
  }, [threadStatuses]);

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
          dragover: (_view, event) => {
            if (!Array.from(event.dataTransfer?.types ?? []).includes(THREAD_REFERENCE_DRAG_TYPE)) return false;
            event.preventDefault();
            if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
            return true;
          },
        },
        handleClick: (_view, _position, event) => {
          const element = event.target instanceof Element ? event.target : null;
          const anchor = element?.closest<HTMLAnchorElement>("a[href]");
          const threadId = anchor === null || anchor === undefined
            ? null
            : parseThreadReferenceHref(anchor.getAttribute("href") ?? "");
          if (threadId === null) return false;
          event.preventDefault();
          onOpenThreadRef.current(threadId);
          return true;
        },
        handleDrop: (view, event) => {
          const reference = parseThreadReferenceDrag(
            event.dataTransfer?.getData(THREAD_REFERENCE_DRAG_TYPE) ?? "",
          );
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          const link = view.state.schema.marks.link;
          if (reference === null || position === undefined || link === undefined) return false;
          try {
            const transaction = view.state.tr.insert(
              position,
              view.state.schema.text(reference.title, [link.create({ href: threadReferenceHref(reference.id) })]),
            );
            event.preventDefault();
            view.dispatch(transaction.scrollIntoView());
            view.focus();
            return true;
          } catch {
            return false;
          }
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        onMarkdownChangeRef.current(nextEditor.getMarkdown());
        if (hostRef.current !== null) applyThreadStatuses(hostRef.current, threadStatusesRef.current);
      },
    });
    applyThreadStatuses(hostRef.current, threadStatusesRef.current);
    return () => editor.destroy();
  }, []);

  return <div ref={hostRef} className="threadflow-journal-editor min-h-0 flex-1 overflow-y-auto px-2" />;
}
