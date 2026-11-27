import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  parseArenaCtlCliArgs,
  resolveCliInputPath,
  resolveVisualEvidenceIngestInputPaths,
} from "./cli.js";

test("parseArenaCtlCliArgs parses explicit authd health input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "authd_health",
    ]),
    {
      command: "authd_health",
    },
  );
});

test("parseArenaCtlCliArgs rejects authd health flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "authd_health",
      "--refresh",
      "true",
    ]),
    /Unsupported flag\(s\): --refresh/,
  );
});

test("parseArenaCtlCliArgs parses explicit authd operator digest input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "authd_operator_digest",
      "--provider",
      "codex",
    ]),
    {
      command: "authd_operator_digest",
      provider: "codex",
    },
  );
});

test("parseArenaCtlCliArgs requires explicit authd operator digest provider", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "authd_operator_digest",
    ]),
    /Missing required --provider/,
  );
});

test("parseArenaCtlCliArgs rejects unsupported authd operator digest provider", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "authd_operator_digest",
      "--provider",
      "openai",
    ]),
    /Expected codex or claude/,
  );
});

test("parseArenaCtlCliArgs parses explicit token status input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "token_status",
    ]),
    {
      command: "token_status",
    },
  );
});

test("parseArenaCtlCliArgs rejects token status flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "token_status",
      "--values",
      "true",
    ]),
    /Unsupported flag\(s\): --values/,
  );
});

test("parseArenaCtlCliArgs parses explicit project experiment preflight input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_experiment_preflight",
      "--project-id",
      "project-1",
      "--mode",
      "agent_run",
      "--tail",
      "80",
    ]),
    {
      command: "project_experiment_preflight",
      projectId: "project-1",
      mode: "agent_run",
      tail: 80,
    },
  );
});

test("parseArenaCtlCliArgs requires explicit preflight mode", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_experiment_preflight",
      "--project-id",
      "project-1",
    ]),
    /Missing required --mode/,
  );
});

test("parseArenaCtlCliArgs rejects unknown flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_experiment_preflight",
      "--project-id",
      "project-1",
      "--mode",
      "preview_only",
      "--retry",
      "true",
    ]),
    /Unsupported flag\(s\): --retry/,
  );
});

test("parseArenaCtlCliArgs parses explicit project stage snapshot input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_stage_snapshot",
      "--project-id",
      "project-1",
      "--task-id",
      "task-001",
      "--tail",
      "80",
    ]),
    {
      command: "project_stage_snapshot",
      projectId: "project-1",
      taskId: "task-001",
      tail: 80,
    },
  );
});

test("parseArenaCtlCliArgs requires project stage snapshot project id", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_stage_snapshot",
      "--task-id",
      "task-001",
    ]),
    /Missing required --project-id/,
  );
});

test("parseArenaCtlCliArgs rejects project stage snapshot mutation flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_stage_snapshot",
      "--project-id",
      "project-1",
      "--retry",
      "true",
    ]),
    /Unsupported flag\(s\): --retry/,
  );
});

test("parseArenaCtlCliArgs parses explicit project stage candidate scan input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_stage_candidates",
      "--limit",
      "12",
      "--include-archived",
      "enabled",
      "--tail",
      "5",
    ]),
    {
      command: "project_stage_candidates",
      limit: 12,
      includeArchived: true,
      tail: 5,
    },
  );
});

test("parseArenaCtlCliArgs rejects project stage candidate scan mutation flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_stage_candidates",
      "--retry",
      "true",
    ]),
    /Unsupported flag\(s\): --retry/,
  );
});

test("parseArenaCtlCliArgs rejects oversized project stage candidate tail", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_stage_candidates",
      "--tail",
      "5001",
    ]),
    /Invalid --tail 5001\. Expected an integer from 1 to 5000\./,
  );
});

test("parseArenaCtlCliArgs parses explicit project updates input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_updates",
      "--project-id",
      "project-1",
      "--tail",
      "12",
    ]),
    {
      command: "project_updates",
      projectId: "project-1",
      tail: 12,
    },
  );
});

test("parseArenaCtlCliArgs requires explicit project updates project id", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_updates",
    ]),
    /Missing required --project-id/,
  );
});

