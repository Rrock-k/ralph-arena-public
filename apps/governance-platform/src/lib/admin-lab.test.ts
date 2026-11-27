import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));
vi.mock("node:net", () => ({
  default: {
    createServer: vi.fn(() => ({
      once: vi.fn(function once() {
        return this;
      }),
      listen: vi.fn(function listen(_port: number, _host: string, callback: () => void) {
        callback();
        return this;
      }),
      address: vi.fn(() => ({ port: 45678 })),
      close: vi.fn((callback?: (error?: Error) => void) => {
        callback?.();
      }),
    })),
  },
}));
vi.mock("@/lib/admin-ops-projects", () => ({
  getProjectOperatorSnapshotForViewer: vi.fn(),
}));
vi.mock("@/lib/project-interaction", () => ({
  getProjectInteractionSnapshotForViewer: vi.fn(),
}));
vi.mock("@/lib/project-visual-evidence-readiness", () => ({
  buildVisualEvidenceReadiness: vi.fn(),
}));
vi.mock("@/lib/spec-artifact-audit", () => ({
  getProjectSpecArtifactAudit: vi.fn(),
}));
vi.mock("@/lib/runtime-intent-claim-dry-run", () => ({
  buildRuntimeIntentClaimDryRun: vi.fn(),
}));
vi.mock("@/lib/runner-init-readiness", () => ({
  buildRunnerInitReadinessSummary: vi.fn(),
}));
vi.mock("@/lib/project-visual-evidence-artifact-check", () => ({
  buildProjectVisualEvidenceArtifactCheck: vi.fn(),
}));
vi.mock("@/app/actions/agent-intent", () => ({
  setAgentIntentInternal: vi.fn(),
}));

import {
  getAdminLabStageCatalog,
  runAdminLabStage,
  AdminLabError,
} from "./admin-lab";
import { execFile } from "node:child_process";
import { getProjectOperatorSnapshotForViewer } from "@/lib/admin-ops-projects";
import { setAgentIntentInternal } from "@/app/actions/agent-intent";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

function argValue(args: readonly unknown[] | undefined, name: string): string {
  if (!Array.isArray(args)) throw new Error(`args missing ${name}`);
  const index = args.indexOf(name);
  if (index < 0 || typeof args[index + 1] !== "string") throw new Error(`arg missing ${name}`);
  return args[index + 1] as string;
}

