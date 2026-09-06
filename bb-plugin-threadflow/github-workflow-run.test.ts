import assert from "node:assert/strict";
import test from "node:test";

import { fetchGithubWorkflowRun, parseGithubWorkflowRunUrl } from "./github-workflow-run.ts";

const RUN_URL = "https://github.com/use-bogi/usebogi.com/actions/runs/33998698980";

test("parses only exact GitHub Actions run URLs", () => {
  assert.deepEqual(parseGithubWorkflowRunUrl(RUN_URL), {
    owner: "use-bogi",
    repository: "usebogi.com",
    runId: 33_998_698_980,
    runUrl: RUN_URL,
  });
  assert.throws(() => parseGithubWorkflowRunUrl(`${RUN_URL}?attempt=1`), /Invalid GitHub Actions run URL/);
  assert.throws(() => parseGithubWorkflowRunUrl("https://example.com/org/repo/actions/runs/1"), /Invalid GitHub Actions run URL/);
});

test("fetches and validates the exact workflow run", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.github.com/repos/use-bogi/usebogi.com/actions/runs/33998698980");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer github-token");
    return Response.json({
      id: 33_998_698_980,
      name: "Deploy Sandbox",
      head_sha: "28b49da5b1ef555d3b125bbf8ca49e80fa1ae4a2",
      status: "completed",
      conclusion: "success",
      html_url: RUN_URL,
    });
  };

  assert.deepEqual(await fetchGithubWorkflowRun(parseGithubWorkflowRunUrl(RUN_URL), {
    token: "github-token",
  }), {
    owner: "use-bogi",
    repository: "usebogi.com",
    runId: 33_998_698_980,
    runUrl: RUN_URL,
    workflowName: "Deploy Sandbox",
    headSha: "28b49da5b1ef555d3b125bbf8ca49e80fa1ae4a2",
    status: "completed",
    conclusion: "success",
  });
});

test("rejects a response for a different workflow run", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => Response.json({
    id: 1,
    name: "Deploy Sandbox",
    head_sha: "28b49da5b1ef555d3b125bbf8ca49e80fa1ae4a2",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/use-bogi/usebogi.com/actions/runs/1",
  });

  await assert.rejects(
    fetchGithubWorkflowRun(parseGithubWorkflowRunUrl(RUN_URL)),
    /different workflow run/,
  );
});
