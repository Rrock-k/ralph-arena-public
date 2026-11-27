import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH,
  ProviderSessionCheckpointStore,
  buildProviderSessionTaskFingerprint,
  type ProviderSessionCheckpointMatch,
} from './provider-session-checkpoint.js';

function buildMatch(overrides: Partial<ProviderSessionCheckpointMatch> = {}): ProviderSessionCheckpointMatch {
  return {
    agent: 'claude-code',
    model: 'claude-sonnet-4-5',
    taskId: 'task-001',
    taskFingerprint: buildProviderSessionTaskFingerprint({
      taskId: 'task-001',
      taskDescription: 'Implement the accepted diff',
    }),
    specHash: 'spec-hash-1',
    ...overrides,
  };
}

test('provider session checkpoint round-trips only for the same task/spec identity', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const match = buildMatch();

    await store.saveRateLimitCheckpoint({
      ...match,
      sessionId: 'session-123',
    });

    const checkpoint = await store.readMatching(match);
    assert.equal(checkpoint?.sessionId, 'session-123');
    assert.equal(checkpoint?.reason, 'rate_limit');
    assert.equal(checkpoint?.outcome, 'error');
  } finally {
    await fs.remove(workDir);
  }
});

test('provider session ledger keeps stale identities but returns only matching sessions', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const checkpointPath = path.join(workDir, PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH);
    const match = buildMatch();

    await store.saveRateLimitCheckpoint({
      ...match,
      sessionId: 'session-123',
    });

    assert.equal(
      await store.readMatching(buildMatch({ specHash: 'spec-hash-2' })),
      null,
    );
    assert.equal(await fs.pathExists(checkpointPath), true);
  } finally {
    await fs.remove(workDir);
  }
});

test('provider session ledger records successful task attempts by default', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const checkpointPath = path.join(workDir, PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH);
    const match = buildMatch();

    await store.recordTaskSession({
      ...match,
      sessionId: 'session-123',
      outcome: 'success',
    });
    await store.recordTaskSession({
      ...match,
      sessionId: 'session-456',
      outcome: 'error',
      errorCategory: 'infra',
    });

    const ledger = await fs.readJson(checkpointPath);
    assert.equal(ledger.version, 2);
    assert.deepEqual(ledger.sessions.map((entry: any) => ({
      sessionId: entry.sessionId,
      outcome: entry.outcome,
      errorCategory: entry.errorCategory ?? null,
    })), [
      { sessionId: 'session-123', outcome: 'success', errorCategory: null },
      { sessionId: 'session-456', outcome: 'error', errorCategory: 'infra' },
    ]);

    const checkpoint = await store.readMatching(match);
    assert.equal(checkpoint?.sessionId, 'session-456');
    assert.equal(checkpoint?.reason, 'task_attempt');
  } finally {
    await fs.remove(workDir);
  }
});

test('provider session checkpoint resumable read ignores successful task attempts', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const match = buildMatch();

    await store.recordTaskSession({
      ...match,
      sessionId: 'session-error',
      outcome: 'error',
      errorCategory: 'infra',
    });
    await store.recordTaskSession({
      ...match,
      sessionId: 'session-success',
      outcome: 'success',
    });

    assert.equal((await store.readMatching(match))?.sessionId, 'session-success');
    const resumable = await store.readResumableMatching(match);
    assert.equal(resumable?.sessionId, 'session-error');
    assert.equal(resumable?.outcome, 'error');
  } finally {
    await fs.remove(workDir);
  }
});

test('provider session checkpoint resumable read returns null for success-only task attempts', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const match = buildMatch();

    await store.recordTaskSession({
      ...match,
      sessionId: 'session-success',
      outcome: 'success',
    });

    assert.equal((await store.readMatching(match))?.sessionId, 'session-success');
    assert.equal(await store.readResumableMatching(match), null);
  } finally {
    await fs.remove(workDir);
  }
});

test('provider session checkpoint can resume same task across accepted spec changes', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const match = buildMatch();

    await store.saveRateLimitCheckpoint({
      ...match,
      sessionId: 'session-123',
    });

    const checkpoint = await store.readResumableMatching(
      buildMatch({ specHash: 'spec-hash-2' }),
      { allowSpecHashMismatch: true },
    );

    assert.equal(checkpoint?.sessionId, 'session-123');
  } finally {
    await fs.remove(workDir);
  }
});

test('provider session checkpoint still rejects different task fingerprints when spec mismatch is allowed', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const match = buildMatch();

    await store.saveRateLimitCheckpoint({
      ...match,
      sessionId: 'session-123',
    });

    assert.equal(
      await store.readMatching({
        ...buildMatch({ specHash: 'spec-hash-2' }),
        taskFingerprint: buildProviderSessionTaskFingerprint({
          taskId: 'task-001',
          taskDescription: 'Different task wording',
        }),
      }, { allowSpecHashMismatch: true }),
      null,
    );
  } finally {
    await fs.remove(workDir);
  }
});

test('provider session checkpoint ignores malformed files', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const checkpointPath = path.join(workDir, PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH);
    await fs.ensureDir(path.dirname(checkpointPath));
    await fs.writeFile(checkpointPath, '{not-json');

    assert.equal(await store.readMatching(buildMatch()), null);
  } finally {
    await fs.remove(workDir);
  }
});

test('provider session checkpoint reads legacy v1 files', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-provider-session-'));
  try {
    const store = new ProviderSessionCheckpointStore(workDir);
    const checkpointPath = path.join(workDir, PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH);
    const match = buildMatch();
    await fs.ensureDir(path.dirname(checkpointPath));
    await fs.writeJson(checkpointPath, {
      version: 1,
      ...match,
      sessionId: 'legacy-session',
      reason: 'rate_limit',
      updatedAt: new Date().toISOString(),
    });

    const checkpoint = await store.readMatching(match);
    assert.equal(checkpoint?.sessionId, 'legacy-session');
    assert.equal(checkpoint?.reason, 'rate_limit');
    assert.equal(checkpoint?.outcome, 'error');
  } finally {
    await fs.remove(workDir);
  }
});
