#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

const migrationDir = "apps/governance-platform/prisma/migrations";
const governancePackagePath = "apps/governance-platform/package.json";
const compatibilityMatrixPath = "infra/governance-rollout/compatibility-matrix.json";
const readinessCanaryScriptPath = "scripts/governance-rollout-canary.mjs";
const readinessCanaryTestPath = "scripts/governance-rollout-canary.test.mjs";
const routeProbesScriptPath = "scripts/governance-rollout-route-probes.mjs";
const routeProbesTestPath = "scripts/governance-rollout-route-probes.test.mjs";
const routeCanaryScriptPath = "scripts/governance-rollout-route-canary.mjs";
const routeCanaryTestPath = "scripts/governance-rollout-route-canary.test.mjs";
const localTopologyScriptPath = "scripts/governance-rollout-local-topology.mjs";
const localTopologyTestPath = "scripts/governance-rollout-local-topology.test.mjs";
const slotRolloutPlanScriptPath = "scripts/governance-rollout-slot-plan.mjs";
const slotRolloutPlanTestPath = "scripts/governance-rollout-slot-plan.test.mjs";
const promotionPlanScriptPath = "scripts/governance-rollout-promotion-plan.mjs";
const promotionPlanTestPath = "scripts/governance-rollout-promotion-plan.test.mjs";
const vpsExecutionPlanScriptPath = "scripts/governance-rollout-vps-execution-plan.mjs";
const vpsExecutionPlanTestPath = "scripts/governance-rollout-vps-execution-plan.test.mjs";
const runnerInventoryScriptPath = "scripts/governance-rollout-runner-inventory.mjs";
const runnerInventoryTestPath = "scripts/governance-rollout-runner-inventory.test.mjs";
const dbSafetyPlanScriptPath = "scripts/governance-rollout-db-safety-plan.mjs";
const dbSafetyPlanTestPath = "scripts/governance-rollout-db-safety-plan.test.mjs";
const evidenceBundleScriptPath = "scripts/governance-rollout-evidence-bundle.mjs";
const evidenceBundleTestPath = "scripts/governance-rollout-evidence-bundle.test.mjs";
const dryRunScriptPath = "scripts/governance-rollout-dry-run.mjs";
const dryRunTestPath = "scripts/governance-rollout-dry-run.test.mjs";
const startupMigrationFiles = [
  "docker-compose.local.yml",
  "apps/governance-platform/docker-entrypoint.sh",
];
const deployMigrationFiles = [
  "infra/vps/scripts/05-deploy.sh",
];
const requiredSecretKeys = [
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "AUTHD_SECRET",
  "RUNNER_WEBHOOK_SECRET",
  "WORKER_SECRET",
  "CRON_SECRET",
  "API_PROXY_SECRET",
];
const productionBuildInputPrefixes = [
  "apps/governance-platform/",
  "packages/contracts/",
  "packages/loops/ralph-runtime/",
];
const productionBuildInputFiles = [
  ".dockerignore",
  "package.json",
  "package-lock.json",
];
const directStaticPublicInputPrefixes = [
  "apps/governance-platform/public/short-html/",
];
const rolloutControlInputPrefixes = [
  "infra/caddy/",
  "infra/governance-rollout/",
  "infra/vps/",
  "scripts/",
];
const rolloutControlInputFiles = [
  "docker-compose.local.yml",
];
const compatibilityPromotionBlockers = [
  "required-fields",
  "enum-values",
  "auth-headers",
  "response-content-type",
];
const requiredCompatibilityEdges = [
  {
    id: "worker-claim",
    surface: "POST /api/internal/runtime-intents/claim",
    oldToNew: "specified",
    newToOld: "not-required-ok",
  },
  {
    id: "worker-complete",
    surface: "POST /api/internal/runtime-intents/:id/complete",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "runner-init",
    surface: "internal init payload",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "runner-status",
    surface: "/api/internal/projects/:id/status",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "runner-specs",
    surface: "specs/diff endpoints",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "runner-assets",
    surface: "asset list/download endpoints",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "runner-logs",
    surface: "logs push endpoint",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "runner-events",
    surface: "events push/poll endpoints",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "runner-progress",
    surface: "/api/internal/project-progress",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "runner-terminal",
    surface: "terminal endpoint",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "preview-gate",
    surface: "/api/auth/preview-gate",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "auth-session",
    surface: "/api/auth/session",
    oldToNew: "specified",
    newToOld: "specified",
  },
  {
    id: "api-proxy",
    surface: "provider proxy routes",
    oldToNew: "specified",
    newToOld: "specified",
  },
];

export function classifyMigrationSql(sql, options = {}) {
  const normalized = stripSqlComments(sql);
  const statements = splitSqlStatements(normalized);
  const statementResults = statements.map(classifySqlStatement).filter(Boolean);
  const reasons = unique(statementResults.flatMap((result) => result.reasons));
  const hasDestructive = statementResults.some((result) => result.classification === "destructive");
  const hasUnknown = statementResults.some((result) => result.classification === "unknown");
  const hasAdditive = statementResults.some((result) => result.classification === "additive-compatible");

  let classification = "additive-compatible";
  if (hasDestructive) {
    classification = "destructive";
  } else if (hasUnknown) {
    classification = "unknown";
  } else if (!hasAdditive) {
    classification = "additive-compatible";
    reasons.push("empty or comment-only migration");
  }

  return {
    path: options.path ?? null,
    classification,
    reasons,
    statementCount: statements.length,
  };
}

export function classifyMigrationFiles(files, options = {}) {
  const fileResults = files.map((file) => {
    const sql = fs.readFileSync(file.absolutePath, "utf8");
    return classifyMigrationSql(sql, { path: file.relativePath });
  });
  if (files.length === 0 && options.inputProvided) {
    return {
      classifier: "passed",
      classification: "additive-compatible",
      files: [],
      requiredAnnotation: false,
      requiresMaintenanceWindow: false,
      requiresTwoStepMigration: false,
      summary: "no migration SQL changed",
    };
  }
  const hasDestructive = fileResults.some((file) => file.classification === "destructive");
  const hasUnknown = fileResults.some((file) => file.classification === "unknown");
  const hasAdditive = fileResults.some((file) => file.classification === "additive-compatible");
  const classification = hasDestructive
    ? "destructive"
    : hasUnknown
      ? "unknown"
      : hasAdditive
        ? "additive-compatible"
        : "unknown";

  return {
    classifier: files.length > 0 ? (classification === "additive-compatible" ? "passed" : "blocked") : "not-run",
    classification,
    files: fileResults,
    requiredAnnotation: classification === "unknown",
    requiresMaintenanceWindow: classification === "destructive",
    requiresTwoStepMigration: classification === "destructive",
  };
}

export function validateCompatibilityMatrix(matrix) {
  const failures = [];
  const entries = Array.isArray(matrix?.entries) ? matrix.entries : [];
  const byId = new Map(entries.map((entry) => [entry?.id, entry]));
  const topLevelBlockers = Array.isArray(matrix?.promotionBlockers)
    ? matrix.promotionBlockers
    : [];

  if (matrix?.schemaVersion !== "ra-344.governance-wire-compatibility.v1") {
    failures.push("schemaVersion must be ra-344.governance-wire-compatibility.v1");
  }
  if (matrix?.taskId !== "RA-344") {
    failures.push("taskId must be RA-344");
  }
  if (matrix?.mutatingLiveChecksAllowed !== false) {
    failures.push("mutatingLiveChecksAllowed must be false");
  }
  for (const blocker of compatibilityPromotionBlockers) {
    if (!topLevelBlockers.includes(blocker)) {
      failures.push(`promotionBlockers must include ${blocker}`);
    }
  }

  const missingEdges = [];
  const invalidEdges = [];
  for (const required of requiredCompatibilityEdges) {
    const entry = byId.get(required.id);
    if (!entry) {
      missingEdges.push(required.id);
      continue;
    }
    if (entry.surface !== required.surface) {
      invalidEdges.push(`${required.id}: surface must be ${required.surface}`);
    }
    validateCompatibilityDirection(entry, required, "oldToNew", invalidEdges);
    validateCompatibilityDirection(entry, required, "newToOld", invalidEdges);
  }
  if (missingEdges.length > 0) {
    failures.push(`missing required compatibility edge(s): ${missingEdges.join(", ")}`);
  }
  failures.push(...invalidEdges);

  return {
    matrixResult: failures.length === 0 ? "passed" : "blocked",
    schemaVersion: matrix?.schemaVersion ?? "missing",
    requiredEdges: requiredCompatibilityEdges.length,
    checkedEdges: entries.length,
    blockedRoutes: failures,
    missingEdges,
  };
}

