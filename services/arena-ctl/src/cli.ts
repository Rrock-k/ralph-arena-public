#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { GovernanceClient } from "./governance-client.js";
import { WorkerClient } from "./worker-client.js";
import type { ArenaCtlContext } from "./tool-context.js";
import {
  readProjectExperimentPreflight,
  type RequestedExperimentMode,
} from "./tools/project-experiment-preflight.js";
import { readProjectStageSnapshot } from "./tools/project-stage-snapshot.js";
import { readProjectStageCandidates } from "./tools/project-stage-candidates.js";
import {
  readAuthdOperatorDigest,
  type AuthdOperatorDigestProvider,
} from "./tools/authd-operator-digest.js";

type VisualEvidenceMode = "off" | "required" | "new_tasks_only";
const PROJECT_STAGE_CANDIDATE_MAX_TAIL = 5000;

type ParsedCliCommand = {
  command: "authd_health";
} | {
  command: "authd_operator_digest";
  provider: AuthdOperatorDigestProvider;
} | {
  command: "token_status";
} | {
  command: "project_experiment_preflight";
  projectId: string;
  mode: RequestedExperimentMode;
  tail?: number;
} | {
  command: "project_stage_snapshot";
  projectId: string;
  taskId?: string;
  tail?: number;
} | {
  command: "project_stage_candidates";
  limit?: number;
  includeArchived?: boolean;
  tail?: number;
} | {
  command: "project_updates";
  projectId: string;
  tail?: number;
} | {
  command: "project_proof_reviews";
  projectId: string;
} | {
  command: "project_visual_evidence_artifact_check";
  projectId: string;
} | {
  command: "project_visual_evidence_ingest";
  projectId: string;
  taskId: string;
  sourceEvidenceRef: string;
  progressJsonPath: string;
  artifactFilePath: string;
} | {
  command: "project_spec_artifact_audit";
  projectId: string;
} | {
  command: "project_set_runtime_auth_modes";
  projectId: string;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
} | {
  command: "project_set_runtime_system";
  projectId: string;
  agent: string;
  agentImpl: string;
  model?: string;
  toolId?: string;
  providerBillingMode: string;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
} | {
  command: "project_set_source_snapshot";
  projectId: string;
  commitSha: string;
} | {
  command: "project_set_visual_evidence_mode";
  projectId: string;
  visualEvidenceMode: VisualEvidenceMode;
} | {
  command: "project_retry_now";
  projectId: string;
} | {
  command: "project_agent_off";
  projectId: string;
} | {
  command: "project_agent_on";
  projectId: string;
} | {
  command: "project_relaunch";
  projectId: string;
} | {
  command: "project_recreate_runtime";
  projectId: string;
} | {
  command: "project_create";
  title: string;
  spec: string;
  agent?: string;
  agentImpl?: string;
  model?: string;
  runnerBackend?: string;
  providerBillingMode?: string;
  initialBudgetUsd?: number;
  claudeAuthMode?: string;
  codexAuthMode?: string;
  sourceSeedProfile?: string;
} | {
  command: "tg_spec_target_create";
  title: string;
  sourceProjectId: string;
  agent?: string;
  agentImpl?: string;
  model?: string;
  runnerBackend?: string;
  providerBillingMode?: string;
  initialBudgetUsd?: number;
  claudeAuthMode?: string;
  codexAuthMode?: string;
  sourceSeedProfile?: string;
} | {
  command: "tg_spec_accepted_artifact_import";
  projectId: string;
  packageFile: string;
} | {
  command: "tg_spec_launch_configure";
  projectId: string;
  agent: string;
  agentImpl: string;
  model?: string;
  claudeAuthMode?: string;
  codexAuthMode?: string;
  runnerBackend: "local" | "vps";
  toolId?: string;
  providerBillingMode: string;
  initialBudgetUsd?: number;
  visualEvidenceMode?: VisualEvidenceMode;
  visualWorkbenchEvidenceAutomation?: boolean;
} | {
  command: "tg_spec_launch_start";
  projectId: string;
};

