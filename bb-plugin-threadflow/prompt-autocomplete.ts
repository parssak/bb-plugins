export function isCaretAtTextEnd(editor: HTMLElement): boolean {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    return editor.selectionStart === editor.value.length
      && editor.selectionEnd === editor.value.length;
  }

  const selection = window.getSelection();
  if (selection === null || !selection.isCollapsed || selection.rangeCount !== 1) return false;
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.endContainer)) return false;

  const remaining = document.createRange();
  remaining.selectNodeContents(editor);
  remaining.setStart(caret.endContainer, caret.endOffset);
  return remaining.toString() === "";
}