export function validateDbSafetyReport(report, expectedMode) {
  const failures = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return {
      status: "blocked",
      failures: ["report must be a JSON object"],
    };
  }
  if (report.taskId !== "RA-344") {
    failures.push("taskId must be RA-344");
  }
  if (report.mode !== expectedMode) {
    failures.push(`mode must be ${expectedMode}`);
  }
  if (report.nonIntervention !== true) {
    failures.push("nonIntervention must be true");
  }
  if (report.decision !== "passed") {
    failures.push("decision must be passed");
  }

  if (expectedMode === "db-backup") {
    if (!hasText(report.artifact?.path)) {
      failures.push("artifact.path is required");
    }
    if (!isSha256(report.artifact?.sha256)) {
      failures.push("artifact.sha256 must be a sha256 hex digest");
    }
    if (!hasText(report.source?.database)) {
      failures.push("source.database is required");
    }
  }

  if (expectedMode === "scratch-restore") {
    if (!isSha256(report.sourceBackupSha256)) {
      failures.push("sourceBackupSha256 must be a sha256 hex digest");
    }
    if (report.target?.kind !== "scratch-postgres") {
      failures.push("target.kind must be scratch-postgres");
    }
    if (report.restore?.status !== "passed") {
      failures.push("restore.status must be passed");
    }
  }

  return {
    status: failures.length === 0 ? "passed" : "blocked",
    failures,
  };
}

export function buildStaticPreflightReport(options = {}) {
  const root = options.repoRoot ? path.resolve(options.repoRoot) : repoRoot;
  const now = options.generatedAt ?? new Date().toISOString();
  const checks = [];
  const releaseSha = readGitOutput(root, ["rev-parse", "--short=12", "HEAD"]) || "unknown";
  const dirtyStatus = readGitStatusShort(root);
  const dirtyClassification = classifyDirtyWorktreeEntries(dirtyStatus);

  const buildArtifact = inspectBuildArtifact(root, checks);
  const runtimeDefault = inspectRuntimeDefault(root, checks);
  const router = inspectRouter(root, checks);
  const secrets = inspectSecrets(root, checks);
  const scheduler = inspectScheduler(root, checks);
  const migration = inspectMigrationGate(root, options, checks);
  const dbSafetyPlan = inspectDbSafetyPlan(root, checks);
  const compatibility = inspectCompatibility(root, checks);
  const canary = inspectCanaryHarness(root, checks);
  const routeProbeCollector = inspectRouteProbeCollector(root, checks);
  const routeCanaryMatrix = inspectRouteCanaryMatrix(root, checks);
  const localTopologyInspector = inspectLocalTopologyInspector(root, checks);
  const localTopologyEvidence = inspectLocalTopologyEvidence(root, options, checks);
  const slotRollout = inspectSlotRolloutPlan(root, checks);
  const promotionPlan = inspectPromotionPlan(root, checks);
  const vpsExecutionPlan = inspectVpsExecutionPlan(root, checks);
  const runnerInventory = inspectRunnerInventory(root, checks);
  const evidenceBundle = inspectEvidenceBundle(root, checks);
  const rolloutDryRun = inspectRolloutDryRun(root, checks);
  const dirtyWorktree = buildDirtyWorktreeGate(dirtyClassification, runtimeDefault);

  if (dirtyWorktree.clean) {
    checks.push(pass("dirty-worktree", "git worktree is clean", dirtyWorktree));
  } else if (!dirtyWorktree.allowed) {
    checks.push(block(
      "dirty-worktree",
      "preflight requires no rollout-affecting dirty worktree paths before rollout evidence is accepted",
      dirtyWorktree,
    ));
  } else {
    checks.push(pass(
      "dirty-worktree",
      "dirty worktree has no governance image or rollout-control blockers; direct public static inputs are reported separately",
      dirtyWorktree,
    ));
  }

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-344",
    mode: "static",
    releaseSha,
    generatedAt: now,
    operator: "scripts/governance-rollout-preflight.mjs",
    nonIntervention: true,
    dirtyWorktree,
    buildArtifact,
    runtimeDefault,
    router,
    secrets,
    scheduler,
    migration,
    dbSafetyPlan,
    compatibility,
    canary,
    routeProbeCollector,
    routeCanaryMatrix,
    localTopologyInspector,
    localTopologyEvidence,
    slotRollout,
    promotionPlan,
    vpsExecutionPlan,
    runnerInventory,
    evidenceBundle,
    rolloutDryRun,
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "allow-standby" : "block",
  };
}

export function buildMigrationGateReport(options = {}) {
  const root = options.repoRoot ? path.resolve(options.repoRoot) : repoRoot;
  const now = options.generatedAt ?? new Date().toISOString();
  const checks = [];
  const releaseSha = readGitOutput(root, ["rev-parse", "--short=12", "HEAD"]) || "unknown";
  const classification = inspectMigrationClassification(root, options);
  const migration = {
    ...classification,
    ...inspectMigrationSafetyEvidence(root, options, classification, checks),
  };
  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);
  return {
    taskId: "RA-344",
    mode: "migration-gate",
    releaseSha,
    generatedAt: now,
    operator: "scripts/governance-rollout-preflight.mjs --migration-gate",
    nonIntervention: true,
    migration,
    checks,
    blockedReasons,
    decision: migration.classifier === "passed" && blockedReasons.length === 0 ? "allow-migration" : "block",
  };
}

function inspectBuildArtifact(root, checks) {
  const packageJson = readJsonFile(root, governancePackagePath);
  const nextConfig = readRepoFile(root, "apps/governance-platform/next.config.mjs");
  const startStandalone = fileExists(root, "apps/governance-platform/scripts/start-standalone.mjs");
  const readinessRoute = fileExists(root, "apps/governance-platform/src/app/api/readiness/route.ts");
  const dockerfile = fileExists(root, "apps/governance-platform/Dockerfile");
  const localProductionDockerfilePath = "apps/governance-platform/Dockerfile.local-production";
  const localProductionDockerfile = readRepoFile(root, localProductionDockerfilePath);
  const dockerignore = readRepoFile(root, ".dockerignore");
  const publicAssets = fileExists(root, "apps/governance-platform/public");
  const directStaticPublicAssets = fileExists(root, "apps/governance-platform/public/short-html");
  const migrations = fileExists(root, migrationDir);

  if (packageJson?.scripts?.build === "next build") {
    checks.push(pass("build-command", "governance package has explicit next build command"));
  } else {
    checks.push(block("build-command", "governance package build command is missing or unexpected"));
  }

  if (packageJson?.scripts?.start === "node scripts/start-standalone.mjs" && startStandalone) {
    checks.push(pass("standalone-start-command", "standalone start command is present"));
  } else {
    checks.push(block("standalone-start-command", "standalone start command is missing"));
  }

  if (nextConfig.includes('output: "standalone"') || nextConfig.includes("output: 'standalone'")) {
    checks.push(pass("standalone-output", "Next standalone output is enabled"));
  } else {
    checks.push(block("standalone-output", "Next standalone output is not enabled"));
  }

  if (dockerfile) {
    checks.push(pass("governance-dockerfile", "governance Dockerfile exists"));
  } else {
    checks.push(block("governance-dockerfile", "governance Dockerfile is missing"));
  }

  const hasRootContextImage = localProductionDockerfile.includes("COPY packages/contracts")
    && localProductionDockerfile.includes("COPY packages/loops/ralph-runtime")
    && localProductionDockerfile.includes("npm --prefix packages/loops/ralph-runtime ci")
    && localProductionDockerfile.includes("COPY apps/governance-platform")
    && localProductionDockerfile.includes("npm --prefix packages/contracts run build")
    && localProductionDockerfile.includes("npm --prefix apps/governance-platform ci")
    && localProductionDockerfile.includes("./apps/governance-platform/public")
    && localProductionDockerfile.includes("./apps/governance-platform/.next/static")
    && !localProductionDockerfile.includes("COPY . .");
  if (hasRootContextImage) {
    checks.push(pass("governance-local-production-image", "root-context governance production image path exists"));
  } else {
    checks.push(block(
      "governance-local-production-image",
      "root-context governance production image path is missing or too broad",
    ));
  }

  const excludesDirectStaticPublicAssets = localProductionDockerfile.includes("rm -rf ./public/short-html")
    && localProductionDockerfile.includes("./apps/governance-platform/public/short-html");
  if (excludesDirectStaticPublicAssets) {
    checks.push(pass("governance-image-direct-static-boundary", "short-html public assets are excluded from the governance production image"));
  } else {
    checks.push(block(
      "governance-image-direct-static-boundary",
      "short-html public assets are not explicitly excluded from the governance production image",
    ));
  }

  const dockerignoreExcludesCaches = [
    ".git",
    "**/node_modules",
    "**/.next",
    "runtime",
    "work",
  ].every((needle) => dockerignore.includes(needle));
  if (dockerignoreExcludesCaches) {
    checks.push(pass("governance-root-dockerignore", "root Docker build context excludes repo/runtime caches"));
  } else {
    checks.push(block(
      "governance-root-dockerignore",
      "root Docker build context does not exclude required caches",
    ));
  }

  if (publicAssets && migrations) {
    checks.push(pass("build-static-inputs", "public assets and migration directory exist"));
  } else {
    checks.push(block("build-static-inputs", "public assets or migration directory is missing"));
  }

  if (readinessRoute) {
    checks.push(pass("readiness-route", "strict governance readiness route exists"));
  } else {
    checks.push(block("readiness-route", "strict governance readiness route is missing"));
  }

  return {
    buildCommand: "npm --prefix apps/governance-platform run build",
    standaloneOutput: "apps/governance-platform/.next/standalone",
    staticAssets: "apps/governance-platform/.next/static",
    publicAssets: "apps/governance-platform/public",
    prismaClient: "apps/governance-platform/node_modules/.prisma/client",
    migrations: migrationDir,
    deploymentsAssetsPolicy: "not-verified",
    hasStandaloneStartScript: startStandalone,
    hasReadinessRoute: readinessRoute,
    hasGovernanceDockerfile: dockerfile,
    localProductionImage: {
      dockerfile: localProductionDockerfilePath,
      rootContext: hasRootContextImage,
      rootDockerignore: dockerignoreExcludesCaches,
      excludesDirectStaticPublicAssets,
    },
    directStaticPublicAssets: {
      path: "apps/governance-platform/public/short-html",
      exists: directStaticPublicAssets,
      imagePolicy: excludesDirectStaticPublicAssets ? "excluded-from-governance-image" : "not-enforced",
    },
  };
}

