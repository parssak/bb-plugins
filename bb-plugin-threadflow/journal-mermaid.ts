export function mermaidPreviewMarkdown(source: string): string {
  const longestFence = Math.max(0, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}mermaid\n${source}\n${fence}`;
}
