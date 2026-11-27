import { cookies, headers } from "next/headers";

const E2E_ADMIN_COOKIE = "e2e_admin_bypass";
const LOCAL_BYPASS_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "governance-platform",
]);

export function extractBypassHost(input?: string | null): string | null {
  if (!input) return null;
  const raw = input.split(",")[0]?.trim();
  if (!raw) return null;

  if (raw.includes("://")) {
    try {
      return new URL(raw).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  if (raw.startsWith("[")) {
    const closingIndex = raw.indexOf("]");
    if (closingIndex >= 0) {
      return raw.slice(1, closingIndex).toLowerCase();
    }
  }

  return raw.split(":")[0]?.trim().toLowerCase() || null;
}

export function isLocalBypassHost(host: string | null): boolean {
  if (!host) return false;
  return LOCAL_BYPASS_HOSTS.has(host) || host.endsWith(".localhost");
}

export function shouldAllowE2EAdminBypass(input: {
  playwrightTest: string | undefined;
  requestHost: string | null;
  bypassCookie: string | null;
}): boolean {
  return input.playwrightTest === "1"
    && isLocalBypassHost(input.requestHost)
    && input.bypassCookie === "1";
}

/**
 * Enables admin-only paths in Playwright environment when explicit cookie is set.
 * This is intentionally unavailable outside PLAYWRIGHT_TEST mode.
 */
export async function hasE2EAdminBypass(): Promise<boolean> {
  if (process.env.PLAYWRIGHT_TEST !== "1") {
    return false;
  }

  let requestHost: string | null = null;
  try {
    const requestHeaders = await headers();
    requestHost = extractBypassHost(requestHeaders.get("host"));
  } catch {
    return false;
  }

  const cookieStore = await cookies();
  return shouldAllowE2EAdminBypass({
    playwrightTest: process.env.PLAYWRIGHT_TEST,
    requestHost,
    bypassCookie: cookieStore.get(E2E_ADMIN_COOKIE)?.value ?? null,
  });
}
