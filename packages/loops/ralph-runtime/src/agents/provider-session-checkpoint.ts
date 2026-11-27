import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import type { AgentErrorCategory } from '../config/types.js';

export const PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH = '.ralph/provider-session-checkpoint.json';

type ProviderSessionCheckpointReason = 'task_attempt' | 'rate_limit';
type ProviderSessionOutcome = 'success' | 'error';

export interface ProviderSessionCheckpointMatch {
  agent: string;
  model: string | null;
  taskId: string;
  taskFingerprint: string;
  specHash: string | null;
}

export interface ProviderSessionCheckpoint extends ProviderSessionCheckpointMatch {
  version: 1;
  sessionId: string;
  reason: ProviderSessionCheckpointReason;
  outcome: ProviderSessionOutcome;
  errorCategory?: AgentErrorCategory;
  resumedFrom?: string;
  resumeFallbackReason?: string;
  updatedAt: string;
}

type ProviderSessionRecord = Omit<ProviderSessionCheckpoint, 'version'>;

interface ProviderSessionLedgerFile {
  version: 2;
  sessions: ProviderSessionRecord[];
}

export function buildProviderSessionTaskFingerprint(input: {
  taskId: string;
  taskDescription: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      taskId: input.taskId,
      taskDescription: input.taskDescription,
    }))
    .digest('hex');
}

export function isProviderSessionResumable(input: {
  outcome?: string | null;
}): boolean {
  return input.outcome === 'error';
}

export class ProviderSessionCheckpointStore {
  private checkpointPath: string;

  constructor(workDir: string) {
    this.checkpointPath = path.join(workDir, PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH);
  }

  async readMatching(
    match: ProviderSessionCheckpointMatch,
    options: { allowSpecHashMismatch?: boolean } = {},
  ): Promise<ProviderSessionCheckpoint | null> {
    const sessions = await this.readSessions();
    const checkpoint = [...sessions]
      .reverse()
      .find(session => this.matches(session, match, options));
    return checkpoint ? { version: 1, ...checkpoint } : null;
  }

  async readResumableMatching(
    match: ProviderSessionCheckpointMatch,
    options: { allowSpecHashMismatch?: boolean } = {},
  ): Promise<ProviderSessionCheckpoint | null> {
    const sessions = await this.readSessions();
    const checkpoint = [...sessions]
      .reverse()
      .find(session => isProviderSessionResumable(session) && this.matches(session, match, options));
    return checkpoint ? { version: 1, ...checkpoint } : null;
  }

  async saveRateLimitCheckpoint(input: ProviderSessionCheckpointMatch & {
    sessionId: string;
  }): Promise<void> {
    await this.recordTaskSession({
      ...input,
      reason: 'rate_limit',
      outcome: 'error',
      errorCategory: 'rate_limit',
    });
  }

  async recordTaskSession(input: ProviderSessionCheckpointMatch & {
    sessionId: string;
    reason?: ProviderSessionCheckpointReason;
    outcome: ProviderSessionOutcome;
    errorCategory?: AgentErrorCategory;
    resumedFrom?: string;
    resumeFallbackReason?: string;
  }): Promise<void> {
    const sessionId = input.sessionId.trim();
    if (!sessionId) return;

    const checkpoint: ProviderSessionRecord = {
      agent: input.agent,
      model: input.model,
      taskId: input.taskId,
      taskFingerprint: input.taskFingerprint,
      specHash: input.specHash,
      sessionId,
      reason: input.reason ?? (input.errorCategory === 'rate_limit' ? 'rate_limit' : 'task_attempt'),
      outcome: input.outcome,
      ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
      ...(input.resumedFrom ? { resumedFrom: input.resumedFrom } : {}),
      ...(input.resumeFallbackReason ? { resumeFallbackReason: input.resumeFallbackReason } : {}),
      updatedAt: new Date().toISOString(),
    };

    const sessions = await this.readSessions();
    await fs.ensureDir(path.dirname(this.checkpointPath));
    await fs.writeJson(this.checkpointPath, {
      version: 2,
      sessions: [
        ...sessions,
        checkpoint,
      ],
    } satisfies ProviderSessionLedgerFile, { spaces: 2 });
  }

