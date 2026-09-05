import { isThreadNudgerUserMessage } from "./thread-nudger-message.ts";

export type UserMessageTimestamp = {
  rowIds: string[];
  createdAt: number;
};

export type TimelineRowCandidate = {
  id: string;
  createdAt: number;
  kind: string;
  role?: string;
  initiator?: string;
  text?: string;
  turnRequest?: { kind?: string } | null;
  children?: readonly TimelineRowCandidate[] | null;
};

export function collectUserMessageTimestamps(
  rows: readonly TimelineRowCandidate[],
): UserMessageTimestamp[] {
  const timestamps: UserMessageTimestamp[] = [];

  const visit = (row: TimelineRowCandidate, parentRowIds: readonly string[]) => {
    if (
      row.kind === "conversation"
      && row.role === "user"
      && row.initiator === "user"
      && typeof row.text === "string"
      && !isThreadNudgerUserMessage({
        role: row.role,
        text: row.text,
        turnRequest: row.turnRequest,
      })
    ) {
      timestamps.push({
        rowIds: [row.id, ...parentRowIds],
        createdAt: row.createdAt,
      });
    }

    if (row.children === null || row.children === undefined) return;
    const nextParentRowIds = row.kind === "turn"
      ? [row.id, ...parentRowIds]
      : parentRowIds;
    for (const child of row.children) visit(child, nextParentRowIds);
  };

  for (const row of rows) visit(row, []);
  return timestamps.sort((left, right) => left.createdAt - right.createdAt);
}

export function formatUserMessageTimestamp(
  createdAt: number,
  now = Date.now(),
  locales?: Intl.LocalesArgument,
): string {
  const date = new Date(createdAt);
  const current = new Date(now);
  return new Intl.DateTimeFormat(locales, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === current.getFullYear() ? {} : { year: "numeric" as const }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
