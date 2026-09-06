import { randomUUID } from "node:crypto";

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import {
  fetchGithubWorkflowRun,
  parseGithubWorkflowRunUrl,
  type GithubWorkflowRun,
  type GithubWorkflowRunIdentity,
} from "./github-workflow-run.ts";

export const WAIT_CHECKER_TITLE_PREFIX = "Threadflow wait check:";

const WAIT_MARKER_PREFIX = "THREADFLOW_WAIT_V1 ";
const MONITOR_INTERVAL_MS = 2_000;
const DIRECT_CHECK_INTERVAL_MS = 30_000;
const INSTRUCTION_INITIAL_DELAY_MS = 20 * 60_000;
const INSTRUCTION_RECHECK_INTERVAL_MS = 45 * 60_000;
const MAX_INSTRUCTION_CHECKS = 64;
const MAX_CONSECUTIVE_CHECK_ERRORS = 3;
const WORKER_TIMEOUT_MS = 120_000;
const ARMING_RECOVERY_GRACE_MS = 30_000;
const INSTRUCTION_CHECK_MODELS = ["gpt-5.3-codex-spark", "gpt-5.6-luna"] as const;

export const waitConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("threads_idle"),
    threadIds: z.array(z.string().min(1).max(100)).min(1).max(50)
      .refine((threadIds) => new Set(threadIds).size === threadIds.length, "Thread IDs must be unique."),
  }).strict(),
  z.object({
    kind: z.literal("thread_archived"),
    targetThreadId: z.string().min(1).max(100),
  }).strict(),
  z.object({
    kind: z.literal("pull_request_merged"),
    targetThreadId: z.string().min(1).max(100),
  }).strict(),
  z.object({
    kind: z.literal("github_actions_succeeded"),
    runUrls: z.array(z.string().url().max(500)).min(1).max(10),
  }).strict(),
  z.object({
    kind: z.literal("instruction"),
    instruction: z.string().trim().min(1).max(2_000),
  }).strict(),
]);

export const threadflowWaitParametersSchema = z.object({
  condition: waitConditionSchema,
  timeoutMinutes: z.number().int().min(1).max(1_440).default(60),
  resumePrompt: z.string().trim().min(1).max(2_000),
}).strict();

type WaitConditionInput = z.infer<typeof waitConditionSchema>;

export const resolvedConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("threads_idle"),
    targets: z.array(z.object({
      threadId: z.string(),
      title: z.string(),
    }).strict()).min(1).max(50),
  }).strict(),
  z.object({
    kind: z.literal("thread_archived"),
    targetThreadId: z.string(),
    targetTitle: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("pull_request_merged"),
    targetThreadId: z.string(),
    targetTitle: z.string(),
    environmentId: z.string(),
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("github_actions_succeeded"),
    runs: z.array(z.object({
      owner: z.string(),
      repository: z.string(),
      runId: z.number().int().positive(),
      runUrl: z.string().url(),
      workflowName: z.string(),
      headSha: z.string().regex(/^[0-9a-f]{40}$/),
    }).strict()).min(1).max(10),
  }).strict(),
  z.object({
    kind: z.literal("instruction"),
    instruction: z.string(),
  }).strict(),
]);

type ResolvedCondition = z.infer<typeof resolvedConditionSchema>;

export const activeThreadflowWaitSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(["arming", "waiting", "releasing", "ready"]),
  label: z.string(),
  condition: resolvedConditionSchema,
  deadlineAt: z.number(),
  nextCheckAt: z.number().nullable(),
  checkCount: z.number().int().nonnegative(),
  lastEvidence: z.string().nullable(),
  createdAt: z.number(),
}).strict();

export type ActiveThreadflowWait = z.infer<typeof activeThreadflowWaitSchema>;

export type ThreadflowWaitController = {
  getActiveWait(threadId: string): Promise<ActiveThreadflowWait | null>;
  getIdleDependencies(queuedMessageIds: ReadonlySet<string>): Array<{
    waitingThreadId: string;
    targetThreadIds: string[];
  }>;
};

const waitStateSchema = z.enum([
  "arming",
  "waiting",
  "releasing",
  "ready",
  "completed",
  "cancelled",
]);

type WaitState = z.infer<typeof waitStateSchema>;

const waitResultSchema = z.object({
  outcome: z.enum(["condition_met", "timed_out", "condition_impossible", "resumed_manually"]),
  observedAt: z.number(),
  detail: z.string().max(2_000),
}).strict();

type WaitResult = z.infer<typeof waitResultSchema>;

const waitMarkerSchema = z.object({
  version: z.literal(1),
  waitId: z.string().uuid(),
  result: waitResultSchema.optional(),
  requestedResumePrompt: z.string().max(2_000).optional(),
}).strict();

type WaitMarker = z.infer<typeof waitMarkerSchema>;

const evaluatorResultSchema = z.object({
  decision: z.enum(["ready", "wait", "failed"]),
  evidence: z.string().trim().min(1).max(1_000),
}).strict();

type EvaluatorResult = z.infer<typeof evaluatorResultSchema>;

