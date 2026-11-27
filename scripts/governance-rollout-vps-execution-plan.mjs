#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const readyMigrationStatuses = new Set(["compatible", "not_required"]);
const rolloutOrderWithSchedulerTransfer = [
  "validate-candidate-caddy",
  "install-promoted-slot-env",
  "restart-standby-with-promoted-scheduler-role",
  "canary-promoted-standby",
  "save-rollback-caddyfile",
  "promote-active-upstream",
  "post-promotion-canary",
];
const rolloutOrderExternalScheduler = [
  "validate-candidate-caddy",
  "save-rollback-caddyfile",
  "promote-active-upstream",
  "post-promotion-canary",
];
const rollbackOrder = [
  "validate-rollback-caddy",
  "rollback-active-upstream",
  "post-rollback-canary",
];

export function buildVpsExecutionPlan(options = {}) {
  const promotionPlan = normalizeRecord(options.promotionPlan, "promotion plan");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runnerInventory = options.runnerInventory
    ? normalizeRecord(options.runnerInventory, "runner inventory")
    : null;
  const oldSlotService = normalizeOldSlotService(options.oldSlotService);
  const checks = [];

  validatePromotionIdentity(promotionPlan, checks);
  validateRelease(promotionPlan, checks);
  const expectedRolloutOrder = promotionPlan.schedulerTransfer?.requiresStandbyRestart
    ? rolloutOrderWithSchedulerTransfer
    : rolloutOrderExternalScheduler;
  const rolloutCommands = normalizeCommands(
    promotionPlan.commands,
    expectedRolloutOrder,
    "rollout",
    checks,
  );
  const rollbackCommands = normalizeCommands(
    promotionPlan.rollback?.commands,
    rollbackOrder,
    "rollback",
    checks,
  );
  validateRollback(promotionPlan, checks);
  const oldSlotStop = buildOldSlotStopPlan({
    checks,
    oldSlotRetentionReason: options.oldSlotRetentionReason,
    oldSlotService,
    runnerInventory,
  });

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-344",
    mode: "vps-execution-plan",
    generatedAt,
    operator: "scripts/governance-rollout-vps-execution-plan.mjs",
    nonIntervention: true,
    release: {
      sha: promotionPlan.release?.sha ?? null,
      buildId: promotionPlan.release?.buildId ?? null,
      previousRef: promotionPlan.release?.previousRef ?? null,
      migrationStatus: promotionPlan.release?.migrationStatus ?? null,
    },
    target: {
      slot: promotionPlan.target?.slot ?? null,
      upstream: promotionPlan.target?.upstream ?? null,
      promotedSchedulerRole: promotionPlan.target?.promotedSchedulerRole ?? null,
      candidateCaddyfile: promotionPlan.target?.candidateCaddyfile ?? null,
    },
    previous: {
      slot: promotionPlan.previous?.slot ?? null,
      upstream: promotionPlan.previous?.upstream ?? null,
      rollbackCaddyfile: promotionPlan.previous?.rollbackCaddyfile ?? null,
    },
    switchMethod: "caddy-active-upstream",
    oldSlotRetention: {
      required: !oldSlotStop.stopAllowed,
      stopAllowed: oldSlotStop.stopAllowed,
      reason: oldSlotStop.retentionReason,
      evidence: oldSlotStop.evidence,
    },
    oldSlotStop,
    commands: rolloutCommands,
    rollbackCommands,
    expectedReports: {
      promotion: "promotion.json",
      rollback: "rollback.json",
      summary: "summary.md",
    },
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "prepared" : "block",
  };
}