function inspectRuntimeDefault(root, checks) {
  const compose = readRepoFile(root, "docker-compose.local.yml");
  const wrapper = readRepoFile(root, "scripts/docker-local-stack.sh");
  const localDockerDocs = readRepoFile(root, "docs/local-docker-stack.md");
  const localProductionDockerfile = readRepoFile(root, "apps/governance-platform/Dockerfile.local-production");
  const governanceService = extractComposeServiceBlock(compose, "governance-platform");
  const usesDevServer = /\bnext\s+dev\b/.test(governanceService)
    || governanceService.includes("next dev --turbopack");
  const usesTurbopack = governanceService.includes("--turbopack");
  const persistsNextCache = governanceService.includes("governance_next:")
    || governanceService.includes("/.next");
  const usesImageRuntime = governanceService.includes("GOVERNANCE_IMAGE")
    && governanceService.includes("arena-public-governance:local");
  const usesMountedRepoRuntime = governanceService.includes("${ARENA_HOST_PATH}:${ARENA_HOST_PATH}")
    || governanceService.includes("governance_node_modules")
    || governanceService.includes("governance-local-production-entrypoint.sh");
  const imageBuildGuard = wrapper.includes("ensure_governance_image_for_compose")
    && wrapper.includes("compose_targets_governance")
    && wrapper.includes('arg_has "--build"')
    && wrapper.includes("build_governance_image");
  const imageRevisionGuard = localProductionDockerfile.includes("ARG GOVERNANCE_SOURCE_SHA=unknown")
    && localProductionDockerfile.includes("org.opencontainers.image.revision=$GOVERNANCE_SOURCE_SHA")
    && wrapper.includes('--build-arg "GOVERNANCE_SOURCE_SHA=$source_sha"')
    && wrapper.includes("governance_image_source_sha")
    && wrapper.includes('image_source_sha="$(governance_image_source_sha "$image_tag")"')
    && wrapper.includes('[ "$image_source_sha" != "$source_sha" ]');
  const readinessMarkerCallIndex = wrapper.indexOf("ensure_governance_readiness_marker_env_for_compose \"$@\"");
  const imageGuardCallIndex = wrapper.indexOf("ensure_governance_image_for_compose \"$@\"");
  const composeExecIndex = wrapper.indexOf("exec docker compose");
  const canaryStartIndex = wrapper.indexOf("start_governance_canary()");
  const canaryImageGuardIndex = wrapper.indexOf(
    'ensure_governance_image_available_for_current_head "$image_tag"',
    canaryStartIndex,
  );
  const canaryArtifactShaIndex = wrapper.indexOf(
    'artifact_sha="$(governance_image_source_sha "$image_tag")"',
    canaryStartIndex,
  );
  const canaryRevisionGuard = canaryStartIndex >= 0
    && canaryImageGuardIndex >= 0
    && canaryArtifactShaIndex >= 0
    && canaryImageGuardIndex < canaryArtifactShaIndex
    && wrapper.includes('build_id="${GOVERNANCE_CANARY_BUILD_ID:-$artifact_sha}"')
    && wrapper.includes('release_sha="${GOVERNANCE_CANARY_RELEASE_SHA:-$artifact_sha}"')
    && wrapper.includes("Governance canary image lacks org.opencontainers.image.revision");
  const readinessMarkerDefaultGuard = wrapper.includes("ensure_governance_readiness_marker_env_for_compose")
    && wrapper.includes("governance_readiness_marker_source_sha")
    && wrapper.includes('export GOVERNANCE_SLOT_ID="${GOVERNANCE_SLOT_ID:-local}"')
    && wrapper.includes('export GOVERNANCE_SCHEDULER_ROLE="${GOVERNANCE_SCHEDULER_ROLE:-active}"')
    && wrapper.includes('export GOVERNANCE_BUILD_ID="${GOVERNANCE_BUILD_ID:-$source_sha}"')
    && wrapper.includes('export GOVERNANCE_RELEASE_SHA="${GOVERNANCE_RELEASE_SHA:-$source_sha}"')
    && wrapper.includes('export GOVERNANCE_MIGRATION_STATUS="${GOVERNANCE_MIGRATION_STATUS:-not_required}"')
    && imageGuardCallIndex >= 0
    && readinessMarkerCallIndex >= 0
    && composeExecIndex >= 0
    && imageGuardCallIndex < readinessMarkerCallIndex
    && readinessMarkerCallIndex < composeExecIndex;
  const committedSourceBuildContext = wrapper.includes("build_governance_image")
    && wrapper.includes("git -C \"$ROOT_DIR\" archive")
    && wrapper.includes("Building governance production image from committed HEAD")
    && localDockerDocs.includes("git archive HEAD")
    && localDockerDocs.includes("committed source context");
  const governanceImageDispatchIndex = wrapper.indexOf('[ "$command_word" = "build" ] && [ "$target_word" = "governance-image" ]');
  const dockerSetupIndex = wrapper.indexOf("docker volume inspect");
  const governanceImageBuildBeforeDockerSetup = governanceImageDispatchIndex >= 0
    && dockerSetupIndex >= 0
    && governanceImageDispatchIndex < dockerSetupIndex;
  const nodeEnv = extractComposeEnvValue(governanceService, "NODE_ENV");
  const requiredRolloutMarkerEnv = [
    "GOVERNANCE_SLOT_ID",
    "GOVERNANCE_BUILD_ID",
    "GOVERNANCE_RELEASE_SHA",
    "GOVERNANCE_SCHEDULER_ROLE",
    "GOVERNANCE_MIGRATION_STATUS",
  ];
  const missingRolloutMarkerEnv = requiredRolloutMarkerEnv
    .filter((key) => !new RegExp(`\\b${key}:`).test(governanceService));

  if (nodeEnv === "production") {
    checks.push(pass("governance-node-env", "local governance default declares NODE_ENV=production"));
  } else {
    checks.push(block("governance-node-env", `local governance default declares NODE_ENV=${nodeEnv || "unknown"}`));
  }

  if (usesDevServer || usesTurbopack) {
    checks.push(block("governance-default-runtime", "local governance default still starts next dev/Turbopack"));
  } else {
    checks.push(pass("governance-default-runtime", "local governance default does not start next dev/Turbopack"));
  }

  if (usesImageRuntime && !usesMountedRepoRuntime) {
    checks.push(pass("governance-image-runtime", "local governance default uses the production image without repo/node_modules runtime mounts"));
  } else {
    checks.push(block("governance-image-runtime", "local governance default is not an immutable production image runtime"));
  }

  if (imageBuildGuard && committedSourceBuildContext && governanceImageBuildBeforeDockerSetup) {
    checks.push(pass("governance-image-build-guard", "local stack wrapper builds governance image from committed HEAD before Docker setup side effects"));
  } else {
    checks.push(block("governance-image-build-guard", "local stack wrapper does not ensure governance image exists from committed source before Docker setup side effects"));
  }

  if (imageRevisionGuard) {
    checks.push(pass("governance-image-revision-guard", "local governance image carries committed source revision and stale images rebuild before compose up/create"));
  } else {
    checks.push(block("governance-image-revision-guard", "local governance image can drift from readiness release markers"));
  }

  if (canaryRevisionGuard) {
    checks.push(pass("governance-canary-revision-guard", "inactive governance canary markers default from image revision, not ambient git HEAD"));
  } else {
    checks.push(block("governance-canary-revision-guard", "inactive governance canary can advertise markers that do not match its image artifact"));
  }

  if (persistsNextCache) {
    checks.push(block("governance-next-cache", "local governance default still persists .next as runtime truth"));
  } else {
    checks.push(pass("governance-next-cache", "local governance default does not persist .next"));
  }

  if (missingRolloutMarkerEnv.length === 0) {
    checks.push(pass("governance-rollout-marker-env", "local governance service wires explicit rollout readiness markers"));
  } else {
    checks.push(block(
      "governance-rollout-marker-env",
      `local governance service is missing rollout marker env: ${missingRolloutMarkerEnv.join(", ")}`,
    ));
  }

  if (readinessMarkerDefaultGuard) {
    checks.push(pass("governance-readiness-marker-defaults", "local stack wrapper defaults governance readiness markers before compose up/create/config"));
  } else {
    checks.push(block("governance-readiness-marker-defaults", "local stack wrapper can start or render governance without readiness marker defaults"));
  }

  return {
    nodeEnv: nodeEnv || "unknown",
    usesNextDev: usesDevServer,
    usesTurbopack,
    persistsNextCache,
    usesImageRuntime,
    usesMountedRepoRuntime,
    imageBuildGuard,
    imageRevisionGuard,
    canaryRevisionGuard,
    readinessMarkerDefaultGuard,
    committedSourceBuildContext,
    governanceImageBuildBeforeDockerSetup,
    rolloutMarkerEnv: {
      required: requiredRolloutMarkerEnv,
      missing: missingRolloutMarkerEnv,
      wired: missingRolloutMarkerEnv.length === 0,
    },
  };
}

