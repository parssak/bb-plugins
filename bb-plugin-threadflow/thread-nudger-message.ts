export const THREAD_NUDGER_MESSAGE_TEXTS = [
  "how's it going",
  "status update? don't stop if you're not done",
  "you've been going for a while, everything ok?",
] as const;

const THREAD_NUDGER_MESSAGES = new Set<string>(THREAD_NUDGER_MESSAGE_TEXTS);

export type UserMessageCandidate = {
  role?: string;
  text: string;
  turnRequest?: { kind?: string } | null;
};

export function isThreadNudgerMessageText(text: string): boolean {
  return THREAD_NUDGER_MESSAGES.has(text.trim());
}

export function isThreadNudgerUserMessage(message: UserMessageCandidate): boolean {
  return message.role === "user"
    && message.turnRequest?.kind === "steer"
    && isThreadNudgerMessageText(message.text);
}
