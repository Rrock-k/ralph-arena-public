import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import type { Agent, AgentOptions } from './base.js';
import type { AgentErrorCategory, AgentResult } from '../config/types.js';

export const PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH = '.ralph/provider-call-checkpoint.json';

export type ProviderCallOwner = 'planner' | 'controller';
export type ProviderCallOutcome = 'success' | 'error';

export interface ProviderCallCheckpointIdentity {
  owner: ProviderCallOwner;
  operation: string;
  agent: string;
  model: string | null;
  allowedTools: string[] | null;
  promptSha256: string;
}

export interface ProviderCallCheckpoint extends ProviderCallCheckpointIdentity {
  version: 1;
  sessionId: string;
  outcome: ProviderCallOutcome;
  errorCategory?: AgentErrorCategory;
  resumedFrom?: string;
  resumeFallbackReason?: string;
  updatedAt: string;
}

type ProviderCallRecord = Omit<ProviderCallCheckpoint, 'version'>;

interface ProviderCallLedgerFile {
  version: 1;
  calls: ProviderCallRecord[];
}

export function buildProviderCallPromptSha256(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}

export function buildProviderCallIdentity(input: {
  owner: ProviderCallOwner;
  operation: string;
  agent: string;
  model?: string | null;
  allowedTools?: readonly string[] | null;
  prompt: string;
}): ProviderCallCheckpointIdentity {
  return {
    owner: input.owner,
    operation: input.operation,
    agent: input.agent,
    model: input.model?.trim() || null,
    allowedTools: input.allowedTools ? [...input.allowedTools] : null,
    promptSha256: buildProviderCallPromptSha256(input.prompt),
  };
}

export function isProviderCallResumable(input: {
  outcome?: string | null;
}): boolean {
  return input.outcome === 'error';
}

export class ProviderCallCheckpointStore {
  private checkpointPath: string;

  constructor(workDir: string) {
    this.checkpointPath = path.join(workDir, PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH);
  }

  async readMatching(identity: ProviderCallCheckpointIdentity): Promise<ProviderCallCheckpoint | null> {
    const calls = await this.readCalls();
    const checkpoint = [...calls]
      .reverse()
      .find(call => this.matches(call, identity));
    return checkpoint ? { version: 1, ...checkpoint } : null;
  }

  async readResumableMatching(identity: ProviderCallCheckpointIdentity): Promise<ProviderCallCheckpoint | null> {
    const checkpoint = await this.readMatching(identity);
    return checkpoint && isProviderCallResumable(checkpoint) ? checkpoint : null;
  }

  async recordCall(input: ProviderCallCheckpointIdentity & {
    sessionId: string;
    outcome: ProviderCallOutcome;
    errorCategory?: AgentErrorCategory;
    resumedFrom?: string;
    resumeFallbackReason?: string;
  }): Promise<void> {
    const sessionId = input.sessionId.trim();
    if (!sessionId) return;

    const checkpoint: ProviderCallRecord = {
      owner: input.owner,
      operation: input.operation,
      agent: input.agent,
      model: input.model,
      allowedTools: input.allowedTools ? [...input.allowedTools] : null,
      promptSha256: input.promptSha256,
      sessionId,
      outcome: input.outcome,
      ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
      ...(input.resumedFrom ? { resumedFrom: input.resumedFrom } : {}),
      ...(input.resumeFallbackReason ? { resumeFallbackReason: input.resumeFallbackReason } : {}),
      updatedAt: new Date().toISOString(),
    };

    const calls = await this.readCalls();
    await fs.ensureDir(path.dirname(this.checkpointPath));
    await fs.writeJson(this.checkpointPath, {
      version: 1,
      calls: [
        ...calls,
        checkpoint,
      ],
    } satisfies ProviderCallLedgerFile, { spaces: 2 });
  }

  async recordAgentResult(identity: ProviderCallCheckpointIdentity, result: AgentResult): Promise<void> {
    const sessionId = result.providerSession?.id?.trim();
    if (!sessionId) return;

    await this.recordCall({
      ...identity,
      sessionId,
      outcome: result.success ? 'success' : 'error',
      ...(result.error?.category ? { errorCategory: result.error.category } : {}),
      ...(result.providerSession?.resumedFrom ? { resumedFrom: result.providerSession.resumedFrom } : {}),
      ...(result.providerSession?.resumeFallbackReason ? { resumeFallbackReason: result.providerSession.resumeFallbackReason } : {}),
    });
  }

