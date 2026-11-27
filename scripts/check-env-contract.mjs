#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const fixLocal = args.has("--fix-local");

const files = {
  rootExample: ".env.example",
  rootEnv: ".env",
  rootEnvLocal: ".env.local",
  governanceExample: "apps/governance-platform/.env.example",
  governanceEnvLocal: "apps/governance-platform/.env.local",
  compose: "docker-compose.local.yml",
  contract: "docs/contracts/env-secrets-contract.md",
};

const rootExampleKeys = [
  "CLAUDE_AUTH_MODE",
  "CODEX_AUTH_MODE",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ADMIN_EMAILS",
  "ADMIN_TELEGRAM_USER_IDS",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENCODE_API_KEY",
  "RUNNER_MOUNT_CODEX_CONFIG",
  "RUNNER_CODEX_CONFIG_DIR",
  "GITHUB_TOKEN",
  "ZAI_AUTH_TOKEN",
  "SECRETS_ENCRYPTION_KEY",
  "ARENA_ADMIN_SECRET",
  "ARENA_PREVIEW_REFRESH_TOKEN",
  "ARENA_PREVIEW_REFRESH_PROJECT_IDS",
  "RUNNER_WEBHOOK_SECRET",
  "AUTHD_SECRET",
  "ARENA_PUSH_SECRET",
  "TG_SPEC_INTERNAL_BASE_URL",
  "TELEGRAM_OIDC_CLIENT_ID",
  "TELEGRAM_OIDC_CLIENT_SECRET",
  "TELEGRAM_WEBAPP_BOT_ID",
  "API_PROXY_URL",
  "API_PROXY_CONTAINER_URL",
  "API_PROXY_SECRET",
  "RUNNER_MAX_CONCURRENT_RUNS",
  "ARENA_PROJECT_DATA_ROOT",
  "RUNNER_WORKER_MEMORY",
  "RUNNER_WORKER_CPUS",
  "PREVIEW_DOMAIN",
  "GOVERNANCE_PUBLIC_URL",
  "GOVERNANCE_BUILD_ID",
  "GOVERNANCE_RELEASE_SHA",
  "GOVERNANCE_SLOT_ID",
  "GOVERNANCE_SCHEDULER_ROLE",
  "GOVERNANCE_MIGRATION_STATUS",
  "RALPH_E2E_ENFORCER_MIN_FEATURE_TASKS",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "CODEX_CLI_VERSION",
  "CLAUDE_CODE_CLI_VERSION",
  "OPENCLAW_CLI_VERSION",
  "OPENCODE_CLI_VERSION",
  "ANTIGRAVITY_CLI_VERSION",
  "ARENA_DB_BACKUP_ROOT",
  "ARENA_DB_BACKUP_INTERVAL_MS",
  "ARENA_DB_BACKUP_INITIAL_DELAY_MS",
  "ARENA_DB_BACKUP_KEEP_ALL_HOURS",
  "ARENA_DB_BACKUP_KEEP_DAILY_DAYS",
  "ARENA_DB_BACKUP_KEEP_WEEKLY_WEEKS",
  "ARENA_DB_BACKUP_KEEP_MONTHLY_MONTHS",
  "HETZNER_API_TOKEN",
  "HETZNER_DNS_TOKEN",
  "HETZNER_DNS_ZONE_ID",
  "VPS_PREVIEW_BASE_DOMAIN",
  "VPS_WORKER_IMAGE",
  "VPS_DEFAULT_REGION",
  "VPS_DEFAULT_SERVER_TYPE",
  "VPS_ACME_EMAIL",
  "FREEMIUS_PRODUCT_ID",
  "FREEMIUS_API_KEY",
  "FREEMIUS_SECRET_KEY",
  "FREEMIUS_PUBLIC_KEY",
  "FREEMIUS_CHECKOUT_MODE",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_WEBHOOK_SECRET",
  "NEXT_PUBLIC_CF_BEACON_TOKEN",
  "ARENA_BOT_TELEGRAM_TOKEN",
  "ARENA_BOT_TELEGRAM_CHAT_ID",
  "ARENA_BOT_AUTOMATIONS_DIR",
  "ARENA_BOT_DIGEST_SOURCE_FILES",
  "ARENA_BOT_DIGEST_MAX_AGE_HOURS",
  "ARENA_BOT_WEEKLY_DIGEST_AUTOMATION_DIR",
  "ARENA_BOT_WEEKLY_DIGEST_POLL_INTERVAL_MS",
];