interface WaitRow {
  id: string;
  thread_id: string;
  condition_kind: ResolvedCondition["kind"];
  condition_json: string;
  state: WaitState;
  label: string;
  resume_prompt: string;
  queued_message_id: string | null;
  deadline_at: number;
  next_check_at: number | null;
  check_count: number;
  consecutive_errors: number;
  last_evidence: string | null;
  worker_thread_id: string | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface WaitRecord {
  id: string;
  threadId: string;
  condition: ResolvedCondition;
  state: WaitState;
  label: string;
  resumePrompt: string;
  queuedMessageId: string | null;
  deadlineAt: number;
  nextCheckAt: number | null;
  checkCount: number;
  consecutiveErrors: number;
  lastEvidence: string | null;
  workerThreadId: string | null;
  result: WaitResult | null;
  createdAt: number;
}

type ArmWaitResult = {
  outcome: "armed";
  waitId: string;
  deadlineAt: number;
  label: string;
} | {
  outcome: "already_satisfied";
  detail: string;
} | {
  outcome: "already_waiting";
  waitId: string;
  deadlineAt: number;
  label: string;
};

interface ResolvedConditionResult {
  condition: ResolvedCondition;
  label: string;
  alreadySatisfied: string | null;
  initialEvidence?: string;
}

function threadTitle(thread: { title: string | null; titleFallback: string | null }): string {
  return thread.title?.trim() || thread.titleFallback?.trim() || "Untitled";
}

function waitMarkerBlock(marker: WaitMarker) {
  return {
    type: "text" as const,
    visibility: "agent-only" as const,
    text: `${WAIT_MARKER_PREFIX}${JSON.stringify(marker)}`,
    mentions: [],
  };
}

function parseWaitMarker(blocks: readonly unknown[]): WaitMarker | null {
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const candidate = block as { type?: unknown; text?: unknown; visibility?: unknown };
    if (
      candidate.type !== "text"
      || candidate.visibility !== "agent-only"
      || typeof candidate.text !== "string"
      || !candidate.text.startsWith(WAIT_MARKER_PREFIX)
    ) continue;
    try {
      const parsed = waitMarkerSchema.safeParse(JSON.parse(candidate.text.slice(WAIT_MARKER_PREFIX.length)));
      if (parsed.success) return parsed.data;
    } catch {
      return null;
    }
  }
  return null;
}

function parseEvaluatorResult(output: string): EvaluatorResult | null {
  const trimmed = output.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [unfenced];
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = evaluatorResultSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  return null;
}

function waitForMonitorTick(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, MONITOR_INTERVAL_MS);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function formatToolResult(result: ArmWaitResult): string {
  if (result.outcome === "already_satisfied") {
    return `The wait condition is already satisfied: ${result.detail}\nContinue this turn.`;
  }
  if (result.outcome === "already_waiting") {
    return `This thread is already sleeping on wait ${result.waitId}: ${result.label}. Deadline: ${new Date(result.deadlineAt).toISOString()}.\nEnd this turn now.`;
  }
  return `Wait ${result.waitId} armed: ${result.label}. Deadline: ${new Date(result.deadlineAt).toISOString()}.\nEnd this turn now. Do not poll or continue working.`;
}

