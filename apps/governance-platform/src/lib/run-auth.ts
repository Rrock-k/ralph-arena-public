import { getTokenManager } from "./token-manager";
import { isAuthdConfigured, mintRunAuthFromAuthd } from "./authd-client";
import { createHash } from "crypto";
import { getUserProviderAuthEnv, providerForAgent } from "@/lib/user-provider-credentials";
import { isAntigravityRuntimeAgent, isOpenCodeRuntimeAgent } from "@/lib/agent-runtime-support";

export interface RunAuthModes {
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
}

export interface RunAuthSnapshot {
  auth: Record<string, string>;
  version?: string;
}

export interface RunAuthBuildOptions {
  userId?: string | null;
  agent?: string | null;
}

export function narrowRunAuthModesForAgent(agent: string, modes: RunAuthModes): RunAuthModes {
  if (agent === "codex") {
    return {
      claudeAuthMode: "api_key",
      codexAuthMode: resolveCodexAuthMode(modes),
    };
  }

  if (agent === "claude-code") {
    return {
      claudeAuthMode: resolveClaudeAuthMode(modes),
      codexAuthMode: "api_key",
    };
  }

  if (isAntigravityRuntimeAgent(agent)) {
    return {
      claudeAuthMode: null,
      codexAuthMode: null,
    };
  }

  if (isOpenCodeRuntimeAgent(agent)) {
    return {
      claudeAuthMode: null,
      codexAuthMode: null,
    };
  }

  return {
    claudeAuthMode: "api_key",
    codexAuthMode: "api_key",
  };
}

export class RuntimeAuthUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = "RuntimeAuthUnavailableError";
  }
}

function hashAuthEnv(auth: Record<string, string>): string | undefined {
  const entries = Object.entries(auth)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return undefined;
  return createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex")
    .slice(0, 16);
}

function resolveClaudeAuthMode(modes: RunAuthModes): string {
  return modes.claudeAuthMode || "oauth";
}

function resolveCodexAuthMode(modes: RunAuthModes): string | null {
  return modes.codexAuthMode || null;
}

function requiresAuthd(modes: RunAuthModes): boolean {
  return resolveClaudeAuthMode(modes) === "oauth" || resolveCodexAuthMode(modes) === "subscription";
}

function hasUserProviderBuildAuth(opts?: RunAuthBuildOptions): boolean {
  return Boolean(opts?.userId && providerForAgent(opts.agent ?? ""));
}

export function resolveRunAuthModesForBuild(
  modes: RunAuthModes,
  opts?: RunAuthBuildOptions,
): RunAuthModes {
  if (!opts?.userId) return modes;

  const userProvider = providerForAgent(opts.agent ?? "");
  if (userProvider === "openai") {
    return { ...modes, codexAuthMode: "api_key" };
  }
  if (userProvider === "anthropic") {
    return { ...modes, claudeAuthMode: "api_key" };
  }
  if (userProvider === "opencode") {
    return { claudeAuthMode: null, codexAuthMode: null };
  }
  return modes;
}

async function assembleOpenCodeAuthEnv(opts?: RunAuthBuildOptions): Promise<Record<string, string>> {
  const provider = providerForAgent(opts?.agent ?? "");
  if (provider !== "opencode") return {};

  if (opts?.userId) {
    const userEnv = await getUserProviderAuthEnv(opts.userId, provider);
    return userEnv;
  }

  const shared = getTokenManager().getTokens("opencode-api") ?? {};
  if (shared.OPENCODE_API_KEY) {
    return { OPENCODE_API_KEY: shared.OPENCODE_API_KEY };
  }

  // OpenCode Zen free models are a verified credentialless CLI path. Keep
  // OPENCODE_API_KEY as an optional override, not as a launch precondition.
  return {};
}

/**
 * Assemble API-key auth env vars from current TokenManager state.
 * OAuth/subscription auth now comes only from authd.
 */
async function assembleApiKeyAuthEnv(
  modes: RunAuthModes,
  opts?: RunAuthBuildOptions,
): Promise<Record<string, string>> {
  const tm = getTokenManager();
  const authEnv: Record<string, string> = {};
  const claudeAuthMode = resolveClaudeAuthMode(modes);
  const codexAuthMode = resolveCodexAuthMode(modes);
  const userProvider = providerForAgent(opts?.agent ?? "");

  if (opts?.userId && userProvider) {
    const userEnv = await getUserProviderAuthEnv(opts.userId, userProvider);
    if (Object.keys(userEnv).length > 0) {
      return userEnv;
    }
    throw new RuntimeAuthUnavailableError(
      `User ${userProvider} API key is required for this run but is not configured.`,
    );
  }

  if (claudeAuthMode !== "oauth") {
    const claude = tm.getTokens("claude-api");
    if (claude.ANTHROPIC_API_KEY)
      authEnv.ANTHROPIC_API_KEY = claude.ANTHROPIC_API_KEY;
  }

  if (codexAuthMode !== "subscription") {
    const openai = tm.getTokens("openai-api");
    if (openai.OPENAI_API_KEY) authEnv.OPENAI_API_KEY = openai.OPENAI_API_KEY;
  }

  for (const requirement of requiredSharedApiKeyEnvVars(modes, opts)) {
    if (!authEnv[requirement.envKey]) {
      throw new RuntimeAuthUnavailableError(
        `Shared ${requirement.providerName} API key is required for this run but is not configured.`,
      );
    }
  }

  return authEnv;
}