  private async readCalls(): Promise<ProviderCallRecord[]> {
    try {
      const parsed = await fs.readJson(this.checkpointPath);
      if (!parsed || typeof parsed !== 'object') return [];
      if ((parsed as Record<string, unknown>).version !== 1 || !Array.isArray((parsed as Record<string, unknown>).calls)) {
        return [];
      }
      return ((parsed as Record<string, unknown>).calls as unknown[])
        .map((entry: unknown) => this.parseCallRecord(entry))
        .filter((entry): entry is ProviderCallRecord => !!entry);
    } catch {
      return [];
    }
  }

  private matches(checkpoint: ProviderCallRecord, identity: ProviderCallCheckpointIdentity): boolean {
    return checkpoint.owner === identity.owner
      && checkpoint.operation === identity.operation
      && checkpoint.agent === identity.agent
      && checkpoint.model === identity.model
      && checkpoint.promptSha256 === identity.promptSha256
      && this.sameAllowedTools(checkpoint.allowedTools, identity.allowedTools);
  }

  private sameAllowedTools(left: string[] | null, right: string[] | null): boolean {
    if (left === null || right === null) return left === right;
    if (left.length !== right.length) return false;
    return left.every((tool, index) => tool === right[index]);
  }

  private parseCallRecord(value: unknown): ProviderCallRecord | null {
    if (!value || typeof value !== 'object') return null;
    const parsed = value as Record<string, unknown>;
    const owner = parsed.owner === 'planner' || parsed.owner === 'controller'
      ? parsed.owner
      : null;
    if (!owner) return null;
    if (typeof parsed.operation !== 'string' || parsed.operation.length === 0) return null;
    if (typeof parsed.agent !== 'string' || parsed.agent.length === 0) return null;
    if (!(typeof parsed.model === 'string' || parsed.model === null)) return null;
    if (!(Array.isArray(parsed.allowedTools) || parsed.allowedTools === null)) return null;
    if (Array.isArray(parsed.allowedTools) && parsed.allowedTools.some(tool => typeof tool !== 'string')) return null;
    if (typeof parsed.promptSha256 !== 'string' || parsed.promptSha256.length === 0) return null;
    if (typeof parsed.sessionId !== 'string' || parsed.sessionId.trim().length === 0) return null;
    if (parsed.outcome !== 'success' && parsed.outcome !== 'error') return null;
    if (typeof parsed.updatedAt !== 'string' || parsed.updatedAt.length === 0) return null;

    return {
      owner,
      operation: parsed.operation,
      agent: parsed.agent,
      model: parsed.model,
      allowedTools: parsed.allowedTools ? [...parsed.allowedTools] as string[] : null,
      promptSha256: parsed.promptSha256,
      sessionId: parsed.sessionId,
      outcome: parsed.outcome,
      ...(typeof parsed.errorCategory === 'string' ? { errorCategory: parsed.errorCategory as AgentErrorCategory } : {}),
      ...(typeof parsed.resumedFrom === 'string' && parsed.resumedFrom ? { resumedFrom: parsed.resumedFrom } : {}),
      ...(typeof parsed.resumeFallbackReason === 'string' && parsed.resumeFallbackReason ? { resumeFallbackReason: parsed.resumeFallbackReason } : {}),
      updatedAt: parsed.updatedAt,
    };
  }
}

export async function executeAgentWithProviderCallCheckpoint(input: {
  store: ProviderCallCheckpointStore;
  owner: ProviderCallOwner;
  operation: string;
  agent: Agent;
  options: AgentOptions;
}): Promise<AgentResult> {
  const identity = buildProviderCallIdentity({
    owner: input.owner,
    operation: input.operation,
    agent: input.agent.name,
    model: input.options.model,
    allowedTools: input.options.allowedTools,
    prompt: input.options.prompt,
  });
  const checkpoint = await input.store.readResumableMatching(identity);
  const result = await input.agent.execute({
    ...input.options,
    providerSessionResumeId: checkpoint?.sessionId ?? input.options.providerSessionResumeId,
  });
  await input.store.recordAgentResult(identity, result);
  return result;
}
