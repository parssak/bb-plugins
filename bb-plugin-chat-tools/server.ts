import { registerLegacyImport } from "./legacy-storage.ts";
import { rpcContract } from "./contract.ts";
import { readPullRequest } from "./pull-request.ts";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  isThreadNudgerMessageText,
  isThreadNudgerUserMessage,
} from "./thread-nudger-message.ts";
import { collectUserMessageTimestamps } from "./user-message-timestamp.ts";

const USER_MESSAGE_TIMESTAMP_PAGE_LIMIT = 25;

const chatSummarySchema = z.object({
  threadId: z.string(),
  sourceUpdatedAt: z.number(),
  lastUserMessage: z.string(),
  summary: z.string(),
  followUps: z.array(z.string().trim().min(1).max(240)).max(3).optional(),
  dismissed: z.boolean(),
});

const generatedSummarySchema = z
  .object({
    summary: z.string().trim().min(1),
    followUps: z.array(z.string().trim().min(1).max(240)).min(1).max(3),
  })
  .strict();

const MAX_THREADS_PER_STATE = 200;

const THREADS_CHANGED_CHANNEL = "threads-changed";

const SUMMARY_KEY_PREFIX = "chat-summary:";

const SUMMARIES_CHANGED_CHANNEL = "chat-summaries-changed";

const SUMMARY_WORKER_TITLE_PREFIX = "TLDR worker:";

const LONG_RESPONSE_MIN_CHARS = 400;

const SUMMARY_GRACE_MS = 5_000;

const MAX_USER_MESSAGE_CHARS = 4_000;

const MAX_ASSISTANT_MESSAGE_CHARS = 20_000;

const RECENT_CONTEXT_MESSAGE_COUNT = 6;

const MAX_PRIOR_CONTEXT_MESSAGE_CHARS = 3_000;

const REVIEW_WORKTREE_PROMPT = "Review the changes in this worktree";

const ASK_LINUS_PROMPT = "how would linus torvalds feel about this";

const REVIEW_NEXT_STEPS_PROMPT = "Okay so what should we do? TLDR";

const HANDOFF_KEY_PREFIX = "side-chat-handoff:";

const AUTOMATIC_REVIEW_CLAIM_KEY_PREFIX = "automatic-review-claim:";

const HANDOFFS_CHANGED_CHANNEL = "side-chat-handoffs-changed";

const HANDOFF_PROMPT = [
  "Give me a handoff message to send back to the main agent.",
  "Include the relevant discussion points and context tersely.",
  "Return only the handoff message in one fenced code block, with no text outside it.",
].join(" ");

const MAX_HANDOFF_CHARS = 8_000;

function excludeFromDisplayedDiff(path: string): boolean {
  const filename = path.split("/").at(-1);
  return (
    filename === "pnpm-lock.yaml" ||
    path.includes(".internal") ||
    path.includes(".test")
  );
}

function isRunningStatus(status: string): boolean {
  return status !== "idle" && status !== "error";
}

function isAutomaticReviewThread(
  thread: {
    title: string | null;
    visibility: "hidden" | "visible";
    originKind: string | null;
    originPluginId: string | null;
  },
  pluginId: string,
): boolean {
  return (
    thread.title === "Review" &&
    thread.visibility === "hidden" &&
    thread.originKind === "fork" &&
    (thread.originPluginId === pluginId ||
      thread.originPluginId === "threadflow")
  );
}

type ChatSummary = z.infer<typeof chatSummarySchema>;

type PendingHandoff = { sourceThreadId: string };

type AutomaticReviewClaim = { claimedAt: number };

function summaryKey(threadId: string): string {
  return `${SUMMARY_KEY_PREFIX}${threadId}`;
}

function handoffKey(threadId: string): string {
  return `${HANDOFF_KEY_PREFIX}${threadId}`;
}

function automaticReviewClaimKey(sourceThreadId: string): string {
  return `${AUTOMATIC_REVIEW_CLAIM_KEY_PREFIX}${sourceThreadId}`;
}

