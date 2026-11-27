import { extractBypassHost, isLocalBypassHost } from "@/lib/e2e-auth-bypass";

function readHostnameFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function getPublicControlPlaneHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>();

  for (const value of [env.AUTH_URL, env.NEXTAUTH_URL, env.GOVERNANCE_PUBLIC_URL]) {
    const host = readHostnameFromUrl(value);
    if (!host || isLocalBypassHost(host)) continue;
    hosts.add(host);
  }

  return hosts;
}

export function isPublicControlPlaneHost(
  requestHost: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const host = extractBypassHost(requestHost);
  if (!host || isLocalBypassHost(host)) {
    return false;
  }

  return getPublicControlPlaneHosts(env).has(host);
}

export function shouldBlockPublicControlPlaneRequest(input: {
  pathname: string;
  requestHost: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.pathname !== "/api/admin/ctl" && !input.pathname.startsWith("/api/admin/ctl/")) {
    return false;
  }

  return isPublicControlPlaneHost(input.requestHost, input.env);
}
