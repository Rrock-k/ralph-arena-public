#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arenaCtlCli = path.join(repoRoot, "services/arena-ctl/cli.sh");
const expectedCandidateScanSchema = "ra-356.project-stage-candidates.v1";
const expectedSnapshotSchema = "ra-356.project-stage-snapshot.v1";
const proofLikeErrorCategories = new Set(["auth", "infra"]);

export function buildRa268ProofCarrierGateReport(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const candidateScan = options.candidateScan ?? null;
  const selectedSnapshots = Array.isArray(options.selectedSnapshots) ? options.selectedSnapshots : [];
  const snapshotIndex = indexSelectedSnapshots(selectedSnapshots);
  const checks = [];

  validateCandidateScan(candidateScan, checks);

  const candidateDecisions = readCandidateProjects(candidateScan).flatMap((candidateProject) => {
    const tasks = Array.isArray(candidateProject.taskCandidates) ? candidateProject.taskCandidates : [];
    return tasks.map((task) => classifyCandidateTask({
      candidateProject,
      task,
      selectedSnapshot: snapshotIndex.get(snapshotKey(candidateProject.project?.id, task?.id)) ?? null,
    }));
  });

  const eligibleCarrierCount = candidateDecisions.filter((decision) => decision.verdict === "eligible").length;
  const missingSelectedSnapshotCount = candidateDecisions
    .filter((decision) => decision.verdict === "needs_selected_snapshot").length;

  if (eligibleCarrierCount > 0) {
    checks.push(pass("safe-proof-carrier", `${eligibleCarrierCount} safe stale-runtime-auth proof carrier(s) available`));
  } else {
    checks.push(block("safe-proof-carrier", "no safe stale-runtime-auth proof carrier is available"));
  }

  if ((candidateScan?.scan?.scanFailureCount ?? 0) > 0 && eligibleCarrierCount === 0) {
    checks.push(block(
      "candidate-scan-failures",
      `candidate scan had ${candidateScan.scan.scanFailureCount} failure(s), so no-carrier evidence is incomplete`,
    ));
  } else if ((candidateScan?.scan?.scanFailureCount ?? 0) > 0) {
    checks.push(pass(
      "candidate-scan-failures",
      "candidate scan had failures, but a selected safe carrier is already available",
    ));
  }

  if (missingSelectedSnapshotCount > 0) {
    checks.push(block(
      "selected-snapshots",
      `${missingSelectedSnapshotCount} resume candidate(s) still need selected project_stage_snapshot evidence`,
    ));
  } else {
    checks.push(pass("selected-snapshots", "selected snapshot evidence is present for classified resume candidates"));
  }

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-268",
    schemaVersion: "ra-268.stale-runtime-auth-proof-carrier.v1",
    mode: "stale-runtime-auth-proof-carrier-gate",
    generatedAt,
    operator: "scripts/ra268-proof-carrier-gate.mjs",
    ownerBoundary: "scripts.ra268-proof-carrier-gate",
    sourceBoundary: "arena-ctl.project-stage-candidates + arena-ctl.project-stage-snapshot",
    nonIntervention: true,
    activeServiceMutation: false,
    target: {
      projectLimit: options.projectLimit ?? null,
      tail: options.tail ?? null,
      selectedSnapshotCount: selectedSnapshots.length,
    },
    scan: summarizeCandidateScan(candidateScan),
    candidateDecisions,
    eligibleCarrierCount,
    checks,
    blockedReasons,
    decision: eligibleCarrierCount > 0 && blockedReasons.length === 0 ? "candidate_available" : "block",
  };
}