function extractHandoff(output: string): string | null {
  const matches = [...output.matchAll(/```[^\r\n`]*\r?\n([\s\S]*?)```/g)];
  if (matches.length !== 1) return null;
  const handoff = matches[0]?.[1]?.trim() ?? "";
  return handoff !== "" && handoff.length <= MAX_HANDOFF_CHARS ? handoff : null;
}

function parseGeneratedSummary(
  output: string,
): z.infer<typeof generatedSummarySchema> | null {
  const trimmed = output.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const candidates = [unfenced];
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace)
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = generatedSummarySchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  return null;
}

export default function plugin(bb: BbPluginApi) {
  registerLegacyImport(bb, "chat", (key, value) => {
    if (key.startsWith("chat-summary:")) chatSummarySchema.parse(value);
    else if (key.startsWith("side-chat-handoff:"))
      z.object({ sourceThreadId: z.string().min(1) })
        .strict()
        .parse(value);
    else
      z.object({ claimedAt: z.number().nonnegative() }).strict().parse(value);
  });
  const viewingThreads = new Map<string, string>();
  const summariesInFlight = new Set<string>();
  const pendingSummaryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const reviewFollowUpsInFlight = new Set<string>();
  const handoffsInFlight = new Set<string>();
  const automaticReviewsInFlight = new Set<string>();
  const publishThreadsChanged = () =>
    bb.realtime.publish(THREADS_CHANGED_CHANNEL, null);
  const publishSummaryChanged = (threadId: string) =>
    bb.realtime.publish(SUMMARIES_CHANGED_CHANNEL, { threadId });
  const publishHandoffChanged = (
    threadId: string,
    status: "sent" | "failed",
    message?: string,
  ) => {
    bb.realtime.publish(HANDOFFS_CHANGED_CHANNEL, {
      threadId,
      status,
      ...(message === undefined ? {} : { message }),
    });
  };
  const cancelPendingSummary = (threadId: string) => {
    const timer = pendingSummaryTimers.get(threadId);
    if (timer === undefined) return;
    clearTimeout(timer);
    pendingSummaryTimers.delete(threadId);
  };
  const sourceThreadFor = async (threadId: string) => {
    const thread = await bb.sdk.threads.get({ threadId });
    return thread.sourceThreadId === null
      ? thread
      : bb.sdk.threads.get({ threadId: thread.sourceThreadId });
  };
  const createSideChat = async ({
    sourceThreadId,
    initialMessage,
    title,
  }: {
    sourceThreadId: string;
    initialMessage?: string;
    title?: string;
  }) => {
    const sourceThread = await sourceThreadFor(sourceThreadId);
    const resolvedSourceThreadId = sourceThread.id;
    const existing = await bb.sdk.threads.list({
      includeHidden: true,
      originKind: "fork",
      originPluginId: bb.pluginId,
      limit: MAX_THREADS_PER_STATE,
    });
    const siblingCount = existing.filter(
      (thread) => thread.sourceThreadId === resolvedSourceThreadId,
    ).length;
    const sideChatTitle = title ?? `Side chat ${siblingCount + 1}`;
    const forkedThread = await bb.sdk.threads.fork({
      sourceThreadId: resolvedSourceThreadId,
      origin: "plugin",
      originPluginId: bb.pluginId,
      visibility: "hidden",
      title: sideChatTitle,
      ...(initialMessage === undefined
        ? {}
        : {
            input: [
              { type: "text" as const, text: initialMessage, mentions: [] },
            ],
          }),
    });
    const thread = await bb.sdk.threads.update({
      threadId: forkedThread.id,
      parentThreadId: resolvedSourceThreadId,
    });
    const currentThread =
      initialMessage === undefined
        ? thread
        : await bb.sdk.threads.get({ threadId: thread.id });
    publishThreadsChanged();
    return {
      thread: {
        id: currentThread.id,
        title:
          currentThread.title?.trim() ||
          currentThread.titleFallback?.trim() ||
          sideChatTitle,
        sourceThreadId: resolvedSourceThreadId,
        createdAt: currentThread.createdAt,
        needsAttention: false,
        running: isRunningStatus(currentThread.status),
        closeable: true,
        navigation: "thread" as const,
      },
    };
  };
  const clearSummary = async (threadId: string) => {
    const existing = await bb.storage.kv.get<ChatSummary>(summaryKey(threadId));
    if (existing === undefined) return;
    await bb.storage.kv.delete(summaryKey(threadId));
    publishSummaryChanged(threadId);
  };
  const clearStaleSummary = async (
    threadId: string,
    sourceUpdatedAt: number,
  ) => {
    const existing = await bb.storage.kv.get<ChatSummary>(summaryKey(threadId));
    if (existing === undefined || existing.sourceUpdatedAt === sourceUpdatedAt)
      return;
    await bb.storage.kv.delete(summaryKey(threadId));
    publishSummaryChanged(threadId);
  };
  const getDisplayableSummary = async (threadId: string) => {
    const summary = await bb.storage.kv.get<ChatSummary>(summaryKey(threadId));
    if (
      summary === undefined ||
      !isThreadNudgerMessageText(summary.lastUserMessage)
    )
      return summary;
    try {
      const timeline = await bb.sdk.threads.timeline({
        threadId,
        segmentLimit: "12",
      });
      const lastUserMessage = timeline.rows
        .filter((row) => row.kind === "conversation" && row.role === "user")
        .at(-1);
      if (
        lastUserMessage === undefined ||
        !isThreadNudgerUserMessage(lastUserMessage)
      )
        return summary;
    } catch {
      return summary;
    }
    await bb.storage.kv.delete(summaryKey(threadId));
    publishSummaryChanged(threadId);
    return undefined;
  };
  const advanceReviewChat = async (threadId: string) => {
    if (reviewFollowUpsInFlight.has(threadId)) return;
    reviewFollowUpsInFlight.add(threadId);
    try {
      const timeline = await bb.sdk.threads.timeline({
        threadId,
        segmentLimit: "12",
      });
      const lastUserMessage = timeline.rows
        .filter((row) => row.kind === "conversation" && row.role === "user")
        .at(-1)
        ?.text.trim();
      const nextMessage =
        lastUserMessage === REVIEW_WORKTREE_PROMPT
          ? ASK_LINUS_PROMPT
          : lastUserMessage === ASK_LINUS_PROMPT
            ? REVIEW_NEXT_STEPS_PROMPT
            : null;
      if (nextMessage === null) return;
      await bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text: nextMessage, mentions: [] }],
      });
    } catch (cause) {
      bb.log.warn(
        `Could not advance review chat ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      reviewFollowUpsInFlight.delete(threadId);
    }
  };
  const finishPendingHandoff = async (
    threadId: string,
    lastAssistantText: string | null,
  ) => {
    if (handoffsInFlight.has(threadId)) return;
    const pending = await bb.storage.kv.get<PendingHandoff>(
      handoffKey(threadId),
    );
    if (pending === undefined) return;
    handoffsInFlight.add(threadId);
    try {
      const timeline = await bb.sdk.threads.timeline({
        threadId,
        segmentLimit: "12",
      });
      const conversation = timeline.rows
        .filter(
          (row) =>
            row.kind === "conversation" &&
            (row.role === "user" || row.role === "assistant"),
        )
        .map((row) => ({ role: row.role, text: row.text.trim() }))
        .filter((message) => message.text !== "");
      const lastUserMessage = conversation
        .filter((message) => message.role === "user")
        .at(-1)?.text;
      if (lastUserMessage !== HANDOFF_PROMPT) {
        throw new Error(
          "The completed response did not belong to the handoff request.",
        );
      }
      const response =
        lastAssistantText?.trim() ||
        conversation.filter((message) => message.role === "assistant").at(-1)
          ?.text ||
        "";
      const handoff = extractHandoff(response);
      if (handoff === null) {
        throw new Error(
          "The side chat did not return exactly one non-empty fenced code block.",
        );
      }
      await bb.sdk.threads.send({
        threadId: pending.sourceThreadId,
        senderThreadId: threadId,
        mode: "queue-if-active",
        input: [{ type: "text", text: handoff, mentions: [] }],
      });
      await bb.storage.kv.delete(handoffKey(threadId));
      publishHandoffChanged(threadId, "sent");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await bb.storage.kv.delete(handoffKey(threadId));
      publishHandoffChanged(threadId, "failed", message);
      bb.log.warn(`Could not hand off side chat ${threadId}: ${message}`);
    } finally {
      handoffsInFlight.delete(threadId);
    }
  };
  const failPendingHandoff = async (threadId: string, message: string) => {
    const key = handoffKey(threadId);
    if ((await bb.storage.kv.get<PendingHandoff>(key)) === undefined) return;
    await bb.storage.kv.delete(key);
    publishHandoffChanged(threadId, "failed", message);
  };
  const generateSummary = async ({
    threadId,
    expectedUpdatedAt,
    lastAssistantText,
    force,
  }: {
    threadId: string;
    expectedUpdatedAt: number | null;
    lastAssistantText: string | null;
    force: boolean;
  }): Promise<boolean> => {
    if (summariesInFlight.has(threadId)) return false;
    summariesInFlight.add(threadId);
    let workerThreadId: string | null = null;
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      if (
        thread.archivedAt !== null ||
        thread.environmentId === null ||
        thread.title?.startsWith(SUMMARY_WORKER_TITLE_PREFIX) === true ||
        (expectedUpdatedAt !== null &&
          thread.updatedAt !== expectedUpdatedAt) ||
        (!force &&
          (thread.status !== "idle" ||
            [...viewingThreads.values()].includes(threadId)))
      )
        return false;

      const existing = await getDisplayableSummary(threadId);
      if (existing?.sourceUpdatedAt === thread.updatedAt) {
        if (force && existing.dismissed) {
          await bb.storage.kv.set(summaryKey(threadId), {
            ...existing,
            dismissed: false,
          } satisfies ChatSummary);
          publishSummaryChanged(threadId);
        }
        return true;
      }

      const timeline = await bb.sdk.threads.timeline({
        threadId,
        segmentLimit: "12",
      });
      const conversation = timeline.rows
        .flatMap((row) => {
          if (
            row.kind !== "conversation" ||
            (row.role === "user" && isThreadNudgerUserMessage(row))
          )
            return [];
          return [{ role: row.role, text: row.text.trim() }];
        })
        .filter((message) => message.text !== "");
      const lastUserMessage =
        conversation
          .filter((message) => message.role === "user")
          .at(-1)
          ?.text.slice(-MAX_USER_MESSAGE_CHARS) ?? "";
      const assistantMessage = (
        lastAssistantText?.trim() ||
        conversation.filter((message) => message.role === "assistant").at(-1)
          ?.text ||
        ""
      ).slice(-MAX_ASSISTANT_MESSAGE_CHARS);
      if (lastUserMessage === "" || assistantMessage === "") return false;

      const timelineEndsWithCurrentAssistant =
        conversation.at(-1)?.role === "assistant" &&
        conversation.at(-1)?.text.endsWith(assistantMessage) === true;
      const recentConversation = [
        ...(timelineEndsWithCurrentAssistant
          ? conversation.slice(0, -1)
          : conversation),
        { role: "assistant" as const, text: assistantMessage },
      ]
        .slice(-RECENT_CONTEXT_MESSAGE_COUNT)
        .map((message, index, messages) => ({
          role: message.role,
          text:
            index === messages.length - 1
              ? message.text
              : message.text.slice(-MAX_PRIOR_CONTEXT_MESSAGE_CHARS),
        }));
      const recentConversationPrompt = recentConversation
        .map((message) => `${message.role.toUpperCase()}:\n${message.text}`)
        .join("\n\n");
      let repositoryState = "Repository state unavailable.";
      try {
        const [statusResult, pullRequestResult] = await Promise.all([
          bb.sdk.environments.status({ environmentId: thread.environmentId }),
          readPullRequest(bb, thread.environmentId),
        ]);
        const stateParts: string[] = [];
        if (statusResult.outcome === "available") {
          const { mergeBase, workingTree } = statusResult.workspace;
          stateParts.push(
            `Working tree: ${workingTree.state}; ${workingTree.files.length} uncommitted files; ${workingTree.insertions} additions; ${workingTree.deletions} deletions.`,
            `Branch versus ${mergeBase?.mergeBaseBranch ?? statusResult.workspace.branch.defaultBranch}: ${mergeBase?.aheadCount ?? 0} commits ahead; ${mergeBase?.behindCount ?? 0} commits behind; ${mergeBase?.files.length ?? 0} committed files changed.`,
          );
        } else {
          stateParts.push("Git status unavailable.");
        }
        if (pullRequestResult.outcome === "available") {
          stateParts.push(
            `Pull request: #${pullRequestResult.pullRequest.number}; ${pullRequestResult.pullRequest.state}; checks ${pullRequestResult.pullRequest.checks.state}.`,
          );
        } else if (pullRequestResult.outcome === "absent") {
          stateParts.push("Pull request: none.");
        } else {
          stateParts.push("Pull request status unavailable.");
        }
        repositoryState = stateParts.join("\n");
      } catch (cause) {
        bb.log.debug(
          `Could not load repository context for TLDR ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      const worker = await bb.sdk.threads.spawn({
        projectId: thread.projectId,
        environment: { type: "reuse", environmentId: thread.environmentId },
        providerId: "codex",
        model: "gpt-5.6-luna",
        reasoningLevel: "low",
        permissionMode: "accept-edits",
        serviceTier: "default",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
          serviceTier: "explicit",
        },
        visibility: "hidden",
        title: `${SUMMARY_WORKER_TITLE_PREFIX} ${threadId}`,
        prompt: [
          "Summarize the newest assistant response below for a busy engineer returning to a coding thread.",
          "Use the earlier messages only to resolve references and preserve the current task context.",
          'Return only valid JSON with this exact shape: {"summary":"Outcome sentence.\\n\\nShort status sentence.","followUps":["Message to send"]}.',
          "Write the summary as 1-3 brief prose paragraphs, at most 55 words total. Do not use bullets, numbered lists, or headings.",
          "Pull out the few sentences that carry the outcome, cause, fix, blocker, or next action. Simplify them when possible without dropping the mechanism or consequence.",
          'Compress routine progress details. For example, reduce a verbose spawned-thread update to "Started @thread:THREAD_ID in a fresh worktree." Keep qualifiers only when they change what the user should do.',
          "Preserve useful links attached to retained facts. Copy exact Markdown link syntax and exact @thread:... references so they remain clickable. Never alter a link target or thread ID, and do not invent links.",
          'Add 1-3 follow-up messages that the user can send next. Each must be a concrete 1-4 word command, such as "Fix it", "Add tests", or "Show the diff".',
          'Use REPOSITORY STATE as fact. If there are uncommitted files, include "Commit". If there is no pull request and the branch has commits ahead, include "Make PR". If both apply, put "Commit" before "Make PR". Do not suggest "Make PR" for uncommitted-only work.',
          'If the exchange concerns a pull request and no unresolved blocker makes merging unsafe, prefer "Merge to main" as one follow-up.',
          "Use ASD-STE100 Simplified Technical English. Use active voice, common words, short sentences, and one idea per sentence.",
          "Do not use idioms, contractions, or unnecessary jargon. Keep code, commands, file names, and product names exact.",
          "Lead with the outcome. Preserve concrete decisions, blockers, file names, commands, and next actions.",
          "Do not add a heading, preamble, speculation, JSON fence, or extra key. Do not use tools or inspect the workspace.",
          "",
          "REPOSITORY STATE:",
          repositoryState,
          "",
          "RECENT CONVERSATION (oldest to newest):",
          recentConversationPrompt,
        ].join("\n"),
      });
      workerThreadId = worker.id;
      await bb.sdk.threads.wait({
        threadId: worker.id,
        status: "idle",
        timeoutMs: 180_000,
      });
      const output = (
        await bb.sdk.threads.output({ threadId: worker.id })
      ).output?.trim();
      if (output === undefined || output === "") return false;
      const generated = parseGeneratedSummary(output);
      if (generated === null) {
        bb.log.warn(
          `TLDR worker returned invalid structured output for thread ${threadId}`,
        );
        return false;
      }

      const latestSource = await bb.sdk.threads.get({ threadId });
      if (
        latestSource.updatedAt !== thread.updatedAt ||
        (!force && [...viewingThreads.values()].includes(threadId))
      )
        return false;
      await bb.storage.kv.set(summaryKey(threadId), {
        threadId,
        sourceUpdatedAt: thread.updatedAt,
        lastUserMessage,
        summary: generated.summary,
        followUps: generated.followUps,
        dismissed: false,
      } satisfies ChatSummary);
      publishSummaryChanged(threadId);
      return true;
    } catch (cause) {
      bb.log.warn(
        `Could not summarize thread ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return false;
    } finally {
      summariesInFlight.delete(threadId);
      if (workerThreadId !== null) {
        try {
          await bb.sdk.threads.archive({ threadId: workerThreadId });
          await bb.sdk.threads.stop({ threadId: workerThreadId });
        } catch (cause) {
          bb.log.debug(
            `Could not clean up TLDR worker ${workerThreadId}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
    }
  };
  const createAutomaticReview = async (sourceThreadId: string) => {
    const sourceThread = await sourceThreadFor(sourceThreadId);
    const resolvedSourceThreadId = sourceThread.id;
    if (automaticReviewsInFlight.has(resolvedSourceThreadId))
      return { status: "already_claimed" as const };
    automaticReviewsInFlight.add(resolvedSourceThreadId);
    try {
      const key = automaticReviewClaimKey(resolvedSourceThreadId);
      if ((await bb.storage.kv.get<AutomaticReviewClaim>(key)) !== undefined)
        return { status: "already_claimed" as const };
      await createSideChat({
        sourceThreadId: resolvedSourceThreadId,
        initialMessage: REVIEW_WORKTREE_PROMPT,
        title: "Review",
      });
      await bb.storage.kv.set(key, {
        claimedAt: Date.now(),
      } satisfies AutomaticReviewClaim);
      return { status: "started" as const };
    } finally {
      automaticReviewsInFlight.delete(resolvedSourceThreadId);
    }
  };
  const archiveSourceThread = async (threadId: string) => {
    const thread = await bb.sdk.threads.get({ threadId });
    if (isRunningStatus(thread.status)) {
      throw new Error(
        `Cannot archive "${thread.title?.trim() || thread.titleFallback?.trim() || "Untitled"}" while it is running.`,
      );
    }

    if (thread.sourceThreadId !== null) {
      await bb.sdk.threads.archive({ threadId });
      return;
    }

    const sideChats = await bb.sdk.threads.list({
      sourceThreadId: threadId,
      archived: false,
      includeHidden: true,
      limit: MAX_THREADS_PER_STATE,
    });
    const runningSideChat = sideChats.find((sideChat) =>
      isRunningStatus(sideChat.status),
    );
    if (runningSideChat !== undefined) {
      throw new Error(
        `Cannot archive this worktree while "${runningSideChat.title?.trim() || runningSideChat.titleFallback?.trim() || "Side chat"}" is running.`,
      );
    }

    if (thread.environmentId === null) {
      await bb.sdk.threads.archive({ threadId });
      return;
    }

    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.workspaceProvisionType !== "managed-worktree") {
      await bb.sdk.threads.archive({ threadId });
      return;
    }

    await bb.sdk.environments.archiveThreads({
      environmentId: environment.id,
    });
  };
  bb.onDispose(() => {
    for (const timer of pendingSummaryTimers.values()) clearTimeout(timer);
    pendingSummaryTimers.clear();
  });
  bb.events.on("thread.idle", async ({ thread }) => {
    if (
      thread.visibility === "hidden" ||
      thread.parentThreadId !== null ||
      thread.archivedAt !== null ||
      thread.environmentId === null
    )
      return;
    try {
      if (
        (await bb.storage.kv.get(automaticReviewClaimKey(thread.id))) !==
        undefined
      )
        return;
      const result = await readPullRequest(bb, thread.environmentId);
      if (
        result.outcome === "available" &&
        (result.pullRequest.state === "open" ||
          result.pullRequest.state === "draft")
      ) {
        await createAutomaticReview(thread.id);
      }
    } catch (cause) {
      bb.log.warn(
        `Could not start automatic review: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  });
  bb.events.on("thread.created", publishThreadsChanged);
  bb.events.on("thread.active", ({ thread }) => {
    publishThreadsChanged();

    if (thread.title?.startsWith(SUMMARY_WORKER_TITLE_PREFIX) === true) return;
    cancelPendingSummary(thread.id);
    void clearSummary(thread.id).catch((cause) => {
      bb.log.warn(
        `Could not clear TLDR for active thread ${thread.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
  });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    publishThreadsChanged();

    void finishPendingHandoff(thread.id, lastAssistantText).catch((cause) => {
      bb.log.warn(
        `Could not inspect handoff response ${thread.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
    if (
      isAutomaticReviewThread(thread, bb.pluginId) &&
      thread.archivedAt === null &&
      lastAssistantText !== null &&
      lastAssistantText.trim() !== ""
    ) {
      void advanceReviewChat(thread.id);
    }
    if (thread.title?.startsWith(SUMMARY_WORKER_TITLE_PREFIX) !== true) {
      void clearStaleSummary(thread.id, thread.updatedAt).catch((cause) => {
        bb.log.warn(
          `Could not clear stale TLDR for thread ${thread.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      });
    }
    if (
      thread.providerId !== "codex" ||
      (thread.visibility === "hidden" &&
        !(
          thread.originKind === "fork" &&
          (thread.originPluginId === bb.pluginId ||
            thread.originPluginId === "threadflow")
        )) ||
      thread.archivedAt !== null ||
      thread.environmentId === null ||
      thread.title?.startsWith(SUMMARY_WORKER_TITLE_PREFIX) === true ||
      lastAssistantText === null ||
      lastAssistantText.trim().length < LONG_RESPONSE_MIN_CHARS ||
      (thread.lastReadAt !== null &&
        thread.lastReadAt >= thread.latestAttentionAt) ||
      [...viewingThreads.values()].includes(thread.id) ||
      summariesInFlight.has(thread.id)
    )
      return;

    cancelPendingSummary(thread.id);
    const timer = setTimeout(() => {
      pendingSummaryTimers.delete(thread.id);
      void generateSummary({
        threadId: thread.id,
        expectedUpdatedAt: thread.updatedAt,
        lastAssistantText,
        force: false,
      });
    }, SUMMARY_GRACE_MS);
    pendingSummaryTimers.set(thread.id, timer);
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    publishThreadsChanged();

    void failPendingHandoff(
      thread.id,
      error?.trim() || "The side chat failed before producing a handoff.",
    ).catch((cause) => {
      bb.log.warn(
        `Could not clear failed handoff ${thread.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
  });
  bb.events.on("thread.archived", ({ thread }) => {
    cancelPendingSummary(thread.id);

    publishThreadsChanged();

    void failPendingHandoff(
      thread.id,
      "The side chat was archived before producing a handoff.",
    ).catch((cause) => {
      bb.log.warn(
        `Could not clear archived handoff ${thread.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    cancelPendingSummary(thread.id);

    publishThreadsChanged();

    void failPendingHandoff(
      thread.id,
      "The side chat was deleted before producing a handoff.",
    ).catch((cause) => {
      bb.log.warn(
        `Could not clear deleted handoff ${thread.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
  });
  bb.events.on("interaction.pending", ({ thread }) => {
    publishThreadsChanged();
  });
  bb.events.on("message.queued", publishThreadsChanged);
  bb.events.on("message.dispatched", publishThreadsChanged);
  bb.rpc.register(rpcContract, {
    thread_context: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      const sourceThread =
        thread.sourceThreadId === null
          ? thread
          : await bb.sdk.threads.get({ threadId: thread.sourceThreadId });
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      const project =
        projects.find((candidate) => candidate.id === sourceThread.projectId)
          ?.name ?? "Unknown project";
      const environment =
        sourceThread.environmentId === null
          ? null
          : await bb.sdk.environments.get({
              environmentId: sourceThread.environmentId,
            });
      const title =
        thread.title?.trim() || thread.titleFallback?.trim() || "Untitled";
      const sourceTitle =
        sourceThread.title?.trim() ||
        sourceThread.titleFallback?.trim() ||
        "Untitled";
      return {
        target: {
          id: thread.id,
          environmentId: sourceThread.environmentId,
          title,
          createdAt: thread.createdAt,
          project,
          worktree:
            environment?.workspaceProvisionType === "managed-worktree"
              ? environment.branchName
              : null,
          ...(thread.sourceThreadId === null
            ? {}
            : {
                sourceThreadId: sourceThread.id,
                accentTitle: sourceTitle,
                accentCreatedAt: sourceThread.createdAt,
              }),
        },
      };
    },
    close_side_chat: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (
        thread.sourceThreadId === null ||
        thread.originKind !== "fork" ||
        thread.visibility !== "hidden"
      )
        throw new Error("This thread is not a side chat.");
      if (isRunningStatus(thread.status)) {
        await bb.sdk.threads.stop({ threadId });
      }
      await bb.sdk.threads.archive({ threadId });
      publishThreadsChanged();
      return { ok: true as const };
    },
    toggle_archived: async ({ id }) => {
      const thread = await bb.sdk.threads.get({ threadId: id });
      const archived = thread.archivedAt === null;
      if (archived) await archiveSourceThread(id);
      else await bb.sdk.threads.unarchive({ threadId: id });
      publishThreadsChanged();
      return { archived };
    },
    prompt_history: async () => {
      const [active, archived] = await Promise.all([
        bb.sdk.threads.list({
          archived: false,
          includeHidden: false,
          limit: 20,
        }),
        bb.sdk.threads.list({
          archived: true,
          includeHidden: false,
          limit: 10,
        }),
      ]);
      const threads = [...active, ...archived]
        .filter(
          (thread) =>
            thread.title?.startsWith(SUMMARY_WORKER_TITLE_PREFIX) !== true,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20);
      const timelines = await Promise.all(
        threads.map(async (thread) => {
          try {
            return await bb.sdk.threads.timeline({
              threadId: thread.id,
              segmentLimit: "20",
            });
          } catch {
            return null;
          }
        }),
      );
      const prompts: string[] = [];
      const seen = new Set<string>();
      for (const timeline of timelines) {
        if (timeline === null) continue;
        const userMessages = timeline.rows
          .flatMap((row) =>
            row.kind === "conversation" &&
            row.role === "user" &&
            !isThreadNudgerUserMessage(row)
              ? [row.text.trim().slice(0, 4_000)]
              : [],
          )
          .filter((text) => text !== "")
          .reverse();
        for (const prompt of userMessages) {
          const key = prompt.toLocaleLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          prompts.push(prompt);
          if (prompts.length === 100) return { prompts };
        }
      }
      return { prompts };
    },
    user_message_timestamps: async ({ threadId }) => {
      const rows: Parameters<typeof collectUserMessageTimestamps>[0][number][] =
        [];
      let olderCursor: { anchorId: string; anchorSeq: number } | null = null;
      for (
        let pageIndex = 0;
        pageIndex < USER_MESSAGE_TIMESTAMP_PAGE_LIMIT;
        pageIndex += 1
      ) {
        const timeline = await bb.sdk.threads.timeline({
          threadId,
          includeNestedRows: "true",
          segmentLimit: "100",
          ...(olderCursor === null
            ? {}
            : {
                beforeAnchorId: olderCursor.anchorId,
                beforeAnchorSeq: String(olderCursor.anchorSeq),
              }),
        });
        rows.push(...timeline.rows);
        olderCursor = timeline.timelinePage.olderCursor;
        if (olderCursor === null) break;
      }
      return { messages: collectUserMessageTimestamps(rows) };
    },
    create_side_chat: createSideChat,
    create_automatic_review: ({ sourceThreadId }) =>
      createAutomaticReview(sourceThreadId),
    send_message: async ({ threadId, message }) => {
      await bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text: message, mentions: [] }],
      });
      return { ok: true as const };
    },
    handoff_side_chat: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (
        thread.sourceThreadId === null ||
        thread.visibility !== "hidden" ||
        thread.originKind !== "fork" ||
        (thread.originPluginId !== bb.pluginId &&
          thread.originPluginId !== "threadflow") ||
        thread.archivedAt !== null
      )
        throw new Error("This thread is not an active Chat tools side chat.");
      if (
        (await bb.storage.kv.get<PendingHandoff>(handoffKey(threadId))) !==
        undefined
      ) {
        return { status: "pending" as const };
      }
      if (isRunningStatus(thread.status)) {
        throw new Error(
          "Wait for the side chat to finish before requesting a handoff.",
        );
      }

      await bb.storage.kv.set(handoffKey(threadId), {
        sourceThreadId: thread.sourceThreadId,
      } satisfies PendingHandoff);
      try {
        await bb.sdk.threads.send({
          threadId,
          mode: "start",
          input: [{ type: "text", text: HANDOFF_PROMPT, mentions: [] }],
        });
      } catch (cause) {
        await bb.storage.kv.delete(handoffKey(threadId));
        throw cause;
      }
      return { status: "started" as const };
    },
    handoff_status: async ({ threadId }) => ({
      pending:
        (await bb.storage.kv.get<PendingHandoff>(handoffKey(threadId))) !==
        undefined,
    }),
    pull_request_checks: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.environmentId === null) return { checks: null };
      const result = await readPullRequest(bb, thread.environmentId);
      if (result.outcome !== "available") return { checks: null };
      return {
        checks: {
          state: result.pullRequest.checks.state,
          failedCount: result.pullRequest.checks.failedCount,
          pendingCount: result.pullRequest.checks.pendingCount,
          totalCount: result.pullRequest.checks.totalCount,
        },
      };
    },
    worktree_changes: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.environmentId === null) return { changes: null };
      const [environment, status] = await Promise.all([
        bb.sdk.environments.get({ environmentId: thread.environmentId }),
        bb.sdk.environments.status({ environmentId: thread.environmentId }),
      ]);
      if (status.outcome !== "available") return { changes: null };
      const baseBranch =
        environment.mergeBaseBranch ??
        environment.baseBranch ??
        status.workspace.mergeBase?.mergeBaseBranch ??
        environment.defaultBranch ??
        status.workspace.branch.defaultBranch;
      const result = await bb.sdk.environments.diffFiles({
        environmentId: thread.environmentId,
        target: "all",
        mergeBaseBranch: baseBranch,
      });
      if (result.outcome !== "available") return { changes: null };
      const files = result.files.filter(
        (file) =>
          !excludeFromDisplayedDiff(file.path) &&
          (file.previousPath === null ||
            !excludeFromDisplayedDiff(file.previousPath)),
      );
      if (files.length === 0) return { changes: null };
      return {
        changes: {
          baseBranch,
          fileCount: files.length,
          additions: files.reduce((total, file) => total + file.additions, 0),
          deletions: files.reduce((total, file) => total + file.deletions, 0),
        },
      };
    },
    chat_summary: async ({ threadId }) => {
      const summary = await getDisplayableSummary(threadId);
      return { summary: summary ?? null };
    },
    set_chat_summary_dismissed: async ({ threadId, dismissed }) => {
      const summary = await getDisplayableSummary(threadId);
      if (summary !== undefined) {
        await bb.storage.kv.set(summaryKey(threadId), {
          ...summary,
          dismissed,
        } satisfies ChatSummary);
        publishSummaryChanged(threadId);
      }
      return { ok: true as const };
    },
    toggle_chat_summary: async ({ threadId }) => {
      cancelPendingSummary(threadId);
      const existing = await getDisplayableSummary(threadId);
      if (existing !== undefined) {
        const dismissed = !existing.dismissed;
        await bb.storage.kv.set(summaryKey(threadId), {
          ...existing,
          dismissed,
        } satisfies ChatSummary);
        publishSummaryChanged(threadId);
        return { status: dismissed ? ("hidden" as const) : ("shown" as const) };
      }
      if (summariesInFlight.has(threadId)) return { status: "busy" as const };

      const thread = await bb.sdk.threads.get({ threadId });
      void generateSummary({
        threadId,
        expectedUpdatedAt: thread.updatedAt,
        lastAssistantText: null,
        force: true,
      });
      return { status: "started" as const };
    },
    set_viewing_thread: ({ clientId, threadId }) => {
      if (threadId === null) viewingThreads.delete(clientId);
      else {
        viewingThreads.set(clientId, threadId);
        cancelPendingSummary(threadId);
      }
      return { ok: true as const };
    },
  });
}