export function writeVpsExecutionArtifacts(plan, outDir) {
  const absoluteOutDir = path.resolve(repoRoot, outDir);
  const planPath = path.join(absoluteOutDir, "vps-execution-plan.json");
  const rolloutScriptPath = path.join(absoluteOutDir, "rollout-execution.sh");
  const rollbackScriptPath = path.join(absoluteOutDir, "rollback-execution.sh");
  const oldSlotStopScriptPath = path.join(absoluteOutDir, "old-slot-stop-execution.sh");
  const summaryPath = path.join(absoluteOutDir, "summary.md");

  fs.mkdirSync(absoluteOutDir, { recursive: true });
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(rolloutScriptPath, renderShellScript(plan, "rollout"), { mode: 0o755 });
  fs.writeFileSync(rollbackScriptPath, renderShellScript(plan, "rollback"), { mode: 0o755 });
  if (plan.oldSlotStop.stopAllowed) {
    fs.writeFileSync(oldSlotStopScriptPath, renderShellScript(plan, "old-slot-stop"), { mode: 0o755 });
  }
  fs.writeFileSync(summaryPath, renderSummary(plan));

  return {
    outDir: absoluteOutDir,
    planPath,
    rolloutScriptPath,
    rollbackScriptPath,
    oldSlotStopScriptPath: plan.oldSlotStop.stopAllowed ? oldSlotStopScriptPath : null,
    summaryPath,
  };
}

function validatePromotionIdentity(promotionPlan, checks) {
  if (promotionPlan.taskId === "RA-344" && promotionPlan.mode === "promotion-plan") {
    checks.push(pass("promotion-plan-identity", "promotion plan identity matches RA-344"));
  } else {
    checks.push(block("promotion-plan-identity", "promotion plan identity is missing or unexpected"));
  }

  if (promotionPlan.decision === "ready-to-promote" && promotionPlan.nonIntervention === true) {
    checks.push(pass("promotion-plan-decision", "promotion plan is ready to promote"));
  } else {
    checks.push(block("promotion-plan-decision", "promotion plan is not ready to promote"));
  }

  if (promotionPlan.router?.switchMethod === "caddy-active-upstream") {
    checks.push(pass("switch-method", "promotion uses Caddy active-upstream switch"));
  } else {
    checks.push(block("switch-method", "promotion plan must use caddy-active-upstream"));
  }
}

function validateRelease(promotionPlan, checks) {
  if (readNonEmpty(promotionPlan.release?.sha) && readNonEmpty(promotionPlan.release?.buildId)) {
    checks.push(pass("release-identity", "promotion plan includes release identity"));
  } else {
    checks.push(block("release-identity", "promotion plan is missing release sha or build id"));
  }

  if (readyMigrationStatuses.has(promotionPlan.release?.migrationStatus)) {
    checks.push(pass("schema-rollback-compatible", "migration status allows code rollback"));
  } else {
    checks.push(block("schema-rollback-compatible", "migration status is not code rollback compatible"));
  }
}

function validateRollback(promotionPlan, checks) {
  if (promotionPlan.rollback?.mode === "rollback-plan" && promotionPlan.rollback?.decision === "prepared") {
    checks.push(pass("rollback-plan", "rollback plan is prepared"));
  } else {
    checks.push(block("rollback-plan", "rollback plan is missing or not prepared"));
  }

  if (promotionPlan.rollback?.schemaCompatible === true) {
    checks.push(pass("rollback-schema-compatible", "rollback plan marks schema compatible"));
  } else {
    checks.push(block("rollback-schema-compatible", "rollback plan is not schema compatible"));
  }
}

