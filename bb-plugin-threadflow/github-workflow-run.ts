import { z } from "zod";

const REQUEST_TIMEOUT_MS = 10_000;

const workflowRunResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/i),
  status: z.string().min(1),
  conclusion: z.string().nullable(),
  html_url: z.string().url(),
}).passthrough();

export interface GithubWorkflowRunIdentity {
  owner: string;
  repository: string;
  runId: number;
  runUrl: string;
}

export interface GithubWorkflowRun extends GithubWorkflowRunIdentity {
  workflowName: string;
  headSha: string;
  status: string;
  conclusion: string | null;
}

export function parseGithubWorkflowRunUrl(value: string): GithubWorkflowRunIdentity {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid GitHub Actions run URL: ${value}`);
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/actions\/runs\/([1-9]\d*)\/?$/);
  if (
    url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || match === null
  ) {
    throw new Error(`Invalid GitHub Actions run URL: ${value}`);
  }
  const runId = Number(match[3]);
  if (!Number.isSafeInteger(runId)) throw new Error(`Invalid GitHub Actions run URL: ${value}`);
  return {
    owner: match[1]!,
    repository: match[2]!,
    runId,
    runUrl: url.href.replace(/\/$/, ""),
  };
}

export async function fetchGithubWorkflowRun(
  identity: GithubWorkflowRunIdentity,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<GithubWorkflowRun> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal === undefined
    ? timeoutSignal
    : AbortSignal.any([options.signal, timeoutSignal]);
  const token = options.token?.trim();
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repository)}/actions/runs/${identity.runId}`,
    {
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "bb-plugin-threadflow",
        ...(token === undefined || token === "" ? {} : { Authorization: `Bearer ${token}` }),
      },
    },
  );
  if (!response.ok) {
    const credentialHint = response.status === 401 || response.status === 403 || response.status === 404
      ? " Configure Threadflow's GitHub token with Actions read access if this is a private repository."
      : "";
    throw new Error(`GitHub returned ${response.status} for ${identity.runUrl}.${credentialHint}`);
  }
  const parsed = workflowRunResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`GitHub returned an invalid workflow run for ${identity.runUrl}.`);
  const responseIdentity = parseGithubWorkflowRunUrl(parsed.data.html_url);
  if (
    parsed.data.id !== identity.runId
    || responseIdentity.owner.toLowerCase() !== identity.owner.toLowerCase()
    || responseIdentity.repository.toLowerCase() !== identity.repository.toLowerCase()
    || responseIdentity.runId !== identity.runId
  ) {
    throw new Error(`GitHub returned a different workflow run for ${identity.runUrl}.`);
  }
  return {
    ...identity,
    workflowName: parsed.data.name,
    headSha: parsed.data.head_sha.toLowerCase(),
    status: parsed.data.status,
    conclusion: parsed.data.conclusion,
  };
}