const governanceExampleKeys = [
  "DATABASE_URL",
  "ARENA_DB_BACKUP_ROOT",
  "ARENA_DB_BACKUP_INTERVAL_MS",
  "ARENA_DB_BACKUP_INITIAL_DELAY_MS",
  "ARENA_DB_BACKUP_KEEP_ALL_HOURS",
  "ARENA_DB_BACKUP_KEEP_DAILY_DAYS",
  "ARENA_DB_BACKUP_KEEP_WEEKLY_WEEKS",
  "ARENA_DB_BACKUP_KEEP_MONTHLY_MONTHS",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
  "AUTH_URL",
  "GOVERNANCE_PUBLIC_URL",
  "GOVERNANCE_BUILD_ID",
  "GOVERNANCE_RELEASE_SHA",
  "GOVERNANCE_SLOT_ID",
  "GOVERNANCE_SCHEDULER_ROLE",
  "GOVERNANCE_MIGRATION_STATUS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "TELEGRAM_OIDC_CLIENT_ID",
  "TELEGRAM_OIDC_CLIENT_SECRET",
  "TELEGRAM_WEBAPP_BOT_ID",
  "ADMIN_EMAILS",
  "ADMIN_TELEGRAM_USER_IDS",
  "SECRETS_ENCRYPTION_KEY",
  "ARENA_ADMIN_SECRET",
  "ARENA_PREVIEW_REFRESH_TOKEN",
  "ARENA_PREVIEW_REFRESH_PROJECT_IDS",
  "ARENA_PUSH_SECRET",
  "TG_SPEC_INTERNAL_BASE_URL",
  "GITHUB_TOKEN",
  "DEFAULT_PROJECT_BRANCH",
  "RUNNER_GIT_TRANSPORT",
  "RUNNER_GITHUB_OWNER",
  "RUNNER_GITHUB_REPO_PREFIX",
  "RUNNER_GITHUB_REPO_VISIBILITY",
  "RUNNER_AGENT",
  "CLAUDE_AUTH_MODE",
  "CODEX_AUTH_MODE",
  "OPENCODE_API_KEY",
  "API_PROXY_URL",
  "API_PROXY_CONTAINER_URL",
  "API_PROXY_SECRET",
  "RUNNER_MAX_CONCURRENT_RUNS",
  "RUNNER_DOTENV_OVERRIDE",
  "RUNNER_WORKER_IMAGE",
  "RUNNER_WORKER_MEMORY",
  "RUNNER_WORKER_CPUS",
  "PREVIEW_DOMAIN",
  "RALPH_E2E_ENFORCER_MIN_FEATURE_TASKS",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "RUNNER_ALLOW_PLACEHOLDER_REPOS",
  "RUNNER_WEBHOOK_SECRET",
  "CRON_SECRET",
  "APP_PORT",
  "AUTH_TRUST_HOST",
  "NEXT_PUBLIC_CF_BEACON_TOKEN",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_WEBHOOK_SECRET",
  "FREEMIUS_PRODUCT_ID",
  "FREEMIUS_API_KEY",
  "FREEMIUS_SECRET_KEY",
  "FREEMIUS_PUBLIC_KEY",
  "FREEMIUS_CHECKOUT_MODE",
];