export function classifyCandidateTask(input = {}) {
  const candidateProject = input.candidateProject ?? {};
  const task = input.task ?? {};
  const selectedSnapshot = input.selectedSnapshot ?? null;
  const blockers = [];
  const notes = [];
  const projectId = readString(candidateProject.project?.id);
  const taskId = readString(task.id);
  const mode = readString(task.recommendedExecutorMode);

  if (mode !== "resume_interrupted") {
    blockers.push(`executor_mode_${mode || "missing"}_does_not_probe_stale_runtime_auth`);
  }

  addCandidateProjectBlockers(candidateProject, blockers);

  if (mode === "resume_interrupted" && !selectedSnapshot) {
    blockers.push("selected_snapshot_missing");
  } else if (selectedSnapshot) {
    addSelectedSnapshotBlockers({ selectedSnapshot, taskId, blockers, notes });
  }

  const verdict = blockers.length === 0
    ? "eligible"
    : blockers.includes("selected_snapshot_missing") && mode === "resume_interrupted"
      ? "needs_selected_snapshot"
      : "reject";

  return {
    project: {
      id: projectId,
      name: candidateProject.project?.name ?? null,
    },
    task: {
      id: taskId,
      displayTitle: task.displayTitle ?? null,
      recommendedExecutorMode: mode,
      status: task.status ?? null,
    },
    proofClass: verdict === "eligible" ? "stale_runtime_auth_probe_carrier" : "not_stale_runtime_auth_carrier",
    verdict,
    blockers,
    notes,
    selectedSnapshot: selectedSnapshot ? summarizeSelectedSnapshot(selectedSnapshot) : null,
  };
}

function addCandidateProjectBlockers(candidateProject, blockers) {
  const lifecycleClass = readString(candidateProject.lifecycle?.classification);
  if (lifecycleClass === "parked") {
    blockers.push("project_is_parked_requires_app_on");
  } else if (lifecycleClass === "active_broken") {
    blockers.push("project_is_active_broken_requires_repair_or_relaunch");
  }

  if (candidateProject.source?.syncWouldBlock === true) {
    blockers.push("source_sync_would_block");
  }
  if (candidateProject.source?.blockingPathCount > 0) {
    blockers.push("source_has_blocking_paths");
  }

  if (candidateProject.acceptedArtifact?.classification !== "current_v1_artifact") {
    blockers.push(`accepted_artifact_${candidateProject.acceptedArtifact?.classification ?? "missing"}`);
  }
  if (candidateProject.acceptedArtifact?.runnerReady !== true) {
    blockers.push("accepted_artifact_runner_not_ready");
  }
}

function addSelectedSnapshotBlockers(input) {
  const { selectedSnapshot, taskId, blockers, notes } = input;
  if (selectedSnapshot.schemaVersion !== expectedSnapshotSchema) {
    blockers.push("selected_snapshot_schema_mismatch");
  }
  if (selectedSnapshot.selectedTaskId !== taskId) {
    blockers.push("selected_snapshot_task_mismatch");
  }

  const lifecycleRecommended = readString(selectedSnapshot.lifecycleContext?.recommendedNextAction);
  if (lifecycleRecommended && lifecycleRecommended !== "no_action" && lifecycleRecommended !== "launch_or_resume") {
    blockers.push(`selected_snapshot_recommends_${lifecycleRecommended}`);
  }

  if (selectedSnapshot.source?.gitSyncRisk?.wouldBlockSync === true) {
    blockers.push("selected_snapshot_source_sync_would_block");
  }
  if (selectedSnapshot.acceptedArtifactAudit?.classification !== "current_v1_artifact") {
    blockers.push(`selected_snapshot_accepted_artifact_${selectedSnapshot.acceptedArtifactAudit?.classification ?? "missing"}`);
  }
  if (selectedSnapshot.acceptedArtifactAudit?.runnerReady !== true) {
    blockers.push("selected_snapshot_runner_not_ready");
  }

  const readback = selectedSnapshot.providerSessions?.selectedTaskCheckpointReadback ?? null;
  if (!readback || typeof readback !== "object") {
    blockers.push("provider_checkpoint_readback_missing");
  } else {
    if (readback.canPrepareExecutor !== true) {
      blockers.push(`provider_checkpoint_${readback.reasonCode ?? readback.status ?? "blocked"}`);
    }
    if (readback.reasonCode !== "failed_error_checkpoint_ready") {
      blockers.push(`provider_checkpoint_reason_${readback.reasonCode ?? "missing"}`);
    }
  }

  const sessions = Array.isArray(selectedSnapshot.providerSessions?.selectedTaskSessions)
    ? selectedSnapshot.providerSessions.selectedTaskSessions
    : [];
  const proofSession = sessions.find((session) => {
    return session?.outcome === "error" && proofLikeErrorCategories.has(readString(session.errorCategory) ?? "");
  });
  if (!proofSession) {
    blockers.push("no_auth_or_infra_error_checkpoint");
  } else {
    notes.push(`proof-like checkpoint errorCategory=${proofSession.errorCategory}`);
  }
}