test("parseArenaCtlCliArgs rejects invalid project updates tail", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_updates",
      "--project-id",
      "project-1",
      "--tail",
      "0",
    ]),
    /Invalid --tail 0/,
  );
});

test("parseArenaCtlCliArgs parses explicit project proof reviews input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_proof_reviews",
      "--project-id",
      "project-1",
    ]),
    {
      command: "project_proof_reviews",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs parses explicit project runtime auth mode update", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_set_runtime_auth_modes",
      "--project-id",
      "project-1",
      "--codex-auth-mode",
      "subscription",
    ]),
    {
      command: "project_set_runtime_auth_modes",
      projectId: "project-1",
      codexAuthMode: "subscription",
      claudeAuthMode: undefined,
    },
  );
});

test("parseArenaCtlCliArgs requires at least one runtime auth mode", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_set_runtime_auth_modes",
      "--project-id",
      "project-1",
    ]),
    /At least one of --claude-auth-mode or --codex-auth-mode is required/,
  );
});

test("parseArenaCtlCliArgs supports clearing a runtime auth mode", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_set_runtime_auth_modes",
      "--project-id",
      "project-1",
      "--claude-auth-mode",
      "null",
    ]),
    {
      command: "project_set_runtime_auth_modes",
      projectId: "project-1",
      claudeAuthMode: null,
      codexAuthMode: undefined,
    },
  );
});

test("parseArenaCtlCliArgs rejects unsupported runtime auth modes", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_set_runtime_auth_modes",
      "--project-id",
      "project-1",
      "--codex-auth-mode",
      "oauth",
    ]),
    /Expected subscription, api_key or null/,
  );
});

test("parseArenaCtlCliArgs parses explicit project runtime system update", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_set_runtime_system",
      "--project-id",
      "sushi-kitties",
      "--agent",
      "codex",
      "--agent-impl",
      "ralph",
      "--model",
      "gpt-5.5",
      "--tool-id",
      "tool-codex",
      "--provider-billing-mode",
      "platform_credentials",
      "--codex-auth-mode",
      "subscription",
    ]),
    {
      command: "project_set_runtime_system",
      projectId: "sushi-kitties",
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      toolId: "tool-codex",
      providerBillingMode: "platform_credentials",
      claudeAuthMode: undefined,
      codexAuthMode: "subscription",
    },
  );
});

test("parseArenaCtlCliArgs requires runtime system billing mode", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_set_runtime_system",
      "--project-id",
      "sushi-kitties",
      "--agent",
      "codex",
      "--agent-impl",
      "ralph",
      "--model",
      "gpt-5.5",
    ]),
    /Missing required --provider-billing-mode/,
  );
});

test("parseArenaCtlCliArgs parses explicit source snapshot update", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_set_source_snapshot",
      "--project-id",
      "project-1",
      "--commit-sha",
      "298adb82e6f8b2dcc0df7026c011a90d514373d8",
    ]),
    {
      command: "project_set_source_snapshot",
      projectId: "project-1",
      commitSha: "298adb82e6f8b2dcc0df7026c011a90d514373d8",
    },
  );
});

test("parseArenaCtlCliArgs rejects short source snapshot SHAs", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_set_source_snapshot",
      "--project-id",
      "project-1",
      "--commit-sha",
      "298adb8",
    ]),
    /--commit-sha must be a 40 character git SHA/,
  );
});

test("parseArenaCtlCliArgs parses explicit project visual evidence mode update", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_set_visual_evidence_mode",
      "--project-id",
      "project-1",
      "--visual-evidence-mode",
      "new_tasks_only",
    ]),
    {
      command: "project_set_visual_evidence_mode",
      projectId: "project-1",
      visualEvidenceMode: "new_tasks_only",
    },
  );
});

test("parseArenaCtlCliArgs rejects unsupported project visual evidence modes", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_set_visual_evidence_mode",
      "--project-id",
      "project-1",
      "--visual-evidence-mode",
      "sometimes",
    ]),
    /Expected off, required or new_tasks_only/,
  );
});