const composeGovernanceKeys = [
  "NODE_ENV",
  "HOSTNAME",
  "PORT",
  "APP_PORT",
  "AUTH_TRUST_HOST",
  "DATABASE_URL",
  "NEXTAUTH_URL",
  "AUTH_URL",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ADMIN_EMAILS",
  "GOVERNANCE_INTERNAL_URL",
  "GOVERNANCE_PUBLIC_URL",
  "RUNNER_GIT_TRANSPORT",
  "RUNNER_AGENT",
  "DEFAULT_PROJECT_BRANCH",
  "RUNNER_GITHUB_OWNER",
  "RUNNER_GITHUB_REPO_PREFIX",
  "RUNNER_GITHUB_REPO_VISIBILITY",
  "RUNNER_ALLOW_PLACEHOLDER_REPOS",
  "CLAUDE_AUTH_MODE",
  "CODEX_AUTH_MODE",
  "GOVERNANCE_SLOT_ID",
  "GOVERNANCE_BUILD_ID",
  "GOVERNANCE_RELEASE_SHA",
  "GOVERNANCE_SCHEDULER_ROLE",
  "GOVERNANCE_MIGRATION_STATUS",
  "CRON_SECRET",
  "PLAYWRIGHT_TEST",
  "SECRETS_ENCRYPTION_KEY",
  "RUNNER_WEBHOOK_SECRET",
  "WORKER_SECRET",
  "GITHUB_TOKEN",
  "ARENA_PUSH_SECRET",
  "TG_SPEC_INTERNAL_BASE_URL",
  "WORKER_AGENT_URL",
  "API_PROXY_URL",
  "API_PROXY_SECRET",
  "AUTHD_URL",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "AUTHD_SECRET",
  "AUTHD_TIMEOUT_MS",
  "TELEGRAM_OIDC_CLIENT_ID",
  "TELEGRAM_OIDC_CLIENT_SECRET",
  "TELEGRAM_WEBAPP_BOT_ID",
  "ADMIN_TELEGRAM_USER_IDS",
  "ARENA_ADMIN_SECRET",
  "ARENA_PREVIEW_REFRESH_TOKEN",
  "ARENA_PREVIEW_REFRESH_PROJECT_IDS",
  "ARENA_PROJECT_WORKSPACES_ROOT",
  "ARENA_PROJECT_ASSETS_ROOT",
  "ARENA_WORKSPACE_BACKUP_ROOT",
  "ARENA_DB_BACKUP_ROOT",
  "ARENA_DB_BACKUP_INTERVAL_MS",
  "ARENA_DB_BACKUP_INITIAL_DELAY_MS",
  "ARENA_DB_BACKUP_KEEP_ALL_HOURS",
  "ARENA_DB_BACKUP_KEEP_DAILY_DAYS",
  "ARENA_DB_BACKUP_KEEP_WEEKLY_WEEKS",
  "ARENA_DB_BACKUP_KEEP_MONTHLY_MONTHS",
  "HETZNER_API_TOKEN",
  "HETZNER_DEFAULT_SERVER_TYPE",
  "HETZNER_DNS_TOKEN",
  "HETZNER_DNS_ZONE_ID",
  "PREVIEW_DOMAIN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_AUTH_JSON",
  "OPENCODE_API_KEY",
  "FREEMIUS_PRODUCT_ID",
  "FREEMIUS_API_KEY",
  "FREEMIUS_SECRET_KEY",
  "FREEMIUS_PUBLIC_KEY",
  "FREEMIUS_CHECKOUT_MODE",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_WEBHOOK_SECRET",
  "NEXT_PUBLIC_CF_BEACON_TOKEN",
];

const composeArenaBotKeys = [
  "ARENA_BOT_WEEKLY_DIGEST_SOURCE_FILE",
  "ARENA_BOT_DIGEST_SOURCE_FILES",
  "ARENA_BOT_DIGEST_MAX_AGE_HOURS",
  "ARENA_BOT_STATE_FILE",
  "ARENA_BOT_TELEGRAM_TOKEN",
  "ARENA_BOT_TELEGRAM_CHAT_ID",
  "ARENA_BOT_WEEKLY_DIGEST_POLL_INTERVAL_MS",
];

const forbiddenNames = [
  "TELEGRAM_AUTH_BOT_USERNAME",
  "TELEGRAM_AUTH_BOT_TOKEN",
  "TELEGRAM_WEBAPP_BOT_TOKEN",
  "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME",
];

const errors = [];
const localFixNotes = [];

function abs(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(abs(rel), "utf8");
}

function readIfExists(rel) {
  const target = abs(rel);
  if (!fs.existsSync(target)) return "";
  return fs.readFileSync(target, "utf8");
}