function validateCandidateScan(scan, checks) {
  if (!scan || typeof scan !== "object" || Array.isArray(scan)) {
    checks.push(block("candidate-scan", "project_stage_candidates report is missing"));
    return;
  }
  if (scan.schemaVersion === expectedCandidateScanSchema) {
    checks.push(pass("candidate-scan-schema", "candidate scan schema matches project_stage_candidates"));
  } else {
    checks.push(block("candidate-scan-schema", "candidate scan schema is missing or unexpected"));
  }
  if (scan.mode === "read_only" && scan.ownerBoundary === "arena-ctl.project-stage-candidates") {
    checks.push(pass("candidate-scan-boundary", "candidate scan is the read-only owner report"));
  } else {
    checks.push(block("candidate-scan-boundary", "candidate scan is not the expected read-only owner report"));
  }
  if (scan.scan?.truncated === true) {
    checks.push(block("candidate-scan-completeness", "candidate scan was truncated"));
  } else {
    const failureCount = scan.scan?.scanFailureCount ?? 0;
    const detail = failureCount > 0 ? ` with ${failureCount} scan failure(s)` : "";
    checks.push(pass("candidate-scan-completeness", `candidate scan was not truncated${detail}`));
  }
}

async function runLiveReport(options = {}) {
  const projectLimit = Number(options.projectLimit ?? 80);
  const tail = Number(options.tail ?? 80);
  const candidateScan = runArenaCtlJson([
    "project_stage_candidates",
    "--limit",
    String(projectLimit),
    "--tail",
    String(tail),
  ]);
  const selectedSnapshots = [];
  for (const candidateProject of readCandidateProjects(candidateScan)) {
    for (const task of Array.isArray(candidateProject.taskCandidates) ? candidateProject.taskCandidates : []) {
      if (task?.recommendedExecutorMode !== "resume_interrupted") continue;
      selectedSnapshots.push(runArenaCtlJson([
        "project_stage_snapshot",
        "--project-id",
        String(candidateProject.project.id),
        "--task-id",
        String(task.id),
        "--tail",
        String(tail),
      ]));
    }
  }
  return buildRa268ProofCarrierGateReport({
    candidateScan,
    selectedSnapshots,
    projectLimit,
    tail,
  });
}

function runArenaCtlJson(args) {
  const result = spawnSync(arenaCtlCli, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || `arena-ctl exited ${result.status}`).trim();
    throw new Error(`arena-ctl ${args[0]} failed: ${output}`);
  }
  return JSON.parse(result.stdout);
}

function readCandidateProjects(scan) {
  return Array.isArray(scan?.candidateProjects) ? scan.candidateProjects : [];
}

function indexSelectedSnapshots(snapshots) {
  const index = new Map();
  for (const snapshot of snapshots) {
    const key = snapshotKey(snapshot?.projectId, snapshot?.selectedTaskId);
    if (key) index.set(key, snapshot);
  }
  return index;
}

function snapshotKey(projectId, taskId) {
  const normalizedProjectId = readString(projectId);
  const normalizedTaskId = readString(taskId);
  return normalizedProjectId && normalizedTaskId ? `${normalizedProjectId}::${normalizedTaskId}` : null;
}