describe("Admin Lab stage catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ARENA_REPO_ROOT = "/repo";
    vi.mocked(getProjectOperatorSnapshotForViewer).mockResolvedValue({
      id: "project-1",
      name: "Project",
      visualEvidenceMode: "new_tasks_only",
      visualEvidenceModeError: null,
    } as any);
    vi.mocked(setAgentIntentInternal).mockResolvedValue({ success: true });
    vi.mocked(execFile).mockImplementation((file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (!cb) throw new Error("callback missing");
      cb(null, "", "");
      return {} as any;
    });
  });

  it("marks source-current snapshot and provider project actions as UI-runnable while fork continuation stays direct CLI", () => {
    const stages = getAdminLabStageCatalog();
    const pauseAgent = stages.find((stage) => stage.id === "project_agent_off");
    const resumeAgent = stages.find((stage) => stage.id === "project_agent_on");
    const candidates = stages.find((stage) => stage.id === "project_stage_candidates");
    const snapshot = stages.find((stage) => stage.id === "project_stage_snapshot");
    const planner = stages.find((stage) => stage.id === "planner_project_dry_run");
    const executor = stages.find((stage) => stage.id === "executor_project_task");
    const executorContinue = stages.find((stage) => stage.id === "executor_task_workspace_continue");
    const executorSourceSnapshot = stages.find((stage) => stage.id === "executor_workspace_source_snapshot");
    const controller = stages.find((stage) => stage.id === "controller_project_dry_run");

    expect(pauseAgent).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "operator_mutation",
      ownerBoundary: "governance.project-agent-intent",
    });
    expect(pauseAgent?.currentCommand).toBeNull();
    expect(pauseAgent?.forbiddenMutations).toContain("relaunch");
    expect(pauseAgent?.forbiddenMutations).toContain("task/progress/evidence writes");

    expect(resumeAgent).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "operator_mutation",
      ownerBoundary: "governance.project-agent-intent",
    });
    expect(resumeAgent?.currentCommand).toBeNull();
    expect(resumeAgent?.forbiddenMutations).toContain("runtime recreate");

    expect(candidates).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "read_only",
      ownerBoundary: "arena-ctl.project-stage-candidates",
    });
    expect(candidates?.currentCommand).toBeNull();

    expect(snapshot).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "read_only",
      ownerBoundary: "arena-ctl.project-stage-snapshot",
    });
    expect(snapshot?.currentCommand).toBeNull();

    expect(planner).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "workspace_dry_run",
      ownerBoundary: "ralph.planner.dry-run-adapter",
    });
    expect(planner?.currentCommand).toContain("npm --prefix packages/loops/ralph-runtime run ralph -- stage run");
    expect(planner?.currentCommand).toContain("planner_project_dry_run --snapshot <project-stage-snapshot.json>");

    expect(executor).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "workspace_mutation",
      ownerBoundary: "ralph.executor-project-task-adapter",
    });
    expect(executor?.currentCommand).toContain("npm --prefix packages/loops/ralph-runtime run ralph -- stage run");
    expect(executor?.currentCommand).toContain("--mode <new_task|failed_task|resume_interrupted>");
    expect(executor?.currentCommand).toContain("--workspace-mode live_workspace_action");
    expect(executor?.allowedMutations).toContain("local project commit after successful clean result");
    expect(executor?.forbiddenMutations).toContain("hidden fork fallback");

    expect(executorContinue).toMatchObject({
      status: "supported_now",
      runSurface: "direct_cli",
      mode: "workspace_mutation",
      ownerBoundary: "ralph.executor-action-core",
    });
    expect(executorContinue?.currentCommand).toContain("executor_task_workspace_continue --executor-workspace-report <previous-executor-task-workspace-run.json>");
    expect(executorContinue?.forbiddenMutations).toContain("hidden retry/fallback");

    expect(executorSourceSnapshot).toMatchObject({
      status: "supported_now",
      runSurface: "direct_cli",
      mode: "workspace_mutation",
      ownerBoundary: "ralph.stage-lab.executor-source-handoff",
    });
    expect(executorSourceSnapshot?.currentCommand).toContain("executor_workspace_source_snapshot --executor-workspace-report <executor-task-workspace-run.json>");
    expect(executorSourceSnapshot?.currentCommand).toContain("--commit-message <message> [--project-id <id>]");
    expect(executorSourceSnapshot?.forbiddenMutations).toContain("Visual Workbench capture auto-run");

    expect(controller).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "workspace_dry_run",
      ownerBoundary: "ralph.controller.dry-run-adapter",
    });
    expect(controller?.currentCommand).toContain("npm --prefix packages/loops/ralph-runtime run ralph -- stage run");
    expect(controller?.currentCommand).toContain("controller_project_dry_run --snapshot <project-stage-snapshot.json>");
    expect(controller?.currentCommand).toContain("--trigger <phase_complete|periodic|failure_threshold|replan|manual|final|spec_migration>");
  });

  it("exposes manifest, selector, shell policy and browser readiness as UI-runnable while mutating Visual Workbench stages stay CLI handoffs", () => {
    const stages = getAdminLabStageCatalog();
    const manifest = stages.find((stage) => stage.id === "visual_workbench_manifest_readiness");
    const selector = stages.find((stage) => stage.id === "visual_workbench_selector_readiness");
    const shellPolicy = stages.find((stage) => stage.id === "visual_workbench_shell_policy");
    const browser = stages.find((stage) => stage.id === "visual_workbench_browser_readiness");
    const automation = stages.find((stage) => stage.id === "visual_workbench_evidence_automation");
    const automationRun = stages.find((stage) => stage.id === "visual_workbench_evidence_automation_run");
    const automationStatus = stages.find((stage) => stage.id === "visual_workbench_automation_status");
    const evidenceChain = stages.find((stage) => stage.id === "visual_workbench_evidence_chain_readiness");

    expect(manifest).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "read_only",
      ownerBoundary: "ra-355.visual-workbench-manifest",
    });
    expect(manifest?.currentCommand).toBeNull();
    expect(manifest?.forbiddenMutations).toContain("client workDir/sourceRef/manifest/story/viewport/baseUrl/outDir inputs");

    expect(selector).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "read_only",
      ownerBoundary: "ralph.visual-workbench-selector-readiness",
    });
    expect(selector?.currentCommand).toBeNull();

    expect(shellPolicy).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "read_only",
      ownerBoundary: "ralph.visual-workbench-shell-policy",
    });
    expect(shellPolicy?.currentCommand).toBeNull();
    expect(shellPolicy?.forbiddenMutations).toContain("shell command execution");
    expect(shellPolicy?.forbiddenMutations).toContain("self-authorization from visual-workbench/manifest.json or project config");

    expect(browser).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "read_only",
      ownerBoundary: "platform.browser-readiness",
    });
    expect(browser?.currentCommand).toBeNull();

    expect(automation).toMatchObject({
      status: "supported_now",
      runSurface: "direct_cli",
      mode: "workspace_mutation",
      ownerBoundary: "ralph.visual-workbench-evidence-automation",
    });
    expect(automation?.currentCommand).toContain("visual-workbench automate-evidence");
    expect(automation?.currentCommand).toContain("--task <taskId>");
    expect(automation?.forbiddenMutations).toContain("screenshotProof or proofReviews[] writes");

    expect(automationRun).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "workspace_mutation",
      ownerBoundary: "ralph.visual-workbench-evidence-automation",
    });
    expect(automationRun?.currentCommand).toContain("visual-workbench automate-evidence");
    expect(automationRun?.currentCommand).toContain("--work-dir <server-derived-project-source-workspace>");
    expect(automationRun?.currentCommand).toContain("--base-url <server-allocated-localhost-url>");
    expect(automationRun?.forbiddenMutations).toContain("client workDir/sourceRef/baseUrl/outDir/config inputs");
    expect(automationRun?.forbiddenMutations).toContain("evidence ingest, controller, executor, retry, relaunch, commit or push auto-start");

    expect(automationStatus).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "read_only",
      ownerBoundary: "ralph.visual-workbench-automation-diagnostic-readback",
    });
    expect(automationStatus?.currentCommand).toBeNull();
    expect(automationStatus?.forbiddenMutations).toContain("Playwright screenshot capture");

    expect(evidenceChain).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "read_only",
      ownerBoundary: "ralph.visual-evidence-chain-readiness",
    });
    expect(evidenceChain?.currentCommand).toBeNull();
    expect(evidenceChain?.forbiddenMutations).toContain("client workDir/sourceRef/run/story/viewport/evidenceRef inputs");
  });

  it("exposes visual evidence ingest as an explicit Arena CLI handoff only", () => {
    const stages = getAdminLabStageCatalog();
    const ingest = stages.find((stage) => stage.id === "visual_evidence_ingest");

    expect(ingest).toMatchObject({
      status: "supported_now",
      runSurface: "direct_cli",
      mode: "operator_mutation",
      ownerBoundary: "governance.project-visual-evidence-ingest",
    });
    expect(ingest?.currentCommand).toContain("services/arena-ctl/cli.sh project_visual_evidence_ingest");
    expect(ingest?.currentCommand).toContain("--project-id <id>");
    expect(ingest?.currentCommand).toContain("--task-id <task-id>");
    expect(ingest?.currentCommand).toContain("--progress-json <workspace/.arena/progress.json>");
    expect(ingest?.forbiddenMutations).toContain("retry/relaunch/unblock");
    expect(ingest?.forbiddenMutations).toContain("Telegram/outbox writes");
  });

  it("exposes prompt contract replay as a fixed UI-run over Prompt Lab replay", () => {
    const stages = getAdminLabStageCatalog();
    const promptReplay = stages.find((stage) => stage.id === "prompt_contract_replay");

    expect(promptReplay).toMatchObject({
      status: "supported_now",
      runSurface: "admin_lab_run",
      mode: "fixture",
      ownerBoundary: "ralph.prompt-repository",
    });
    expect(promptReplay?.currentCommand).toBeNull();
    expect(promptReplay?.allowedMutations).toContain("explicit disposable --out file only");
    expect(promptReplay?.forbiddenMutations).toContain("model provider calls");
    expect(promptReplay?.forbiddenMutations).toContain("planner/executor/controller runs");
  });

  it("runs project_stage_snapshot through the fixed source-current command runner", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
    };
    vi.mocked(execFile).mockImplementationOnce((file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (!cb) throw new Error("callback missing");
      cb(null, JSON.stringify(snapshot), "");
      return {} as any;
    });

    const result = await runAdminLabStage({
      stageId: "project_stage_snapshot",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 120,
      },
    });

    expect(execFile).toHaveBeenCalledWith(
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--task-id", "task-1", "--tail", "120"],
      expect.objectContaining({
        cwd: "/repo",
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "project_stage_snapshot",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toEqual(snapshot);
    expect(result.evidenceNotes).toContain("Admin Lab used the source-current arena-ctl project_stage_snapshot command through a fixed stage-specific backend runner.");
  });

  it("runs project_stage_candidates through the fixed source-current command runner", async () => {
    const scan = {
      schemaVersion: "ra-356.project-stage-candidates.v1",
      scan: {
        projectLimit: 30,
        includeArchived: true,
        scannedProjectCount: 30,
        candidateProjectCount: 1,
      },
      candidateProjects: [],
    };
    vi.mocked(execFile).mockImplementationOnce((file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (!cb) throw new Error("callback missing");
      cb(null, JSON.stringify(scan), "");
      return {} as any;
    });

    const result = await runAdminLabStage({
      stageId: "project_stage_candidates",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        limit: 30,
        tail: 12,
        includeArchived: true,
      },
    });

    expect(execFile).toHaveBeenCalledWith(
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_candidates", "--limit", "30", "--include-archived", "enabled", "--tail", "12"],
      expect.objectContaining({
        cwd: "/repo",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "project_stage_candidates",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toEqual(scan);
    expect(result.evidenceNotes).toContain("Admin Lab used the source-current arena-ctl project_stage_candidates command through a fixed stage-specific backend runner.");
  });

  it("returns validated action invocation metadata for normal project actions", async () => {
    const result = await runAdminLabStage({
      stageId: "project_operator_snapshot",
      actionId: "check_project_status",
      projectId: "project-1",
      session: null,
      hasBypass: true,
    });

    expect(result.actionInvocation).toEqual({
      actionId: "check_project_status",
      title: "Check project status",
      stageId: "project_operator_snapshot",
      ownerBoundary: "ProjectOperatorSnapshot",
      runSurface: "admin_lab_run",
      mode: "read_only",
    });
    expect(result.stage).toMatchObject({
      id: "project_operator_snapshot",
      runSurface: "admin_lab_run",
    });
  });

  it("runs project_agent_off through the existing lifecycle owner", async () => {
    const result = await runAdminLabStage({
      stageId: "project_agent_off",
      actionId: "pause_agent",
      projectId: "project-1",
      session: null,
      hasBypass: true,
    });

    expect(setAgentIntentInternal).toHaveBeenCalledWith("project-1", "OFF", INTERNAL_ACTION_TOKEN);
    expect(execFile).not.toHaveBeenCalled();
    expect(result.actionInvocation).toEqual({
      actionId: "pause_agent",
      title: "Pause agent",
      stageId: "project_agent_off",
      ownerBoundary: "governance.project-agent-intent",
      runSurface: "admin_lab_run",
      mode: "operator_mutation",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.project-agent-intent-result.v1",
      ownerBoundary: "governance.project-agent-intent",
      projectId: "project-1",
      agentIntent: "OFF",
      success: true,
    });
    expect(result.evidenceNotes).toContain("This is the same Agent OFF/ON owner used by arena-ctl and operator actions; it is not a Lab-only pause state.");
  });

  it("rejects project_agent_on when the lifecycle owner rejects resume", async () => {
    vi.mocked(setAgentIntentInternal).mockResolvedValueOnce({
      success: false,
      error: "Loop runtime is unsupported.",
    });

    await expect(runAdminLabStage({
      stageId: "project_agent_on",
      actionId: "resume_agent",
      projectId: "project-1",
      session: null,
      hasBypass: true,
    })).rejects.toMatchObject({
      code: "project_agent_on_rejected",
      message: "Loop runtime is unsupported.",
    } satisfies Pick<AdminLabError, "code" | "message">);

    expect(setAgentIntentInternal).toHaveBeenCalledWith("project-1", "ON", INTERNAL_ACTION_TOKEN);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("rejects action invocation stage mismatches before running the stage", async () => {
    await expect(runAdminLabStage({
      stageId: "project_stage_candidates",
      actionId: "get_task_context",
      projectId: "project-1",
      session: null,
      hasBypass: true,
    })).rejects.toMatchObject({
      code: "invalid_action_invocation",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("rejects action invocation pinned prompt fixture mismatches before Prompt Lab calls", async () => {
    await expect(runAdminLabStage({
      stageId: "prompt_contract_replay",
      actionId: "product_pass",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        promptReplayFixture: "ux_skill",
      },
    })).rejects.toMatchObject({
      code: "invalid_action_invocation",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it.each([
    {
      fixtureId: "product_skill" as const,
      expectedPromptId: "executor.productSkill",
      expectedFixturePath: "/repo/work/plans/ra-356-manual-experiment-tooling/fixtures/executor-product-skill.json",
      expectedLabel: "Product role guidance",
    },
    {
      fixtureId: "ux_skill" as const,
      expectedPromptId: "executor.uxSkill",
      expectedFixturePath: "/repo/work/plans/ra-356-manual-experiment-tooling/fixtures/executor-ux-skill.json",
      expectedLabel: "UX role guidance",
    },
  ])("runs prompt_contract_replay for $fixtureId through fixed Prompt Lab replay", async ({
    fixtureId,
    expectedPromptId,
    expectedFixturePath,
    expectedLabel,
  }) => {
    const promptReplay = {
      schemaVersion: "ra-356.prompt-replay-result.v1",
      owner: "packages/loops/ralph-runtime/src/prompts",
      promptId: expectedPromptId,
      fixture: {
        schemaVersion: "ra-356.prompt-fixture.v1",
        name: expectedLabel,
        path: expectedFixturePath,
      },
      entry: {
        id: expectedPromptId,
        title: expectedLabel,
        owner: "executor",
        kind: "task_template",
        source: {
          file: "packages/loops/ralph-runtime/src/prompts/repository.ts",
          symbol: expectedPromptId === "executor.productSkill" ? "PRODUCT_SKILL_TEMPLATE" : "UX_SKILL_TEMPLATE",
        },
      },
      rendered: {
        text: "Rendered role guidance",
        charCount: 22,
        sha256: "a".repeat(64),
      },
    };
    vi.mocked(execFile).mockImplementationOnce((file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (!cb) throw new Error("callback missing");
      const outIndex = Array.isArray(args) ? args.indexOf("--out") : -1;
      const outPath = outIndex >= 0 && Array.isArray(args) ? args[outIndex + 1] : null;
      if (!outPath) throw new Error("out path missing");
      writeFileSync(outPath, JSON.stringify(promptReplay));
      cb(null, "", "");
      return {} as any;
    });

    const result = await runAdminLabStage({
      stageId: "prompt_contract_replay",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        promptReplayFixture: fixtureId,
      },
    });

    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "prompts",
        "replay",
        "--fixture",
        expectedFixturePath,
        "--out",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    const promptArgs = vi.mocked(execFile).mock.calls[0][1] as string[];
    expect(promptArgs[promptArgs.indexOf("--out") + 1]).toContain("prompt-replay.json");
    for (const forbiddenArg of [
      "--task",
      "--work-dir",
      "--source-ref",
      "--model",
      "--agent",
      "--timeout-minutes",
    ]) {
      expect(promptArgs).not.toContain(forbiddenArg);
    }
    expect(result.stage).toMatchObject({
      id: "prompt_contract_replay",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-prompt-contract-replay.v1",
      fixture: {
        id: fixtureId,
        label: expectedLabel,
        fixturePath: expectedFixturePath,
        expectedPromptId,
      },
      promptReplay,
      tempFiles: {
        outPath: expect.stringContaining("prompt-replay.json"),
      },
    });
    expect(result.evidenceNotes).toContain("This result is prompt inspection only; it is not product findings, UX findings, task evidence or screenshot proof.");
  });

  it("runs visual_workbench_manifest_readiness through snapshot source and fixed Ralph inspect", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      project: { id: "project-1" },
      source: {
        workspace: {
          available: true,
          isGitRepo: true,
          path: "/project/workspace",
          commitSha: "abc123",
        },
      },
      plan: {
        status: "blocked",
        reasonCode: "plan_missing",
      },
    };
    const manifestReadiness = {
      schemaVersion: "ra-356.visual-workbench-inspect-result.v0",
      status: "ready",
      canRunWorkbenchCapture: true,
      stage: {
        stageId: "visual_workbench_manifest_readiness",
        ownerBoundary: "ra-355.visual-workbench-manifest",
        sourceRef: "abc123",
      },
      source: {
        resolvedSourceRef: "abc123",
      },
      manifest: {
        summary: {
          storyCount: 2,
          viewportNames: ["desktop", "mobile"],
        },
        blockers: [],
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(manifestReadiness), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "visual_workbench_manifest_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "npm",
      [
        "--prefix",
        "packages/loops/ralph-runtime",
        "run",
        "ralph",
        "--",
        "visual-workbench",
        "inspect",
        "--work-dir",
        "/project/workspace",
        "--source-ref",
        "abc123",
        "--compact",
      ],
      expect.objectContaining({
        cwd: "/repo",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "visual_workbench_manifest_readiness",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-visual-workbench-manifest-readiness.v1",
      snapshot,
      manifestReadiness,
    });
    expect(result.evidenceNotes).toContain("A ready manifest result only means source-owned Workbench story coverage is structurally usable for later selector/capture steps; it is not screenshot proof or Telegram screenshot availability.");
  });

  it("rejects malformed Prompt Lab replay output before returning a green result", async () => {
    vi.mocked(execFile).mockImplementationOnce((file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (!cb) throw new Error("callback missing");
      const outIndex = Array.isArray(args) ? args.indexOf("--out") : -1;
      const outPath = outIndex >= 0 && Array.isArray(args) ? args[outIndex + 1] : null;
      if (!outPath) throw new Error("out path missing");
      writeFileSync(outPath, JSON.stringify({
        schemaVersion: "ra-356.prompt-replay-result.v1",
        promptId: "executor.productSkill",
        rendered: {
          text: "Rendered role guidance",
        },
      }));
      cb(null, "", "");
      return {} as any;
    });

    await expect(runAdminLabStage({
      stageId: "prompt_contract_replay",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        promptReplayFixture: "product_skill",
      },
    })).rejects.toMatchObject({
      code: "prompt_replay_invalid_output",
    } satisfies Pick<AdminLabError, "code">);
  });

  it("runs executor_project_task through fixed snapshot and Ralph CLI owners", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        specFile: "spec.md",
        selectedTask: {
          id: "task-1",
          acceptanceCriteria: [],
          status: "pending",
          statusSource: "explicit",
          requiredRolePasses: [],
          feedbackItemRefs: [],
        },
      },
    };
    const executorResult = {
      schemaVersion: "ra-356.executor-project-task-result.v0",
      stage: {
        stageId: "executor_project_task",
        mode: "workspace_mutation",
        ownerBoundary: "ralph.executor-project-task-adapter",
        adapterFor: "executor_task_workspace",
        projectStageSnapshot: {
          schemaVersion: "ra-356.project-stage-snapshot.v1",
          ownerBoundary: "arena-ctl.project-stage-snapshot",
        },
        allowedMutations: [],
        forbiddenMutations: [],
        handoff: [],
      },
      status: "completed",
      input: {
        projectId: "project-1",
        selectedTaskId: "task-1",
        mode: "new_task",
        workspaceMode: "live_workspace_action",
        sourceRef: "abc123",
        snapshotSourceRef: "abc123",
      },
      projectCommit: {
        status: "committed",
        afterCommit: "def456",
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const snapshotPath = argValue(args, "--snapshot");
        const outDir = argValue(args, "--out-dir");
        Object.assign(executorResult.input, {
          snapshotPath,
          outDir,
        });
        Object.assign(executorResult, {
          output: {
            outDir,
            reportPath: `${outDir}/executor-project-task-run.json`,
          },
        });
        cb(null, JSON.stringify(executorResult), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "executor_project_task",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        executorMode: "new_task",
        completionPromise: "Finish only task-1.",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 15,
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--task-id", "task-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "stage",
        "run",
        "executor_project_task",
        "--mode",
        "new_task",
        "--workspace-mode",
        "live_workspace_action",
        "--completion-promise",
        "Finish only task-1.",
        "--agent",
        "codex",
        "--model",
        "gpt-5.5",
        "--timeout-minutes",
        "15",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 1_020_000,
        maxBuffer: 25 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "executor_project_task",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-executor-project-task.v1",
      snapshot,
      executorResult,
      tempFiles: {
        outDir: expect.any(String),
        snapshotPath: expect.any(String),
      },
    });
    expect(result.evidenceNotes).toContain("Governance did not render executor prompts, call providers directly, classify diffs or create project commits itself.");
    expect(result.evidenceNotes).toContain("Governance did not accept an executor visual-mode input; Ralph used the snapshot visualEvidencePolicy through the shared executor-observer helper.");
  });

  it("rejects executor_project_task output when the returned workspace mode is not the live project action", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        specFile: "spec.md",
        selectedTask: {
          id: "task-1",
          acceptanceCriteria: [],
          status: "pending",
          statusSource: "explicit",
          requiredRolePasses: [],
          feedbackItemRefs: [],
        },
      },
    };
    const executorResult = {
      schemaVersion: "ra-356.executor-project-task-result.v0",
      stage: {
        stageId: "executor_project_task",
        mode: "workspace_mutation",
        ownerBoundary: "ralph.executor-project-task-adapter",
        adapterFor: "executor_task_workspace",
        projectStageSnapshot: {
          schemaVersion: "ra-356.project-stage-snapshot.v1",
          ownerBoundary: "arena-ctl.project-stage-snapshot",
        },
      },
      input: {
        projectId: "project-1",
        selectedTaskId: "task-1",
        mode: "new_task",
        workspaceMode: "fork",
        sourceRef: "abc123",
        snapshotSourceRef: "abc123",
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const snapshotPath = argValue(args, "--snapshot");
        const outDir = argValue(args, "--out-dir");
        Object.assign(executorResult.input, {
          snapshotPath,
          outDir,
        });
        Object.assign(executorResult, {
          status: "completed",
          output: {
            outDir,
            reportPath: `${outDir}/executor-project-task-run.json`,
          },
        });
        cb(null, JSON.stringify(executorResult), "");
        return {} as any;
      });

    await expect(runAdminLabStage({
      stageId: "executor_project_task",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        executorMode: "new_task",
        completionPromise: "Finish only task-1.",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 15,
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "executor_project_task_invalid_output",
    } satisfies Pick<AdminLabError, "code">);
  });

  it("runs planner_project_dry_run through fixed snapshot, temp fork and Ralph CLI owners", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: null,
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        specFile: "spec.md",
      },
    };
    const plannerResult = {
      schemaVersion: "ra-356.planner-project-dry-run-result.v0",
      stage: {
        stageId: "planner_project_dry_run",
        mode: "workspace_dry_run",
        ownerBoundary: "ralph.planner.dry-run-adapter",
        projectStageSnapshot: {
          schemaVersion: "ra-356.project-stage-snapshot.v1",
          ownerBoundary: "arena-ctl.project-stage-snapshot",
        },
        allowedMutations: [],
        forbiddenMutations: [],
        handoff: [],
      },
      status: "completed",
      input: {
        projectId: "project-1",
        sourceRef: "abc123",
        snapshotSourceRef: "abc123",
        spec: "spec.md",
        visualEvidenceMode: "new_tasks_only",
      },
      plannerOutput: {
        ownerBoundary: "ralph.planner.initial-dry-run",
        summary: {
          taskCount: 2,
          phaseCount: 1,
        },
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, "", "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, "", "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const snapshotPath = argValue(args, "--snapshot");
        const workDir = argValue(args, "--work-dir");
        const outDir = argValue(args, "--out-dir");
        Object.assign(plannerResult.input, {
          snapshotPath,
          workDir,
          outDir,
        });
        Object.assign(plannerResult, {
          output: {
            outDir,
            reportPath: `${outDir}/planner-project-dry-run.json`,
          },
        });
        cb(null, JSON.stringify(plannerResult), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "planner_project_dry_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        visualEvidenceMode: "new_tasks_only",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["clone", "--no-hardlinks", "--quiet", "/project/workspace", expect.stringContaining("fork")],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      3,
      "git",
      ["checkout", "--quiet", "abc123"],
      expect.objectContaining({
        cwd: expect.stringContaining("fork"),
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      4,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "stage",
        "run",
        "planner_project_dry_run",
        "--source-ref",
        "abc123",
        "--spec",
        "spec.md",
        "--visual-evidence-mode",
        "new_tasks_only",
        "--agent",
        "codex",
        "--model",
        "gpt-5.5",
        "--timeout-minutes",
        "10",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 720_000,
        maxBuffer: 25 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "planner_project_dry_run",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-planner-project-dry-run.v1",
      snapshot,
      plannerResult,
      tempFiles: {
        outDir: expect.any(String),
        snapshotPath: expect.any(String),
        workDir: expect.any(String),
      },
    });
    expect(result.evidenceNotes).toContain("Governance did not render planner prompts, call providers directly, parse planner output or apply .ralph/plan.json itself.");
  });

  it("runs planner_spec_migration_apply through fixed snapshot and Ralph CLI owner without client workspace/spec truth", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: null,
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      visualEvidencePolicy: {
        owner: "governance.runner-init-readiness.ralphConfig",
        status: "ready",
        visualEvidenceMode: "new_tasks_only",
      },
      plan: {
        status: "ready",
        specFile: "spec.md",
      },
    };
    const plannerResult = {
      schemaVersion: "ra-356.planner-spec-migration-apply-result.v0",
      stage: {
        stageId: "planner_spec_migration_apply",
        mode: "workspace_mutation",
        ownerBoundary: "ralph.planner-spec-migration-apply",
        projectStageSnapshot: {
          schemaVersion: "ra-356.project-stage-snapshot.v1",
          ownerBoundary: "arena-ctl.project-stage-snapshot",
        },
        allowedMutations: [],
        forbiddenMutations: [],
        handoff: [],
      },
      status: "completed",
      input: {
        projectId: "project-1",
        sourceRef: "abc123",
        snapshotSourceRef: "abc123",
      },
      output: {},
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const snapshotPath = argValue(args, "--snapshot");
        const outDir = argValue(args, "--out-dir");
        Object.assign(plannerResult.input, {
          snapshotPath,
          outDir,
        });
        Object.assign(plannerResult, {
          output: {
            outDir,
            reportPath: `${outDir}/planner-spec-migration-apply.json`,
          },
        });
        cb(null, JSON.stringify(plannerResult), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "planner_spec_migration_apply",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "stage",
        "run",
        "planner_spec_migration_apply",
        "--source-ref",
        "abc123",
        "--agent",
        "codex",
        "--model",
        "gpt-5.5",
        "--timeout-minutes",
        "10",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 720_000,
        maxBuffer: 25 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    const plannerArgs = vi.mocked(execFile).mock.calls[1][1] as string[];
    expect(plannerArgs).not.toContain("--work-dir");
    expect(plannerArgs).not.toContain("--spec");
    expect(plannerArgs).not.toContain("--visual-evidence-mode");
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(result.stage).toMatchObject({
      id: "planner_spec_migration_apply",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-planner-spec-migration-apply.v1",
      snapshot,
      plannerResult,
      tempFiles: {
        outDir: expect.any(String),
        snapshotPath: expect.any(String),
      },
    });
    expect(result.evidenceNotes).toContain("Governance did not render planner prompts, call providers directly, patch .ralph/plan.json, accept client workDir/spec/visualEvidenceMode inputs, or apply dry-run output.");
    expect(result.evidenceNotes).toContain("The Ralph stage may mutate planner-owned .ralph plan/judgment/prompt-trace files in the selected live workspace and then stops; it must not start executor, controller, Workbench, lifecycle repair, deploy or push.");
  });

  it("rejects planner_spec_migration_apply output when the returned source ref is mismatched", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        specFile: "spec.md",
      },
    };
    const plannerResult = {
      schemaVersion: "ra-356.planner-spec-migration-apply-result.v0",
      stage: {
        stageId: "planner_spec_migration_apply",
        mode: "workspace_mutation",
        ownerBoundary: "ralph.planner-spec-migration-apply",
      },
      status: "completed",
      input: {
        projectId: "project-1",
        sourceRef: "different",
        snapshotSourceRef: "different",
        snapshotPath: "/tmp/project-stage-snapshot.json",
        outDir: "/tmp/out",
      },
      output: {
        outDir: "/tmp/out",
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const snapshotPath = argValue(args, "--snapshot");
        const outDir = argValue(args, "--out-dir");
        Object.assign(plannerResult.input, { snapshotPath, outDir });
        Object.assign(plannerResult.output, { outDir });
        cb(null, JSON.stringify(plannerResult), "");
        return {} as any;
      });

    await expect(runAdminLabStage({
      stageId: "planner_spec_migration_apply",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
      },
    })).rejects.toMatchObject({
      code: "planner_spec_migration_apply_invalid_output",
    } satisfies Pick<AdminLabError, "code">);
  });

  it("rejects planner_project_dry_run output when the returned project identity is mismatched", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: null,
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        specFile: "spec.md",
      },
    };
    const plannerResult = {
      schemaVersion: "ra-356.planner-project-dry-run-result.v0",
      stage: {
        stageId: "planner_project_dry_run",
        mode: "workspace_dry_run",
        ownerBoundary: "ralph.planner.dry-run-adapter",
        projectStageSnapshot: {
          schemaVersion: "ra-356.project-stage-snapshot.v1",
          ownerBoundary: "arena-ctl.project-stage-snapshot",
        },
      },
      input: {
        projectId: "other-project",
        sourceRef: "abc123",
        snapshotSourceRef: "abc123",
        spec: "spec.md",
        visualEvidenceMode: "new_tasks_only",
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, "", "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, "", "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const snapshotPath = argValue(args, "--snapshot");
        const workDir = argValue(args, "--work-dir");
        const outDir = argValue(args, "--out-dir");
        Object.assign(plannerResult.input, {
          snapshotPath,
          workDir,
          outDir,
        });
        Object.assign(plannerResult, {
          status: "completed",
          output: {
            outDir,
            reportPath: `${outDir}/planner-project-dry-run.json`,
          },
        });
        cb(null, JSON.stringify(plannerResult), "");
        return {} as any;
      });

    await expect(runAdminLabStage({
      stageId: "planner_project_dry_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        visualEvidenceMode: "new_tasks_only",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "planner_project_dry_run_invalid_output",
    } satisfies Pick<AdminLabError, "code">);
  });

  it("blocks planner and controller dry-runs when project visual policy readback is invalid", async () => {
    vi.mocked(getProjectOperatorSnapshotForViewer).mockResolvedValue({
      id: "project-1",
      name: "Project",
      visualEvidenceMode: null,
      visualEvidenceModeError: "Invalid visualEvidenceMode runtimeConfig: expected off, required or new_tasks_only.",
    } as any);

    await expect(runAdminLabStage({
      stageId: "planner_project_dry_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        visualEvidenceMode: "off",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "invalid_project_visual_evidence_mode",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "controller_project_dry_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        controllerTrigger: "manual",
        visualEvidenceMode: "required",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "invalid_project_visual_evidence_mode",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("runs controller_project_dry_run through fixed snapshot, temp fork and Ralph CLI owners", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: null,
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        specFile: "spec.md",
      },
    };
    const controllerResult = {
      schemaVersion: "ra-356.controller-project-dry-run-result.v0",
      stage: {
        stageId: "controller_project_dry_run",
        mode: "workspace_dry_run",
        ownerBoundary: "ralph.controller.dry-run-adapter",
        projectStageSnapshot: {
          schemaVersion: "ra-356.project-stage-snapshot.v1",
          ownerBoundary: "arena-ctl.project-stage-snapshot",
        },
        allowedMutations: [],
        forbiddenMutations: [],
        handoff: [],
      },
      status: "completed",
      input: {
        projectId: "project-1",
        sourceRef: "abc123",
        snapshotSourceRef: "abc123",
        spec: "spec.md",
        trigger: "manual",
        visualEvidenceMode: "new_tasks_only",
      },
      controllerOutput: {
        ownerBoundary: "ralph.controller.audit-dry-run",
        status: "parsed",
        verdict: "keep-going",
        planChangeCount: 1,
        newJudgmentCount: 0,
        revisedJudgmentCount: 0,
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, "", "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, "", "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const snapshotPath = argValue(args, "--snapshot");
        const workDir = argValue(args, "--work-dir");
        const outDir = argValue(args, "--out-dir");
        Object.assign(controllerResult.input, {
          snapshotPath,
          workDir,
          outDir,
        });
        Object.assign(controllerResult, {
          output: {
            outDir,
            reportPath: `${outDir}/controller-project-dry-run.json`,
          },
        });
        cb(null, JSON.stringify(controllerResult), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "controller_project_dry_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        controllerTrigger: "manual",
        visualEvidenceMode: "new_tasks_only",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["clone", "--no-hardlinks", "--quiet", "/project/workspace", expect.stringContaining("fork")],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      3,
      "git",
      ["checkout", "--quiet", "abc123"],
      expect.objectContaining({
        cwd: expect.stringContaining("fork"),
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      4,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "stage",
        "run",
        "controller_project_dry_run",
        "--source-ref",
        "abc123",
        "--spec",
        "spec.md",
        "--trigger",
        "manual",
        "--visual-evidence-mode",
        "new_tasks_only",
        "--agent",
        "codex",
        "--model",
        "gpt-5.5",
        "--timeout-minutes",
        "10",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 720_000,
        maxBuffer: 25 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "controller_project_dry_run",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-controller-project-dry-run.v1",
      snapshot,
      controllerResult,
      tempFiles: {
        outDir: expect.any(String),
        snapshotPath: expect.any(String),
        workDir: expect.any(String),
      },
    });
    expect(result.evidenceNotes).toContain("Governance did not render controller prompts, call providers directly, parse or apply ControllerReport truth, write controller reports, or update .ralph/plan.json itself.");
  });

  it("rejects controller_project_dry_run output when the returned schema is not the controller stage envelope", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: null,
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        specFile: "spec.md",
      },
    };
    const controllerResult = {
      schemaVersion: "ra-356.planner-project-dry-run-result.v0",
      stage: {
        stageId: "controller_project_dry_run",
        mode: "workspace_dry_run",
        ownerBoundary: "ralph.controller.dry-run-adapter",
        projectStageSnapshot: {
          schemaVersion: "ra-356.project-stage-snapshot.v1",
          ownerBoundary: "arena-ctl.project-stage-snapshot",
        },
      },
      input: {
        projectId: "project-1",
        sourceRef: "abc123",
        snapshotSourceRef: "abc123",
        spec: "spec.md",
        trigger: "manual",
        visualEvidenceMode: "new_tasks_only",
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, "", "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, "", "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const snapshotPath = argValue(args, "--snapshot");
        const workDir = argValue(args, "--work-dir");
        const outDir = argValue(args, "--out-dir");
        Object.assign(controllerResult.input, {
          snapshotPath,
          workDir,
          outDir,
        });
        Object.assign(controllerResult, {
          status: "completed",
          output: {
            outDir,
            reportPath: `${outDir}/controller-project-dry-run.json`,
          },
        });
        cb(null, JSON.stringify(controllerResult), "");
        return {} as any;
      });

    await expect(runAdminLabStage({
      stageId: "controller_project_dry_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        controllerTrigger: "manual",
        visualEvidenceMode: "new_tasks_only",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "controller_project_dry_run_invalid_output",
    } satisfies Pick<AdminLabError, "code">);
  });

  it("runs visual_workbench_selector_readiness through fixed snapshot and Ralph CLI owners", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        selectedTask: {
          id: "task-1",
          visualEvidenceRequired: true,
        },
      },
      selectedTaskVisualReadback: {
        selectedTaskId: "task-1",
        selectedTaskStatus: "pending",
        visualEvidenceRequired: true,
        visualEvidenceMode: "new_tasks_only",
        visualEvidencePolicyStatus: "ready",
        visualWorkbenchManifestStatus: "ready",
        canRunWorkbenchCapture: true,
        visualExpectationSources: ["task.visualEvidenceRequired"],
        nextProjectActionId: "check_story_selection",
        status: "check_story_selection_ready",
        tone: "good",
        reasonCode: "check_story_selection_ready",
        title: "Story selection can be checked",
        message: "This task is ready for story selection readback.",
        canCheckStorySelection: true,
      },
    };
    const selectorReadiness = {
      schemaVersion: "ra-356.visual-workbench-selector-readiness.v2",
      status: "ready",
      taskFilter: "task-1",
      summary: {
        tasks: 1,
        readyTasks: 1,
        blockedTasks: 0,
        notApplicableTasks: 0,
        selectedStories: 1,
        selectedViewports: 2,
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(selectorReadiness), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "visual_workbench_selector_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--task-id", "task-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "visual-workbench",
        "selector-readiness",
        "--work-dir",
        "/project/workspace",
        "--task",
        "task-1",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "visual_workbench_selector_readiness",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-visual-workbench-selector-readiness.v1",
      snapshot,
      selectorReadiness,
    });
    expect(result.evidenceNotes).toContain("A ready selector result only means story and viewport choices are explicit enough for a later manual capture/export step; it is not screenshot proof.");
  });

  it("blocks visual_workbench_selector_readiness when snapshot visual readback is not ready", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        selectedTask: {
          id: "task-1",
          visualEvidenceRequired: false,
        },
      },
      selectedTaskVisualReadback: {
        selectedTaskId: "task-1",
        nextProjectActionId: null,
        canCheckStorySelection: false,
        title: "Story selection not expected",
        message: "The selected task is not marked as visual work under the current project visual evidence policy.",
        reasonCode: "visual_evidence_not_required_for_task",
      },
    };
    vi.mocked(execFile).mockImplementationOnce((file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (!cb) throw new Error("callback missing");
      cb(null, JSON.stringify(snapshot), "");
      return {} as any;
    });

    await expect(runAdminLabStage({
      stageId: "visual_workbench_selector_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "selector_visual_handoff_blocked",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("runs visual_workbench_shell_policy through fixed snapshot and Ralph policy owner", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        selectedTask: {
          id: "task-1",
          visualEvidenceRequired: true,
        },
      },
    };
    const shellPolicy = {
      schemaVersion: "ra-356.visual-workbench-shell-policy.v1",
      status: "allowed",
      ownerBoundary: "ralph.visual-workbench-shell-policy",
      manifest: { status: "ready" },
      policy: {
        mode: "allowlisted",
        allowedServeCommandCount: 1,
        allowedBaseUrlEnvCount: 1,
      },
      workbench: {
        serveCommand: "npm run visual-workbench",
        baseUrlEnv: "VISUAL_WORKBENCH_BASE_URL",
      },
      blockers: [],
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(shellPolicy), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "visual_workbench_shell_policy",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--task-id", "task-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "visual-workbench",
        "shell-policy",
        "--work-dir",
        "/project/workspace",
        "--config",
        "/project/workspace/.arena/ralph.config.json",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    const shellPolicyArgs = vi.mocked(execFile).mock.calls[1][1] as string[];
    expect(shellPolicyArgs).not.toContain("/must/not-pass/ralph.config.json");
    for (const forbiddenArg of [
      "--manifest",
      "--task",
      "--source-ref",
      "--base-url",
      "--out-dir",
    ]) {
      expect(shellPolicyArgs).not.toContain(forbiddenArg);
    }
    expect(result.stage).toMatchObject({
      id: "visual_workbench_shell_policy",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-visual-workbench-shell-policy.v1",
      snapshot,
      shellPolicy,
    });
    expect(result.evidenceNotes).toContain("Shell policy is diagnostic readback only; it does not execute the Workbench serve command, start a browser, capture screenshots, export evidence or publish progress.");
  });

  it("runs visual_workbench_browser_readiness through the fixed Ralph platform owner only", async () => {
    const browserReadiness = {
      schemaVersion: "ra-356.platform-browser-readiness.v1",
      status: "ready",
      ownerBoundary: "platform.browser-readiness",
      provider: "playwright.chromium",
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      blockers: [],
      error: null,
      notes: [
        "Platform browser readiness is a read-only check of the current Ralph runtime Playwright Chromium environment.",
      ],
    };
    vi.mocked(execFile).mockImplementationOnce((file, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      if (!cb) throw new Error("callback missing");
      cb(null, JSON.stringify(browserReadiness), "");
      return {} as any;
    });

    const result = await runAdminLabStage({
      stageId: "visual_workbench_browser_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "must-not-pass",
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith(
      "npm",
      [
        "--prefix",
        "packages/loops/ralph-runtime",
        "run",
        "ralph",
        "--",
        "visual-workbench",
        "browser-readiness",
        "--compact",
      ],
      expect.objectContaining({
        cwd: "/repo",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "visual_workbench_browser_readiness",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toEqual({
      schemaVersion: "ra-356.admin-lab-visual-workbench-browser-readiness.v1",
      browserReadiness,
    });
    expect(result.evidenceNotes).toContain("Governance did not accept project workDir, sourceRef, manifest, story/viewport, baseUrl or outDir inputs for this platform check.");
  });

  it("runs visual_workbench_automation_status through fixed snapshot and Ralph readback owners", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        selectedTask: {
          id: "task-1",
          visualEvidenceRequired: true,
        },
      },
    };
    const automationStatus = {
      schemaVersion: "ra-356.visual-workbench-automation-status.v1",
      status: "available",
      workDir: "/project/workspace",
      taskId: "task-1",
      reportSource: "latest",
      sourceFreshness: {
        status: "current",
        reportSourceRef: "abc123",
        currentHeadRef: "abc123",
        unknowns: [],
      },
      report: {
        status: "published",
        blockers: [],
      },
      blockers: [],
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(automationStatus), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "visual_workbench_automation_status",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--task-id", "task-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "visual-workbench",
        "automation-status",
        "--work-dir",
        "/project/workspace",
        "--task",
        "task-1",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result.stage).toMatchObject({
      id: "visual_workbench_automation_status",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-visual-workbench-automation-status.v1",
      snapshot,
      automationStatus,
    });
    expect(result.evidenceNotes).toContain("Automation status is diagnostic readback only; it is not screenshot capture, screenshot proof, progress publish or Telegram screenshot availability.");
  });

  it("runs visual_workbench_evidence_chain_readiness through fixed snapshot and Ralph readback owners", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        selectedTask: {
          id: "task-1",
          visualEvidenceRequired: true,
        },
      },
    };
    const evidenceChainReadiness = {
      schemaVersion: "ra-356.visual-workbench-evidence-chain-readiness.v4",
      status: "ready_for_arena_readback",
      workDir: "/project/workspace",
      input: {
        taskId: "task-1",
        projectId: "project-1",
      },
      checks: [
        { stageId: "visual_workbench_selector_readiness", status: "ready", blockers: [], warnings: [] },
        { stageId: "arena_visual_evidence_readback", status: "ready", blockers: [], warnings: [] },
      ],
      nextCommands: [
        "services/arena-ctl/cli.sh project_proof_reviews --project-id project-1",
      ],
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(evidenceChainReadiness), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "visual_workbench_evidence_chain_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--task-id", "task-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "visual-workbench",
        "evidence-chain-readiness",
        "--work-dir",
        "/project/workspace",
        "--task",
        "task-1",
        "--project-id",
        "project-1",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    const evidenceChainArgs = vi.mocked(execFile).mock.calls[1][1] as string[];
    for (const forbiddenArg of [
      "--run",
      "--story",
      "--viewport",
      "--feedback-item",
      "--diff-item",
      "--evidence-ref",
      "--base-url",
      "--out-dir",
      "--source-ref",
    ]) {
      expect(evidenceChainArgs).not.toContain(forbiddenArg);
    }
    expect(result.stage).toMatchObject({
      id: "visual_workbench_evidence_chain_readiness",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-visual-workbench-evidence-chain-readiness.v1",
      snapshot,
      evidenceChainReadiness,
    });
    expect(result.evidenceNotes).toContain("Evidence-chain readiness is diagnostic readback only; nextCommands are manual handoffs and are not screenshot capture, screenshot proof, progress publish or Telegram screenshot availability.");
  });

  it("runs visual_workbench_evidence_automation_run through fixed snapshot and the Ralph automation owner", async () => {
    const snapshot = {
      schemaVersion: "ra-356.project-stage-snapshot.v1",
      projectId: "project-1",
      selectedTaskId: "task-1",
      stageBoundary: {
        ownerBoundary: "arena-ctl.project-stage-snapshot",
        mode: "read_only",
      },
      source: {
        workspace: {
          available: true,
          path: "/project/workspace",
          isGitRepo: true,
          commitSha: "abc123",
        },
      },
      plan: {
        status: "ready",
        selectedTask: {
          id: "task-1",
          visualEvidenceRequired: true,
        },
      },
    };
    vi.mocked(execFile)
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        cb(null, JSON.stringify(snapshot), "");
        return {} as any;
      })
      .mockImplementationOnce((file, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        if (!cb) throw new Error("callback missing");
        const workDir = argValue(args, "--work-dir");
        const taskId = argValue(args, "--task");
        const sourceRef = argValue(args, "--source-ref");
        const baseUrl = argValue(args, "--base-url");
        const outDir = argValue(args, "--out-dir");
        cb(null, JSON.stringify({
          schemaVersion: "ra-356.visual-workbench-automation.v5",
          ownerBoundary: "ralph.visual-workbench-evidence-automation",
          status: "published",
          workDir,
          taskId,
          sourceRef,
          baseUrl,
          outDir,
          reportPath: `${outDir}/visual-workbench-automation-run.json`,
          diagnosticReportPath: `${workDir}/.ralph/visual-workbench/task-1/visual-workbench-automation-run.json`,
          manifestPath: "visual-workbench/manifest.json",
          blockers: [],
          exports: [],
          publish: {
            visualEvidenceRows: 1,
          },
        }), "");
        return {} as any;
      });

    const result = await runAdminLabStage({
      stageId: "visual_workbench_evidence_automation_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 80,
        confirmed: true,
      },
    });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "/repo/services/arena-ctl/cli.sh",
      ["project_stage_snapshot", "--project-id", "project-1", "--task-id", "task-1", "--tail", "80"],
      expect.objectContaining({
        cwd: "/repo",
      }),
      expect.any(Function),
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      "npm",
      expect.arrayContaining([
        "--prefix",
        "packages/loops/ralph-runtime",
        "visual-workbench",
        "automate-evidence",
        "--work-dir",
        "/project/workspace",
        "--manifest",
        "visual-workbench/manifest.json",
        "--task",
        "task-1",
        "--source-ref",
        "abc123",
        "--config",
        "/project/workspace/.arena/ralph.config.json",
        "--compact",
      ]),
      expect.objectContaining({
        cwd: "/repo",
        timeout: 5 * 60_000,
        maxBuffer: 25 * 1024 * 1024,
      }),
      expect.any(Function),
    );
    const automationArgs = vi.mocked(execFile).mock.calls[1][1] as string[];
    expect(argValue(automationArgs, "--base-url")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(argValue(automationArgs, "--out-dir")).toContain("ra356-admin-lab-workbench-automation-");
    expect(result.stage).toMatchObject({
      id: "visual_workbench_evidence_automation_run",
      runSurface: "admin_lab_run",
    });
    expect(result.result).toMatchObject({
      schemaVersion: "ra-356.admin-lab-visual-workbench-evidence-automation-run.v1",
      snapshot,
      automationResult: {
        ownerBoundary: "ralph.visual-workbench-evidence-automation",
        taskId: "task-1",
        sourceRef: "abc123",
      },
      tempFiles: {
        outDir: expect.any(String),
      },
    });
    expect(result.evidenceNotes).toContain("Governance called the source-current Ralph visual-workbench automate-evidence owner; it did not implement selector, shell policy, browser readiness, capture, export or progress publish itself.");
  });

  it("validates project_stage_snapshot inputs before the helper call", async () => {
    await expect(runAdminLabStage({
      stageId: "project_stage_snapshot",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "../task",
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "project_stage_snapshot",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 5001,
      },
    })).rejects.toMatchObject({
      code: "invalid_tail",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates project_stage_candidates inputs before the helper call", async () => {
    await expect(runAdminLabStage({
      stageId: "project_stage_candidates",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        limit: 101,
      },
    })).rejects.toMatchObject({
      code: "invalid_limit",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "project_stage_candidates",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 5001,
      },
    })).rejects.toMatchObject({
      code: "invalid_tail",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates prompt_contract_replay fixture options before Prompt Lab calls", async () => {
    await expect(runAdminLabStage({
      stageId: "prompt_contract_replay",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        promptReplayFixture: "planner" as any,
      },
    })).rejects.toMatchObject({
      code: "invalid_prompt_replay_fixture",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "prompt_contract_replay",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        promptReplayFixture: "product_skill",
        model: "must-not-pass",
      },
    })).rejects.toMatchObject({
      code: "invalid_prompt_replay_options",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates visual_workbench_manifest_readiness options before snapshot or inspect calls", async () => {
    await expect(runAdminLabStage({
      stageId: "visual_workbench_manifest_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 80,
        taskId: "task-1",
      },
    })).rejects.toMatchObject({
      code: "invalid_visual_workbench_manifest_options",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "visual_workbench_manifest_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 5001,
      },
    })).rejects.toMatchObject({
      code: "invalid_tail",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates planner_project_dry_run inputs before snapshot or provider calls", async () => {
    await expect(runAdminLabStage({
      stageId: "planner_project_dry_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        visualEvidenceMode: "new_tasks_only",
        agent: "codex",
        timeoutMinutes: 10,
      },
    })).rejects.toMatchObject({
      code: "invalid_model",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "planner_project_dry_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        visualEvidenceMode: "bad" as any,
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 10,
      },
    })).rejects.toMatchObject({
      code: "invalid_visual_evidence_mode",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates visual_workbench_selector_readiness inputs before snapshot or Workbench calls", async () => {
    await expect(runAdminLabStage({
      stageId: "visual_workbench_selector_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "visual_workbench_selector_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "../task",
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates visual_workbench_automation_status inputs before snapshot or report readback calls", async () => {
    await expect(runAdminLabStage({
      stageId: "visual_workbench_automation_status",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "visual_workbench_automation_status",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "../task",
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates visual_workbench_evidence_chain_readiness inputs before snapshot or readback calls", async () => {
    await expect(runAdminLabStage({
      stageId: "visual_workbench_evidence_chain_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "visual_workbench_evidence_chain_readiness",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "../task",
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates visual_workbench_evidence_automation_run inputs before snapshot or capture calls", async () => {
    await expect(runAdminLabStage({
      stageId: "visual_workbench_evidence_automation_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        tail: 80,
        confirmed: true,
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "visual_workbench_evidence_automation_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "../task",
        tail: 80,
        confirmed: true,
      },
    })).rejects.toMatchObject({
      code: "invalid_task_id",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "visual_workbench_evidence_automation_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    })).rejects.toMatchObject({
      code: "visual_workbench_evidence_automation_confirmation_required",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "visual_workbench_evidence_automation_run",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        tail: 80,
        confirmed: true,
        model: "must-not-pass",
      },
    })).rejects.toMatchObject({
      code: "invalid_visual_workbench_evidence_automation_options",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("validates executor_project_task inputs before snapshot or provider calls", async () => {
    await expect(runAdminLabStage({
      stageId: "executor_project_task",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        executorMode: "new_task",
        completionPromise: "Finish task.",
        agent: "codex",
        timeoutMinutes: 15,
      },
    })).rejects.toMatchObject({
      code: "invalid_model",
    } satisfies Pick<AdminLabError, "code">);

    await expect(runAdminLabStage({
      stageId: "executor_project_task",
      projectId: "project-1",
      session: null,
      hasBypass: true,
      options: {
        taskId: "task-1",
        executorMode: "bad" as any,
        completionPromise: "Finish task.",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 15,
      },
    })).rejects.toMatchObject({
      code: "invalid_executor_mode",
    } satisfies Pick<AdminLabError, "code">);

    expect(execFile).not.toHaveBeenCalled();
  });


  it("does not execute direct CLI stages through the Admin Lab browser route", async () => {
    await expect(runAdminLabStage({
      stageId: "executor_task_workspace_continue",
      projectId: "project-1",
      session: null,
      hasBypass: true,
    })).rejects.toMatchObject({
      code: "stage_not_runnable",
      message: "This lab stage is not runnable through the Admin Lab UI yet.",
    } satisfies Pick<AdminLabError, "code" | "message">);

    await expect(runAdminLabStage({
      stageId: "executor_workspace_source_snapshot",
      projectId: "project-1",
      session: null,
      hasBypass: true,
    })).rejects.toMatchObject({
      code: "stage_not_runnable",
      message: "This lab stage is not runnable through the Admin Lab UI yet.",
    } satisfies Pick<AdminLabError, "code" | "message">);

    await expect(runAdminLabStage({
      stageId: "visual_workbench_evidence_automation",
      projectId: "project-1",
      session: null,
      hasBypass: true,
    })).rejects.toMatchObject({
      code: "stage_not_runnable",
      message: "This lab stage is not runnable through the Admin Lab UI yet.",
    } satisfies Pick<AdminLabError, "code" | "message">);

    await expect(runAdminLabStage({
      stageId: "visual_evidence_ingest",
      projectId: "project-1",
      session: null,
      hasBypass: true,
    })).rejects.toMatchObject({
      code: "stage_not_runnable",
      message: "This lab stage is not runnable through the Admin Lab UI yet.",
    } satisfies Pick<AdminLabError, "code" | "message">);
  });
});