function buildOldSlotStopPlan(options) {
  const explicitReason = readNonEmpty(options.oldSlotRetentionReason);
  const pending = {
    status: "not-run",
    stopAllowed: false,
    retentionReason: explicitReason ?? "runner-inventory-pending",
    service: options.oldSlotService,
    command: null,
    evidence: {
      runnerInventory: "not-provided",
      directOldSlotGovernanceUrl: null,
      missingGovernanceUrl: null,
    },
  };

  if (!options.runnerInventory) {
    options.checks.push(pass("runner-inventory-drain", "runner inventory not provided; old slot remains retained"));
    return pending;
  }

  const inventory = options.runnerInventory;
  const evidence = {
    runnerInventory: inventory.decision ?? "unknown",
    directOldSlotGovernanceUrl: inventory.counts?.directOldSlotGovernanceUrl ?? null,
    missingGovernanceUrl: inventory.counts?.missingGovernanceUrl ?? null,
  };
  const identityOk = inventory.taskId === "RA-344"
    && inventory.mode === "runner-inventory"
    && inventory.operator === "scripts/governance-rollout-runner-inventory.mjs"
    && inventory.nonIntervention === true;

  if (!identityOk) {
    options.checks.push(block("runner-inventory-identity", "runner inventory identity is missing or unexpected"));
    return {
      ...pending,
      status: "invalid",
      retentionReason: "runner-inventory-invalid",
      evidence,
    };
  }
  options.checks.push(pass("runner-inventory-identity", "runner inventory identity matches RA-344"));

  const drained = inventory.decision === "drained"
    && inventory.oldSlotStop?.allowed === true
    && Array.isArray(inventory.blockedReasons)
    && inventory.blockedReasons.length === 0
    && inventory.counts?.directOldSlotGovernanceUrl === 0
    && inventory.counts?.missingGovernanceUrl === 0;

  if (!drained) {
    options.checks.push(pass("runner-inventory-drain", "runner inventory requires old slot retention"));
    return {
      ...pending,
      status: "retain-old-slot",
      retentionReason: explicitReason ?? "runner-inventory-blocked",
      evidence,
    };
  }

  options.checks.push(pass("runner-inventory-drain", "runner inventory allows old slot stop"));

  if (!options.oldSlotService) {
    options.checks.push(pass("old-slot-stop-service", "old slot service is not provided; stop script is withheld"));
    return {
      ...pending,
      status: "stop-service-required",
      retentionReason: explicitReason ?? "old-slot-stop-service-required",
      evidence,
    };
  }

  options.checks.push(pass("old-slot-stop-service", "old slot stop service is explicit"));
  return {
    status: "ready-to-stop",
    stopAllowed: true,
    retentionReason: "runner-inventory-drained",
    service: options.oldSlotService,
    command: `systemctl stop ${options.oldSlotService}`,
    evidence,
  };
}

function normalizeCommands(commands, expectedOrder, prefix, checks) {
  if (!Array.isArray(commands)) {
    checks.push(block(`${prefix}-commands`, `${prefix} commands are missing`));
    return [];
  }

  const normalized = commands.map((command, index) => ({
    id: readNonEmpty(command?.id),
    mutates: command?.mutates === true,
    command: readCommand(command?.command),
    order: index + 1,
  }));
  const ids = normalized.map((command) => command.id);

  if (JSON.stringify(ids) === JSON.stringify(expectedOrder)) {
    checks.push(pass(`${prefix}-command-order`, `${prefix} command order is explicit`));
  } else {
    checks.push(block(
      `${prefix}-command-order`,
      `${prefix} command order is ${ids.join(", ") || "missing"}, expected ${expectedOrder.join(", ")}`,
    ));
  }

  for (const command of normalized) {
    if (!command.id || !expectedOrder.includes(command.id)) {
      checks.push(block(`${prefix}-command-${command.order}`, `unexpected command id ${command.id || "missing"}`));
    } else if (!command.command) {
      checks.push(block(`${prefix}-command-${command.id}`, "command text is missing or unsafe"));
    } else {
      checks.push(pass(`${prefix}-command-${command.id}`, `${prefix} command ${command.id} is renderable`));
    }
  }

  return normalized;
}

function renderShellScript(plan, mode) {
  const commands = mode === "rollback"
    ? plan.rollbackCommands
    : mode === "old-slot-stop"
      ? [{ id: "stop-old-slot", command: plan.oldSlotStop.command }]
      : plan.commands;
  const title = mode === "rollback" ? "rollback" : mode === "old-slot-stop" ? "old-slot-stop" : "rollout";
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    `# Generated by scripts/governance-rollout-vps-execution-plan.mjs for RA-344 ${title}.`,
    "# The generator is non-intervention; running this script mutates live VPS state.",
    "# Review vps-execution-plan.json before executing.",
    "",
    ...commands.flatMap((command) => [
      `echo 'RA-344 ${title}: ${command.id}' >&2`,
      command.command,
      "",
    ]),
  ].join("\n");
}

