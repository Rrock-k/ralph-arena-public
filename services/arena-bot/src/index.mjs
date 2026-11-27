import { parseSourceFiles, runAllSourcesOnce } from "./digest.mjs";

const legacySourceFile = process.env.ARENA_BOT_WEEKLY_DIGEST_SOURCE_FILE || "/automation/memory.md";
export function resolveDigestSourceFiles({ configuredSourceFiles, legacySourceFile }) {
  const explicitSourceFiles = parseSourceFiles(configuredSourceFiles);
  if (explicitSourceFiles.length > 0) return explicitSourceFiles;
  return [
    legacySourceFile || "/automation/memory.md",
    "/automations/ralph-authd-relogin-reminder/memory.md",
  ];
}

const config = {
  sourceFile: legacySourceFile,
  sourceFiles: resolveDigestSourceFiles({
    configuredSourceFiles: process.env.ARENA_BOT_DIGEST_SOURCE_FILES,
    legacySourceFile,
  }),
  stateFile: process.env.ARENA_BOT_STATE_FILE || "/state/arena-bot.json",
  telegramBotToken: process.env.ARENA_BOT_TELEGRAM_TOKEN || "",
  telegramChatId: process.env.ARENA_BOT_TELEGRAM_CHAT_ID || "",
  pollIntervalMs: parsePositiveInt(process.env.ARENA_BOT_WEEKLY_DIGEST_POLL_INTERVAL_MS, 30_000),
  maxDigestAgeMs: parsePositiveNumber(process.env.ARENA_BOT_DIGEST_MAX_AGE_HOURS, 0) * 60 * 60 * 1000,
  dryRun: process.env.ARENA_BOT_WEEKLY_DIGEST_DRY_RUN === "1",
  runOnce: process.env.ARENA_BOT_RUN_ONCE === "1",
};

const lastLogKeys = new Set();

async function main() {
  log(
    `arena-bot starting sources=${config.sourceFiles.join(",")} intervalMs=${config.pollIntervalMs}`,
  );

  if (config.runOnce) {
    const results = await runAndLog();
    if (results.every((result) => result.status === "sent" || isNonFatalStatus(result.status))) return;
    process.exitCode = 1;
    return;
  }

  while (true) {
    try {
      await runAndLog();
    } catch (error) {
      log(`error: ${error.message}`);
    }
    await sleep(config.pollIntervalMs);
  }
}

async function runAndLog() {
  const results = await runAllSourcesOnce(config);
  for (const result of results) {
    logResult(result);
  }
  return results;
}

function logResult(result) {
  const key = `${result.status}:${result.digestHash ?? ""}:${result.sourceFile ?? ""}`;
  if (lastLogKeys.has(key) && result.status !== "sent") return;
  lastLogKeys.add(key);

  if (result.status === "sent") {
    log(`sent digest hash=${result.digestHash} at=${result.sentAt}`);
    return;
  }
  if (result.status === "already_sent") {
    log(`digest already sent hash=${result.digestHash}`);
    return;
  }
  if (result.status === "not_configured") {
    log("delivery disabled: ARENA_BOT_TELEGRAM_TOKEN or ARENA_BOT_TELEGRAM_CHAT_ID is empty");
    return;
  }
  if (result.status === "missing_source") {
    log(`waiting for source file: ${result.sourceFile}`);
    return;
  }
  if (result.status === "no_digest") {
    log(`waiting for Operator digest in ${result.sourceFile}`);
    return;
  }
  if (result.status === "stale_digest") {
    log(`skipping stale digest in ${result.sourceFile} createdAt=${result.createdAt ?? "unknown"}`);
    return;
  }
  if (result.status === "dry_run") {
    log(`dry run, digest hash=${result.digestHash}`);
  }
}

function isNonFatalStatus(status) {
  return ["already_sent", "not_configured", "missing_source", "no_digest", "stale_digest", "dry_run"].includes(status);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[arena-bot] ${message}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[arena-bot] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}