const USAGE = [
  "Usage:",
  "  arena-ctl authd_health",
  "  arena-ctl authd_operator_digest --provider <codex|claude>",
  "  arena-ctl token_status",
  "  arena-ctl project_experiment_preflight --project-id <id> --mode <preview_only|agent_run> [--tail <lines>]",
  "  arena-ctl project_stage_snapshot --project-id <id> [--task-id <task-id>] [--tail <lines>]",
  "  arena-ctl project_stage_candidates [--limit <projects>] [--include-archived <enabled|disabled>] [--tail <lines>]",
  "  arena-ctl project_updates --project-id <id> [--tail <rows>]",
  "  arena-ctl project_proof_reviews --project-id <id>",
  "  arena-ctl project_visual_evidence_artifact_check --project-id <id>",
  "  arena-ctl project_visual_evidence_ingest --project-id <id> --task-id <task-id> --evidence-ref <visual-workbench-capture:...> --progress-json <workspace/.arena/progress.json> --artifact-file <workspace/.ralph/visual-workbench/.../capture.png>",
  "  arena-ctl project_spec_artifact_audit --project-id <id>",
  "  arena-ctl project_set_runtime_auth_modes --project-id <id> [--claude-auth-mode <oauth|api_key|null>] [--codex-auth-mode <subscription|api_key|null>]",
  "  arena-ctl project_set_runtime_system --project-id <id> --agent <agent> --agent-impl <impl> --provider-billing-mode <byok|platform_credits|platform_credentials> [--model <model>] [--tool-id <id>] [--claude-auth-mode <oauth|api_key|null>] [--codex-auth-mode <subscription|api_key|null>]",
  "  arena-ctl project_set_source_snapshot --project-id <id> --commit-sha <40-char-git-sha>",
  "  arena-ctl project_set_visual_evidence_mode --project-id <id> --visual-evidence-mode <off|required|new_tasks_only>",
  "  arena-ctl project_retry_now --project-id <id>",
  "  arena-ctl project_agent_off --project-id <id>",
  "  arena-ctl project_agent_on --project-id <id>",
  "  arena-ctl project_relaunch --project-id <id>",
  "  arena-ctl project_recreate_runtime --project-id <id>",
  "  arena-ctl project_create --title <title> --spec <text> [--source-seed-profile <profile>] [--agent <agent>] [--agent-impl <impl>] [--model <model>]",
  "  arena-ctl tg_spec_target_create --title <title> --source-project-id <tg-spec-id> [--source-seed-profile <profile>] [--agent <agent>] [--agent-impl <impl>] [--model <model>]",
  "  arena-ctl tg_spec_accepted_artifact_import --project-id <id> --package-file <accepted-import-package.json>",
  "  arena-ctl tg_spec_launch_configure --project-id <id> --agent <agent> --agent-impl <impl> --runner-backend <local|vps> --provider-billing-mode <mode> [--model <model>] [--codex-auth-mode <mode>] [--claude-auth-mode <mode>] [--tool-id <id>] [--initial-budget-usd <usd>] [--visual-evidence-mode <off|required|new_tasks_only>] [--visual-workbench-evidence-automation <enabled|disabled>]",
  "  arena-ctl tg_spec_launch_start --project-id <id>",
  "",
  "authd_health is read-only. It returns sanitized local authd provider health and never auth values.",
  "authd_operator_digest is read-only. It converts sanitized authd health into message-ready operator text.",
  "token_status is read-only. It returns sanitized TokenManager provider metadata and never auth values.",
  "project_experiment_preflight is read-only. It does not claim runtime intents, start containers,",
  "retry projects, relaunch previews or write workspace files.",
  "project_stage_snapshot is read-only. It reads existing project/preflight/spec/plan/session owners",
  "into a disposable stage input without lifecycle, runtime, source, task, evidence or provider writes.",
  "project_stage_candidates is read-only. It scans a capped project list through project_stage_snapshot",
  "and reports pending/failed/in-progress executor task candidates without selecting or running a task.",
  "project_updates is read-only. It returns recent Arena delivery/update rows for one project.",
  "",
  "project_proof_reviews is read-only. It returns current Arena proofReviews, visualEvidenceReviews and visualEvidenceReadiness diagnostics.",
  "project_visual_evidence_artifact_check is read-only. It checks current visualEvidenceReviews artifact handles through Arena's download owner without returning bytes.",
  "project_visual_evidence_ingest is mutating: it imports explicit published progressJson and one matching Workbench screenshot asset.",
  "It does not relaunch, recreate runtime, clear blockers, retry projects, write task evidence, send Telegram messages or scan raw artifact folders.",
  "project_spec_artifact_audit is read-only. It returns current AcceptedSpecArtifact import/audit status.",
  "project_set_runtime_auth_modes is mutating: it updates future runtime auth configuration only.",
  "It does not relaunch, recreate runtime, clear blockers, retry projects or write workspace files.",
  "project_set_runtime_system is mutating: it updates future runtime system/tool/model/auth configuration only.",
  "It does not relaunch, recreate runtime, clear blockers, retry projects, change App/Agent intent or write workspace files.",
  "project_set_source_snapshot is mutating: it updates the future runtime source commit pointer only.",
  "It does not relaunch, recreate runtime, clear blockers, retry projects or write workspace files.",
  "project_set_visual_evidence_mode is mutating: it updates future runtime visual evidence config only.",
  "It does not relaunch, recreate runtime, clear blockers, retry projects or write workspace files.",
  "project_retry_now is mutating: it clears one retryable/manual blocker through the lifecycle owner.",
  "Use it only with fresh evidence that the wait condition can be retried.",
  "project_agent_off is mutating: it sets agent intent OFF through the lifecycle owner while preserving App ON/preview when supported.",
  "project_agent_on is mutating: it sets agent intent ON through the lifecycle owner. App power must already be ON.",
  "project_relaunch is mutating: it queues an explicit relaunch through the lifecycle owner.",
  "It does not accept overrides; use only when fresh operator evidence recommends relaunch.",
  "project_recreate_runtime is mutating: it recreates the current runtime through the recovery owner.",
  "It preserves project truth and must not be used as a new-run or retry shortcut.",
  "",
  "project_create is mutating: it creates a project through governance /projects/create.",
  "It does not retry, relaunch or repair existing projects.",
  "",
  "tg_spec_target_create is mutating: it creates a dormant tg-spec target through governance.",
  "tg_spec_accepted_artifact_import is mutating: it imports an explicit AcceptedSpecArtifact package through governance.",
  "tg_spec_launch_configure is mutating: it writes explicit launch configuration through the existing launch owner.",
  "tg_spec_launch_start is mutating: it starts a configured tg-spec project through the explicit launch owner.",
].join("\n");

