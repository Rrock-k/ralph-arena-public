import { randomBytes } from "crypto";

interface HandoffToken {
  code: string;
  projectId: string;
  userId: string;
  email: string | null;
  expiresAt: number;
}

const store = new Map<string, HandoffToken>();

const TTL_MS = 60_000; // 60 seconds
const CLEANUP_INTERVAL_MS = 30_000;

// Periodic cleanup of expired tokens
setInterval(() => {
  const now = Date.now();
  store.forEach((token, code) => {
    if (token.expiresAt < now) store.delete(code);
  });
}, CLEANUP_INTERVAL_MS).unref();

export function createHandoffCode(projectId: string, user: { id: string; email?: string | null }): string {
  const code = randomBytes(32).toString("hex");
  store.set(code, {
    code,
    projectId,
    userId: user.id,
    email: user.email ?? null,
    expiresAt: Date.now() + TTL_MS,
  });
  return code;
}

export function exchangeHandoffCode(code: string, projectId: string): { userId: string; email: string | null } | null {
  const token = store.get(code);
  if (!token) return null;

  // Single-use: always delete
  store.delete(code);

  // Check expiry
  if (token.expiresAt < Date.now()) return null;

  // Check project scope
  if (token.projectId !== projectId) return null;

  return { userId: token.userId, email: token.email };
}

/**
 * Validate a handoff code WITHOUT consuming it.
 * Used by Caddy forward_auth gate — called on every sub-request (CSS, JS, images),
 * so the token must survive multiple validations within its TTL.
 */
export function peekHandoffCode(code: string, projectId: string): { userId: string; email: string | null } | null {
  const token = store.get(code);
  if (!token) return null;
  if (token.expiresAt < Date.now()) return null;
  if (token.projectId !== projectId) return null;
  return { userId: token.userId, email: token.email };
}
