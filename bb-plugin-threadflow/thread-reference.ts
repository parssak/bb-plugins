export const THREAD_REFERENCE_DRAG_TYPE = "application/x-threadflow-thread-reference";

const THREAD_REFERENCE_HREF_PREFIX = "threadflow://thread/";
const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export type ThreadReference = {
  id: string;
  title: string;
};

export function threadReferenceHref(threadId: string): string {
  return `${THREAD_REFERENCE_HREF_PREFIX}${encodeURIComponent(threadId)}`;
}

export function threadReferenceMarkdown(reference: ThreadReference): string {
  const label = reference.title.replace(/[\\[\]]/g, "\\$&");
  return `[${label}](${threadReferenceHref(reference.id)})`;
}

export function parseThreadReferenceHref(href: string): string | null {
  if (!href.startsWith(THREAD_REFERENCE_HREF_PREFIX)) return null;
  try {
    const threadId = decodeURIComponent(href.slice(THREAD_REFERENCE_HREF_PREFIX.length));
    return THREAD_ID_PATTERN.test(threadId) ? threadId : null;
  } catch {
    return null;
  }
}

export function threadReferenceIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(/threadflow:\/\/thread\/[^\s)<>"']+/g)) {
    const threadId = parseThreadReferenceHref(match[0]);
    if (threadId === null) continue;
    if (seen.has(threadId)) continue;
    seen.add(threadId);
    ids.push(threadId);
  }
  return ids;
}

export function serializeThreadReferenceDrag(reference: ThreadReference): string {
  return JSON.stringify(reference);
}

export function parseThreadReferenceDrag(value: string): ThreadReference | null {
  if (value.length === 0 || value.length > 1_000) return null;
  try {
    const parsed = JSON.parse(value) as { id?: unknown; title?: unknown };
    if (
      typeof parsed.id !== "string"
      || !THREAD_ID_PATTERN.test(parsed.id)
      || typeof parsed.title !== "string"
    ) return null;
    const title = parsed.title.trim();
    return title.length > 0 && title.length <= 160 ? { id: parsed.id, title } : null;
  } catch {
    return null;
  }
}