test("parseArenaCtlCliArgs parses explicit project retry now input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_retry_now",
      "--project-id",
      "project-1",
    ]),
    {
      command: "project_retry_now",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs rejects unknown project retry now flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_retry_now",
      "--project-id",
      "project-1",
      "--force",
      "true",
    ]),
    /Unsupported flag\(s\): --force/,
  );
});

test("parseArenaCtlCliArgs parses explicit project agent off input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_agent_off",
      "--project-id",
      "project-1",
    ]),
    {
      command: "project_agent_off",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs rejects project agent off overrides", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_agent_off",
      "--project-id",
      "project-1",
      "--force",
      "true",
    ]),
    /Unsupported flag\(s\): --force/,
  );
});

test("parseArenaCtlCliArgs parses explicit project agent on input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_agent_on",
      "--project-id",
      "project-1",
    ]),
    {
      command: "project_agent_on",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs rejects project agent on overrides", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_agent_on",
      "--project-id",
      "project-1",
      "--relaunch",
      "true",
    ]),
    /Unsupported flag\(s\): --relaunch/,
  );
});

test("parseArenaCtlCliArgs parses explicit project relaunch input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_relaunch",
      "--project-id",
      "project-1",
    ]),
    {
      command: "project_relaunch",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs rejects project relaunch overrides", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_relaunch",
      "--project-id",
      "project-1",
      "--provider-billing-mode",
      "platform_credentials",
    ]),
    /Unsupported flag\(s\): --provider-billing-mode/,
  );
});

test("parseArenaCtlCliArgs parses explicit project recreate runtime input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_recreate_runtime",
      "--project-id",
      "project-1",
    ]),
    {
      command: "project_recreate_runtime",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs rejects project recreate runtime flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_recreate_runtime",
      "--project-id",
      "project-1",
      "--retry",
      "true",
    ]),
    /Unsupported flag\(s\): --retry/,
  );
});

test("parseArenaCtlCliArgs requires explicit proof reviews project id", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_proof_reviews",
    ]),
    /Missing required --project-id/,
  );
});

test("parseArenaCtlCliArgs rejects unknown proof reviews flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_proof_reviews",
      "--project-id",
      "project-1",
      "--scan-files",
      "true",
    ]),
    /Unsupported flag\(s\): --scan-files/,
  );
});

test("parseArenaCtlCliArgs parses explicit visual evidence artifact check input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_visual_evidence_artifact_check",
      "--project-id",
      "project-1",
    ]),
    {
      command: "project_visual_evidence_artifact_check",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs requires explicit visual evidence artifact check project id", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_visual_evidence_artifact_check",
    ]),
    /Missing required --project-id/,
  );
});

test("parseArenaCtlCliArgs rejects unknown visual evidence artifact check flags", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_visual_evidence_artifact_check",
      "--project-id",
      "project-1",
      "--scan-files",
      "true",
    ]),
    /Unsupported flag\(s\): --scan-files/,
  );
});

test("parseArenaCtlCliArgs parses explicit visual evidence ingest input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_visual_evidence_ingest",
      "--project-id",
      "project-1",
      "--task-id",
      "task-001",
      "--evidence-ref",
      "visual-workbench-capture:task-001:desktop:abc",
      "--progress-json",
      "/work/stook/.arena/progress.json",
      "--artifact-file",
      "/work/stook/.ralph/visual-workbench/task-001/desktop/capture.png",
    ]),
    {
      command: "project_visual_evidence_ingest",
      projectId: "project-1",
      taskId: "task-001",
      sourceEvidenceRef: "visual-workbench-capture:task-001:desktop:abc",
      progressJsonPath: "/work/stook/.arena/progress.json",
      artifactFilePath: "/work/stook/.ralph/visual-workbench/task-001/desktop/capture.png",
    },
  );
});

test("parseArenaCtlCliArgs requires explicit visual evidence ingest files", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_visual_evidence_ingest",
      "--project-id",
      "project-1",
      "--task-id",
      "task-001",
      "--evidence-ref",
      "visual-workbench-capture:task-001:desktop:abc",
      "--progress-json",
      "/work/stook/.arena/progress.json",
    ]),
    /Missing required --artifact-file/,
  );
});