function summarizeCandidateScan(scan) {
  if (!scan || typeof scan !== "object" || Array.isArray(scan)) return null;
  return {
    schemaVersion: scan.schemaVersion ?? null,
    generatedAt: scan.generatedAt ?? null,
    ownerBoundary: scan.ownerBoundary ?? null,
    mode: scan.mode ?? null,
    scan: scan.scan ?? null,
    candidateProjectCount: Array.isArray(scan.candidateProjects) ? scan.candidateProjects.length : null,
    scanFailureCount: Array.isArray(scan.scanFailures) ? scan.scanFailures.length : null,
    scanFailures: Array.isArray(scan.scanFailures) ? scan.scanFailures : null,
  };
}

function summarizeSelectedSnapshot(snapshot) {
  return {
    projectId: snapshot.projectId ?? null,
    selectedTaskId: snapshot.selectedTaskId ?? null,
    lifecycleClassification: snapshot.lifecycleContext?.classification ?? null,
    recommendedNextAction: snapshot.lifecycleContext?.recommendedNextAction ?? null,
    sourceSyncWouldBlock: snapshot.source?.gitSyncRisk?.wouldBlockSync ?? null,
    acceptedArtifactClassification: snapshot.acceptedArtifactAudit?.classification ?? null,
    runnerReady: snapshot.acceptedArtifactAudit?.runnerReady ?? null,
    checkpoint: snapshot.providerSessions?.selectedTaskCheckpointReadback ?? null,
    selectedTaskSessions: Array.isArray(snapshot.providerSessions?.selectedTaskSessions)
      ? snapshot.providerSessions.selectedTaskSessions.map((session) => ({
        agent: session.agent ?? null,
        model: session.model ?? null,
        outcome: session.outcome ?? null,
        errorCategory: session.errorCategory ?? null,
        reason: session.reason ?? null,
        updatedAt: session.updatedAt ?? null,
      }))
      : null,
  };
}

function readJsonFile(filePath) {
  const absolutePath = path.resolve(repoRoot, filePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function readString(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function pass(id, reason) {
  return { id, status: "pass", reason };
}

function block(id, reason) {
  return { id, status: "block", reason };
}

function parseArgs(argv) {
  const parsed = {
    projectLimit: 80,
    tail: 80,
    candidatesFile: null,
    snapshotFiles: [],
    reportPath: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") {
      parsed.projectLimit = Number(argv[++index]);
    } else if (arg === "--tail") {
      parsed.tail = Number(argv[++index]);
    } else if (arg === "--candidates-file") {
      parsed.candidatesFile = argv[++index];
    } else if (arg === "--snapshot-file") {
      parsed.snapshotFiles.push(argv[++index]);
    } else if (arg === "--report") {
      parsed.reportPath = argv[++index];
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.projectLimit) || parsed.projectLimit < 1 || parsed.projectLimit > 100) {
    throw new Error("--limit must be an integer from 1 to 100");
  }
  if (!Number.isInteger(parsed.tail) || parsed.tail < 1 || parsed.tail > 5000) {
    throw new Error("--tail must be an integer from 1 to 5000");
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/ra268-proof-carrier-gate.mjs [options]

Read-only RA-268 gate for stale-runtime-auth proof carrier selection. By
default it runs arena-ctl project_stage_candidates and selected
project_stage_snapshot reads for resume candidates. It never selects a task,
runs executor, calls providers, writes source, changes lifecycle, retries,
relaunches or recreates runtime.

Options:
  --limit <projects>                 Project scan limit, default: 80.
  --tail <lines>                     Snapshot log tail, default: 80.
  --candidates-file <path>           Use an existing project_stage_candidates JSON report.
  --snapshot-file <path>             Add a selected project_stage_snapshot JSON report.
                                     May be repeated.
  --report <path>                    Write report JSON.
  --json                             Print report JSON.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const report = args.candidatesFile
    ? buildRa268ProofCarrierGateReport({
      candidateScan: readJsonFile(args.candidatesFile),
      selectedSnapshots: args.snapshotFiles.map(readJsonFile),
      projectLimit: args.projectLimit,
      tail: args.tail,
    })
    : await runLiveReport(args);

  if (args.reportPath) {
    const reportPath = path.resolve(repoRoot, args.reportPath);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`RA-268 proof carrier gate: ${report.decision}`);
    for (const reason of report.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }
  if (report.decision !== "candidate_available") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