export function parseArenaCtlCliArgs(argv: string[]): ParsedCliCommand {
  const [command, ...rest] = argv;
  if (command === "help" || command === "--help" || command === "-h") {
    throw new CliUsageError(USAGE, 0);
  }
  if (command === "authd_health") {
    const flags = parseFlags(rest);
    assertNoUnknownFlags(flags);
    return { command };
  }
  if (command === "authd_operator_digest") {
    const flags = parseFlags(rest);
    const provider = readAuthdOperatorDigestProviderFlag(flags, "provider");
    assertNoUnknownFlags(flags);
    return { command, provider };
  }
  if (command === "token_status") {
    const flags = parseFlags(rest);
    assertNoUnknownFlags(flags);
    return { command };
  }

  if (command === "project_experiment_preflight") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const mode = readRequiredFlag(flags, "mode");
    if (mode !== "preview_only" && mode !== "agent_run") {
      throw new CliUsageError(`Invalid --mode ${mode}. Expected preview_only or agent_run.`);
    }
    const tail = flags.get("tail") ? readPositiveIntegerFlag(flags, "tail") : undefined;

    assertNoUnknownFlags(flags);
    return { command, projectId, mode, tail };
  }

  if (command === "project_stage_snapshot") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const taskId = readOptionalFlag(flags, "task-id");
    const tail = flags.get("tail") ? readPositiveIntegerFlag(flags, "tail") : undefined;
    assertNoUnknownFlags(flags);
    return { command, projectId, taskId, tail };
  }

  if (command === "project_stage_candidates") {
    const flags = parseFlags(rest);
    const limit = flags.get("limit") ? readPositiveIntegerFlag(flags, "limit") : undefined;
    const includeArchived = flags.get("include-archived")
      ? readEnabledDisabledFlag(flags, "include-archived")
      : undefined;
    const tail = flags.get("tail")
      ? readPositiveIntegerFlagWithMax(flags, "tail", PROJECT_STAGE_CANDIDATE_MAX_TAIL)
      : undefined;
    assertNoUnknownFlags(flags);
    return { command, limit, includeArchived, tail };
  }

  if (command === "project_updates") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const tail = flags.get("tail") ? readPositiveIntegerFlag(flags, "tail") : undefined;
    assertNoUnknownFlags(flags);
    return { command, projectId, tail };
  }

  if (command === "project_proof_reviews") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  if (command === "project_visual_evidence_artifact_check") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  if (command === "project_visual_evidence_ingest") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const taskId = readRequiredFlag(flags, "task-id");
    const sourceEvidenceRef = readRequiredFlag(flags, "evidence-ref");
    const progressJsonPath = readRequiredFlag(flags, "progress-json");
    const artifactFilePath = readRequiredFlag(flags, "artifact-file");
    assertNoUnknownFlags(flags);
    return { command, projectId, taskId, sourceEvidenceRef, progressJsonPath, artifactFilePath };
  }

  if (command === "project_spec_artifact_audit") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  if (command === "project_set_runtime_auth_modes") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const claudeAuthMode = flags.has("claude-auth-mode")
      ? readNullableAuthModeFlag(flags, "claude-auth-mode", ["oauth", "api_key"])
      : undefined;
    const codexAuthMode = flags.has("codex-auth-mode")
      ? readNullableAuthModeFlag(flags, "codex-auth-mode", ["subscription", "api_key"])
      : undefined;
    if (claudeAuthMode === undefined && codexAuthMode === undefined) {
      throw new CliUsageError("At least one of --claude-auth-mode or --codex-auth-mode is required");
    }
    assertNoUnknownFlags(flags);
    return { command, projectId, claudeAuthMode, codexAuthMode };
  }

  if (command === "project_set_runtime_system") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const agent = readRequiredFlag(flags, "agent");
    const agentImpl = readRequiredFlag(flags, "agent-impl");
    const model = readOptionalFlag(flags, "model");
    const toolId = readOptionalFlag(flags, "tool-id");
    const providerBillingMode = readProviderBillingModeFlag(flags, "provider-billing-mode");
    const claudeAuthMode = flags.has("claude-auth-mode")
      ? readNullableAuthModeFlag(flags, "claude-auth-mode", ["oauth", "api_key"])
      : undefined;
    const codexAuthMode = flags.has("codex-auth-mode")
      ? readNullableAuthModeFlag(flags, "codex-auth-mode", ["subscription", "api_key"])
      : undefined;
    assertNoUnknownFlags(flags);
    return {
      command,
      projectId,
      agent,
      agentImpl,
      model,
      toolId,
      providerBillingMode,
      claudeAuthMode,
      codexAuthMode,
    };
  }

  if (command === "project_set_source_snapshot") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const commitSha = readRequiredFlag(flags, "commit-sha");
    if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
      throw new CliUsageError("--commit-sha must be a 40 character git SHA");
    }
    assertNoUnknownFlags(flags);
    return { command, projectId, commitSha };
  }

  if (command === "project_set_visual_evidence_mode") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const visualEvidenceMode = readVisualEvidenceModeFlag(flags, "visual-evidence-mode");
    assertNoUnknownFlags(flags);
    return { command, projectId, visualEvidenceMode };
  }

  if (command === "project_retry_now") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  if (command === "project_agent_off") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  if (command === "project_agent_on") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  if (command === "project_relaunch") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  if (command === "project_recreate_runtime") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  if (command === "project_create") {
    const flags = parseFlags(rest);
    const title = readRequiredFlag(flags, "title");
    const spec = readRequiredFlag(flags, "spec");
    const parsed: ParsedCliCommand = {
      command,
      title,
      spec,
      agent: readOptionalFlag(flags, "agent"),
      agentImpl: readOptionalFlag(flags, "agent-impl"),
      model: readOptionalFlag(flags, "model"),
      runnerBackend: readOptionalFlag(flags, "runner-backend"),
      providerBillingMode: readOptionalFlag(flags, "provider-billing-mode"),
      initialBudgetUsd: flags.get("initial-budget-usd")
        ? readPositiveNumberFlag(flags, "initial-budget-usd")
        : undefined,
      claudeAuthMode: readOptionalFlag(flags, "claude-auth-mode"),
      codexAuthMode: readOptionalFlag(flags, "codex-auth-mode"),
      sourceSeedProfile: readOptionalFlag(flags, "source-seed-profile"),
    };
    assertNoUnknownFlags(flags);
    return parsed;
  }

  if (command === "tg_spec_target_create") {
    const flags = parseFlags(rest);
    const title = readRequiredFlag(flags, "title");
    const sourceProjectId = readRequiredFlag(flags, "source-project-id");
    const parsed: ParsedCliCommand = {
      command,
      title,
      sourceProjectId,
      agent: readOptionalFlag(flags, "agent"),
      agentImpl: readOptionalFlag(flags, "agent-impl"),
      model: readOptionalFlag(flags, "model"),
      runnerBackend: readOptionalFlag(flags, "runner-backend"),
      providerBillingMode: readOptionalFlag(flags, "provider-billing-mode"),
      initialBudgetUsd: flags.get("initial-budget-usd")
        ? readPositiveNumberFlag(flags, "initial-budget-usd")
        : undefined,
      claudeAuthMode: readOptionalFlag(flags, "claude-auth-mode"),
      codexAuthMode: readOptionalFlag(flags, "codex-auth-mode"),
      sourceSeedProfile: readOptionalFlag(flags, "source-seed-profile"),
    };
    assertNoUnknownFlags(flags);
    return parsed;
  }

  if (command === "tg_spec_accepted_artifact_import") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const packageFile = readRequiredFlag(flags, "package-file");
    assertNoUnknownFlags(flags);
    return { command, projectId, packageFile };
  }

  if (command === "tg_spec_launch_configure") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    const agent = readRequiredFlag(flags, "agent");
    const agentImpl = readRequiredFlag(flags, "agent-impl");
    const runnerBackend = readRunnerBackendFlag(flags, "runner-backend");
    const providerBillingMode = readRequiredFlag(flags, "provider-billing-mode");
    const model = readOptionalFlag(flags, "model");
    const claudeAuthMode = readOptionalFlag(flags, "claude-auth-mode");
    const codexAuthMode = readOptionalFlag(flags, "codex-auth-mode");
    const toolId = readOptionalFlag(flags, "tool-id");
    const initialBudgetUsd = flags.get("initial-budget-usd")
      ? readPositiveNumberFlag(flags, "initial-budget-usd")
      : undefined;
    const visualEvidenceMode = flags.get("visual-evidence-mode")
      ? readVisualEvidenceModeFlag(flags, "visual-evidence-mode")
      : undefined;
    const visualWorkbenchEvidenceAutomation = flags.get("visual-workbench-evidence-automation")
      ? readEnabledDisabledFlag(flags, "visual-workbench-evidence-automation")
      : undefined;
    assertNoUnknownFlags(flags);
    return {
      command,
      projectId,
      agent,
      agentImpl,
      model,
      claudeAuthMode,
      codexAuthMode,
      runnerBackend,
      toolId,
      providerBillingMode,
      initialBudgetUsd,
      visualEvidenceMode,
      visualWorkbenchEvidenceAutomation,
    };
  }

  if (command === "tg_spec_launch_start") {
    const flags = parseFlags(rest);
    const projectId = readRequiredFlag(flags, "project-id");
    assertNoUnknownFlags(flags);
    return { command, projectId };
  }

  throw new CliUsageError(`Unsupported arena-ctl command: ${command ?? "(missing)"}\n\n${USAGE}`);
}