function requiredSharedApiKeyEnvVars(
  modes: RunAuthModes,
  opts?: RunAuthBuildOptions,
): { envKey: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"; providerName: string }[] {
  const agent = opts?.agent ?? "";
  const provider = providerForAgent(agent);
  const claudeAuthMode = resolveClaudeAuthMode(modes);
  const codexAuthMode = resolveCodexAuthMode(modes);

  if (provider === "openai") {
    return codexAuthMode !== "subscription"
      ? [{ envKey: "OPENAI_API_KEY", providerName: "OpenAI" }]
      : [];
  }
  if (provider === "anthropic") {
    return claudeAuthMode !== "oauth"
      ? [{ envKey: "ANTHROPIC_API_KEY", providerName: "Anthropic" }]
      : [];
  }
  return [];
}

function toSnapshot(auth: Record<string, string>): RunAuthSnapshot {
  return {
    auth,
    version: hashAuthEnv(auth),
  };
}

async function mintAuthdSnapshot(
  modes: RunAuthModes,
  buildOpts?: RunAuthBuildOptions,
  opts?: { fresh?: boolean },
): Promise<RunAuthSnapshot> {
  try {
    const authdAuth = await mintRunAuthFromAuthd(modes, opts);
    const merged = {
      ...(await assembleApiKeyAuthEnv(modes, buildOpts)),
      ...authdAuth,
    };

    return toSnapshot(merged);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeAuthUnavailableError(`Runtime auth mint via authd failed: ${message}`);
  }
}

function assertRuntimeAuthAvailable(modes: RunAuthModes): void {
  if (!requiresAuthd(modes)) return;
  if (isAuthdConfigured()) return;
  throw new RuntimeAuthUnavailableError(
    "Runtime auth requires authd for Claude OAuth / Codex subscription, but AUTHD_URL is not configured.",
  );
}

/**
 * Build auth env vars for a container run.
 * OAuth/subscription providers are sourced from authd.
 * API-key providers still come from TokenManager until authd owns them too.
 */
export async function buildRunAuthSnapshot(
  modes: RunAuthModes,
  opts?: RunAuthBuildOptions,
): Promise<RunAuthSnapshot> {
  const effectiveModes = resolveRunAuthModesForBuild(modes, opts);
  if (isAntigravityRuntimeAgent(opts?.agent)) {
    return toSnapshot({});
  }
  if (isOpenCodeRuntimeAgent(opts?.agent)) {
    if (!hasUserProviderBuildAuth(opts)) {
      getTokenManager().triggerRefreshAsync();
    }
    return toSnapshot(await assembleOpenCodeAuthEnv(opts));
  }
  if (requiresAuthd(effectiveModes)) {
    assertRuntimeAuthAvailable(effectiveModes);
    return await mintAuthdSnapshot(effectiveModes, opts);
  }

  if (!hasUserProviderBuildAuth(opts)) {
    getTokenManager().triggerRefreshAsync();
  }
  return toSnapshot(await assembleApiKeyAuthEnv(effectiveModes, opts));
}

export async function buildRunAuthEnv(
  modes: RunAuthModes,
  opts?: RunAuthBuildOptions,
): Promise<Record<string, string>> {
  const snapshot = await buildRunAuthSnapshot(modes, opts);
  return snapshot.auth;
}

/**
 * Build auth env with sync refresh for API-key modes, or a fresh authd mint for OAuth/subscription modes.
 */
export async function buildRunAuthSnapshotFresh(
  modes: RunAuthModes,
  opts?: RunAuthBuildOptions,
): Promise<RunAuthSnapshot> {
  const effectiveModes = resolveRunAuthModesForBuild(modes, opts);
  if (isAntigravityRuntimeAgent(opts?.agent)) {
    return toSnapshot({});
  }
  if (isOpenCodeRuntimeAgent(opts?.agent)) {
    if (!hasUserProviderBuildAuth(opts)) {
      await getTokenManager().triggerRefreshSync();
    }
    return toSnapshot(await assembleOpenCodeAuthEnv(opts));
  }
  if (requiresAuthd(effectiveModes)) {
    assertRuntimeAuthAvailable(effectiveModes);
    return await mintAuthdSnapshot(effectiveModes, opts, { fresh: true });
  }

  if (!hasUserProviderBuildAuth(opts)) {
    const tm = getTokenManager();

    // 1. Sync refresh — blocks until refresh-tokens.sh completes
    await tm.triggerRefreshSync();
  }

  return toSnapshot(await assembleApiKeyAuthEnv(effectiveModes, opts));
}

export async function buildRunAuthEnvFresh(
  modes: RunAuthModes,
  opts?: RunAuthBuildOptions,
): Promise<Record<string, string>> {
  const snapshot = await buildRunAuthSnapshotFresh(modes, opts);
  return snapshot.auth;
}
