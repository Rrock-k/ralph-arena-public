import { NextResponse } from "next/server";
import {
  AdminLabError,
  type AdminLabRunOptions,
  isAdminLabStageId,
  runAdminLabStage,
} from "@/lib/admin-lab";
import {
  getAdminLabProjectActionDefinition,
  isAdminLabProjectActionId,
} from "@/lib/admin-lab-actions";
import { requirePlatformCapability } from "@/lib/platform-access";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requirePlatformCapability("platform.runtime.manage");
  if (!access.authorized) {
    return NextResponse.json({ error: access.error }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const requestedStageId = body?.stageId;
  const actionId = readOptionalActionId(body?.actionId);
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  if (body?.actionId !== undefined && !actionId) {
    return NextResponse.json({ error: "actionId is invalid", code: "invalid_action_id" }, { status: 400 });
  }
  const action = actionId ? getAdminLabProjectActionDefinition(actionId) : null;
  if (action && requestedStageId !== undefined) {
    return NextResponse.json({
      error: "Primary Lab action requests must send actionId only; raw stageId is for debug stage runs.",
      code: "action_stage_double_truth",
    }, { status: 400 });
  }
  const stageId = action?.stageId ?? requestedStageId;
  if (!isAdminLabStageId(stageId)) {
    return NextResponse.json({ error: "stageId is invalid" }, { status: 400 });
  }

  try {
    return NextResponse.json(await runAdminLabStage({
      projectId,
      stageId,
      ...(actionId ? { actionId } : {}),
      session: access.session,
      hasBypass: access.hasBypass,
      options: readAdminLabRunOptions(stageId, body, action ? "action" : "debug_stage"),
    }));
  } catch (error) {
    if (error instanceof AdminLabError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
      }, { status: error.status });
    }
    console.error("[admin-lab/run] unexpected Lab run error:", error);
    return NextResponse.json({
      error: "Lab action failed unexpectedly. Check governance-platform logs.",
      code: "lab_run_unhandled_error",
    }, { status: 500 });
  }
}

function readOptionalActionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || !isAdminLabProjectActionId(trimmed)) return undefined;
  return trimmed;
}

type AdminLabRunInvocationKind = "action" | "debug_stage";

function baseRequestKeys(invocationKind: AdminLabRunInvocationKind): string[] {
  return invocationKind === "action" ? ["projectId", "actionId"] : ["projectId", "stageId"];
}

