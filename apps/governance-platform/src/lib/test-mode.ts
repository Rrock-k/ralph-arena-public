import { extractBypassHost, isLocalBypassHost } from "@/lib/e2e-auth-bypass";

export function getRequestHost(request: Request): string | null {
  return extractBypassHost(request.headers.get("host"))
    || extractBypassHost(request.url);
}

export function isTestModeEnabledForRequest(request: Request): boolean {
  const enabled = process.env.PLAYWRIGHT_TEST === "1" || process.env.ARENA_TEST_API === "1";
  if (!enabled) return false;
  return isLocalBypassHost(getRequestHost(request));
}
