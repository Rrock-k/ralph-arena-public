import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentOptions } from '../agents/base.js';
import { runExecutorAgentCall } from './executor-agent-call.js';

test('runExecutorAgentCall invokes agent with normalized executor options and completion signal', async () => {
  let receivedOptions: AgentOptions | null = null;
  const call = await runExecutorAgentCall({
    agent: {
      name: 'test-agent',
      execute: async (options) => {
        receivedOptions = options;
        return {
          success: true,
          output: `${'implemented '.repeat(20)}\n<promise>TASK_COMPLETE</promise>`,
          filesChanged: ['src/app.ts'],
          completionPromiseFound: false,
          providerSession: { id: 'session-new', resumedFrom: 'session-old' },
        };
      },
    },
    workDir: '/tmp/work',
    prompt: 'executor prompt',
    completionPromise: 'TASK_COMPLETE',
    model: 'test-model',
    timeoutMinutes: 7,
    verbose: false,
    providerSessionResumeId: 'session-old',
  });

  assert.equal(call.ownerBoundary, 'ralph.executor-agent-call');
  assert.equal(call.agentName, 'test-agent');
  assert.equal(call.model, 'test-model');
  assert.equal(call.timeoutMinutes, 7);
  assert.equal(call.providerSessionResumeId, 'session-old');
  assert.equal(call.completionPromiseFound, true);
  assert.equal(call.result.completionPromiseFound, true);
  assert.deepEqual(receivedOptions, {
    workDir: '/tmp/work',
    prompt: 'executor prompt',
    timeout: 7,
    verbose: false,
    model: 'test-model',
    providerSessionResumeId: 'session-old',
  });
});

test('runExecutorAgentCall omits optional model, timeout and resume id when absent', async () => {
  let receivedOptions: AgentOptions | null = null;
  const call = await runExecutorAgentCall({
    agent: {
      name: 'test-agent',
      execute: async (options) => {
        receivedOptions = options;
        return {
          success: true,
          output: 'no completion yet',
          filesChanged: [],
          completionPromiseFound: true,
        };
      },
    },
    workDir: '/tmp/work',
    prompt: 'executor prompt',
    completionPromise: 'TASK_COMPLETE',
    verbose: true,
  });

  assert.equal(call.completionPromiseFound, false);
  assert.equal(call.result.completionPromiseFound, false);
  assert.deepEqual(receivedOptions, {
    workDir: '/tmp/work',
    prompt: 'executor prompt',
    timeout: undefined,
    verbose: true,
    model: undefined,
    providerSessionResumeId: undefined,
  });
});
