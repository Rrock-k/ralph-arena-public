import os from "os";
import path from "path";

export interface AuthdConfig {
  port: number;
  secret: string;
  probeTimeoutMs: number;
  claudeCredentialsPath: string;
  codexAuthJsonPath: string;
  claudeRefreshCommand?: string;
  codexRefreshCommand?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AuthdConfig {
  return {
    port: parsePositiveInt(env.AUTHD_PORT, 4311),
    secret: env.AUTHD_SECRET?.trim() || "",
    probeTimeoutMs: parsePositiveInt(env.AUTHD_PROBE_TIMEOUT_MS, 5_000),
    claudeCredentialsPath:
      env.AUTHD_CLAUDE_CREDENTIALS_PATH || path.join(os.homedir(), ".claude", ".credentials.json"),
    codexAuthJsonPath: env.AUTHD_CODEX_AUTH_JSON_PATH || path.join(os.homedir(), ".codex", "auth.json"),
    claudeRefreshCommand: env.AUTHD_CLAUDE_REFRESH_CMD?.trim() || undefined,
    codexRefreshCommand: env.AUTHD_CODEX_REFRESH_CMD?.trim() || undefined,
  };
}
