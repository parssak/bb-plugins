const MERMAID_DIAGRAM_START = /^(?:architecture-beta|block-beta|classDiagram|erDiagram|flowchart|gantt|gitGraph|graph|info|journey|kanban|mindmap|packet-beta|pie|quadrantChart|requirementDiagram|sankey-beta|sequenceDiagram|stateDiagram(?:-v2)?|timeline|xychart-beta|zenuml)\b/i;

export function isLikelyMermaid(source: string): boolean {
  const firstDiagramLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("%%"));
  return firstDiagramLine !== undefined && MERMAID_DIAGRAM_START.test(firstDiagramLine);
}

export function mermaidPreviewMarkdown(source: string): string {
  const longestFence = Math.max(0, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}mermaid\n${source}\n${fence}`;
}