async function main() {
  try {
    const parsed = parseArenaCtlCliArgs(process.argv.slice(2));
    const ctx = buildContext();

    let result: unknown;
    if (parsed.command === "authd_health") {
      result = await ctx.governance.getAuthdHealth();
    } else if (parsed.command === "authd_operator_digest") {
      result = await readAuthdOperatorDigest({
        ctx,
        provider: parsed.provider,
      });
    } else if (parsed.command === "token_status") {
      result = await ctx.governance.getTokenStatus();
    } else if (parsed.command === "project_experiment_preflight") {
      result = await readProjectExperimentPreflight({
        ctx,
        projectId: parsed.projectId,
        requestedMode: parsed.mode,
        tail: parsed.tail,
      });
    } else if (parsed.command === "project_stage_snapshot") {
      result = await readProjectStageSnapshot({
        ctx,
        projectId: parsed.projectId,
        taskId: parsed.taskId,
        tail: parsed.tail,
      });
    } else if (parsed.command === "project_stage_candidates") {
      result = await readProjectStageCandidates({
        ctx,
        limit: parsed.limit,
        includeArchived: parsed.includeArchived,
        tail: parsed.tail,
      });
    } else if (parsed.command === "project_updates") {
      result = await ctx.governance.getProjectUpdates(parsed.projectId, parsed.tail);
    } else if (parsed.command === "project_proof_reviews") {
      result = await ctx.governance.getProjectProofReviews(parsed.projectId);
    } else if (parsed.command === "project_visual_evidence_artifact_check") {
      result = await ctx.governance.getProjectVisualEvidenceArtifactCheck(parsed.projectId);
    } else if (parsed.command === "project_visual_evidence_ingest") {
      const inputPaths = resolveVisualEvidenceIngestInputPaths({
        progressJsonPath: parsed.progressJsonPath,
        artifactFilePath: parsed.artifactFilePath,
      });
      const progressJson = await fs.readFile(inputPaths.progressJsonPath, "utf8");
      const artifactBuffer = await fs.readFile(inputPaths.artifactFilePath);
      result = await ctx.governance.ingestProjectVisualEvidence(parsed.projectId, {
        taskId: parsed.taskId,
        sourceEvidenceRef: parsed.sourceEvidenceRef,
        progressJson,
        artifactFilename: path.basename(inputPaths.artifactFilePath),
        artifactContentType: imageContentTypeForPath(inputPaths.artifactFilePath),
        artifactContentBase64: artifactBuffer.toString("base64"),
      });
    } else if (parsed.command === "project_spec_artifact_audit") {
      result = await ctx.governance.getProjectSpecArtifactAudit(parsed.projectId);
    } else if (parsed.command === "project_set_runtime_auth_modes") {
      result = await ctx.governance.setProjectRuntimeAuthModes(parsed.projectId, {
        ...(parsed.claudeAuthMode !== undefined ? { claudeAuthMode: parsed.claudeAuthMode } : {}),
        ...(parsed.codexAuthMode !== undefined ? { codexAuthMode: parsed.codexAuthMode } : {}),
      });
    } else if (parsed.command === "project_set_runtime_system") {
      result = await ctx.governance.setProjectRuntimeSystem(parsed.projectId, {
        agent: parsed.agent,
        agentImpl: parsed.agentImpl,
        providerBillingMode: parsed.providerBillingMode,
        ...(parsed.model !== undefined ? { model: parsed.model } : {}),
        ...(parsed.toolId !== undefined ? { toolId: parsed.toolId } : {}),
        ...(parsed.claudeAuthMode !== undefined ? { claudeAuthMode: parsed.claudeAuthMode } : {}),
        ...(parsed.codexAuthMode !== undefined ? { codexAuthMode: parsed.codexAuthMode } : {}),
      });
    } else if (parsed.command === "project_set_source_snapshot") {
      result = await ctx.governance.setProjectSourceSnapshot(parsed.projectId, parsed.commitSha);
    } else if (parsed.command === "project_set_visual_evidence_mode") {
      result = await ctx.governance.setProjectVisualEvidenceMode(parsed.projectId, parsed.visualEvidenceMode);
    } else if (parsed.command === "project_retry_now") {
      result = await ctx.governance.retryProjectNow(parsed.projectId);
    } else if (parsed.command === "project_agent_off") {
      result = await ctx.governance.setAgentIntent(parsed.projectId, "OFF");
    } else if (parsed.command === "project_agent_on") {
      result = await ctx.governance.setAgentIntent(parsed.projectId, "ON");
    } else if (parsed.command === "project_relaunch") {
      result = await ctx.governance.relaunchProject(parsed.projectId, {});
    } else if (parsed.command === "project_recreate_runtime") {
      result = await ctx.governance.recreateProjectRuntime(parsed.projectId);
    } else if (parsed.command === "project_create") {
      result = await ctx.governance.createPersonalProject(compactObject({
        title: parsed.title,
        spec: parsed.spec,
        agent: parsed.agent,
        agentImpl: parsed.agentImpl,
        model: parsed.model,
        runnerBackend: parsed.runnerBackend,
        providerBillingMode: parsed.providerBillingMode,
        initialBudgetUsd: parsed.initialBudgetUsd,
        claudeAuthMode: parsed.claudeAuthMode,
        codexAuthMode: parsed.codexAuthMode,
        sourceSeedProfile: parsed.sourceSeedProfile,
      }));
    } else if (parsed.command === "tg_spec_target_create") {
      result = await ctx.governance.createTgSpecTargetProject(compactObject({
        title: parsed.title,
        sourceProjectId: parsed.sourceProjectId,
        agent: parsed.agent,
        agentImpl: parsed.agentImpl,
        model: parsed.model,
        runnerBackend: parsed.runnerBackend,
        providerBillingMode: parsed.providerBillingMode,
        initialBudgetUsd: parsed.initialBudgetUsd,
        claudeAuthMode: parsed.claudeAuthMode,
        codexAuthMode: parsed.codexAuthMode,
        sourceSeedProfile: parsed.sourceSeedProfile,
      }));
    } else if (parsed.command === "tg_spec_accepted_artifact_import") {
      const packageFile = resolveCliInputPath(parsed.packageFile);
      const rawPackage = await fs.readFile(packageFile, "utf8");
      const packageBody = JSON.parse(rawPackage) as Record<string, unknown>;
      result = await ctx.governance.importTgSpecAcceptedArtifact(parsed.projectId, packageBody);
    } else if (parsed.command === "tg_spec_launch_configure") {
      result = await ctx.governance.configureTgSpecLaunch(parsed.projectId, compactObject({
        agent: parsed.agent,
        agentImpl: parsed.agentImpl,
        model: parsed.model,
        claudeAuthMode: parsed.claudeAuthMode,
        codexAuthMode: parsed.codexAuthMode,
        runnerBackend: parsed.runnerBackend,
        toolId: parsed.toolId,
        providerBillingMode: parsed.providerBillingMode,
        initialBudgetUsd: parsed.initialBudgetUsd,
        visualEvidenceMode: parsed.visualEvidenceMode,
        visualWorkbenchEvidenceAutomation: parsed.visualWorkbenchEvidenceAutomation,
      }));
    } else if (parsed.command === "tg_spec_launch_start") {
      result = await ctx.governance.startTgSpecLaunch(parsed.projectId);
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (error instanceof CliUsageError) {
      const stream = error.exitCode === 0 ? process.stdout : process.stderr;
      stream.write(`${error.message}\n`);
      process.exit(error.exitCode);
    }
    process.stderr.write(`arena-ctl failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

function buildContext(): ArenaCtlContext {
  const config = loadConfig();
  return {
    config,
    governance: new GovernanceClient(config),
    worker: new WorkerClient(config),
  };
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) {
      throw new CliUsageError(`Unexpected argument: ${arg ?? "(missing)"}`);
    }
    const key = arg.slice(2);
    if (!key) {
      throw new CliUsageError("Empty flag is not supported.");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CliUsageError(`Missing value for --${key}.`);
    }
    flags.set(key, value);
    index += 1;
  }
  return flags;
}

function readRequiredFlag(flags: Map<string, string>, key: string): string {
  const value = flags.get(key);
  flags.delete(key);
  if (!value) {
    throw new CliUsageError(`Missing required --${key}.\n\n${USAGE}`);
  }
  return value;
}

function readOptionalFlag(flags: Map<string, string>, key: string): string | undefined {
  const value = flags.get(key);
  flags.delete(key);
  return value || undefined;
}

function readPositiveIntegerFlag(flags: Map<string, string>, key: string): number {
  const value = flags.get(key);
  flags.delete(key);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliUsageError(`Invalid --${key} ${value}. Expected a positive integer.`);
  }
  return parsed;
}

function readPositiveIntegerFlagWithMax(flags: Map<string, string>, key: string, max: number): number {
  const parsed = readPositiveIntegerFlag(flags, key);
  if (parsed > max) {
    throw new CliUsageError(`Invalid --${key} ${parsed}. Expected an integer from 1 to ${max}.`);
  }
  return parsed;
}

function readPositiveNumberFlag(flags: Map<string, string>, key: string): number {
  const value = flags.get(key);
  flags.delete(key);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliUsageError(`Invalid --${key} ${value}. Expected a positive number.`);
  }
  return parsed;
}

function readRunnerBackendFlag(flags: Map<string, string>, key: string): "local" | "vps" {
  const value = readRequiredFlag(flags, key);
  if (value === "local" || value === "vps") {
    return value;
  }
  throw new CliUsageError(`Invalid --${key} ${value}. Expected local or vps.`);
}

function readEnabledDisabledFlag(flags: Map<string, string>, key: string): boolean {
  const value = readRequiredFlag(flags, key);
  if (value === "enabled") return true;
  if (value === "disabled") return false;
  throw new CliUsageError(`Invalid --${key} ${value}. Expected enabled or disabled.`);
}

function readVisualEvidenceModeFlag(flags: Map<string, string>, key: string): VisualEvidenceMode {
  const value = readRequiredFlag(flags, key);
  if (value === "off" || value === "required" || value === "new_tasks_only") return value;
  throw new CliUsageError(`Invalid --${key} ${value}. Expected off, required or new_tasks_only.`);
}

function readProviderBillingModeFlag(flags: Map<string, string>, key: string): string {
  const value = readRequiredFlag(flags, key);
  if (value === "byok" || value === "platform_credits" || value === "platform_credentials") return value;
  throw new CliUsageError(`Invalid --${key} ${value}. Expected byok, platform_credits or platform_credentials.`);
}

function readNullableAuthModeFlag(
  flags: Map<string, string>,
  key: string,
  allowed: string[],
): string | null {
  const value = readRequiredFlag(flags, key);
  if (value === "null") return null;
  if (allowed.includes(value)) return value;
  throw new CliUsageError(`Invalid --${key} ${value}. Expected ${allowed.join(", ")} or null.`);
}

function readAuthdOperatorDigestProviderFlag(flags: Map<string, string>, key: string): AuthdOperatorDigestProvider {
  const value = readRequiredFlag(flags, key);
  if (value === "codex" || value === "claude") return value;
  throw new CliUsageError(`Invalid --${key} ${value}. Expected codex or claude.`);
}

function assertNoUnknownFlags(flags: Map<string, string>) {
  const unknown = [...flags.keys()];
  if (unknown.length > 0) {
    throw new CliUsageError(`Unsupported flag(s): ${unknown.map((key) => `--${key}`).join(", ")}.`);
  }
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

export function resolveCliInputPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  const invocationCwd = process.env.ARENA_CTL_INVOCATION_CWD?.trim();
  return path.resolve(invocationCwd || process.cwd(), inputPath);
}

export function resolveVisualEvidenceIngestInputPaths(input: {
  progressJsonPath: string;
  artifactFilePath: string;
}): { progressJsonPath: string; artifactFilePath: string } {
  const progressJsonPath = resolveCliInputPath(input.progressJsonPath);
  const artifactFilePath = resolveCliInputPath(input.artifactFilePath);
  const progressNormalized = normalizeFilesystemPath(progressJsonPath);
  const artifactNormalized = normalizeFilesystemPath(artifactFilePath);
  const progressSuffix = "/.arena/progress.json";
  const artifactMarker = "/.ralph/visual-workbench/";

  if (!progressNormalized.endsWith(progressSuffix)) {
    throw new CliUsageError("--progress-json must point to workspace/.arena/progress.json");
  }
  const workspaceRoot = progressNormalized.slice(0, -progressSuffix.length);
  if (!workspaceRoot || !artifactNormalized.startsWith(`${workspaceRoot}${artifactMarker}`)) {
    throw new CliUsageError("--artifact-file must point to the same workspace under .ralph/visual-workbench/");
  }
  if (path.extname(artifactFilePath).toLowerCase() !== ".png") {
    throw new CliUsageError("--artifact-file must be a PNG Workbench capture");
  }

  return { progressJsonPath, artifactFilePath };
}

function normalizeFilesystemPath(inputPath: string): string {
  return path.resolve(inputPath).replace(/\\/g, "/");
}

function imageContentTypeForPath(inputPath: string): string {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".png") return "image/png";
  throw new CliUsageError("--artifact-file must be a PNG Workbench capture");
}

class CliUsageError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