test("parseArenaCtlCliArgs parses explicit project spec artifact audit input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_spec_artifact_audit",
      "--project-id",
      "project-1",
    ]),
    {
      command: "project_spec_artifact_audit",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs parses explicit project create input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "project_create",
      "--title",
      "RA-356 Visual Workbench Canary",
      "--spec",
      "Build a tiny synth UI.",
      "--source-seed-profile",
      "visual_workbench_canary_v0",
      "--agent",
      "codex",
      "--agent-impl",
      "direct",
      "--model",
      "gpt-5.5",
      "--provider-billing-mode",
      "byok",
      "--initial-budget-usd",
      "3.5",
    ]),
    {
      command: "project_create",
      title: "RA-356 Visual Workbench Canary",
      spec: "Build a tiny synth UI.",
      sourceSeedProfile: "visual_workbench_canary_v0",
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      providerBillingMode: "byok",
      initialBudgetUsd: 3.5,
      runnerBackend: undefined,
      claudeAuthMode: undefined,
      codexAuthMode: undefined,
    },
  );
});

test("parseArenaCtlCliArgs requires explicit project create title and spec", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_create",
      "--title",
      "RA-356 Visual Workbench Canary",
    ]),
    /Missing required --spec/,
  );
});

test("parseArenaCtlCliArgs rejects invalid project create budget", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "project_create",
      "--title",
      "RA-356 Visual Workbench Canary",
      "--spec",
      "Build a tiny synth UI.",
      "--initial-budget-usd",
      "0",
    ]),
    /Invalid --initial-budget-usd 0/,
  );
});

test("parseArenaCtlCliArgs parses explicit tg-spec target create input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "tg_spec_target_create",
      "--title",
      "RA-356 Accepted Visual Canary",
      "--source-project-id",
      "tg-ra356-canary-1",
      "--source-seed-profile",
      "visual_workbench_canary_v0",
      "--agent",
      "codex",
      "--agent-impl",
      "direct",
      "--model",
      "gpt-5.5",
      "--provider-billing-mode",
      "byok",
      "--initial-budget-usd",
      "2.5",
    ]),
    {
      command: "tg_spec_target_create",
      title: "RA-356 Accepted Visual Canary",
      sourceProjectId: "tg-ra356-canary-1",
      sourceSeedProfile: "visual_workbench_canary_v0",
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      providerBillingMode: "byok",
      initialBudgetUsd: 2.5,
      runnerBackend: undefined,
      claudeAuthMode: undefined,
      codexAuthMode: undefined,
    },
  );
});

test("parseArenaCtlCliArgs parses explicit tg-spec accepted artifact import input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "tg_spec_accepted_artifact_import",
      "--project-id",
      "project-1",
      "--package-file",
      "/tmp/accepted-import-package.json",
    ]),
    {
      command: "tg_spec_accepted_artifact_import",
      projectId: "project-1",
      packageFile: "/tmp/accepted-import-package.json",
    },
  );
});

test("parseArenaCtlCliArgs requires explicit tg-spec accepted import package file", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "tg_spec_accepted_artifact_import",
      "--project-id",
      "project-1",
    ]),
    /Missing required --package-file/,
  );
});

test("parseArenaCtlCliArgs parses explicit tg-spec launch start input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "tg_spec_launch_start",
      "--project-id",
      "project-1",
    ]),
    {
      command: "tg_spec_launch_start",
      projectId: "project-1",
    },
  );
});

test("parseArenaCtlCliArgs parses explicit tg-spec launch configure input", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "tg_spec_launch_configure",
      "--project-id",
      "project-1",
      "--agent",
      "codex",
      "--agent-impl",
      "direct",
      "--runner-backend",
      "local",
      "--provider-billing-mode",
      "byok",
      "--model",
      "gpt-5.4",
      "--codex-auth-mode",
      "subscription",
      "--visual-workbench-evidence-automation",
      "enabled",
    ]),
    {
      command: "tg_spec_launch_configure",
      projectId: "project-1",
      agent: "codex",
      agentImpl: "direct",
      runnerBackend: "local",
      providerBillingMode: "byok",
      model: "gpt-5.4",
      codexAuthMode: "subscription",
      claudeAuthMode: undefined,
      toolId: undefined,
      initialBudgetUsd: undefined,
      visualEvidenceMode: undefined,
      visualWorkbenchEvidenceAutomation: true,
    },
  );
});