function inspectRouter(root, checks) {
  const compose = readRepoFile(root, "docker-compose.local.yml");
  const localCaddy = readRepoFile(root, "infra/caddy/Caddyfile.local");
  const vpsCaddy = readRepoFile(root, "infra/vps/templates/caddy/Caddyfile.tpl");
  const deploy = readRepoFile(root, "infra/vps/scripts/05-deploy.sh");
  const activeUpstreamTemplate = readRepoFile(root, "infra/governance-rollout/Caddyfile.active-upstream.tpl");
  const routerConfigRenderer = fileExists(root, "scripts/governance-rollout-router-config.mjs");
  const systemdSlotTemplate = fileExists(root, "infra/vps/templates/systemd/governance-web@.service.tpl");
  const caddyService = extractComposeServiceBlock(compose, "caddy");
  const stableInternalUrl = extractComposeEnvValue(compose, "GOVERNANCE_INTERNAL_URL") || "unknown";
  const hasLegacySlotHarness = repoSearch(root, [
    "governance-blue",
    "governance-green",
    "GOVERNANCE_ACTIVE_UPSTREAM",
    "active_upstream",
    "active-upstream",
  ]);
  const hasActiveUpstreamTemplate = activeUpstreamTemplate.includes("X-Ralph-Governance-Active-Slot")
    && activeUpstreamTemplate.includes("reverse_proxy __UPSTREAM__");
  const hasSlotHarness = hasLegacySlotHarness
    || (hasActiveUpstreamTemplate && routerConfigRenderer && systemdSlotTemplate);
  const singleUpstream = vpsCaddy.includes("127.0.0.1:3000");
  const directRestart = deploy.includes("systemctl restart governance-web");
  const slotUrlExposure = /\bGOVERNANCE_(BLUE|GREEN|SLOT|STANDBY)_URL\b/.test(compose) ? "present" : "none";
  const shortHtmlDirectStatic = caddyService.includes("./apps/governance-platform/public/short-html:/srv/short-html:ro")
    && localCaddy.includes("handle_path /short-html/*")
    && localCaddy.includes("root * /srv/short-html")
    && localCaddy.includes("file_server")
    && localCaddy.includes("@shortHtmlHidden");

  if (stableInternalUrl === "http://governance-platform:3000") {
    checks.push(pass("stable-internal-url", "stable internal governance URL is explicit"));
  } else {
    checks.push(block("stable-internal-url", "stable internal governance URL is missing or changed"));
  }

  if (hasSlotHarness) {
    checks.push(pass("active-upstream-owner", "repository contains an explicit active upstream owner"));
  } else {
    checks.push(block("active-upstream-owner", "no explicit blue/green active upstream owner is present"));
  }

  if (directRestart) {
    checks.push(block("direct-restart-guard", "VPS deploy still restarts the active governance service directly"));
  } else {
    checks.push(pass("direct-restart-guard", "VPS deploy does not directly restart the active governance service"));
  }

  if (slotUrlExposure === "none") {
    checks.push(pass("slot-url-exposure", "no slot-specific URL is exposed to worker/runner env templates"));
  } else {
    checks.push(block("slot-url-exposure", "slot-specific governance URL appears in static env wiring"));
  }

  if (shortHtmlDirectStatic) {
    checks.push(pass("short-html-direct-static", "local Caddy serves /short-html/* directly from the host public folder"));
  } else {
    checks.push(block(
      "short-html-direct-static",
      "local Caddy does not directly serve /short-html/* from the host public folder",
    ));
  }

  return {
    stableInternalUrl,
    activeUpstreamOwner: hasSlotHarness ? "caddy-template" : "missing",
    slotUrlExposure,
    directRestartGuard: !directRestart,
    vpsSingleUpstream: singleUpstream,
    hasActiveUpstreamTemplate,
    hasRouterConfigRenderer: routerConfigRenderer,
    hasSystemdSlotTemplate: systemdSlotTemplate,
    shortHtmlDirectStatic,
  };
}

function inspectSecrets(root, checks) {
  const contractText = readRepoFile(root, "docs/contracts/env-secrets-contract.md");
  const rootExample = readRepoFile(root, ".env.example");
  const governanceExample = readRepoFile(root, "apps/governance-platform/.env.example");
  const compose = readRepoFile(root, "docker-compose.local.yml");
  const combined = [contractText, rootExample, governanceExample, compose].join("\n");
  const result = {};

  for (const key of requiredSecretKeys) {
    const contracted = combined.includes(key);
    const derived = key === "WORKER_SECRET" && compose.includes('WORKER_SECRET: "${RUNNER_WEBHOOK_SECRET:-}"');
    result[key] = derived ? "derived-from-RUNNER_WEBHOOK_SECRET" : contracted ? "contracted" : "missing";
    if (contracted || derived) {
      checks.push(pass(`secret-contract-${key}`, `${key} is represented in static env contract inputs`));
    } else {
      checks.push(block(`secret-contract-${key}`, `${key} is missing from static env contract inputs`));
    }
  }

  return {
    AUTH_SECRET_OR_NEXTAUTH_SECRET:
      result.AUTH_SECRET !== "missing" || result.NEXTAUTH_SECRET !== "missing" ? "contracted" : "missing",
    AUTHD_SECRET: result.AUTHD_SECRET,
    RUNNER_WEBHOOK_SECRET: result.RUNNER_WEBHOOK_SECRET,
    WORKER_SECRET: result.WORKER_SECRET,
    CRON_SECRET: result.CRON_SECRET,
    API_PROXY_SECRET: result.API_PROXY_SECRET,
    requiredKeys: result,
  };
}