function envKeys(rel) {
  const keys = new Set();
  for (const line of readIfExists(rel).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function checkNoDuplicateEnvKeys(rel) {
  const seen = new Set();
  for (const line of readIfExists(rel).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) continue;
    if (seen.has(match[1])) errors.push(`${rel} defines ${match[1]} more than once`);
    seen.add(match[1]);
  }
}

function requireKeys(rel, required) {
  const keys = envKeys(rel);
  for (const key of required) {
    if (!keys.has(key)) errors.push(`${rel} is missing ${key}`);
  }
}

function forbidUnknownEnvKeys(rel, allowed) {
  const known = new Set(allowed);
  for (const key of envKeys(rel)) {
    if (!known.has(key)) {
      errors.push(`${rel} defines unregistered ${key}; update scripts/check-env-contract.mjs and ${files.contract} when adding env vars`);
    }
  }
}

function requireText(rel, needle, message) {
  if (!readIfExists(rel).includes(needle)) errors.push(message || `${rel} is missing ${needle}`);
}

function forbidText(rel, needle, message) {
  if (readIfExists(rel).includes(needle)) errors.push(message || `${rel} must not contain ${needle}`);
}

function requireComposeEnvironmentKeys(keys) {
  const current = composeEnvironmentKeys("governance-platform");
  for (const key of keys) {
    if (!current.has(key)) errors.push(`${files.compose} governance-platform.environment is missing ${key}`);
  }
}

function composeEnvironmentKeys(serviceName) {
  const keys = new Set();
  const lines = read(files.compose).split(/\r?\n/);
  let inService = false;
  let inEnvironment = false;

  for (const line of lines) {
    if (line.match(new RegExp(`^  ${serviceName}:\\s*$`))) {
      inService = true;
      inEnvironment = false;
      continue;
    }
    if (inService && /^  [A-Za-z0-9_-]+:\s*$/.test(line)) break;
    if (!inService) continue;

    if (/^    environment:\s*$/.test(line)) {
      inEnvironment = true;
      continue;
    }
    if (inEnvironment && /^    [A-Za-z0-9_-]+:/.test(line)) break;
    if (!inEnvironment) continue;

    const match = line.match(/^      ([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (match) keys.add(match[1]);
  }

  return keys;
}

function forbidUnknownComposeEnvironmentKeys(serviceName, allowed) {
  const known = new Set(allowed);
  for (const key of composeEnvironmentKeys(serviceName)) {
    if (!known.has(key)) {
      errors.push(`${files.compose} ${serviceName}.environment defines unregistered ${key}; update scripts/check-env-contract.mjs and ${files.contract} when adding env vars`);
    }
  }
}

function parseEnvAssignments(rel) {
  const assignments = [];
  const lines = readIfExists(rel).split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) return;
    assignments.push({
      index,
      key: match[1],
      raw: line,
      value: match[2].trim(),
    });
  });
  return assignments;
}

function isNonEmptyAssignment(assignment) {
  const value = assignment.value;
  return value !== "" && value !== "\"\"" && value !== "''";
}

function checkCommentOnlyEnv(rel) {
  const keys = envKeys(rel);
  if (keys.size === 0) return;
  errors.push(`${rel} must be comment-only for local devprod; move assignments to root .env.local`);
}

function checkLocalLiveEnv() {
  checkNoDuplicateEnvKeys(files.rootEnvLocal);
  for (const name of forbiddenNames) {
    forbidText(files.rootEnvLocal, name, `${files.rootEnvLocal} still contains deprecated ${name}`);
  }
  checkCommentOnlyEnv(files.rootEnv);
  checkCommentOnlyEnv(files.governanceEnvLocal);

  const rootLocalKeys = envKeys(files.rootEnvLocal);
  for (const key of ["TELEGRAM_OIDC_CLIENT_ID", "TELEGRAM_OIDC_CLIENT_SECRET"]) {
    if (!rootLocalKeys.has(key)) {
      errors.push(`${files.rootEnvLocal} is missing ${key}; keep an empty placeholder if Telegram OIDC is not configured yet`);
    }
  }
}

function backupLocalEnvFiles() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join("/private/tmp", `agents-arena-env-backup-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  for (const rel of [
    files.rootEnv,
    files.rootEnvLocal,
    files.governanceEnvLocal,
  ]) {
    const source = abs(rel);
    if (!fs.existsSync(source)) continue;
    const target = path.join(backupDir, rel.replaceAll("/", "__"));
    fs.copyFileSync(source, target);
  }

  localFixNotes.push(`Backup written to ${backupDir}`);
}

function preferredAssignments(assignments) {
  const byKey = new Map();
  for (const assignment of assignments) {
    const current = byKey.get(assignment.key);
    if (!current) {
      byKey.set(assignment.key, assignment);
      continue;
    }
    if (!isNonEmptyAssignment(current) && isNonEmptyAssignment(assignment)) {
      byKey.set(assignment.key, assignment);
    }
  }
  return byKey;
}

function fixLocalLiveEnv() {
  backupLocalEnvFiles();

  const rootLines = readIfExists(files.rootEnvLocal).split(/\r?\n/);
  const rootAssignments = parseEnvAssignments(files.rootEnvLocal);
  const preferredRoot = preferredAssignments(rootAssignments);
  const keptAssignmentIndexes = new Set();
  const deprecated = new Set(forbiddenNames);

  for (const [key, assignment] of preferredRoot.entries()) {
    if (!deprecated.has(key)) keptAssignmentIndexes.add(assignment.index);
  }

  const cleanedRootLines = [];
  rootLines.forEach((line, index) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) {
      cleanedRootLines.push(line);
      return;
    }
    if (keptAssignmentIndexes.has(index)) {
      cleanedRootLines.push(line);
    }
  });

  const currentRootAssignments = preferredAssignments(
    cleanedRootLines.map((line, index) => {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
      if (!match) return null;
      return { index, key: match[1], raw: line, value: match[2].trim() };
    }).filter(Boolean),
  );

  const candidateMoves = [
    ...parseEnvAssignments(files.rootEnv),
    ...parseEnvAssignments(files.governanceEnvLocal),
  ].filter((assignment) => !deprecated.has(assignment.key));

  const appended = [];
  for (const assignment of candidateMoves) {
    const current = currentRootAssignments.get(assignment.key);
    if (current && isNonEmptyAssignment(current)) continue;
    if (appended.some((item) => item.key === assignment.key)) continue;
    appended.push(assignment);
    currentRootAssignments.set(assignment.key, assignment);
  }

  const placeholders = [
    "TELEGRAM_OIDC_CLIENT_ID",
    "TELEGRAM_OIDC_CLIENT_SECRET",
  ].filter((key) => !currentRootAssignments.has(key));

  if (appended.length > 0 || placeholders.length > 0) {
    cleanedRootLines.push("");
    cleanedRootLines.push("# Migrated local/devprod env ownership.");
    for (const assignment of appended) {
      cleanedRootLines.push(assignment.raw);
    }
    for (const key of placeholders) {
      cleanedRootLines.push(`${key}=`);
    }
  }

  fs.writeFileSync(abs(files.rootEnvLocal), `${cleanedRootLines.join("\n").replace(/\n+$/g, "")}\n`);

  fs.writeFileSync(
    abs(files.rootEnv),
    [
      "# Local Docker/devprod env lives in .env.local.",
      "# This file is intentionally comment-only.",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    abs(files.governanceEnvLocal),
    [
      "# Direct Next-only local overrides are intentionally disabled for devprod.",
      "# Local Docker/devprod env lives in the repo root .env.local.",
      "",
    ].join("\n"),
  );

  localFixNotes.push("Local env files cleaned without printing secret values.");
}

if (fixLocal) {
  fixLocalLiveEnv();
}

checkNoDuplicateEnvKeys(files.rootExample);
checkNoDuplicateEnvKeys(files.governanceExample);
requireKeys(files.rootExample, rootExampleKeys);
requireKeys(files.governanceExample, governanceExampleKeys);
requireComposeEnvironmentKeys(composeGovernanceKeys);
for (const key of composeArenaBotKeys) {
  if (!composeEnvironmentKeys("arena-bot").has(key)) {
    errors.push(`${files.compose} arena-bot.environment is missing ${key}`);
  }
}
forbidUnknownEnvKeys(files.rootExample, rootExampleKeys);
forbidUnknownEnvKeys(files.governanceExample, governanceExampleKeys);
forbidUnknownComposeEnvironmentKeys("governance-platform", composeGovernanceKeys);
forbidUnknownComposeEnvironmentKeys("arena-bot", composeArenaBotKeys);
forbidText(
  files.compose,
  "TELEGRAM_BOT_TOKEN",
  `${files.compose} must not pass TELEGRAM_BOT_TOKEN to governance-platform; it is a ProjectSecret runtime key`,
);

for (const name of forbiddenNames) {
  for (const rel of [
    files.rootExample,
    files.governanceExample,
    files.compose,
    files.contract,
  ]) {
    forbidText(rel, name, `${rel} still references deprecated ${name}; use Telegram OIDC client credentials`);
  }
}

requireText(
  files.contract,
  "`ProjectSecret` is for project/app runtime env only",
  `${files.contract} must keep the ProjectSecret/platform env boundary explicit`,
);
requireText(
  files.contract,
  "`TELEGRAM_OIDC_CLIENT_ID`, `TELEGRAM_OIDC_CLIENT_SECRET`",
  `${files.contract} must keep Telegram OIDC env ownership explicit`,
);
requireText(
  files.contract,
  "`TELEGRAM_WEBAPP_BOT_ID`",
  `${files.contract} must keep Telegram WebApp verification env ownership explicit`,
);
requireText(
  files.contract,
  "`TELEGRAM_BOT_TOKEN` remains a project runtime secret",
  `${files.contract} must keep Telegram platform auth separate from project runtime secrets`,
);
requireText(
  files.contract,
  "`ARENA_BOT_TELEGRAM_TOKEN`",
  `${files.contract} must document arena bot delivery env ownership`,
);

checkLocalLiveEnv();

if (errors.length > 0) {
  console.error("Env contract check failed:");
  for (const error of errors) console.error(`- ${error}`);
  if (!fixLocal) {
    console.error("To normalize local ignored env placement, run: node scripts/check-env-contract.mjs --fix-local");
  }
  process.exit(1);
}

for (const note of localFixNotes) console.log(note);
console.log("Env contract check passed.");
