import "server-only";

export const INTERNAL_ACTION_TOKEN = Symbol("ralph-arena.internal-action");

export function requireInternalActionToken(token: unknown): { success: false; error: string } | null {
  if (token === INTERNAL_ACTION_TOKEN) return null;
  return {
    success: false,
    error: "Internal action is not callable directly.",
  };
}
