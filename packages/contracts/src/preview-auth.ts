/**
 * RA-055: Shared preview auth — HMAC-signed cookies for preview access.
 *
 * Used by:
 * - governance preview-gate (Caddy forward_auth, local Docker)
 * - arena-runner auth-proxy (VPS)
 */

import { createHmac } from "crypto";

export interface PreviewAuthPayload {
  userId: string;
  email: string | null;
}

interface SignedPayload extends PreviewAuthPayload {
  projectId: string;
  exp: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Sign a preview auth payload into a cookie value: base64url(JSON).hmac
 */
export function signPreviewAuth(
  secret: string,
  payload: PreviewAuthPayload,
  projectId: string,
): string {
  const data: SignedPayload = { ...payload, projectId, exp: Date.now() + TTL_MS };
  const b64 = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

/**
 * Verify and decode a preview auth cookie. Returns null if invalid/expired/wrong project.
 */
export function verifyPreviewAuth(
  secret: string,
  cookie: string,
  projectId: string,
): PreviewAuthPayload | null {
  const [b64, sig] = cookie.split(".");
  if (!b64 || !sig) return null;

  const expectedSig = createHmac("sha256", secret).update(b64).digest("base64url");
  if (sig !== expectedSig) return null;

  try {
    const data: SignedPayload = JSON.parse(Buffer.from(b64, "base64url").toString());
    if (data.projectId !== projectId) return null;
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { userId: data.userId, email: typeof data.email === "string" ? data.email : null };
  } catch {
    return null;
  }
}

/**
 * Build an anonymous per-project ID from userId + projectId.
 * Containers never see real user identity — only this opaque hash.
 */
export function buildAnonId(secret: string, userId: string, projectId: string): string {
  return createHmac("sha256", secret).update(`${userId}:${projectId}`).digest("hex").slice(0, 16);
}
