import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import type { Agent } from './base.js';
import type { AgentResult } from '../config/types.js';
import {
  PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH,
  ProviderCallCheckpointStore,
  buildProviderCallIdentity,
  executeAgentWithProviderCallCheckpoint,
  type ProviderCallCheckpointIdentity,
} from './provider-call-checkpoint.js';

function buildIdentity(overrides: Partial<ProviderCallCheckpointIdentity> = {}): ProviderCallCheckpointIdentity {
  return {
    owner: 'planner',
    operation: 'planner.specMigration',
    agent: 'codex',
    model: 'gpt-5-codex',
    allowedTools: null,
    promptSha256: 'prompt-hash-1',
    ...overrides,
  };
}

test('provider call checkpoint round-trips exact invocation identity only', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-call-'));
  try {
    const store = new ProviderCallCheckpointStore(workDir);
    const identity = buildIdentity({ allowedTools: [] });
    await store.recordCall({
      ...identity,
      sessionId: 'session-123',
      outcome: 'error',
      errorCategory: 'infra',
    });

    assert.equal((await store.readMatching(identity))?.sessionId, 'session-123');

    const mismatches: ProviderCallCheckpointIdentity[] = [
      buildIdentity({ ...identity, owner: 'controller' }),
      buildIdentity({ ...identity, operation: 'planner.initial' }),
      buildIdentity({ ...identity, agent: 'claude-code' }),
      buildIdentity({ ...identity, model: 'other-model' }),
      buildIdentity({ ...identity, allowedTools: null }),
      buildIdentity({ ...identity, allowedTools: ['Read'] }),
      buildIdentity({ ...identity, promptSha256: 'prompt-hash-2' }),
    ];

    for (const mismatch of mismatches) {
      assert.equal(await store.readMatching(mismatch), null);
    }
  } finally {
    await fs.remove(workDir);
  }
});

test('provider call checkpoint resumes only when newest matching record is error', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-call-'));
  try {
    const store = new ProviderCallCheckpointStore(workDir);
    const identity = buildIdentity();

    await store.recordCall({
      ...identity,
      sessionId: 'session-error',
      outcome: 'error',
      errorCategory: 'rate_limit',
    });
    assert.equal((await store.readResumableMatching(identity))?.sessionId, 'session-error');

    await store.recordCall({
      ...identity,
      sessionId: 'session-success',
      outcome: 'success',
    });

    assert.equal((await store.readMatching(identity))?.sessionId, 'session-success');
    assert.equal(await store.readResumableMatching(identity), null);
  } finally {
    await fs.remove(workDir);
  }
});

test('provider call checkpoint returns no resume for success-only and malformed ledgers', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-call-'));
  try {
    const store = new ProviderCallCheckpointStore(workDir);
    const identity = buildIdentity();

    await store.recordCall({
      ...identity,
      sessionId: 'session-success',
      outcome: 'success',
    });
    assert.equal(await store.readResumableMatching(identity), null);

    const checkpointPath = path.join(workDir, PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH);
    await fs.writeFile(checkpointPath, '{not-json');
    assert.equal(await store.readMatching(identity), null);
    assert.equal(await store.readResumableMatching(identity), null);
  } finally {
    await fs.remove(workDir);
  }
});

test('provider call helper records fresh fallback as suppressing diagnostic', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-call-'));
  try {
    const store = new ProviderCallCheckpointStore(workDir);
    const identity = buildProviderCallIdentity({
      owner: 'planner',
      operation: 'planner.specMigration',
      agent: 'fake-agent',
      model: 'gpt-5-codex',
      allowedTools: null,
      prompt: 'prioritize these tasks',
    });
    await store.recordCall({
      ...identity,
      sessionId: 'missing-session',
      outcome: 'error',
      errorCategory: 'infra',
    });

    let observedResumeId: string | undefined;
    const agent: Agent = {
      name: 'fake-agent',
      execute: async (options): Promise<AgentResult> => {
        observedResumeId = options.providerSessionResumeId;
        return {
          success: true,
          output: 'ok',
          filesChanged: [],
          completionPromiseFound: false,
          providerSession: {
            id: 'fresh-session',
            resumeFallbackReason: 'session missing',
          },
        };
      },
      isAvailable: async () => true,
      getVersion: async () => 'fake',
    };

    await executeAgentWithProviderCallCheckpoint({
      store,
      owner: 'planner',
      operation: 'planner.specMigration',
      agent,
      options: {
        workDir,
        prompt: 'prioritize these tasks',
        model: 'gpt-5-codex',
      },
    });

    assert.equal(observedResumeId, 'missing-session');
    const latest = await store.readMatching(identity);
    assert.equal(latest?.sessionId, 'fresh-session');
    assert.equal(latest?.outcome, 'success');
    assert.equal(latest?.resumeFallbackReason, 'session missing');
    assert.equal(await store.readResumableMatching(identity), null);
  } finally {
    await fs.remove(workDir);
  }
});
