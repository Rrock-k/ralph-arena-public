import net from "node:net";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

export type ArenaCtlConfig = {
  repoRoot: string;
  governanceUrl: string;
  adminSecret: string;
  workerSecret: string;
  workspaceRoot: string;
};

export function loadConfig(): ArenaCtlConfig {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(process.env.ARENA_REPO_ROOT || path.join(moduleDir, "..", "..", ".."));
  const adminSecret = process.env.ARENA_ADMIN_SECRET?.trim();
  const governanceUrl = (process.env.GOVERNANCE_ADMIN_URL || process.env.GOVERNANCE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

  if (!adminSecret) {
    throw new Error("ARENA_ADMIN_SECRET is required");
  }

  assertInternalGovernanceUrl(governanceUrl);

  return {
    repoRoot,
    governanceUrl,
    adminSecret,
    workerSecret: process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET || "",
    workspaceRoot: path.resolve(
      process.env.WORKSPACE_ROOT
      || process.env.ARENA_PROJECT_WORKSPACES_ROOT
      || getDefaultWorkspaceRoot(repoRoot),
    ),
  };
}

function getDefaultWorkspaceRoot(repoRoot: string): string {
  const home = process.env.ARENA_HOME_PATH || process.env.HOME || os.homedir();
  return home
    ? path.join(home, ".arena-runtime", "project-workspaces")
    : path.join(repoRoot, "runtime", "project-workspaces");
}

function assertInternalGovernanceUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid governance admin URL: ${rawUrl}`);
  }

  if (!isAllowedGovernanceHost(url.hostname)) {
    throw new Error(
      `Refusing public governance admin URL: ${rawUrl}. Use localhost, docker-internal host, ssh tunnel, private IP, or Tailscale.`,
    );
  }
}

function isAllowedGovernanceHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;

  if (
    host === "localhost"
    || host === "127.0.0.1"
    || host === "0.0.0.0"
    || host === "::1"
    || host === "[::1]"
    || host === "governance-platform"
    || host === "host.docker.internal"
    || host.endsWith(".localhost")
    || host.endsWith(".internal")
    || host.endsWith(".ts.net")
  ) {
    return true;
  }

  if (net.isIP(host)) {
    return isPrivateIp(host);
  }

  return false;
}

function isPrivateIp(host: string): boolean {
  if (net.isIPv4(host)) {
    const [a = 0, b = 0] = host.split(".").map((part) => Number(part));
    return a === 10
      || a === 127
      || a === 192 && b === 168
      || a === 172 && b >= 16 && b <= 31
      || a === 100 && b >= 64 && b <= 127;
  }

  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}