function readAdminLabRunOptions(
  stageId: string,
  body: Record<string, unknown> | null,
  invocationKind: AdminLabRunInvocationKind,
): AdminLabRunOptions | undefined {
  const baseKeys = baseRequestKeys(invocationKind);
  if (
    stageId === "project_operator_snapshot"
    || stageId === "project_agent_off"
    || stageId === "project_agent_on"
    || stageId === "spec_artifact_audit"
    || stageId === "runtime_claim_dry_run"
    || stageId === "runner_init_readiness"
    || stageId === "proof_reviews"
    || stageId === "visual_evidence_artifact_check"
  ) {
    assertAdminLabRunRequestKeys(
      body,
      baseKeys,
      `invalid_${stageId}_options`,
      `${stageId} accepts only the selected invocation id.`,
    );
    return undefined;
  }

  if (stageId === "prompt_contract_replay") {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "promptReplayFixture"],
      "invalid_prompt_replay_options",
      "Prompt replay accepts only the selected invocation id and promptReplayFixture.",
    );
    const promptReplayFixture = body?.promptReplayFixture;
    return {
      ...(typeof promptReplayFixture === "string"
        ? { promptReplayFixture: promptReplayFixture as AdminLabRunOptions["promptReplayFixture"] }
        : {}),
    };
  }

  if (stageId === "visual_workbench_manifest_readiness") {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "tail"],
      "invalid_visual_workbench_manifest_options",
      "Visual Workbench manifest readiness accepts only the selected invocation id and tail.",
    );
    const tail = readOptionalNumber(body?.tail);
    return {
      ...(tail !== undefined ? { tail } : {}),
    };
  }

  if (stageId === "project_stage_candidates") {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "limit", "tail", "includeArchived"],
      "invalid_project_stage_candidates_options",
      "Project stage candidates accepts only the selected invocation id, limit, tail and includeArchived.",
    );
    const limit = readOptionalNumber(body?.limit);
    const tail = readOptionalNumber(body?.tail);
    const includeArchivedValue = body?.includeArchived;
    const includeArchived = typeof includeArchivedValue === "boolean"
      ? includeArchivedValue
      : typeof includeArchivedValue === "string" && includeArchivedValue.trim() === "true";

    return {
      ...(limit !== undefined ? { limit } : {}),
      ...(tail !== undefined ? { tail } : {}),
      includeArchived,
    };
  }

  if (stageId === "executor_project_task") {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "taskId", "executorMode", "completionPromise", "agent", "model", "timeoutMinutes", "tail"],
      "invalid_executor_project_task_options",
      "Executor project task accepts only the selected invocation id, taskId, executorMode, completionPromise, agent, model, timeoutMinutes and tail.",
    );
    const taskIdValue = body?.taskId;
    const taskId = typeof taskIdValue === "string" && taskIdValue.trim()
      ? taskIdValue.trim()
      : undefined;
    const executorModeValue = body?.executorMode;
    const completionPromiseValue = body?.completionPromise;
    const agentValue = body?.agent;
    const modelValue = body?.model;
    const timeoutMinutes = readOptionalNumber(body?.timeoutMinutes);
    const tail = readOptionalNumber(body?.tail);

    return {
      ...(taskId ? { taskId } : {}),
      ...(typeof executorModeValue === "string" ? { executorMode: executorModeValue as AdminLabRunOptions["executorMode"] } : {}),
      ...(typeof completionPromiseValue === "string" ? { completionPromise: completionPromiseValue } : {}),
      ...(typeof agentValue === "string" ? { agent: agentValue as AdminLabRunOptions["agent"] } : {}),
      ...(typeof modelValue === "string" ? { model: modelValue } : {}),
      ...(timeoutMinutes !== undefined ? { timeoutMinutes } : {}),
      ...(tail !== undefined ? { tail } : {}),
    };
  }

  if (stageId === "planner_project_dry_run") {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "visualEvidenceMode", "agent", "model", "timeoutMinutes", "tail"],
      "invalid_planner_project_dry_run_options",
      "Planner project dry-run accepts only the selected invocation id, visualEvidenceMode, agent, model, timeoutMinutes and tail.",
    );
    const visualEvidenceModeValue = body?.visualEvidenceMode;
    const agentValue = body?.agent;
    const modelValue = body?.model;
    const timeoutMinutes = readOptionalNumber(body?.timeoutMinutes);
    const tail = readOptionalNumber(body?.tail);

    return {
      ...(typeof visualEvidenceModeValue === "string" ? { visualEvidenceMode: visualEvidenceModeValue as AdminLabRunOptions["visualEvidenceMode"] } : {}),
      ...(typeof agentValue === "string" ? { agent: agentValue as AdminLabRunOptions["agent"] } : {}),
      ...(typeof modelValue === "string" ? { model: modelValue } : {}),
      ...(timeoutMinutes !== undefined ? { timeoutMinutes } : {}),
      ...(tail !== undefined ? { tail } : {}),
    };
  }

  if (stageId === "planner_spec_migration_apply") {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "agent", "model", "timeoutMinutes", "tail"],
      "invalid_planner_spec_migration_apply_options",
      "Planner spec migration apply accepts only the selected invocation id, agent, model, timeoutMinutes and tail.",
    );
    const agentValue = body?.agent;
    const modelValue = body?.model;
    const timeoutMinutes = readOptionalNumber(body?.timeoutMinutes);
    const tail = readOptionalNumber(body?.tail);

    return {
      ...(typeof agentValue === "string" ? { agent: agentValue as AdminLabRunOptions["agent"] } : {}),
      ...(typeof modelValue === "string" ? { model: modelValue } : {}),
      ...(timeoutMinutes !== undefined ? { timeoutMinutes } : {}),
      ...(tail !== undefined ? { tail } : {}),
    };
  }

  if (stageId === "controller_project_dry_run") {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "controllerTrigger", "visualEvidenceMode", "agent", "model", "timeoutMinutes", "tail"],
      "invalid_controller_project_dry_run_options",
      "Controller project dry-run accepts only the selected invocation id, controllerTrigger, visualEvidenceMode, agent, model, timeoutMinutes and tail.",
    );
    const controllerTriggerValue = body?.controllerTrigger;
    const visualEvidenceModeValue = body?.visualEvidenceMode;
    const agentValue = body?.agent;
    const modelValue = body?.model;
    const timeoutMinutes = readOptionalNumber(body?.timeoutMinutes);
    const tail = readOptionalNumber(body?.tail);

    return {
      ...(typeof controllerTriggerValue === "string" ? { controllerTrigger: controllerTriggerValue as AdminLabRunOptions["controllerTrigger"] } : {}),
      ...(typeof visualEvidenceModeValue === "string" ? { visualEvidenceMode: visualEvidenceModeValue as AdminLabRunOptions["visualEvidenceMode"] } : {}),
      ...(typeof agentValue === "string" ? { agent: agentValue as AdminLabRunOptions["agent"] } : {}),
      ...(typeof modelValue === "string" ? { model: modelValue } : {}),
      ...(timeoutMinutes !== undefined ? { timeoutMinutes } : {}),
      ...(tail !== undefined ? { tail } : {}),
    };
  }

  if (
    stageId === "visual_workbench_selector_readiness"
    || stageId === "visual_workbench_shell_policy"
    || stageId === "visual_workbench_automation_status"
    || stageId === "visual_workbench_evidence_chain_readiness"
  ) {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "taskId", "tail"],
      `invalid_${stageId}_options`,
      `${stageId} accepts only the selected invocation id, taskId and tail.`,
    );
    const taskIdValue = body?.taskId;
    const taskId = typeof taskIdValue === "string" && taskIdValue.trim()
      ? taskIdValue.trim()
      : undefined;
    const tail = readOptionalNumber(body?.tail);

    return {
      ...(taskId ? { taskId } : {}),
      ...(tail !== undefined ? { tail } : {}),
    };
  }

  if (stageId === "visual_workbench_evidence_automation_run") {
    assertAdminLabRunRequestKeys(
      body,
      [...baseKeys, "taskId", "tail", "confirmed"],
      "invalid_visual_workbench_evidence_automation_options",
      "Workbench evidence automation accepts only the selected invocation id, taskId, tail and confirmed.",
    );
    const taskIdValue = body?.taskId;
    const taskId = typeof taskIdValue === "string" && taskIdValue.trim()
      ? taskIdValue.trim()
      : undefined;
    const tail = readOptionalNumber(body?.tail);
    const confirmed = body?.confirmed === true;

    return {
      ...(taskId ? { taskId } : {}),
      ...(tail !== undefined ? { tail } : {}),
      confirmed,
    };
  }

  if (stageId === "visual_workbench_browser_readiness") {
    assertAdminLabRunRequestKeys(
      body,
      baseKeys,
      "invalid_visual_workbench_browser_readiness_options",
      "Visual Workbench browser readiness accepts only the selected invocation id.",
    );
    return undefined;
  }

  if (stageId !== "project_stage_snapshot") return undefined;

  assertAdminLabRunRequestKeys(
    body,
    [...baseKeys, "taskId", "tail"],
    "invalid_project_stage_snapshot_options",
    "Project Stage Snapshot accepts only the selected invocation id, taskId and tail.",
  );

  const taskIdValue = body?.taskId;
  const taskId = typeof taskIdValue === "string" && taskIdValue.trim()
    ? taskIdValue.trim()
    : undefined;

  const tail = readOptionalNumber(body?.tail);

  return {
    ...(taskId ? { taskId } : {}),
    ...(tail !== undefined ? { tail } : {}),
  };
}

function assertAdminLabRunRequestKeys(
  body: Record<string, unknown> | null,
  allowedKeysInput: string[],
  code: string,
  message: string,
): void {
  const allowedKeys = new Set(allowedKeysInput);
  const unexpectedKeys = Object.keys(body ?? {}).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new AdminLabError(
      400,
      code,
      message,
    );
  }
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value.trim());
  if (value !== undefined && value !== null && value !== "") return Number.NaN;
  return undefined;
}
