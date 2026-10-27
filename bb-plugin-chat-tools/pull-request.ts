import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const GITHUB_PR_STATUS_PLUGIN_ID = "bb--github-pr-status";

// Validate the fields Chat tools consumes; the provider owns the full PR shape.
export const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["open", "draft", "merged", "closed"]),
  attention: z.string(),
  checks: z.object({
    state: z.enum(["passing", "failing", "pending", "no_checks", "unknown"]),
    totalCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
  }),
});

const pullRequestResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("available"), pullRequest: pullRequestSchema }),
  z.object({ outcome: z.literal("absent") }),
  z.object({ outcome: z.literal("unavailable"), message: z.string() }),
]);

export const githubPrContract = defineRpcContract({
  pullRequests: {
    input: z.object({ keys: z.array(z.string().min(1)).min(1).max(200) }),
    output: z.record(z.string(), pullRequestResultSchema),
  },
});

export type PullRequest = z.infer<typeof pullRequestSchema>;

export async function readPullRequest(bb: BbPluginApi, environmentId: string) {
  const results = await bb.sdk.plugins.callRpc({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    method: "pullRequests",
    input: { keys: [environmentId] },
    outputSchema: githubPrContract.pullRequests.output,
  });
  return results[environmentId] ?? {
    outcome: "unavailable" as const,
    message: "GitHub PR Status returned no result for this environment.",
  };
}