function inspectScheduler(root, checks) {
  const instrumentation = readRepoFile(root, "apps/governance-platform/src/instrumentation.ts");
  const schedulerRoleHelper = readRepoFile(root, "apps/governance-platform/src/lib/governance-scheduler-role.ts");
  const schema = readRepoFile(root, "apps/governance-platform/prisma/schema.prisma");
  const envContract = readRepoFile(root, "docs/contracts/env-secrets-contract.md");
  const rootExample = readRepoFile(root, ".env.example");
  const governanceExample = readRepoFile(root, "apps/governance-platform/.env.example");
  const compose = readRepoFile(root, "docker-compose.local.yml");
  const hasSchedulerRoleHelper = schedulerRoleHelper.includes("GOVERNANCE_SCHEDULER_ROLE")
    && schedulerRoleHelper.includes("active")
    && schedulerRoleHelper.includes("standby")
    && schedulerRoleHelper.includes("external");
  const instrumentationUsesSchedulerRole = instrumentation.includes("resolveInstrumentedScheduler")
    && instrumentation.includes("resolveGovernanceScheduler");
  const envContracted = envContract.includes("GOVERNANCE_SCHEDULER_ROLE")
    && rootExample.includes("GOVERNANCE_SCHEDULER_ROLE")
    && governanceExample.includes("GOVERNANCE_SCHEDULER_ROLE")
    && compose.includes("GOVERNANCE_SCHEDULER_ROLE");
  const hasSchedulerRole = hasSchedulerRoleHelper
    && instrumentationUsesSchedulerRole
    && envContracted;
  const maintenanceJobs = readRepoFile(root, "apps/governance-platform/src/lib/maintenance-jobs.ts");
  const hasMaintenanceItemLock = maintenanceJobs.includes('FOR UPDATE');
  const hasAdvisorySchedulerLease = maintenanceJobs.includes("pg_advisory_xact_lock")
    && maintenanceJobs.includes("MAINTENANCE_RUN_ADVISORY_LOCK_NAMESPACE");
  const maintenanceRunBlock = extractModelBlock(schema, "MaintenanceRun");
  const hasDbLeaseGate = /@@unique\(\[itemId,\s*status/.test(maintenanceRunBlock)
    || /active.*lease/i.test(schema)
    || hasAdvisorySchedulerLease;

  if (hasSchedulerRole) {
    checks.push(pass("scheduler-role", "explicit governance scheduler role is present"));
  } else {
    checks.push(block("scheduler-role", "standby/active scheduler role is not explicit"));
  }

  if (hasDbLeaseGate) {
    checks.push(pass("scheduler-db-lease", "DB-enforced scheduler lease is present"));
  } else if (hasMaintenanceItemLock) {
    checks.push(block("scheduler-db-lease", "maintenance jobs use row locking, but no schema-level active-run lease exists"));
  } else {
    checks.push(block("scheduler-db-lease", "scheduler DB lease guard is missing"));
  }

  return {
    role: hasSchedulerRole ? "configured" : "implicit-active",
    roleSource: hasSchedulerRole ? "GOVERNANCE_SCHEDULER_ROLE" : "process instrumentation default",
    dbLeaseGate: hasDbLeaseGate ? "present" : "missing",
    hasSchedulerRoleHelper,
    instrumentationUsesSchedulerRole,
    envContracted,
    hasAdvisorySchedulerLease,
  };
}

function inspectMigrationGate(root, options, checks) {
  const classification = inspectMigrationClassification(root, options);
  const safety = inspectMigrationSafetyEvidence(root, options, classification, checks);
  const startupFindings = findMigrationCommands(root, startupMigrationFiles);
  const deployFindings = findUngatedDeployMigrationCommands(root, deployMigrationFiles);

  if (classification.classifier === "not-run") {
    checks.push(block("migration-classifier", "migration classifier was not given --previous-ref or --migration input"));
  } else if (classification.classifier === "passed") {
    checks.push(pass("migration-classifier", "migration classifier found only additive-compatible migration SQL"));
  } else {
    checks.push(block(
      "migration-classifier",
      `migration classifier blocked ${classification.classification} migration SQL`,
      { files: classification.files },
    ));
  }

  for (const finding of startupFindings) {
    checks.push(block("migration-startup-command", `${finding.path} still runs ${finding.command} in startup path`));
  }
  if (startupFindings.length === 0) {
    checks.push(pass("migration-startup-command", "no startup migration command found in checked files"));
  }

  for (const finding of deployFindings) {
    checks.push(block("migration-deploy-gate", `${finding.path} runs ${finding.command} without RA-344 classifier evidence gate`));
  }
  if (deployFindings.length === 0) {
    checks.push(pass("migration-deploy-gate", "no deploy migration command found in checked files"));
  }

  return {
    ...classification,
    ...safety,
    startupCommands: startupFindings,
    deployCommands: deployFindings,
  };
}

function inspectMigrationSafetyEvidence(root, options, classification, checks) {
  if (classification.classifier === "not-run") {
    return {
      backup: { status: "not-run", reason: "migration classifier was not run" },
      scratchRestore: { status: "not-run", reason: "migration classifier was not run" },
    };
  }

  if (classification.classifier !== "passed") {
    return {
      backup: { status: "blocked-upstream", reason: "migration classifier blocked migration" },
      scratchRestore: { status: "blocked-upstream", reason: "migration classifier blocked migration" },
    };
  }

  const changedMigrationCount = classification.files?.length ?? 0;
  if (changedMigrationCount === 0) {
    checks.push(pass("migration-backup", "no migration SQL changed; backup evidence is not required"));
    checks.push(pass("migration-scratch-restore", "no migration SQL changed; scratch restore evidence is not required"));
    return {
      backup: { status: "not-required", reason: "no migration SQL changed" },
      scratchRestore: { status: "not-required", reason: "no migration SQL changed" },
    };
  }

  const backup = inspectDbSafetyReport(root, options.backupReportPath, "db-backup");
  const scratchRestore = inspectDbSafetyReport(root, options.scratchRestoreReportPath, "scratch-restore");

  if (backup.status === "passed") {
    checks.push(pass("migration-backup", "DB backup evidence is present"));
  } else {
    checks.push(block("migration-backup", backup.reason, { failures: backup.failures }));
  }

  if (scratchRestore.status === "passed") {
    checks.push(pass("migration-scratch-restore", "scratch restore evidence is present"));
  } else {
    checks.push(block("migration-scratch-restore", scratchRestore.reason, { failures: scratchRestore.failures }));
  }

  if (
    backup.status === "passed"
    && scratchRestore.status === "passed"
    && backup.artifactSha256 !== scratchRestore.sourceBackupSha256
  ) {
    scratchRestore.status = "blocked";
    scratchRestore.reason = "scratch restore source backup does not match DB backup artifact";
    scratchRestore.failures = ["sourceBackupSha256 must match backup artifact.sha256"];
    checks.push(block("migration-scratch-restore-source", scratchRestore.reason));
  }

  return {
    backup,
    scratchRestore,
  };
}

function inspectDbSafetyReport(root, reportPath, expectedMode) {
  if (!reportPath) {
    return {
      status: "not-run",
      mode: expectedMode,
      reportPath: null,
      reason: `${expectedMode} report is required when migration SQL changed`,
      failures: ["report path is missing"],
    };
  }

  const absolutePath = path.resolve(root, reportPath);
  let report;
  try {
    report = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    return {
      status: "blocked",
      mode: expectedMode,
      reportPath,
      reason: `failed to read ${expectedMode} report`,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }

  const validation = validateDbSafetyReport(report, expectedMode);
  return {
    status: validation.status,
    mode: expectedMode,
    reportPath,
    reason: validation.status === "passed"
      ? `${expectedMode} report passed`
      : `${expectedMode} report is invalid`,
    failures: validation.failures,
    artifactSha256: report.artifact?.sha256 ?? null,
    sourceBackupSha256: report.sourceBackupSha256 ?? null,
  };
}

function inspectCompatibility(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const matrix = readJsonFile(root, compatibilityMatrixPath);
  const hasMatrixSpec = rolloutSpecs.includes("Old/New Wire Compatibility Matrix");
  const validation = validateCompatibilityMatrix(matrix);

  if (!hasMatrixSpec) {
    checks.push(block("compatibility-matrix", "compatibility matrix spec is missing"));
  } else if (!matrix) {
    checks.push(block("compatibility-matrix", "executable compatibility matrix file is missing"));
  } else if (validation.matrixResult === "passed") {
    checks.push(pass("compatibility-matrix", "executable old/new wire compatibility matrix is present"));
  } else {
    checks.push(block("compatibility-matrix", "executable compatibility matrix is incomplete", {
      blockedRoutes: validation.blockedRoutes,
    }));
  }
  return {
    ...validation,
    matrixPath: compatibilityMatrixPath,
    specPresent: hasMatrixSpec,
    executablePresent: Boolean(matrix),
  };
}

function inspectDbSafetyPlan(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, dbSafetyPlanScriptPath);
  const hasScript = script.includes("buildDbSafetyPlan")
    && script.includes("db-safety-plan")
    && script.includes("db-backup-execution.sh")
    && script.includes("scratch-restore-execution.sh");
  const hasTest = fileExists(root, dbSafetyPlanTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-db-safety-plan.mjs");

  if (hasScript && hasTest && documented) {
    checks.push(pass("db-safety-plan", "DB safety plan helper is executable and documented"));
  } else {
    checks.push(block("db-safety-plan", "DB safety plan helper is missing, untested, or undocumented"));
  }

  return {
    helperPath: dbSafetyPlanScriptPath,
    testPath: dbSafetyPlanTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function inspectCanaryHarness(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, readinessCanaryScriptPath);
  const localDockerDocs = readRepoFile(root, "docs/local-docker-stack.md");
  const localStackWrapper = readRepoFile(root, "scripts/docker-local-stack.sh");
  const hasScript = script.includes("buildReadinessCanaryReport")
    && script.includes("ra-344.governance-readiness.v1")
    && script.includes("content-type");
  const hasTest = fileExists(root, readinessCanaryTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-canary.mjs");
  const localWrapperRepeatable = localStackWrapper.includes("start_governance_canary")
    && localStackWrapper.includes("stop_governance_canary")
    && localStackWrapper.includes("remove_governance_canary")
    && localStackWrapper.includes("GOVERNANCE_CANARY_FORCE")
    && localStackWrapper.includes('"ra.task"')
    && localStackWrapper.includes('"ra.role"')
    && localDockerDocs.includes("remove governance-canary");

  if (hasScript && hasTest && documented && localWrapperRepeatable) {
    checks.push(pass("readiness-canary", "readiness canary helper and local wrapper cleanup path are executable and documented"));
  } else {
    checks.push(block("readiness-canary", "readiness canary helper or repeatable local wrapper cleanup path is missing, untested, or undocumented"));
  }

  return {
    helperPath: readinessCanaryScriptPath,
    testPath: readinessCanaryTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
    localWrapperRepeatable,
  };
}

function inspectRouteProbeCollector(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, routeProbesScriptPath);
  const hasScript = script.includes("buildRouteProbesReport")
    && script.includes("route-probes")
    && script.includes("runtime-intents-route")
    && script.includes("does not send secrets");
  const hasTest = fileExists(root, routeProbesTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-route-probes.mjs")
    && rolloutSpecs.includes("route-probes.json");

  if (hasScript && hasTest && documented) {
    checks.push(pass("route-probe-collector", "route probe collector is executable and documented"));
  } else {
    checks.push(block("route-probe-collector", "route probe collector is missing, untested, or undocumented"));
  }

  return {
    helperPath: routeProbesScriptPath,
    testPath: routeProbesTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function inspectRouteCanaryMatrix(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, routeCanaryScriptPath);
  const hasScript = script.includes("buildRouteCanaryReport")
    && script.includes("route-canary-matrix")
    && script.includes("runtime-intents-route")
    && script.includes("preview-generation");
  const hasTest = fileExists(root, routeCanaryTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-route-canary.mjs");

  if (hasScript && hasTest && documented) {
    checks.push(pass("route-canary-matrix", "route canary matrix helper is executable and documented"));
  } else {
    checks.push(block("route-canary-matrix", "route canary matrix helper is missing, untested, or undocumented"));
  }

  return {
    helperPath: routeCanaryScriptPath,
    testPath: routeCanaryTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function inspectLocalTopologyInspector(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const localDockerDocs = readRepoFile(root, "docs/local-docker-stack.md");
  const wrapper = readRepoFile(root, "scripts/docker-local-stack.sh");
  const script = readRepoFile(root, localTopologyScriptPath);
  const inspectIndex = wrapper.indexOf('if [ "$command_word" = "inspect" ] && [ "$target_word" = "topology" ]; then');
  const sideEffectIndexes = [
    wrapper.indexOf("mkdir -p"),
    wrapper.indexOf("docker network create"),
    wrapper.indexOf("npm ci"),
    wrapper.indexOf("docker build"),
  ].filter((index) => index >= 0);
  const wrapperEarly = inspectIndex >= 0 && sideEffectIndexes.every((index) => inspectIndex < index);
  const hasScript = script.includes("buildLocalTopologyReport")
    && script.includes("local-topology-inspector")
    && script.includes("docker ps")
    && script.includes("docker inspect");
  const hasTest = fileExists(root, localTopologyTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-local-topology.mjs")
    && localDockerDocs.includes("inspect topology");

  if (hasScript && hasTest && documented && wrapperEarly) {
    checks.push(pass("local-topology-inspector", "read-only local topology inspector is executable and documented"));
  } else {
    checks.push(block("local-topology-inspector", "read-only local topology inspector is missing, late, untested, or undocumented"));
  }

  return {
    helperPath: localTopologyScriptPath,
    testPath: localTopologyTestPath,
    wrapperPath: "scripts/docker-local-stack.sh",
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
    wrapperEarly,
  };
}

function inspectLocalTopologyEvidence(root, options, checks) {
  const reportPath = options.localTopologyReportPath ?? null;
  let report = options.localTopologyReport ?? null;
  let readFailure = null;

  if (!report && reportPath) {
    try {
      report = JSON.parse(fs.readFileSync(path.resolve(root, reportPath), "utf8"));
    } catch (error) {
      readFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const validation = validateLocalTopologyEvidence(report, { reportPath, readFailure });
  if (validation.status === "passed") {
    checks.push(pass("local-topology-evidence", "local topology evidence is captured and passes its gate"));
  } else {
    checks.push(block("local-topology-evidence", validation.reason, { failures: validation.failures }));
  }

  return validation;
}

export function validateLocalTopologyEvidence(report, options = {}) {
  const reportPath = options.reportPath ?? null;
  const readFailure = options.readFailure ?? null;
  const failures = [];

  if (readFailure) {
    return {
      status: "blocked",
      reportPath,
      reason: "failed to read local topology report",
      failures: [readFailure],
    };
  }

  if (!report) {
    return {
      status: "not-run",
      reportPath,
      reason: "local topology report is required before standby promotion evidence is accepted",
      failures: ["pass --local-topology-report <local-topology.json>"],
    };
  }

  if (report.taskId !== "RA-344") {
    failures.push("taskId must be RA-344");
  }
  if (report.mode !== "local-topology-inspector") {
    failures.push("mode must be local-topology-inspector");
  }
  if (report.operator !== "./scripts/docker-local-stack.sh inspect topology") {
    failures.push("operator must be ./scripts/docker-local-stack.sh inspect topology");
  }
  if (report.nonIntervention !== true) {
    failures.push("nonIntervention must be true");
  }
  if (report.decision !== "captured") {
    failures.push(`decision must be captured, got ${report.decision || "missing"}`);
  }
  if ((report.blockedReasons?.length ?? 0) > 0) {
    failures.push(`blockedReasons must be empty, got ${report.blockedReasons.join("; ")}`);
  }

  const services = Array.isArray(report.compose?.services) ? report.compose.services : [];
  const governanceServices = services.filter((service) => service?.service === "governance-platform");
  const runningGovernanceServices = governanceServices.filter((service) => service.running === true);
  if (runningGovernanceServices.length === 0) {
    failures.push("at least one running governance-platform service is required");
  }

  for (const service of runningGovernanceServices) {
    const env = service.selectedEnv && typeof service.selectedEnv === "object" ? service.selectedEnv : {};
    const name = service.name || "governance-platform";
    if (env.NODE_ENV !== "production") {
      failures.push(`${name}: NODE_ENV must be production`);
    }
    if (!["active", "standby", "external"].includes(env.GOVERNANCE_SCHEDULER_ROLE)) {
      failures.push(`${name}: GOVERNANCE_SCHEDULER_ROLE must be active, standby, or external`);
    }
    if (!hasText(env.GOVERNANCE_SLOT_ID)) {
      failures.push(`${name}: GOVERNANCE_SLOT_ID is required`);
    }
    if (!hasText(env.GOVERNANCE_BUILD_ID) && !hasText(env.GOVERNANCE_RELEASE_SHA)) {
      failures.push(`${name}: GOVERNANCE_BUILD_ID or GOVERNANCE_RELEASE_SHA is required`);
    }
    if (!["compatible", "not_required"].includes(env.GOVERNANCE_MIGRATION_STATUS)) {
      failures.push(`${name}: GOVERNANCE_MIGRATION_STATUS must be compatible or not_required`);
    }
  }

  const schedulerOwners = Array.isArray(report.scheduler?.owners) ? report.scheduler.owners : [];
  const activeSchedulerOwners = schedulerOwners.filter((owner) => (
    owner?.running === true
    && ["active", "external"].includes(owner?.schedulerRole)
  ));
  if (activeSchedulerOwners.length !== 1) {
    failures.push(`exactly one running active/external scheduler owner is required, got ${activeSchedulerOwners.length}`);
  }

  const runtimeContainers = Array.isArray(report.runtimeContainers) ? report.runtimeContainers : [];
  const runningRuntimeContainers = runtimeContainers.filter((container) => container?.running === true);
  const missingGovernanceUrl = runningRuntimeContainers
    .filter((container) => !hasText(container.governanceUrlOrigin))
    .map((container) => container.name || container.id || "unknown");

  const status = failures.length === 0 ? "passed" : "blocked";
  return {
    status,
    reportPath,
    reason: status === "passed"
      ? "local topology evidence passed"
      : "local topology evidence is not safe for standby promotion",
    failures,
    counts: report.counts ?? null,
    governanceServices: runningGovernanceServices.map((service) => ({
      name: service.name ?? null,
      running: service.running === true,
      nodeEnv: service.selectedEnv?.NODE_ENV ?? null,
      schedulerRole: service.selectedEnv?.GOVERNANCE_SCHEDULER_ROLE ?? null,
      slotId: service.selectedEnv?.GOVERNANCE_SLOT_ID ?? null,
      buildId: service.selectedEnv?.GOVERNANCE_BUILD_ID ?? null,
      releaseSha: service.selectedEnv?.GOVERNANCE_RELEASE_SHA ?? null,
      migrationStatus: service.selectedEnv?.GOVERNANCE_MIGRATION_STATUS ?? null,
    })),
    activeSchedulerOwners: activeSchedulerOwners.map((owner) => ({
      name: owner.name ?? null,
      service: owner.service ?? null,
      schedulerRole: owner.schedulerRole ?? null,
      slotId: owner.slotId ?? null,
      buildId: owner.buildId ?? null,
      migrationStatus: owner.migrationStatus ?? null,
    })),
    runningRuntimeContainers: runningRuntimeContainers.length,
    missingGovernanceUrl,
    warnings: missingGovernanceUrl.length > 0
      ? [`running runtime containers missing ARENA_GOVERNANCE_URL require old-slot retention proof: ${missingGovernanceUrl.join(", ")}`]
      : [],
  };
}

function inspectSlotRolloutPlan(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, slotRolloutPlanScriptPath);
  const hasScript = script.includes("buildSlotRolloutPlan")
    && script.includes("GOVERNANCE_SLOT_ID")
    && script.includes("governance-rollout-canary.mjs")
    && script.includes("governance-rollout-router-config.mjs");
  const hasTest = fileExists(root, slotRolloutPlanTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-slot-plan.mjs");

  if (hasScript && hasTest && documented) {
    checks.push(pass("slot-rollout-plan", "slot rollout plan helper is executable and documented"));
  } else {
    checks.push(block("slot-rollout-plan", "slot rollout plan helper is missing, untested, or undocumented"));
  }

  return {
    helperPath: slotRolloutPlanScriptPath,
    testPath: slotRolloutPlanTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function inspectPromotionPlan(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, promotionPlanScriptPath);
  const hasScript = script.includes("buildPromotionPlan")
    && script.includes("promotion-plan")
    && script.includes("rollback-plan")
    && script.includes("governance-rollout-canary.mjs");
  const hasTest = fileExists(root, promotionPlanTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-promotion-plan.mjs");

  if (hasScript && hasTest && documented) {
    checks.push(pass("promotion-plan", "promotion and rollback plan helper is executable and documented"));
  } else {
    checks.push(block("promotion-plan", "promotion and rollback plan helper is missing, untested, or undocumented"));
  }

  return {
    helperPath: promotionPlanScriptPath,
    testPath: promotionPlanTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function inspectVpsExecutionPlan(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, vpsExecutionPlanScriptPath);
  const hasScript = script.includes("buildVpsExecutionPlan")
    && script.includes("vps-execution-plan")
    && script.includes("rollout-execution.sh")
    && script.includes("oldSlotRetention")
    && script.includes("runnerInventory")
    && script.includes("old-slot-stop-execution.sh");
  const hasTest = fileExists(root, vpsExecutionPlanTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-vps-execution-plan.mjs");

  if (hasScript && hasTest && documented) {
    checks.push(pass("vps-execution-plan", "VPS execution plan helper is executable and documented"));
  } else {
    checks.push(block("vps-execution-plan", "VPS execution plan helper is missing, untested, or undocumented"));
  }

  return {
    helperPath: vpsExecutionPlanScriptPath,
    testPath: vpsExecutionPlanTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function inspectRunnerInventory(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, runnerInventoryScriptPath);
  const hasScript = script.includes("buildRunnerInventoryReport")
    && script.includes("runner-inventory")
    && script.includes("oldSlotStop")
    && script.includes("ARENA_GOVERNANCE_URL");
  const hasTest = fileExists(root, runnerInventoryTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-runner-inventory.mjs");

  if (hasScript && hasTest && documented) {
    checks.push(pass("runner-inventory", "runner inventory drain helper is executable and documented"));
  } else {
    checks.push(block("runner-inventory", "runner inventory drain helper is missing, untested, or undocumented"));
  }

  return {
    helperPath: runnerInventoryScriptPath,
    testPath: runnerInventoryTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function inspectEvidenceBundle(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, evidenceBundleScriptPath);
  const hasScript = script.includes("buildRolloutEvidenceBundle")
    && script.includes("rollout-evidence-bundle")
    && script.includes("preflight.json")
    && script.includes("local-topology.json")
    && script.includes("route-canary-matrix.json")
    && script.includes("vps-execution-plan.json");
  const hasTest = fileExists(root, evidenceBundleTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-evidence-bundle.mjs")
    && rolloutSpecs.includes("rollout-evidence-bundle.json");

  if (hasScript && hasTest && documented) {
    checks.push(pass("evidence-bundle", "rollout evidence bundle helper is executable and documented"));
  } else {
    checks.push(block("evidence-bundle", "rollout evidence bundle helper is missing, untested, or undocumented"));
  }

  return {
    helperPath: evidenceBundleScriptPath,
    testPath: evidenceBundleTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function inspectRolloutDryRun(root, checks) {
  const rolloutSpecs = readRepoFile(root, "work/plans/ra-344-governance-production-rollout/rollout-dry-run-specs.md");
  const script = readRepoFile(root, dryRunScriptPath);
  const hasScript = script.includes("runGovernanceRolloutDryRun")
    && script.includes("rollout-dry-run")
    && script.includes("buildStaticPreflightReport")
    && script.includes("buildRolloutEvidenceBundle")
    && script.includes("does not fetch live URLs");
  const hasTest = fileExists(root, dryRunTestPath);
  const documented = rolloutSpecs.includes("governance-rollout-dry-run.mjs")
    && rolloutSpecs.includes("rollout-dry-run.json");

  if (hasScript && hasTest && documented) {
    checks.push(pass("rollout-dry-run", "rollout dry-run orchestrator is executable and documented"));
  } else {
    checks.push(block("rollout-dry-run", "rollout dry-run orchestrator is missing, untested, or undocumented"));
  }

  return {
    helperPath: dryRunScriptPath,
    testPath: dryRunTestPath,
    executablePresent: hasScript,
    testPresent: hasTest,
    documented,
  };
}

function validateCompatibilityDirection(entry, required, directionKey, invalidEdges) {
  const expected = required[directionKey];
  const direction = entry?.[directionKey];
  if (!direction || typeof direction !== "object") {
    invalidEdges.push(`${required.id}: ${directionKey} is missing`);
    return;
  }
  const status = direction.status;
  if (expected === "specified" && status !== "specified") {
    invalidEdges.push(`${required.id}: ${directionKey}.status must be specified`);
  }
  if (expected === "not-required-ok" && !["specified", "not-required"].includes(status)) {
    invalidEdges.push(`${required.id}: ${directionKey}.status must be specified or not-required`);
  }
  if (status === "specified" && typeof direction.check !== "string") {
    invalidEdges.push(`${required.id}: ${directionKey}.check is required when specified`);
  }
  if (status === "not-required" && typeof direction.reason !== "string") {
    invalidEdges.push(`${required.id}: ${directionKey}.reason is required when not-required`);
  }
}

export function resolveMigrationFiles(root, options = {}) {
  const explicitMigrations = options.migrations ?? [];
  if (explicitMigrations.length > 0) {
    return explicitMigrations.map((file) => normalizeMigrationPath(root, file));
  }

  if (!options.previousRef) {
    return [];
  }

  const output = readGitOutput(root, [
    "diff",
    "--name-only",
    options.previousRef,
    "HEAD",
    "--",
    migrationDir,
  ]);
  return output
    .split("\n")
    .filter((line) => line.endsWith("/migration.sql"))
    .map((line) => normalizeMigrationPath(root, line))
    .filter((file) => fs.existsSync(file.absolutePath));
}

function normalizeMigrationPath(root, file) {
  const absolutePath = path.resolve(root, file);
  const relativePath = path.relative(root, absolutePath);
  if (!relativePath.startsWith(migrationDir) || path.basename(relativePath) !== "migration.sql") {
    throw new Error(`Migration input must be a migration.sql under ${migrationDir}: ${file}`);
  }
  return { relativePath, absolutePath };
}

function classifySqlStatement(statement) {
  const trimmed = statement.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/\s+/g, " ");
  const upper = compact.toUpperCase();
  const reasons = [];

  if (/\bDROP\s+TABLE\b/.test(upper)) reasons.push("drops a table");
  if (/\bDROP\s+COLUMN\b/.test(upper)) reasons.push("drops a column");
  if (/\bDROP\s+TYPE\b/.test(upper)) reasons.push("drops a type");
  if (/\bRENAME\s+(TO|TABLE|COLUMN)\b/.test(upper)) reasons.push("renames schema object");
  if (/\bALTER\s+COLUMN\b.*\bTYPE\b/.test(upper)) reasons.push("changes column type");
  if (/\bALTER\s+COLUMN\b.*\bSET\s+NOT\s+NULL\b/.test(upper)) reasons.push("adds not-null constraint to existing column");
  if (/\bADD\s+CONSTRAINT\b.*\bUNIQUE\b/.test(upper)) reasons.push("adds unique constraint that can fail existing data");
  if (/\bCREATE\s+UNIQUE\s+INDEX\b/.test(upper)) reasons.push("adds unique index that can fail existing data");
  if (/\bALTER\s+TABLE\b.*\bADD\s+COLUMN\b.*\bNOT\s+NULL\b/.test(upper) && !/\bDEFAULT\b/.test(upper)) {
    reasons.push("adds non-null column without compatible default");
  }

  if (reasons.length > 0) {
    return { classification: "destructive", reasons };
  }

  const unknownReasons = [];
  if (/^DO\b/.test(upper)) unknownReasons.push("DO block requires human classification");
  if (/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/.test(upper)) unknownReasons.push("function body requires human classification");
  if (/^(UPDATE|DELETE|TRUNCATE|MERGE)\b/.test(upper)) unknownReasons.push("data rewrite requires human classification");
  if (/\bEXECUTE\b/.test(upper)) unknownReasons.push("dynamic SQL requires human classification");
  if (/\bALTER\s+TYPE\b/.test(upper) && !/\bADD\s+VALUE\b/.test(upper)) {
    unknownReasons.push("type change requires human classification");
  }

  if (unknownReasons.length > 0) {
    return { classification: "unknown", reasons: unknownReasons };
  }

  const additiveReasons = [];
  if (/\bCREATE\s+TABLE\b/.test(upper)) additiveReasons.push("creates a table");
  if (/\bCREATE\s+INDEX\b/.test(upper)) additiveReasons.push("creates a non-unique index");
  if (/\bALTER\s+TABLE\b.*\bADD\s+COLUMN\b/.test(upper)) additiveReasons.push("adds nullable/defaulted column");
  if (/\bALTER\s+TYPE\b.*\bADD\s+VALUE\b/.test(upper)) additiveReasons.push("adds enum value");

  if (additiveReasons.length > 0) {
    return { classification: "additive-compatible", reasons: additiveReasons };
  }

  return {
    classification: "unknown",
    reasons: [`unclassified SQL statement: ${compact.slice(0, 120)}`],
  };
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function splitSqlStatements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function findMigrationCommands(root, files) {
  const commandPatterns = [
    { command: "prisma migrate deploy", pattern: /\bprisma\s+migrate\s+deploy\b/ },
    { command: "npm --prefix apps/governance-platform run db:deploy", pattern: /\bnpm\s+--prefix\s+apps\/governance-platform\s+run\s+db:deploy\b/ },
  ];
  const findings = [];
  for (const relativePath of files) {
    const content = readRepoFile(root, relativePath);
    for (const { command, pattern } of commandPatterns) {
      if (pattern.test(content)) {
        findings.push({ path: relativePath, command });
      }
    }
  }
  return findings;
}

function findUngatedDeployMigrationCommands(root, files) {
  const findings = [];
  const dbDeployPattern = /\bnpm\s+--prefix\s+apps\/governance-platform\s+run\s+db:deploy\b/;
  const gateCommand = "node scripts/governance-rollout-preflight.mjs --static --migration-gate";

  for (const relativePath of files) {
    const content = readRepoFile(root, relativePath);
    const dbDeployIndex = content.search(dbDeployPattern);
    if (dbDeployIndex < 0) continue;
    const gateIndex = content.indexOf(gateCommand);
    const hasClassifierGate = gateIndex >= 0
      && gateIndex < dbDeployIndex
      && content.includes("--previous-ref");
    if (!hasClassifierGate) {
      findings.push({
        path: relativePath,
        command: "npm --prefix apps/governance-platform run db:deploy",
      });
    }
  }
  return findings;
}

function inspectMigrationClassification(root, options) {
  const files = resolveMigrationFiles(root, options);
  return classifyMigrationFiles(files, { inputProvided: hasMigrationInput(options) });
}

function hasMigrationInput(options = {}) {
  return Boolean(options.previousRef) || (options.migrations?.length ?? 0) > 0;
}

function extractComposeEnvValue(compose, key) {
  const match = compose.match(new RegExp(`\\b${key}:\\s*"?([^"\\n]+)"?`));
  return match?.[1]?.trim() ?? null;
}

function extractComposeServiceBlock(compose, serviceName) {
  const lines = compose.split("\n");
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start < 0) return "";

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
    if (/^[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

function extractModelBlock(schema, modelName) {
  const match = schema.match(new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] ?? "";
}

function repoSearch(root, needles) {
  const files = [
    "docker-compose.local.yml",
    "infra/vps/scripts/05-deploy.sh",
    "infra/vps/templates/caddy/Caddyfile.tpl",
    "infra/vps/templates/systemd/governance-web.service.tpl",
    "infra/vps/templates/systemd/governance-web@.service.tpl",
    "infra/governance-rollout/Caddyfile.active-upstream.tpl",
    "scripts/governance-rollout-router-config.mjs",
    "docs/contracts/env-secrets-contract.md",
  ];
  return files.some((relativePath) => {
    const content = readRepoFile(root, relativePath);
    return needles.some((needle) => content.includes(needle));
  });
}

function readRepoFile(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonFile(root, relativePath) {
  const content = readRepoFile(root, relativePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function fileExists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readGitOutput(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function readGitStatusShort(root) {
  const result = spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export function classifyDirtyWorktreeEntries(statusSummary) {
  const entries = statusSummary.map(parseDirtyStatusLine).filter(Boolean);
  const directStaticPublicInputs = entries
    .filter((entry) => entry.categories.includes("direct-static-public-input"))
    .map((entry) => entry.path);
  const productionBuildInputs = entries
    .filter((entry) => entry.categories.includes("production-build-input"))
    .map((entry) => entry.path);
  const rolloutControlInputs = entries
    .filter((entry) => entry.categories.includes("rollout-control-input"))
    .map((entry) => entry.path);
  const docsOrWorkNotes = entries
    .filter((entry) => entry.categories.includes("docs-or-work-note"))
    .map((entry) => entry.path);
  const otherPaths = entries
    .filter((entry) => entry.categories.includes("other"))
    .map((entry) => entry.path);

  return {
    statusSummary,
    entries,
    directStaticPublicInputs,
    productionBuildInputs,
    rolloutControlInputs,
    docsOrWorkNotes,
    otherPaths,
  };
}

export function buildDirtyWorktreeGate(dirtyClassification, runtimeDefault = {}) {
  const clean = dirtyClassification.statusSummary.length === 0;
  const ignoredProductionBuildInputs = runtimeDefault.committedSourceBuildContext
    ? dirtyClassification.productionBuildInputs
    : [];
  const blockingProductionBuildInputs = runtimeDefault.committedSourceBuildContext
    ? []
    : dirtyClassification.productionBuildInputs;
  const blockingPaths = unique([
    ...blockingProductionBuildInputs,
    ...dirtyClassification.rolloutControlInputs,
    ...dirtyClassification.otherPaths,
  ]);

  return {
    allowed: clean || blockingPaths.length === 0,
    clean,
    ...dirtyClassification,
    ignoredProductionBuildInputs,
    blockingProductionBuildInputs,
    blockingPaths,
  };
}

function parseDirtyStatusLine(line) {
  const raw = `${line ?? ""}`;
  if (!raw.trim()) return null;
  let status = raw.slice(0, 2);
  let rawPath = raw.length > 3 ? raw.slice(3) : raw.trim();
  if (raw.length > 1 && raw[1] === " " && raw[2] !== " ") {
    status = `${raw[0]} `;
    rawPath = raw.slice(2);
  }
  const pathValue = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
  const categories = classifyDirtyPath(pathValue);
  return {
    status,
    path: pathValue,
    raw,
    categories,
  };
}

function classifyDirtyPath(pathValue) {
  if (matchesAny(pathValue, [], directStaticPublicInputPrefixes)) {
    return ["direct-static-public-input"];
  }
  if (matchesAny(pathValue, productionBuildInputFiles, productionBuildInputPrefixes)) {
    return ["production-build-input"];
  }
  if (matchesAny(pathValue, rolloutControlInputFiles, rolloutControlInputPrefixes)) {
    return ["rollout-control-input"];
  }
  if (pathValue.startsWith("docs/") || pathValue.startsWith("work/")) {
    return ["docs-or-work-note"];
  }
  return ["other"];
}

function matchesAny(pathValue, files, prefixes) {
  return files.includes(pathValue) || prefixes.some((prefix) => pathValue.startsWith(prefix));
}

function pass(id, reason, details = undefined) {
  return { id, status: "pass", reason, ...(details ? { details } : {}) };
}

function block(id, reason, details = undefined) {
  return { id, status: "block", reason, ...(details ? { details } : {}) };
}

function hasText(value) {
  return `${value ?? ""}`.trim().length > 0;
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(`${value ?? ""}`.trim());
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseArgs(argv) {
  const parsed = {
    staticMode: false,
    json: false,
    expectBlock: false,
    migrationGate: false,
    reportPath: null,
    previousRef: null,
    migrations: [],
    backupReportPath: null,
    scratchRestoreReportPath: null,
    localTopologyReportPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--static") {
      parsed.staticMode = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--expect-block") {
      parsed.expectBlock = true;
    } else if (arg === "--migration-gate") {
      parsed.migrationGate = true;
    } else if (arg === "--report") {
      parsed.reportPath = argv[++index];
    } else if (arg === "--previous-ref") {
      parsed.previousRef = argv[++index];
    } else if (arg === "--migration") {
      parsed.migrations.push(argv[++index]);
    } else if (arg === "--backup-report") {
      parsed.backupReportPath = argv[++index];
    } else if (arg === "--scratch-restore-report") {
      parsed.scratchRestoreReportPath = argv[++index];
    } else if (arg === "--local-topology-report") {
      parsed.localTopologyReportPath = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/governance-rollout-preflight.mjs --static [options]

Options:
  --previous-ref <ref>   Classify migration.sql files changed since ref.
  --migration <path>    Classify an explicit migration.sql file. Repeatable.
  --migration-gate      Run only the RA-344 migration classifier gate.
  --backup-report <path>
                        DB backup evidence report for changed migration SQL.
  --scratch-restore-report <path>
                        Scratch restore evidence report for changed migration SQL.
  --local-topology-report <path>
                        Captured local-topology.json evidence from inspect topology.
  --report <path>       Write the full JSON preflight report.
  --json                Print the full JSON preflight report.
  --expect-block        Exit 0 only when the current repo is blocked.
`);
}

function printSummary(report) {
  if (report.mode === "migration-gate") {
    console.log(`RA-344 governance migration gate: ${report.decision}`);
    console.log(`release: ${report.releaseSha}`);
    console.log(`migration: ${report.migration.classifier} (${report.migration.classification})`);
    if (report.migration.files.length > 0) {
      for (const file of report.migration.files) {
        console.log(`- ${file.path}: ${file.classification}`);
      }
    } else {
      console.log(`- ${report.migration.summary ?? "no migration SQL changed"}`);
    }
    return;
  }
  console.log(`RA-344 governance rollout static preflight: ${report.decision}`);
  console.log(`release: ${report.releaseSha}`);
  console.log(`migration: ${report.migration.classifier} (${report.migration.classification})`);
  if (report.blockedReasons.length > 0) {
    console.log("blocked reasons:");
    for (const reason of report.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }
}

function writeReport(root, reportPath, report) {
  const absolutePath = path.resolve(root, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    if (!args.staticMode) {
      throw new Error("--static is required; live/local/VPS preflight modes are not implemented by this repo-only guard");
    }

    const report = args.migrationGate
      ? buildMigrationGateReport({
          previousRef: args.previousRef,
          migrations: args.migrations,
          backupReportPath: args.backupReportPath,
          scratchRestoreReportPath: args.scratchRestoreReportPath,
        })
      : buildStaticPreflightReport({
          previousRef: args.previousRef,
          migrations: args.migrations,
          backupReportPath: args.backupReportPath,
          scratchRestoreReportPath: args.scratchRestoreReportPath,
          localTopologyReportPath: args.localTopologyReportPath,
        });
    if (args.reportPath) {
      writeReport(repoRoot, args.reportPath, report);
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSummary(report);
    }

    if (args.expectBlock) {
      process.exit(report.decision === "block" ? 0 : 1);
    }
    if (args.migrationGate) {
      process.exit(report.decision === "allow-migration" ? 0 : 1);
    }
    process.exit(report.decision === "allow-standby" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