test("parseArenaCtlCliArgs reads tg-spec launch visual evidence mode", () => {
  assert.deepEqual(
    parseArenaCtlCliArgs([
      "tg_spec_launch_configure",
      "--project-id",
      "project-1",
      "--agent",
      "codex",
      "--agent-impl",
      "direct",
      "--runner-backend",
      "local",
      "--provider-billing-mode",
      "byok",
      "--visual-evidence-mode",
      "new_tasks_only",
    ]),
    {
      command: "tg_spec_launch_configure",
      projectId: "project-1",
      agent: "codex",
      agentImpl: "direct",
      runnerBackend: "local",
      providerBillingMode: "byok",
      model: undefined,
      codexAuthMode: undefined,
      claudeAuthMode: undefined,
      toolId: undefined,
      initialBudgetUsd: undefined,
      visualEvidenceMode: "new_tasks_only",
      visualWorkbenchEvidenceAutomation: undefined,
    },
  );
});

test("parseArenaCtlCliArgs rejects unknown tg-spec Workbench automation mode", () => {
  assert.throws(
    () => parseArenaCtlCliArgs([
      "tg_spec_launch_configure",
      "--project-id",
      "project-1",
      "--agent",
      "codex",
      "--agent-impl",
      "direct",
      "--runner-backend",
      "local",
      "--provider-billing-mode",
      "byok",
      "--visual-workbench-evidence-automation",
      "maybe",
    ]),
    /Expected enabled or disabled/,
  );
});

test("resolveCliInputPath resolves package files from the original invocation cwd", () => {
  const previous = process.env.ARENA_CTL_INVOCATION_CWD;
  process.env.ARENA_CTL_INVOCATION_CWD = "/repo/root";
  try {
    assert.equal(
      resolveCliInputPath("work/plans/fixture.json"),
      path.resolve("/repo/root", "work/plans/fixture.json"),
    );
    assert.equal(
      resolveCliInputPath("/absolute/fixture.json"),
      "/absolute/fixture.json",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ARENA_CTL_INVOCATION_CWD;
    } else {
      process.env.ARENA_CTL_INVOCATION_CWD = previous;
    }
  }
});

test("resolveVisualEvidenceIngestInputPaths accepts same-workspace Workbench capture inputs", () => {
  const previous = process.env.ARENA_CTL_INVOCATION_CWD;
  process.env.ARENA_CTL_INVOCATION_CWD = "/repo/root";
  try {
    assert.deepEqual(
      resolveVisualEvidenceIngestInputPaths({
        progressJsonPath: "workspaces/stook/.arena/progress.json",
        artifactFilePath: "workspaces/stook/.ralph/visual-workbench/task-001/desktop/capture.png",
      }),
      {
        progressJsonPath: path.resolve("/repo/root", "workspaces/stook/.arena/progress.json"),
        artifactFilePath: path.resolve("/repo/root", "workspaces/stook/.ralph/visual-workbench/task-001/desktop/capture.png"),
      },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ARENA_CTL_INVOCATION_CWD;
    } else {
      process.env.ARENA_CTL_INVOCATION_CWD = previous;
    }
  }
});

test("resolveVisualEvidenceIngestInputPaths rejects cross-workspace or non-Workbench files", () => {
  assert.throws(
    () => resolveVisualEvidenceIngestInputPaths({
      progressJsonPath: "/work/stook/.arena/progress.json",
      artifactFilePath: "/work/other/.ralph/visual-workbench/task-001/desktop/capture.png",
    }),
    /same workspace/,
  );
  assert.throws(
    () => resolveVisualEvidenceIngestInputPaths({
      progressJsonPath: "/work/stook/progress.json",
      artifactFilePath: "/work/stook/.ralph/visual-workbench/task-001/desktop/capture.png",
    }),
    /\.arena\/progress\.json/,
  );
  assert.throws(
    () => resolveVisualEvidenceIngestInputPaths({
      progressJsonPath: "/work/stook/.arena/progress.json",
      artifactFilePath: "/work/stook/.ralph/visual-workbench/task-001/desktop/capture.jpg",
    }),
    /PNG/,
  );
});