  async clear(): Promise<void> {
    await fs.remove(this.checkpointPath);
  }

  async clearMatching(match: ProviderSessionCheckpointMatch): Promise<void> {
    const sessions = await this.readSessions();
    const keptSessions = sessions.filter(session => !this.matches(session, match, {
      allowSpecHashMismatch: true,
    }));
    if (keptSessions.length === sessions.length) return;
    if (keptSessions.length === 0) {
      await this.clear();
      return;
    }
    await fs.writeJson(this.checkpointPath, {
      version: 2,
      sessions: keptSessions,
    } satisfies ProviderSessionLedgerFile, { spaces: 2 });
  }

  private async readSessions(): Promise<ProviderSessionRecord[]> {
    try {
      const parsed = await fs.readJson(this.checkpointPath);
      if (!parsed || typeof parsed !== 'object') return [];
      if (parsed.version === 2 && Array.isArray(parsed.sessions)) {
        return (parsed.sessions as unknown[])
          .map((entry: unknown) => this.parseSessionRecord(entry))
          .filter((entry): entry is ProviderSessionRecord => !!entry);
      }
      const legacyCheckpoint = this.parseLegacyCheckpoint(parsed);
      return legacyCheckpoint ? [legacyCheckpoint] : [];
    } catch {
      return [];
    }
  }

  private matches(
    checkpoint: ProviderSessionRecord,
    match: ProviderSessionCheckpointMatch,
    options: { allowSpecHashMismatch?: boolean },
  ): boolean {
    return checkpoint.agent === match.agent
      && checkpoint.model === match.model
      && checkpoint.taskId === match.taskId
      && checkpoint.taskFingerprint === match.taskFingerprint
      && (options.allowSpecHashMismatch || checkpoint.specHash === match.specHash);
  }

  private parseLegacyCheckpoint(value: unknown): ProviderSessionRecord | null {
    if (!value || typeof value !== 'object') return null;
    const parsed = value as Record<string, unknown>;
    if (parsed.version !== 1) return null;
    const record = this.parseSessionRecord({
      ...parsed,
      reason: parsed.reason === 'rate_limit' ? 'rate_limit' : 'task_attempt',
      outcome: 'error',
      errorCategory: parsed.reason === 'rate_limit' ? 'rate_limit' : undefined,
    });
    return record;
  }

  private parseSessionRecord(value: unknown): ProviderSessionRecord | null {
    if (!value || typeof value !== 'object') return null;
    const parsed = value as Record<string, unknown>;
    if (typeof parsed.agent !== 'string' || parsed.agent.length === 0) return null;
    if (typeof parsed.taskId !== 'string' || parsed.taskId.length === 0) return null;
    if (typeof parsed.taskFingerprint !== 'string' || parsed.taskFingerprint.length === 0) return null;
    if (typeof parsed.sessionId !== 'string' || parsed.sessionId.trim().length === 0) return null;
    if (typeof parsed.updatedAt !== 'string' || parsed.updatedAt.length === 0) return null;
    const outcome = parsed.outcome === 'success' || parsed.outcome === 'error'
      ? parsed.outcome
      : null;
    if (!outcome) return null;
    const reason = parsed.reason === 'rate_limit' || parsed.reason === 'task_attempt'
      ? parsed.reason
      : 'task_attempt';

    return {
      agent: parsed.agent,
      model: typeof parsed.model === 'string' ? parsed.model : null,
      taskId: parsed.taskId,
      taskFingerprint: parsed.taskFingerprint,
      specHash: typeof parsed.specHash === 'string' ? parsed.specHash : null,
      sessionId: parsed.sessionId,
      reason,
      outcome,
      ...(typeof parsed.errorCategory === 'string' ? { errorCategory: parsed.errorCategory as AgentErrorCategory } : {}),
      ...(typeof parsed.resumedFrom === 'string' && parsed.resumedFrom ? { resumedFrom: parsed.resumedFrom } : {}),
      ...(typeof parsed.resumeFallbackReason === 'string' && parsed.resumeFallbackReason ? { resumeFallbackReason: parsed.resumeFallbackReason } : {}),
      updatedAt: parsed.updatedAt,
    };
  }
}