export function registerThreadflowWaits(
  bb: BbPluginApi,
  options: {
    excludedThreadTitlePrefixes?: readonly string[];
    getGithubToken?: () => Promise<string | undefined>;
    inspectGithubWorkflowRun?: (
      identity: GithubWorkflowRunIdentity,
      signal?: AbortSignal,
    ) => Promise<GithubWorkflowRun>;
  } = {},
): ThreadflowWaitController {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS threadflow_waits (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      condition_kind TEXT NOT NULL,
      condition_json TEXT NOT NULL,
      state TEXT NOT NULL,
      label TEXT NOT NULL,
      resume_prompt TEXT NOT NULL,
      queued_message_id TEXT,
      deadline_at INTEGER NOT NULL,
      next_check_at INTEGER,
      check_count INTEGER NOT NULL DEFAULT 0,
      consecutive_errors INTEGER NOT NULL DEFAULT 0,
      last_evidence TEXT,
      worker_thread_id TEXT,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS threadflow_waits_one_active_per_thread
      ON threadflow_waits(thread_id)
      WHERE state IN ('arming', 'waiting', 'releasing', 'ready')`,
    `CREATE INDEX IF NOT EXISTS threadflow_waits_due
      ON threadflow_waits(state, next_check_at, deadline_at)`,
  ]);

  const rowToWait = (row: WaitRow): WaitRecord => ({
    id: row.id,
    threadId: row.thread_id,
    condition: resolvedConditionSchema.parse(JSON.parse(row.condition_json)),
    state: waitStateSchema.parse(row.state),
    label: row.label,
    resumePrompt: row.resume_prompt,
    queuedMessageId: row.queued_message_id,
    deadlineAt: row.deadline_at,
    nextCheckAt: row.next_check_at,
    checkCount: row.check_count,
    consecutiveErrors: row.consecutive_errors,
    lastEvidence: row.last_evidence,
    workerThreadId: row.worker_thread_id,
    result: row.result_json === null ? null : waitResultSchema.parse(JSON.parse(row.result_json)),
    createdAt: row.created_at,
  });
  const getWait = (waitId: string): WaitRecord | null => {
    const row = db.prepare("SELECT * FROM threadflow_waits WHERE id = ?").get(waitId) as WaitRow | undefined;
    return row === undefined ? null : rowToWait(row);
  };
  const getActiveWaitForThread = (threadId: string): WaitRecord | null => {
    const row = db.prepare(`SELECT * FROM threadflow_waits
      WHERE thread_id = ? AND state IN ('arming', 'waiting', 'releasing', 'ready')
      ORDER BY created_at DESC LIMIT 1`).get(threadId) as WaitRow | undefined;
    return row === undefined ? null : rowToWait(row);
  };
  const listWaits = (where: string, ...params: unknown[]): WaitRecord[] => (
    (db.prepare(`SELECT * FROM threadflow_waits WHERE ${where}`).all(...params) as WaitRow[]).map(rowToWait)
  );
  const inspectGithubWorkflowRun = options.inspectGithubWorkflowRun ?? (async (identity, signal) => (
    fetchGithubWorkflowRun(identity, {
      token: await options.getGithubToken?.(),
      ...(signal === undefined ? {} : { signal }),
    })
  ));

  const resolveCondition = async (
    sleepingThreadId: string,
    condition: WaitConditionInput,
  ): Promise<ResolvedConditionResult> => {
    if (condition.kind === "instruction") {
      return {
        condition,
        label: `Waiting until: ${condition.instruction.replace(/\s+/g, " ").slice(0, 140)}`,
        alreadySatisfied: null,
      };
    }

    if (condition.kind === "threads_idle") {
      if (condition.threadIds.includes(sleepingThreadId)) {
        throw new Error("A thread cannot wait for itself to become idle.");
      }
      const threads = await Promise.all(condition.threadIds.map((threadId) => bb.sdk.threads.get({ threadId })));
      const targets = threads.map((thread) => ({ threadId: thread.id, title: threadTitle(thread) }));
      const pending = threads.flatMap((thread, index) => thread.status === "idle"
        ? []
        : [`“${targets[index]!.title}” (${thread.status})`]);
      return {
        condition: { kind: condition.kind, targets },
        label: `Waiting for ${targets.length} ${targets.length === 1 ? "thread" : "threads"} to become idle`,
        alreadySatisfied: pending.length === 0
          ? `${targets.length === 1 ? `“${targets[0]!.title}” is` : `All ${targets.length} threads are`} already idle.`
          : null,
        initialEvidence: `Still running: ${pending.join(", ")}.`,
      };
    }

    if (condition.kind === "thread_archived") {
      if (condition.targetThreadId === sleepingThreadId) {
        throw new Error("A thread cannot wait for itself to be archived.");
      }
      const target = await bb.sdk.threads.get({ threadId: condition.targetThreadId });
      const title = threadTitle(target);
      return {
        condition: { ...condition, targetTitle: title },
        label: `Waiting for “${title}” to be archived`,
        alreadySatisfied: target.archivedAt === null ? null : `“${title}” is already archived.`,
      };
    }

    if (condition.kind === "github_actions_succeeded") {
      const identities = condition.runUrls.map(parseGithubWorkflowRunUrl);
      const runs = await Promise.all(identities.map((identity) => inspectGithubWorkflowRun(identity)));
      const failed = runs.find((run) => run.status === "completed" && run.conclusion !== "success");
      if (failed !== undefined) {
        throw new Error(`${failed.workflowName} already completed with conclusion ${failed.conclusion ?? "unknown"}.`);
      }
      return {
        condition: {
          kind: condition.kind,
          runs: runs.map(({ owner, repository, runId, runUrl, workflowName, headSha }) => ({
            owner,
            repository,
            runId,
            runUrl,
            workflowName,
            headSha,
          })),
        },
        label: runs.length === 1
          ? `Waiting for GitHub Actions: ${runs[0]!.workflowName}`
          : `Waiting for ${runs.length} GitHub Actions runs`,
        alreadySatisfied: runs.every((run) => run.status === "completed" && run.conclusion === "success")
          ? `${runs.length === 1 ? runs[0]!.workflowName : `${runs.length} workflow runs`} already succeeded.`
          : null,
      };
    }

    const target = await bb.sdk.threads.get({ threadId: condition.targetThreadId });
    const title = threadTitle(target);
    if (target.environmentId === null) throw new Error(`“${title}” has no environment.`);
    const result = await bb.sdk.environments.pullRequest({ environmentId: target.environmentId });
    if (result.outcome === "absent") throw new Error(`“${title}” has no pull request.`);
    if (result.outcome === "unavailable") throw new Error(result.message);
    if (result.pullRequest.state === "closed") {
      throw new Error(`PR #${result.pullRequest.number} is already closed without merging.`);
    }
    return {
      condition: {
        ...condition,
        targetTitle: title,
        environmentId: target.environmentId,
        pullRequestNumber: result.pullRequest.number,
        pullRequestUrl: result.pullRequest.url,
      },
      label: `Waiting for PR #${result.pullRequest.number} to merge`,
      alreadySatisfied: result.pullRequest.state === "merged"
        ? `PR #${result.pullRequest.number} is already merged.`
        : null,
    };
  };

  const attachQueuedMessage = (waitId: string, queuedMessageId: string) => {
    db.prepare(`UPDATE threadflow_waits
      SET queued_message_id = ?, state = CASE WHEN state = 'arming' THEN 'waiting' ELSE state END, updated_at = ?
      WHERE id = ? AND state IN ('arming', 'waiting')`).run(queuedMessageId, Date.now(), waitId);
  };

  const markWaitCancelled = (waitId: string) => {
    const now = Date.now();
    db.prepare(`UPDATE threadflow_waits SET state = 'cancelled', updated_at = ?, completed_at = ?
      WHERE id = ? AND state IN ('arming', 'waiting', 'releasing', 'ready')`).run(now, now, waitId);
  };

  const queueRowsForWait = async (wait: WaitRecord) => {
    const rows = await bb.sdk.threads.queuedMessages.list({ threadId: wait.threadId });
    return rows.filter((row) => row.id === wait.queuedMessageId || parseWaitMarker(row.content)?.waitId === wait.id);
  };

  const reconcileActiveWaitForThread = async (threadId: string): Promise<WaitRecord | null> => {
    const wait = getActiveWaitForThread(threadId);
    if (wait === null) return null;
    if (wait.state === "arming" && Date.now() - wait.createdAt < ARMING_RECOVERY_GRACE_MS) return wait;
    let queuedRows;
    try {
      queuedRows = await queueRowsForWait(wait);
    } catch {
      return wait;
    }
    if (queuedRows.length > 0) {
      attachQueuedMessage(wait.id, queuedRows[0]!.id);
      return getWait(wait.id);
    }
    if (wait.state === "ready" || wait.state === "releasing") {
      const now = Date.now();
      db.prepare(`UPDATE threadflow_waits SET state = 'completed', updated_at = ?, completed_at = ?
        WHERE id = ?`).run(now, now, wait.id);
    } else {
      markWaitCancelled(wait.id);
    }
    return null;
  };

  const prepareRelease = async (waitId: string): Promise<void> => {
    const wait = getWait(waitId);
    if (wait === null || wait.state !== "releasing" || wait.result === null) return;
    const queuedRows = await queueRowsForWait(wait);
    const queued = queuedRows[0];
    if (queued === undefined) {
      const now = Date.now();
      db.prepare(`UPDATE threadflow_waits SET state = 'completed', updated_at = ?, completed_at = ?
        WHERE id = ? AND state = 'releasing'`).run(now, now, wait.id);
      return;
    }

    const visibleText = wait.result.outcome === "condition_met" || wait.result.outcome === "resumed_manually"
      ? wait.resumePrompt
      : "The Threadflow wait ended without satisfying its condition. Reassess the blocker before continuing.";
    await bb.sdk.threads.queuedMessages.update({
      threadId: wait.threadId,
      queuedMessageId: queued.id,
      expectedUpdatedAt: queued.updatedAt,
      input: [
        { type: "text", text: visibleText, mentions: [] },
        waitMarkerBlock({
          version: 1,
          waitId: wait.id,
          result: wait.result,
          requestedResumePrompt: wait.resumePrompt,
        }),
      ],
    });
    db.prepare("UPDATE threadflow_waits SET state = 'ready', updated_at = ? WHERE id = ? AND state = 'releasing'")
      .run(Date.now(), wait.id);
    await bb.experimental_hooks.recheck("message.dispatch");
  };

  const releaseWait = async (waitId: string, result: WaitResult): Promise<void> => {
    const claimed = db.prepare(`UPDATE threadflow_waits SET state = 'releasing', result_json = ?, updated_at = ?
      WHERE id = ? AND state = 'waiting'`).run(JSON.stringify(result), Date.now(), waitId);
    if (claimed.changes === 0) return;
    try {
      await prepareRelease(waitId);
    } catch (cause) {
      bb.log.warn(`Could not prepare Threadflow wait ${waitId} for release: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const armWait = async ({
    sleepingThreadId,
    condition: conditionInput,
    timeoutMinutes,
    resumePrompt,
  }: {
    sleepingThreadId: string;
    condition: WaitConditionInput;
    timeoutMinutes: number;
    resumePrompt: string;
  }): Promise<ArmWaitResult> => {
    const sleepingThread = await bb.sdk.threads.get({ threadId: sleepingThreadId });
    if (sleepingThread.archivedAt !== null) throw new Error("An archived thread cannot be put to sleep.");
    const existing = await reconcileActiveWaitForThread(sleepingThreadId);
    if (existing !== null) {
      return {
        outcome: "already_waiting",
        waitId: existing.id,
        deadlineAt: existing.deadlineAt,
        label: existing.label,
      };
    }

    const resolved = await resolveCondition(sleepingThreadId, conditionInput);
    if (resolved.alreadySatisfied !== null) {
      return { outcome: "already_satisfied", detail: resolved.alreadySatisfied };
    }

    const now = Date.now();
    const waitId = randomUUID();
    const deadlineAt = now + timeoutMinutes * 60_000;
    const nextCheckAt = resolved.condition.kind === "instruction"
      ? now + INSTRUCTION_INITIAL_DELAY_MS
      : now + DIRECT_CHECK_INTERVAL_MS;
    try {
      db.prepare(`INSERT INTO threadflow_waits (
        id, thread_id, condition_kind, condition_json, state, label, resume_prompt,
        deadline_at, next_check_at, last_evidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'arming', ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          waitId,
          sleepingThreadId,
          resolved.condition.kind,
          JSON.stringify(resolved.condition),
          resolved.label,
          resumePrompt,
          deadlineAt,
          nextCheckAt,
          resolved.initialEvidence ?? null,
          now,
          now,
        );
    } catch (cause) {
      const raced = getActiveWaitForThread(sleepingThreadId);
      if (raced !== null) {
        return {
          outcome: "already_waiting",
          waitId: raced.id,
          deadlineAt: raced.deadlineAt,
          label: raced.label,
        };
      }
      throw cause;
    }

    try {
      const sent = await bb.sdk.threads.send({
        threadId: sleepingThreadId,
        mode: "queue-if-active",
        input: [
          { type: "text", text: resumePrompt, mentions: [] },
          waitMarkerBlock({ version: 1, waitId }),
        ],
      });
      if (sent.delivery !== "queued") {
        const result: WaitResult = {
          outcome: "resumed_manually",
          observedAt: Date.now(),
          detail: "The continuation dispatched before Threadflow could hold it.",
        };
        const completedAt = Date.now();
        db.prepare(`UPDATE threadflow_waits SET state = 'completed', result_json = ?, updated_at = ?, completed_at = ?
          WHERE id = ?`).run(JSON.stringify(result), completedAt, completedAt, waitId);
        throw new Error("The continuation dispatched before the wait could be armed.");
      }
      attachQueuedMessage(waitId, sent.queuedMessage.id);
    } catch (cause) {
      const rows = await bb.sdk.threads.queuedMessages.list({ threadId: sleepingThreadId }).catch(() => []);
      const queued = rows.find((row) => parseWaitMarker(row.content)?.waitId === waitId);
      if (queued === undefined) markWaitCancelled(waitId);
      else attachQueuedMessage(waitId, queued.id);
      throw cause;
    }

    return { outcome: "armed", waitId, deadlineAt, label: resolved.label };
  };

  const evaluateDirectWait = async (wait: WaitRecord, signal: AbortSignal): Promise<void> => {
    if (wait.condition.kind === "instruction") return;
    if (wait.condition.kind === "threads_idle") {
      try {
        const threads = await Promise.all(wait.condition.targets.map((target) => (
          bb.sdk.threads.get({ threadId: target.threadId })
        )));
        const pending = threads.flatMap((thread, index) => thread.status === "idle"
          ? []
          : [`“${wait.condition.targets[index]!.title}” (${thread.status})`]);
        if (pending.length === 0) {
          await releaseWait(wait.id, {
            outcome: "condition_met",
            observedAt: Date.now(),
            detail: `${threads.length === 1 ? `“${wait.condition.targets[0]!.title}” is` : `All ${threads.length} threads are`} idle.`,
          });
          return;
        }
        const now = Date.now();
        db.prepare(`UPDATE threadflow_waits
          SET next_check_at = ?, last_evidence = ?, updated_at = ?
          WHERE id = ? AND state = 'waiting'`)
          .run(now + DIRECT_CHECK_INTERVAL_MS, `Still running: ${pending.join(", ")}.`, now, wait.id);
      } catch (cause) {
        if (signal.aborted) return;
        bb.log.debug(`Could not check idle threads for wait ${wait.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
        db.prepare("UPDATE threadflow_waits SET next_check_at = ?, updated_at = ? WHERE id = ? AND state = 'waiting'")
          .run(Date.now() + DIRECT_CHECK_INTERVAL_MS, Date.now(), wait.id);
      }
      return;
    }
    if (wait.condition.kind === "thread_archived") {
      try {
        const target = await bb.sdk.threads.get({ threadId: wait.condition.targetThreadId });
        if (target.archivedAt !== null) {
          await releaseWait(wait.id, {
            outcome: "condition_met",
            observedAt: Date.now(),
            detail: `“${wait.condition.targetTitle}” was archived.`,
          });
          return;
        }
      } catch (cause) {
        bb.log.debug(`Could not check thread wait ${wait.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      db.prepare("UPDATE threadflow_waits SET next_check_at = ?, updated_at = ? WHERE id = ? AND state = 'waiting'")
        .run(Date.now() + DIRECT_CHECK_INTERVAL_MS, Date.now(), wait.id);
      return;
    }

    if (wait.condition.kind === "github_actions_succeeded") {
      try {
        const runs: GithubWorkflowRun[] = [];
        for (const expected of wait.condition.runs) {
          const observed = await inspectGithubWorkflowRun(expected, signal);
          if (observed.headSha !== expected.headSha) {
            await releaseWait(wait.id, {
              outcome: "condition_impossible",
              observedAt: Date.now(),
              detail: `${expected.workflowName} no longer points to commit ${expected.headSha}.`,
            });
            return;
          }
          runs.push(observed);
        }
        const failed = runs.find((run) => run.status === "completed" && run.conclusion !== "success");
        if (failed !== undefined) {
          await releaseWait(wait.id, {
            outcome: "condition_impossible",
            observedAt: Date.now(),
            detail: `${failed.workflowName} completed with conclusion ${failed.conclusion ?? "unknown"}.`,
          });
          return;
        }
        if (runs.every((run) => run.status === "completed" && run.conclusion === "success")) {
          await releaseWait(wait.id, {
            outcome: "condition_met",
            observedAt: Date.now(),
            detail: `${runs.length === 1 ? runs[0]!.workflowName : `${runs.length} GitHub Actions runs`} succeeded.`,
          });
          return;
        }
      } catch (cause) {
        if (signal.aborted) return;
        bb.log.debug(`Could not check GitHub Actions wait ${wait.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      db.prepare("UPDATE threadflow_waits SET next_check_at = ?, updated_at = ? WHERE id = ? AND state = 'waiting'")
        .run(Date.now() + DIRECT_CHECK_INTERVAL_MS, Date.now(), wait.id);
      return;
    }

    try {
      const result = await bb.sdk.environments.pullRequest({ environmentId: wait.condition.environmentId });
      if (result.outcome === "available") {
        const samePullRequest = result.pullRequest.number === wait.condition.pullRequestNumber
          && result.pullRequest.url === wait.condition.pullRequestUrl;
        if (!samePullRequest) {
          await releaseWait(wait.id, {
            outcome: "condition_impossible",
            observedAt: Date.now(),
            detail: `The environment no longer points to PR #${wait.condition.pullRequestNumber}.`,
          });
          return;
        }
        if (result.pullRequest.state === "merged") {
          await releaseWait(wait.id, {
            outcome: "condition_met",
            observedAt: Date.now(),
            detail: `PR #${wait.condition.pullRequestNumber} was merged.`,
          });
          return;
        }
        if (result.pullRequest.state === "closed") {
          await releaseWait(wait.id, {
            outcome: "condition_impossible",
            observedAt: Date.now(),
            detail: `PR #${wait.condition.pullRequestNumber} closed without merging.`,
          });
          return;
        }
      } else if (result.outcome === "absent") {
        await releaseWait(wait.id, {
          outcome: "condition_impossible",
          observedAt: Date.now(),
          detail: `PR #${wait.condition.pullRequestNumber} is no longer attached to the environment.`,
        });
        return;
      }
    } catch (cause) {
      bb.log.debug(`Could not check PR wait ${wait.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    db.prepare("UPDATE threadflow_waits SET next_check_at = ?, updated_at = ? WHERE id = ? AND state = 'waiting'")
      .run(Date.now() + DIRECT_CHECK_INTERVAL_MS, Date.now(), wait.id);
  };

  const cleanupWorker = async (threadId: string): Promise<void> => {
    try {
      await bb.sdk.threads.archive({ threadId });
    } catch (cause) {
      bb.log.debug(`Could not archive Threadflow wait checker ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    try {
      await bb.sdk.threads.stop({ threadId });
    } catch (cause) {
      bb.log.debug(`Could not stop Threadflow wait checker ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const evaluateWithModel = async (
    wait: WaitRecord,
    model: typeof INSTRUCTION_CHECK_MODELS[number],
    signal: AbortSignal,
  ): Promise<EvaluatorResult> => {
    if (wait.condition.kind !== "instruction") throw new Error("This wait is not instruction-based.");
    const sleepingThread = await bb.sdk.threads.get({ threadId: wait.threadId });
    if (sleepingThread.environmentId === null) throw new Error("The sleeping thread has no environment.");
    let workerThreadId: string | null = null;
    try {
      const worker = await bb.sdk.threads.spawn({
        projectId: sleepingThread.projectId,
        environment: { type: "reuse", environmentId: sleepingThread.environmentId },
        providerId: "codex",
        model,
        reasoningLevel: "low",
        permissionMode: "auto",
        serviceTier: "default",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
          serviceTier: "explicit",
        },
        visibility: "hidden",
        title: `${WAIT_CHECKER_TITLE_PREFIX} ${wait.id}`,
        prompt: [
          "You are a read-only condition checker for a sleeping coding agent.",
          "Inspect current state with tools only as needed. Do not modify files, branches, pull requests, threads, or external services.",
          "Return only strict JSON with this exact shape: {\"decision\":\"ready|wait|failed\",\"evidence\":\"brief observed evidence\"}.",
          "Use ready only when current observable evidence proves the condition true.",
          "Use wait when it is false, pending, or uncertain. Use failed only when it can no longer become true.",
          "Do not include a Markdown fence or any other text.",
          "",
          "CONDITION:",
          wait.condition.instruction,
        ].join("\n"),
      });
      workerThreadId = worker.id;
      db.prepare("UPDATE threadflow_waits SET worker_thread_id = ?, updated_at = ? WHERE id = ? AND state = 'waiting'")
        .run(worker.id, Date.now(), wait.id);
      await bb.sdk.threads.wait({ threadId: worker.id, status: "idle", timeoutMs: WORKER_TIMEOUT_MS, signal });
      const output = (await bb.sdk.threads.output({ threadId: worker.id, signal })).output?.trim() ?? "";
      const result = parseEvaluatorResult(output);
      if (result === null) throw new Error(`${model} returned invalid condition-check JSON.`);
      return result;
    } finally {
      if (workerThreadId !== null) await cleanupWorker(workerThreadId);
      db.prepare("UPDATE threadflow_waits SET worker_thread_id = NULL, updated_at = ? WHERE id = ?")
        .run(Date.now(), wait.id);
    }
  };

  const evaluateInstructionWait = async (wait: WaitRecord, signal: AbortSignal): Promise<void> => {
    if (wait.condition.kind !== "instruction") return;
    if (wait.checkCount >= MAX_INSTRUCTION_CHECKS) {
      await releaseWait(wait.id, {
        outcome: "timed_out",
        observedAt: Date.now(),
        detail: "The instruction-check budget was exhausted.",
      });
      return;
    }

    db.prepare(`UPDATE threadflow_waits
      SET check_count = check_count + 1, next_check_at = NULL, updated_at = ?
      WHERE id = ? AND state = 'waiting'`).run(Date.now(), wait.id);

    let result: EvaluatorResult | null = null;
    let lastError: unknown = null;
    for (const model of INSTRUCTION_CHECK_MODELS) {
      if (signal.aborted) return;
      try {
        result = await evaluateWithModel(wait, model, signal);
        break;
      } catch (cause) {
        lastError = cause;
        if (signal.aborted) return;
        bb.log.debug(`Condition checker ${model} failed for ${wait.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }

    if (result?.decision === "ready") {
      await releaseWait(wait.id, {
        outcome: "condition_met",
        observedAt: Date.now(),
        detail: result.evidence,
      });
      return;
    }
    if (result?.decision === "failed") {
      await releaseWait(wait.id, {
        outcome: "condition_impossible",
        observedAt: Date.now(),
        detail: result.evidence,
      });
      return;
    }

    const current = getWait(wait.id);
    if (current === null || current.state !== "waiting") return;
    const consecutiveErrors = result === null ? current.consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= MAX_CONSECUTIVE_CHECK_ERRORS) {
      await releaseWait(wait.id, {
        outcome: "condition_impossible",
        observedAt: Date.now(),
        detail: `The cheap condition checker failed three times: ${lastError instanceof Error ? lastError.message : String(lastError)}`.slice(0, 2_000),
      });
      return;
    }
    const nextCheckAt = Date.now() + INSTRUCTION_RECHECK_INTERVAL_MS;
    db.prepare(`UPDATE threadflow_waits
      SET next_check_at = ?, consecutive_errors = ?, last_evidence = ?, updated_at = ?
      WHERE id = ? AND state = 'waiting'`)
      .run(nextCheckAt, consecutiveErrors, result?.evidence ?? null, Date.now(), wait.id);
  };

  const recoverQueueState = async (): Promise<void> => {
    const activeWaits = listWaits("state IN ('arming', 'waiting', 'releasing', 'ready')");
    if (activeWaits.length === 0) return;
    const queuedRows = await bb.sdk.threads.queue.list();
    const queuedById = new Map(queuedRows.map((row) => [row.id, row]));
    const queuedByWaitId = new Map<string, (typeof queuedRows)[number]>();
    for (const row of queuedRows) {
      const marker = parseWaitMarker(row.content);
      if (marker !== null) queuedByWaitId.set(marker.waitId, row);
    }
    for (const wait of activeWaits) {
      const queued = wait.queuedMessageId === null
        ? queuedByWaitId.get(wait.id)
        : queuedById.get(wait.queuedMessageId) ?? queuedByWaitId.get(wait.id);
      if (queued !== undefined) {
        attachQueuedMessage(wait.id, queued.id);
        if (wait.state === "ready") await bb.experimental_hooks.recheck("message.dispatch");
        continue;
      }
      if (wait.state === "ready" || wait.state === "releasing") {
        const now = Date.now();
        db.prepare(`UPDATE threadflow_waits SET state = 'completed', updated_at = ?, completed_at = ?
          WHERE id = ?`).run(now, now, wait.id);
      } else if (wait.state === "arming" && Date.now() - wait.createdAt >= ARMING_RECOVERY_GRACE_MS) {
        markWaitCancelled(wait.id);
      } else if (wait.state === "waiting") {
        markWaitCancelled(wait.id);
      }
    }
  };

  const cleanupOrphanedWorkers = async (): Promise<void> => {
    const workers = await bb.sdk.threads.list({
      archived: false,
      includeHidden: true,
      originPluginId: bb.pluginId,
      limit: 200,
    });
    for (const worker of workers) {
      if (worker.title?.startsWith(WAIT_CHECKER_TITLE_PREFIX) !== true) continue;
      await cleanupWorker(worker.id);
    }
    db.prepare(`UPDATE threadflow_waits SET worker_thread_id = NULL, next_check_at = ?, updated_at = ?
      WHERE state = 'waiting' AND condition_kind = 'instruction' AND worker_thread_id IS NOT NULL`)
      .run(Date.now(), Date.now());
  };

  const monitorOnce = async (signal: AbortSignal): Promise<void> => {
    const now = Date.now();
    for (const wait of listWaits("state = 'releasing'")) {
      if (signal.aborted) return;
      await prepareRelease(wait.id);
    }
    for (const wait of listWaits("state = 'waiting' AND deadline_at <= ?", now)) {
      if (signal.aborted) return;
      await releaseWait(wait.id, {
        outcome: "timed_out",
        observedAt: now,
        detail: `The wait reached its deadline at ${new Date(wait.deadlineAt).toISOString()}.`,
      });
    }
    for (const wait of listWaits(
      "state = 'waiting' AND condition_kind != 'instruction' AND next_check_at IS NOT NULL AND next_check_at <= ? ORDER BY next_check_at LIMIT 20",
      now,
    )) {
      if (signal.aborted) return;
      await evaluateDirectWait(wait, signal);
    }
    const instructionWait = listWaits(
      "state = 'waiting' AND condition_kind = 'instruction' AND next_check_at IS NOT NULL AND next_check_at <= ? ORDER BY next_check_at LIMIT 1",
      now,
    )[0];
    if (!signal.aborted && instructionWait !== undefined) await evaluateInstructionWait(instructionWait, signal);
  };

  bb.experimental_hooks.on("message.dispatch", (context) => {
    const marker = parseWaitMarker(context.input.blocks);
    if (marker === null) return { action: "proceed" };
    const wait = getWait(marker.waitId);
    if (wait === null || wait.state === "ready" || wait.state === "completed") return { action: "proceed" };
    if (wait.state === "cancelled") {
      return { action: "reject", message: "This Threadflow wait was cancelled." };
    }
    const now = Date.now();
    return {
      action: "wait",
      reason: wait.label,
      sendAt: wait.deadlineAt > now ? wait.deadlineAt : now + MONITOR_INTERVAL_MS,
    };
  });

  bb.events.on("message.queued", ({ entry }) => {
    const marker = parseWaitMarker(entry.content);
    if (marker !== null) attachQueuedMessage(marker.waitId, entry.id);
  });
  bb.events.on("message.dispatched", ({ entry }) => {
    const wait = listWaits("queued_message_id = ? LIMIT 1", entry.id)[0];
    if (wait === undefined) return;
    const now = Date.now();
    const result = wait.result ?? {
      outcome: "resumed_manually" as const,
      observedAt: now,
      detail: "The queued continuation was sent manually.",
    };
    db.prepare(`UPDATE threadflow_waits SET state = 'completed', result_json = ?, updated_at = ?, completed_at = ?
      WHERE id = ?`).run(JSON.stringify(result), now, now, wait.id);
  });

  const handleSleepingThreadEnded = async (threadId: string) => {
    const wait = getActiveWaitForThread(threadId);
    if (wait === null) return;
    if (wait.queuedMessageId !== null) {
      try {
        await bb.sdk.threads.queuedMessages.delete({ threadId, queuedMessageId: wait.queuedMessageId });
      } catch {
        // It may already have been removed by the thread operation.
      }
    }
    markWaitCancelled(wait.id);
  };
  const failWaitsTargetingDeletedThread = async (threadId: string) => {
    const waits = listWaits("state = 'waiting'").filter((wait) => (
      ((wait.condition.kind === "thread_archived" || wait.condition.kind === "pull_request_merged")
        && wait.condition.targetThreadId === threadId)
      || (wait.condition.kind === "threads_idle"
        && wait.condition.targets.some((target) => target.threadId === threadId))
    ));
    for (const wait of waits) {
      await releaseWait(wait.id, {
        outcome: "condition_impossible",
        observedAt: Date.now(),
        detail: "The target thread was deleted.",
      });
    }
  };
  const reevaluateThreadIdleWaits = async (threadId: string) => {
    const waits = listWaits("state = 'waiting'").filter((wait) => (
      wait.condition.kind === "threads_idle"
      && wait.condition.targets.some((target) => target.threadId === threadId)
    ));
    for (const wait of waits) await evaluateDirectWait(wait, new AbortController().signal);
  };
  bb.events.on("thread.active", async ({ thread }) => {
    await reevaluateThreadIdleWaits(thread.id);
  });
  bb.events.on("thread.idle", async ({ thread }) => {
    await reevaluateThreadIdleWaits(thread.id);
  });
  bb.events.on("thread.failed", async ({ thread }) => {
    await reevaluateThreadIdleWaits(thread.id);
  });
  bb.events.on("thread.archived", async ({ thread }) => {
    await handleSleepingThreadEnded(thread.id);
    await reevaluateThreadIdleWaits(thread.id);
    const waits = listWaits("state = 'waiting'").filter((wait) => (
      wait.condition.kind === "thread_archived" && wait.condition.targetThreadId === thread.id
    ));
    for (const wait of waits) {
      if (wait.condition.kind !== "thread_archived") continue;
      await releaseWait(wait.id, {
        outcome: "condition_met",
        observedAt: Date.now(),
        detail: `“${wait.condition.targetTitle}” was archived.`,
      });
    }
  });
  bb.events.on("thread.deleted", async ({ thread }) => {
    await handleSleepingThreadEnded(thread.id);
    await failWaitsTargetingDeletedThread(thread.id);
  });

  bb.background.service("threadflow-wait-monitor", {
    async start(signal) {
      try {
        await cleanupOrphanedWorkers();
        await recoverQueueState();
      } catch (cause) {
        bb.log.warn(`Could not recover Threadflow waits: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      let lastQueueRecoveryAt = Date.now();
      while (!signal.aborted) {
        try {
          await monitorOnce(signal);
          if (Date.now() - lastQueueRecoveryAt >= DIRECT_CHECK_INTERVAL_MS) {
            await recoverQueueState();
            lastQueueRecoveryAt = Date.now();
          }
        } catch (cause) {
          if (!signal.aborted) {
            bb.log.warn(`Threadflow wait monitor failed: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        }
        await waitForMonitorTick(signal);
      }
    },
  });

  bb.agents.registerTool({
    name: "threadflow_wait",
    description: "Sleep this thread until one or more BB threads are idle, another thread is archived, its current pull request is merged, exact GitHub Actions runs succeed, or a cheap read-only agent judges a custom condition ready.",
    instructions: "Use typed conditions when possible. After an armed or already-waiting result, end the turn immediately and do not poll. Continue only when the result says the condition was already satisfied.",
    presentation: {
      label: {
        pending: "Arming Threadflow wait",
        completed: "Armed Threadflow wait",
      },
      suppress: false,
    },
    parameters: threadflowWaitParametersSchema,
    async execute({ condition, timeoutMinutes, resumePrompt }, { threadId }) {
      return formatToolResult(await armWait({
        sleepingThreadId: threadId,
        condition,
        timeoutMinutes,
        resumePrompt,
      }));
    },
  });

  const excludedPrefixes = [WAIT_CHECKER_TITLE_PREFIX, ...(options.excludedThreadTitlePrefixes ?? [])];
  bb.agents.configure((context) => ({
    tools: context.origin.pluginId === bb.pluginId
      && context.thread.title !== null
      && excludedPrefixes.some((prefix) => context.thread.title!.startsWith(prefix))
      ? []
      : ["threadflow_wait"],
    skills: [],
  }));

  return {
    async getActiveWait(threadId) {
      const wait = await reconcileActiveWaitForThread(threadId);
      if (wait === null || wait.state === "completed" || wait.state === "cancelled") return null;
      return {
        id: wait.id,
        state: wait.state,
        label: wait.label,
        condition: wait.condition,
        deadlineAt: wait.deadlineAt,
        nextCheckAt: wait.nextCheckAt,
        checkCount: wait.checkCount,
        lastEvidence: wait.lastEvidence,
        createdAt: wait.createdAt,
      };
    },
    getIdleDependencies(queuedMessageIds) {
      return listWaits("state IN ('arming', 'waiting', 'releasing', 'ready') AND condition_kind = 'threads_idle'")
        .flatMap((wait) => wait.condition.kind === "threads_idle"
          && wait.queuedMessageId !== null
          && queuedMessageIds.has(wait.queuedMessageId)
          ? [{
              waitingThreadId: wait.threadId,
              targetThreadIds: wait.condition.targets.map((target) => target.threadId),
            }]
          : []);
    },
  };
}