function renderSummary(plan) {
  return [
    "# RA-344 VPS Execution Plan",
    "",
    `Decision: ${plan.decision}`,
    `Release: ${plan.release.sha ?? "unknown"}`,
    `Target: ${plan.target.slot ?? "unknown"} ${plan.target.upstream ?? "unknown"}`,
    `Previous: ${plan.previous.slot ?? "unknown"} ${plan.previous.upstream ?? "unknown"}`,
    "",
    "Old slot retention:",
    `- required: ${plan.oldSlotRetention.required}`,
    `- stopAllowed: ${plan.oldSlotRetention.stopAllowed}`,
    `- reason: ${plan.oldSlotRetention.reason}`,
    `- stopStatus: ${plan.oldSlotStop.status}`,
    `- stopService: ${plan.oldSlotStop.service ?? "not-configured"}`,
    "",
    "Reports:",
    `- ${plan.expectedReports.promotion}`,
    `- ${plan.expectedReports.rollback}`,
    `- ${plan.expectedReports.summary}`,
    "",
  ].join("\n");
}

function normalizeRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value;
}

function readCommand(value) {
  const command = readNonEmpty(value);
  if (!command || command.includes("\n") || command.includes("\0")) {
    return null;
  }
  return command;
}

function readJsonFile(filePath, name) {
  const absolutePath = path.resolve(repoRoot, filePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeOldSlotService(value) {
  const raw = readNonEmpty(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.endsWith(".service") ? raw.slice(0, -".service".length) : raw;
  if (!/^governance-web(@[A-Za-z0-9_.-]+)?$/.test(normalized)) {
    throw new Error("old slot service must be governance-web or governance-web@<slot>");
  }
  return normalized;
}

function readNonEmpty(value) {
  const normalized = `${value ?? ""}`.trim();
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
    promotionPlanPath: null,
    oldSlotRetentionReason: null,
    runnerInventoryPath: null,
    oldSlotService: null,
    outDir: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--promotion-plan") {
      parsed.promotionPlanPath = argv[++index];
    } else if (arg === "--old-slot-retention-reason") {
      parsed.oldSlotRetentionReason = argv[++index];
    } else if (arg === "--runner-inventory") {
      parsed.runnerInventoryPath = argv[++index];
    } else if (arg === "--old-slot-service") {
      parsed.oldSlotService = argv[++index];
    } else if (arg === "--out-dir") {
      parsed.outDir = argv[++index];
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/governance-rollout-vps-execution-plan.mjs --promotion-plan <promotion-plan.json> --out-dir <path> [options]

Options:
  --old-slot-retention-reason <reason>  Explain why old slot cannot be stopped automatically.
  --runner-inventory <runner-inventory.json>
                                      Optional drain proof for old-slot stop planning.
  --old-slot-service <service>        Explicit systemd service to stop after drain proof.
  --json                                Print full execution plan JSON.
`);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    if (!args.promotionPlanPath) throw new Error("--promotion-plan is required");
    if (!args.outDir) throw new Error("--out-dir is required");

    const plan = buildVpsExecutionPlan({
      promotionPlan: readJsonFile(args.promotionPlanPath, "promotion plan"),
      oldSlotRetentionReason: args.oldSlotRetentionReason,
      runnerInventory: args.runnerInventoryPath
        ? readJsonFile(args.runnerInventoryPath, "runner inventory")
        : null,
      oldSlotService: args.oldSlotService,
    });
    const written = writeVpsExecutionArtifacts(plan, args.outDir);
    const output = { ...plan, written };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`RA-344 VPS execution plan: ${plan.decision}`);
      console.log(`target: ${plan.target.slot} ${plan.target.upstream}`);
      console.log(`report: ${written.planPath}`);
      if (plan.blockedReasons.length > 0) {
        console.log("blocked reasons:");
        for (const reason of plan.blockedReasons) {
          console.log(`- ${reason}`);
        }
      }
    }

    process.exit(plan.decision === "prepared" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
