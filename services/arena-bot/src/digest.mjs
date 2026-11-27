import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_TELEGRAM_TEXT_LENGTH = 4096;

export function extractLatestOperatorDigest(markdown) {
  return extractLatestOperatorDigestEntry(markdown)?.digest ?? null;
}

export function extractLatestOperatorDigestEntry(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  let marker = null;
  let headingStack = [];

  lines.forEach((line, index) => {
    const heading = parseHeading(line);
    const parentHeading = heading
      ? [...headingStack].reverse().find((item) => item.level < heading.level) ?? null
      : headingStack[headingStack.length - 1] ?? null;
    const label = normalizeMarkerLabel(heading?.text ?? line);
    if (label === "operator digest") {
      marker = {
        index,
        headingLevel: heading?.level ?? null,
        parentHeading,
      };
    }
    if (heading) {
      headingStack = headingStack.filter((item) => item.level < heading.level);
      headingStack.push({
        ...heading,
        index,
      });
    }
  });

  if (!marker) return null;

  const collected = [];
  for (let index = marker.index + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = parseHeading(line);
    if (
      heading
      && marker.headingLevel !== null
      && heading.level <= marker.headingLevel
    ) {
      break;
    }
    if (
      marker.headingLevel === null
      && collected.some((item) => item.trim())
      && line.trim() === ""
    ) {
      break;
    }
    collected.push(line);
  }

  const digest = trimBlankEdges(collected).join("\n").trim();
  if (!digest) return null;
  const createdAtMs = parseDigestHeadingTimestampMs(marker.parentHeading?.text);
  return {
    digest,
    createdAt: createdAtMs === null ? null : new Date(createdAtMs).toISOString(),
    createdAtMs,
  };
}

export function digestHash(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

export function truncateTelegramText(text, maxLength = DEFAULT_MAX_TELEGRAM_TEXT_LENGTH) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 16)).trimEnd()}\n[truncated]`;
}

export function loadSentState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    return {};
  }
}

export function saveSentState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const tmpFile = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmpFile, stateFile);
}

export function parseSourceFiles(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function sendTelegramMessage({ token, chatId, text, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: truncateTelegramText(text),
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await safeResponseText(response);
    throw new Error(`Telegram sendMessage failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
}

export async function runOnce(config, deps = {}) {
  const readFile = deps.readFile ?? ((file) => fs.readFileSync(file, "utf8"));
  const loadState = deps.loadState ?? loadSentState;
  const saveState = deps.saveState ?? saveSentState;
  const sendMessage = deps.sendMessage ?? sendTelegramMessage;

  let markdown = "";
  try {
    markdown = readFile(config.sourceFile);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "missing_source", sourceFile: config.sourceFile };
    }
    throw error;
  }

  const digestEntry = extractLatestOperatorDigestEntry(markdown);
  if (!digestEntry) {
    return { status: "no_digest", sourceFile: config.sourceFile };
  }
  const digest = digestEntry.digest;

  const hash = digestHash(digest);
  const maxDigestAgeMs = Number(config.maxDigestAgeMs || 0);
  const nowMs = typeof deps.now === "function" ? deps.now().getTime() : Date.now();
  if (
    Number.isFinite(maxDigestAgeMs)
    && maxDigestAgeMs > 0
    && digestEntry.createdAtMs !== null
    && nowMs - digestEntry.createdAtMs > maxDigestAgeMs
  ) {
    return {
      status: "stale_digest",
      digestHash: hash,
      sourceFile: config.sourceFile,
      createdAt: digestEntry.createdAt,
      maxAgeMs: maxDigestAgeMs,
    };
  }

  const state = loadState(config.stateFile);
  const sourceState = getSourceState(state, config.sourceFile);
  if (sourceState.lastDigestHash === hash) {
    return { status: "already_sent", digestHash: hash };
  }

  if (!config.telegramBotToken || !config.telegramChatId) {
    return { status: "not_configured", digestHash: hash };
  }

  if (config.dryRun) {
    return { status: "dry_run", digestHash: hash, digest };
  }

  await sendMessage({
    token: config.telegramBotToken,
    chatId: config.telegramChatId,
    text: digest,
    fetchImpl: deps.fetchImpl,
  });

  const sentAt = new Date().toISOString();
  saveState(config.stateFile, buildNextSentState(state, config.sourceFile, {
    lastDigestHash: hash,
    lastSentAt: sentAt,
  }));

  return { status: "sent", digestHash: hash, sentAt };
}

export async function runAllSourcesOnce(config, deps = {}) {
  const sourceFiles = Array.isArray(config.sourceFiles) && config.sourceFiles.length > 0
    ? config.sourceFiles
    : [config.sourceFile].filter(Boolean);
  const results = [];
  for (const sourceFile of sourceFiles) {
    results.push(await runOnce({
      ...config,
      sourceFile,
    }, deps));
  }
  return results;
}

function parseHeading(line) {
  const match = String(line).match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  return {
    level: match[1].length,
    text: match[2],
  };
}

function normalizeMarkerLabel(value) {
  return String(value)
    .replace(/^\s*-\s+/, "")
    .replace(/[`*_:#]/g, "")
    .trim()
    .toLowerCase();
}

function trimBlankEdges(lines) {
  const copy = [...lines];
  while (copy.length > 0 && copy[0].trim() === "") copy.shift();
  while (copy.length > 0 && copy[copy.length - 1].trim() === "") copy.pop();
  return copy;
}

function parseDigestHeadingTimestampMs(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\s*(Z|[+-]\d{2}(?::?\d{2})?))?/);
  if (!match) return null;

  const [, date, hour = "00", minute = "00", second = "00", rawOffset = "Z"] = match;
  const offset = normalizeDateOffset(rawOffset || "Z");
  const parsed = Date.parse(`${date}T${hour}:${minute}:${second}${offset}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateOffset(value) {
  if (value === "Z") return "Z";
  const match = String(value).match(/^([+-])(\d{2})(?::?(\d{2}))?$/);
  if (!match) return "Z";
  return `${match[1]}${match[2]}:${match[3] ?? "00"}`;
}

function getSourceState(state, sourceFile) {
  const sources = state && typeof state === "object" && !Array.isArray(state) ? state.sources : null;
  if (sources && typeof sources === "object" && !Array.isArray(sources)) {
    const sourceState = sources[sourceFile];
    if (sourceState && typeof sourceState === "object" && !Array.isArray(sourceState)) {
      return sourceState;
    }
  }

  if (state?.sourceFile === sourceFile || (!state?.sources && state?.lastDigestHash)) {
    return {
      lastDigestHash: state.lastDigestHash,
      lastSentAt: state.lastSentAt,
    };
  }
  return {};
}

function buildNextSentState(state, sourceFile, sourceState) {
  const current = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  const currentSources = current.sources && typeof current.sources === "object" && !Array.isArray(current.sources)
    ? current.sources
    : {};
  return {
    ...current,
    lastDigestHash: sourceState.lastDigestHash,
    lastSentAt: sourceState.lastSentAt,
    sourceFile,
    sources: {
      ...currentSources,
      [sourceFile]: {
        lastDigestHash: sourceState.lastDigestHash,
        lastSentAt: sourceState.lastSentAt,
      },
    },
  };
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
