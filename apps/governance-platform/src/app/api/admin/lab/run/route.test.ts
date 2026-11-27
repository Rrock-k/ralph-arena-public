import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockAdminLabError } = vi.hoisted(() => {
  class MockAdminLabError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { MockAdminLabError };
});

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

vi.mock("@/lib/admin-lab", () => ({
  AdminLabError: MockAdminLabError,
  isAdminLabStageId: vi.fn((value: unknown) =>
    value === "project_operator_snapshot"
      || value === "project_agent_off"
      || value === "project_agent_on"
      || value === "spec_artifact_audit"
      || value === "runtime_claim_dry_run"
      || value === "runner_init_readiness"
      || value === "proof_reviews"
      || value === "visual_evidence_artifact_check"
      || value === "prompt_contract_replay"
      || value === "project_stage_candidates"
      || value === "project_stage_snapshot"
      || value === "executor_project_task"
      || value === "planner_project_dry_run"
      || value === "planner_spec_migration_apply"
      || value === "controller_project_dry_run"
      || value === "visual_workbench_manifest_readiness"
      || value === "visual_workbench_selector_readiness"
      || value === "visual_workbench_shell_policy"
      || value === "visual_workbench_browser_readiness"
      || value === "visual_workbench_automation_status"
      || value === "visual_workbench_evidence_chain_readiness"
      || value === "visual_workbench_evidence_automation_run",
  ),
  runAdminLabStage: vi.fn(),
}));

import { POST } from "./route";
import { requirePlatformCapability } from "@/lib/platform-access";
import { runAdminLabStage } from "@/lib/admin-lab";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/lab/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authorizeLabRun() {
  vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
    authorized: true,
    session: { user: { id: "user-1" } },
    hasBypass: false,
  } as any);
}

