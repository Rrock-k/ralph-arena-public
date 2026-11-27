export type AdminApiAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

function readConfiguredSecret(): string | null {
  const value = process.env.ARENA_ADMIN_SECRET?.trim();
  return value || null;
}

export function getAdminApiAuthResult(request: Request): AdminApiAuthResult {
  const expected = readConfiguredSecret();
  if (!expected) {
    return { ok: false, status: 503, error: "Admin API not configured" };
  }

  const provided = request.headers.get("x-arena-admin-secret")?.trim();
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

export function isAdminApiAuthorized(request: Request): boolean {
  return getAdminApiAuthResult(request).ok;
}
