export type RequiredSecretEntry = {
  key: string;
  description?: string;
  blocking?: boolean;
  requestedAt?: string;
  requestedByRunId?: string;
};

export function normalizeRequiredSecretKey(key: string | null | undefined): string {
  return (key ?? "").trim().toUpperCase();
}

export function isValidRequiredSecretKey(key: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(key);
}

export function parseRequiredSecrets(raw: string | null | undefined): RequiredSecretEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const key = normalizeRequiredSecretKey((entry as { key?: string }).key);
      if (!key || !isValidRequiredSecretKey(key)) return [];
      const description = typeof (entry as { description?: unknown }).description === "string"
        ? (entry as { description: string }).description.trim() || undefined
        : undefined;
      const blocking = typeof (entry as { blocking?: unknown }).blocking === "boolean"
        ? (entry as { blocking: boolean }).blocking
        : true;
      const requestedAt = typeof (entry as { requestedAt?: unknown }).requestedAt === "string"
        ? (entry as { requestedAt: string }).requestedAt
        : undefined;
      const requestedByRunId = typeof (entry as { requestedByRunId?: unknown }).requestedByRunId === "string"
        ? (entry as { requestedByRunId: string }).requestedByRunId
        : undefined;
      return [{
        key,
        ...(description ? { description } : {}),
        blocking,
        ...(requestedAt ? { requestedAt } : {}),
        ...(requestedByRunId ? { requestedByRunId } : {}),
      }];
    });
  } catch {
    return [];
  }
}

export function mergeRequiredSecrets(
  existing: RequiredSecretEntry[],
  entries: RequiredSecretEntry[],
): { list: RequiredSecretEntry[]; changed: boolean } {
  type StoredRequiredSecretEntry = RequiredSecretEntry & { blocking: boolean };
  const byKey = new Map<string, StoredRequiredSecretEntry>(
    existing.map((entry) => [entry.key, { ...entry, blocking: entry.blocking !== false }]),
  );
  let changed = false;

  for (const entry of entries) {
    const key = normalizeRequiredSecretKey(entry.key);
    if (!key || !isValidRequiredSecretKey(key)) continue;
    const normalized: StoredRequiredSecretEntry = {
      key,
      ...(entry.description?.trim() ? { description: entry.description.trim() } : {}),
      blocking: entry.blocking !== false,
      ...(entry.requestedAt ? { requestedAt: entry.requestedAt } : {}),
      ...(entry.requestedByRunId ? { requestedByRunId: entry.requestedByRunId } : {}),
    };
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, normalized);
      changed = true;
      continue;
    }
    const next: StoredRequiredSecretEntry = {
      key,
      description: current.description || normalized.description,
      blocking: current.blocking !== false || normalized.blocking !== false,
      requestedAt: normalized.requestedAt || current.requestedAt,
      requestedByRunId: normalized.requestedByRunId || current.requestedByRunId,
    };
    if (
      next.description !== current.description ||
      next.blocking !== current.blocking ||
      next.requestedAt !== current.requestedAt ||
      next.requestedByRunId !== current.requestedByRunId
    ) {
      byKey.set(key, next);
      changed = true;
    }
  }

  return { list: Array.from(byKey.values()), changed };
}