describe("POST /api/admin/lab/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires platform runtime management", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: false,
      error: "Platform access denied",
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "project_operator_snapshot",
    }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Platform access denied" });
    expect(runAdminLabStage).not.toHaveBeenCalled();
  });

  it("rejects invalid stage ids before running the lab", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: null,
      hasBypass: true,
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "not-a-stage",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: "stageId is invalid" });
    expect(runAdminLabStage).not.toHaveBeenCalled();
  });

  it("runs a valid lab stage with viewer auth context", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { ok: true },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "project_operator_snapshot",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "project_operator_snapshot",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: undefined,
    });
    expect(payload).toEqual({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { ok: true },
    });
  });

  it("passes a validated project action id as top-level invocation metadata", async () => {
    authorizeLabRun();
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { ok: true },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      actionId: "check_project_status",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "project_operator_snapshot",
      actionId: "check_project_status",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: undefined,
    });
  });

  it("maps Pause agent project action to the lifecycle stage without raw stage input", async () => {
    authorizeLabRun();
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.project-agent-intent-result.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      actionId: "pause_agent",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "project_agent_off",
      actionId: "pause_agent",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: undefined,
    });
  });

  it("rejects primary action requests that also send raw stage ids", async () => {
    authorizeLabRun();

    const response = await POST(request({
      projectId: "project-1",
      stageId: "project_stage_candidates",
      actionId: "get_task_context",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "Primary Lab action requests must send actionId only; raw stageId is for debug stage runs.",
      code: "action_stage_double_truth",
    });
    expect(runAdminLabStage).not.toHaveBeenCalled();
  });

  it("rejects unknown action ids before running the lab", async () => {
    authorizeLabRun();

    const response = await POST(request({
      projectId: "project-1",
      actionId: "not-an-action",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "actionId is invalid",
      code: "invalid_action_id",
    });
    expect(runAdminLabStage).not.toHaveBeenCalled();
  });

  it.each([
    ["project_operator_snapshot", "workDir", "invalid_project_operator_snapshot_options"],
    ["project_agent_off", "retry", "invalid_project_agent_off_options"],
    ["project_agent_on", "relaunch", "invalid_project_agent_on_options"],
    ["spec_artifact_audit", "workDir", "invalid_spec_artifact_audit_options"],
    ["runtime_claim_dry_run", "workDir", "invalid_runtime_claim_dry_run_options"],
    ["runner_init_readiness", "workDir", "invalid_runner_init_readiness_options"],
    ["proof_reviews", "report", "invalid_proof_reviews_options"],
    ["visual_evidence_artifact_check", "artifactFile", "invalid_visual_evidence_artifact_check_options"],
    ["project_stage_snapshot", "workDir", "invalid_project_stage_snapshot_options"],
    ["project_stage_candidates", "workDir", "invalid_project_stage_candidates_options"],
    ["executor_project_task", "workDir", "invalid_executor_project_task_options"],
    ["planner_project_dry_run", "spec", "invalid_planner_project_dry_run_options"],
    ["planner_spec_migration_apply", "workDir", "invalid_planner_spec_migration_apply_options"],
    ["planner_spec_migration_apply", "sourceRef", "invalid_planner_spec_migration_apply_options"],
    ["planner_spec_migration_apply", "spec", "invalid_planner_spec_migration_apply_options"],
    ["planner_spec_migration_apply", "visualEvidenceMode", "invalid_planner_spec_migration_apply_options"],
    ["controller_project_dry_run", "snapshot", "invalid_controller_project_dry_run_options"],
    ["visual_workbench_selector_readiness", "workDir", "invalid_visual_workbench_selector_readiness_options"],
    ["visual_workbench_shell_policy", "config", "invalid_visual_workbench_shell_policy_options"],
    ["visual_workbench_browser_readiness", "taskId", "invalid_visual_workbench_browser_readiness_options"],
    ["visual_workbench_automation_status", "report", "invalid_visual_workbench_automation_status_options"],
    ["visual_workbench_evidence_chain_readiness", "run", "invalid_visual_workbench_evidence_chain_readiness_options"],
    ["visual_workbench_evidence_automation_run", "workDir", "invalid_visual_workbench_evidence_automation_options"],
    ["visual_workbench_evidence_automation_run", "baseUrl", "invalid_visual_workbench_evidence_automation_options"],
    ["visual_workbench_evidence_automation_run", "outDir", "invalid_visual_workbench_evidence_automation_options"],
    ["visual_workbench_evidence_automation_run", "config", "invalid_visual_workbench_evidence_automation_options"],
  ])("rejects unexpected %s request input %s", async (stageId, unexpectedKey, code) => {
    authorizeLabRun();

    const response = await POST(request({
      projectId: "project-1",
      stageId,
      [unexpectedKey]: "must-not-pass",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ code });
    expect(runAdminLabStage).not.toHaveBeenCalled();
  });

  it("passes project_stage_snapshot task and tail inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.project-stage-snapshot.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "project_stage_snapshot",
      taskId: "task-1",
      tail: "120",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "project_stage_snapshot",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        taskId: "task-1",
        tail: 120,
      },
    });
  });

  it("passes project_stage_candidates scan inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.project-stage-candidates.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "project_stage_candidates",
      limit: "40",
      tail: "9",
      includeArchived: true,
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "project_stage_candidates",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        limit: 40,
        tail: 9,
        includeArchived: true,
      },
    });
  });

  it("passes prompt_contract_replay fixture enum to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-prompt-contract-replay.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "prompt_contract_replay",
      promptReplayFixture: "product_skill",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "prompt_contract_replay",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        promptReplayFixture: "product_skill",
      },
    });
  });

  it("rejects prompt_contract_replay path, model and task-shaped inputs", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "prompt_contract_replay",
      promptReplayFixture: "ux_skill",
      fixture: "/must/not-pass",
      out: "/must/not-pass",
      taskId: "task-1",
      model: "must-not-pass",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "Prompt replay accepts only the selected invocation id and promptReplayFixture.",
      code: "invalid_prompt_replay_options",
    });
    expect(runAdminLabStage).not.toHaveBeenCalled();
  });

  it("passes visual_workbench_manifest_readiness tail only to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-visual-workbench-manifest-readiness.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "visual_workbench_manifest_readiness",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "visual_workbench_manifest_readiness",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        tail: 80,
      },
    });
  });

  it("rejects visual_workbench_manifest_readiness path, model and task-shaped inputs", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "visual_workbench_manifest_readiness",
      tail: 80,
      workDir: "/must/not-pass",
      sourceRef: "abc123",
      taskId: "task-1",
      model: "must-not-pass",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "Visual Workbench manifest readiness accepts only the selected invocation id and tail.",
      code: "invalid_visual_workbench_manifest_options",
    });
    expect(runAdminLabStage).not.toHaveBeenCalled();
  });

  it("passes executor_project_task inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-executor-project-task.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "executor_project_task",
      taskId: "task-1",
      executorMode: "new_task",
      completionPromise: "Finish task-1 only.",
      agent: "codex",
      model: "gpt-5.5",
      timeoutMinutes: "20",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "executor_project_task",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        taskId: "task-1",
        executorMode: "new_task",
        completionPromise: "Finish task-1 only.",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 20,
        tail: 80,
      },
    });
  });

  it("passes planner_project_dry_run inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-planner-project-dry-run.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "planner_project_dry_run",
      visualEvidenceMode: "new_tasks_only",
      agent: "codex",
      model: "gpt-5.5",
      timeoutMinutes: "12",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "planner_project_dry_run",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        visualEvidenceMode: "new_tasks_only",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 12,
        tail: 80,
      },
    });
  });

  it("passes planner_spec_migration_apply inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-planner-spec-migration-apply.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "planner_spec_migration_apply",
      agent: "codex",
      model: "gpt-5.5",
      timeoutMinutes: "12",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "planner_spec_migration_apply",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 12,
        tail: 80,
      },
    });
  });

  it("passes visual_workbench_evidence_automation_run confirmation inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-visual-workbench-evidence-automation-run.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "visual_workbench_evidence_automation_run",
      taskId: "task-047",
      tail: "80",
      confirmed: true,
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "visual_workbench_evidence_automation_run",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        taskId: "task-047",
        tail: 80,
        confirmed: true,
      },
    });
  });

  it("passes controller_project_dry_run inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-controller-project-dry-run.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "controller_project_dry_run",
      controllerTrigger: "manual",
      visualEvidenceMode: "new_tasks_only",
      agent: "codex",
      model: "gpt-5.5",
      timeoutMinutes: "12",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "controller_project_dry_run",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        controllerTrigger: "manual",
        visualEvidenceMode: "new_tasks_only",
        agent: "codex",
        model: "gpt-5.5",
        timeoutMinutes: 12,
        tail: 80,
      },
    });
  });

  it("passes visual_workbench_selector_readiness inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-visual-workbench-selector-readiness.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "visual_workbench_selector_readiness",
      taskId: "task-1",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "visual_workbench_selector_readiness",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    });
  });

  it("passes visual_workbench_shell_policy task inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-visual-workbench-shell-policy.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "visual_workbench_shell_policy",
      taskId: "task-1",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "visual_workbench_shell_policy",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    });
  });

  it("runs visual_workbench_browser_readiness without project or task inputs", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-visual-workbench-browser-readiness.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "visual_workbench_browser_readiness",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "visual_workbench_browser_readiness",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: undefined,
    });
  });

  it("passes visual_workbench_automation_status task inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-visual-workbench-automation-status.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "visual_workbench_automation_status",
      taskId: "task-1",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "visual_workbench_automation_status",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    });
  });

  it("passes visual_workbench_evidence_chain_readiness task inputs to the lab runner", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(runAdminLabStage).mockResolvedValueOnce({
      schemaVersion: "ra-356.admin-lab-run.v1",
      projectId: "project-1",
      result: { schemaVersion: "ra-356.admin-lab-visual-workbench-evidence-chain-readiness.v1" },
    } as any);

    const response = await POST(request({
      projectId: "project-1",
      stageId: "visual_workbench_evidence_chain_readiness",
      taskId: "task-1",
      tail: "80",
    }));

    expect(response.status).toBe(200);
    expect(runAdminLabStage).toHaveBeenCalledWith({
      projectId: "project-1",
      stageId: "visual_workbench_evidence_chain_readiness",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      options: {
        taskId: "task-1",
        tail: 80,
      },
    });
  });

  it("maps lab stage errors without exposing a stack", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
      session: null,
      hasBypass: true,
    } as any);
    vi.mocked(runAdminLabStage).mockRejectedValueOnce(
      new MockAdminLabError(400, "stage_not_runnable", "This lab stage is not runnable yet."),
    );

    const response = await POST(request({
      projectId: "project-1",
      stageId: "planner_project_dry_run",
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: "This lab stage is not runnable yet.",
      code: "stage_not_runnable",
    });
  });

  it("returns structured JSON for unexpected lab run errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
        authorized: true,
        session: null,
        hasBypass: true,
      } as any);
      vi.mocked(runAdminLabStage).mockRejectedValueOnce(new Error("boom"));

      const response = await POST(request({
        projectId: "project-1",
        stageId: "planner_project_dry_run",
      }));
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload).toEqual({
        error: "Lab action failed unexpectedly. Check governance-platform logs.",
        code: "lab_run_unhandled_error",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[admin-lab/run] unexpected Lab run error:",
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
