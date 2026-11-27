import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLangfuseGenerationAttributes,
  mirrorPromptTraceEventToLangfuse,
  readLangfuseMirrorConfig,
} from './langfuse.js';
import {
  PROMPT_TRACE_SCHEMA_VERSION,
  type PromptTraceEvent,
} from './trace.js';

const sampleEvent: PromptTraceEvent = {
  schemaVersion: PROMPT_TRACE_SCHEMA_VERSION,
  eventId: '11111111-1111-4111-8111-111111111111',
  timestamp: '2026-05-20T10:00:00.000Z',
  eventType: 'model_call',
  promptId: 'planner.initial',
  owner: 'planner',
  label: 'Initial plan',
  model: 'claude-opus-4-6',
  success: true,
  context: {
    projectId: 'project-1',
    attempt: 1,
  },
  prompt: {
    visibility: 'admin_raw',
    charCount: 15,
    text: 'Plan this project',
  },
  output: {
    visibility: 'admin_raw',
    charCount: 13,
    text: '{"phases":[]}',
  },
  parse: {
    status: 'ok',
    summary: 'parsed plan',
  },
  usage: {
    inputTokens: 1_000,
    outputTokens: 200,
    totalTokens: 1_200,
    inputCostUsd: 0.005,
    outputCostUsd: 0.005,
    apiEquivalentCostUsd: 0.01,
    pricingSource: '@arena/contracts',
  },
};

test('reads Langfuse mirror config only when all required env keys are present', () => {
  assert.equal(readLangfuseMirrorConfig({}), null);
  assert.equal(readLangfuseMirrorConfig({
    LANGFUSE_BASE_URL: 'https://cloud.langfuse.com/',
    LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
  }), null);

  assert.deepEqual(readLangfuseMirrorConfig({
    LANGFUSE_BASE_URL: 'https://cloud.langfuse.com/',
    LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
    LANGFUSE_SECRET_KEY: 'sk-lf-test',
  }), {
    baseUrl: 'https://cloud.langfuse.com',
    publicKey: 'pk-lf-test',
    secretKey: 'sk-lf-test',
  });
});

test('builds Langfuse generation attributes from a prompt trace event', () => {
  const attributes = buildLangfuseGenerationAttributes(sampleEvent);

  assert.equal(attributes.model, 'claude-opus-4-6');
  assert.equal(attributes.input, 'Plan this project');
  assert.equal(attributes.output, '{"phases":[]}');
  assert.equal(attributes.level, 'DEFAULT');
  assert.deepEqual(attributes.usageDetails, {
    input: 1_000,
    output: 200,
    total: 1_200,
  });
  assert.equal(attributes.costDetails, undefined);

  const metadata = attributes.metadata as Record<string, unknown>;
  const ralph = metadata.ralph as Record<string, unknown>;
  const context = metadata.context as Record<string, unknown>;
  assert.equal(ralph.promptId, 'planner.initial');
  assert.equal(ralph.owner, 'planner');
  assert.equal(ralph.success, true);
  assert.equal(ralph.parseStatus, 'ok');
  assert.equal(ralph.promptCharCount, 15);
  assert.equal(ralph.outputCharCount, 13);
  assert.equal(ralph.apiEquivalentCostUsd, 0.01);
  assert.equal(context.projectId, 'project-1');
  assert.equal(context.attempt, 1);
});

test('marks failed prompt calls as error generations', () => {
  const attributes = buildLangfuseGenerationAttributes({
    ...sampleEvent,
    success: false,
    parse: {
      status: 'error',
      summary: 'agent call failed',
    },
  });

  assert.equal(attributes.level, 'ERROR');
  assert.equal(attributes.statusMessage, 'agent call failed');
});

test('does nothing when Langfuse env is missing', async () => {
  const result = await mirrorPromptTraceEventToLangfuse(sampleEvent, { env: {} });

  assert.deepEqual(result, { status: 'disabled', reason: 'missing_env' });
});

test('creates one SDK generation and flushes it', async () => {
  const calls: Array<{
    name: string;
    attributes: Record<string, unknown>;
    traceAttributes: { name: string; tags: string[]; metadata: Record<string, string> };
    ended: boolean;
  }> = [];

  const result = await mirrorPromptTraceEventToLangfuse(sampleEvent, {
    config: {
      baseUrl: 'https://cloud.langfuse.com',
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
    },
    client: {
      recordGeneration: (name, attributes, traceAttributes) => {
        calls.push({
          name,
          attributes: attributes as Record<string, unknown>,
          traceAttributes,
          ended: true,
        });
      },
      forceFlush: async () => {},
    },
  });

  assert.deepEqual(result, { status: 'sent' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'planner.initial');
  assert.equal(calls[0].attributes.input, 'Plan this project');
  assert.equal(calls[0].attributes.output, '{"phases":[]}');
  assert.deepEqual(calls[0].attributes.usageDetails, {
    input: 1_000,
    output: 200,
    total: 1_200,
  });
  assert.equal(calls[0].attributes.costDetails, undefined);
  assert.equal(calls[0].traceAttributes.name, 'Initial plan');
  assert.deepEqual(calls[0].traceAttributes.tags, ['ralph', 'prompt-call']);
  assert.equal(calls[0].traceAttributes.metadata.promptId, 'planner.initial');
  assert.equal(calls[0].ended, true);
});

test('keeps Langfuse SDK failures best-effort', async () => {
  const thrownResult = await mirrorPromptTraceEventToLangfuse(sampleEvent, {
    config: {
      baseUrl: 'https://cloud.langfuse.com',
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
    },
    client: {
      recordGeneration: () => {
        throw new Error('offline');
      },
      forceFlush: async () => {},
    },
  });

  assert.deepEqual(thrownResult, { status: 'failed', reason: 'request_failed' });

  const timeoutResult = await mirrorPromptTraceEventToLangfuse(sampleEvent, {
    config: {
      baseUrl: 'https://cloud.langfuse.com',
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
    },
    timeoutMs: 1,
    client: {
      recordGeneration: () => {},
      forceFlush: () => new Promise((resolve) => {
        setTimeout(resolve, 100);
      }),
    },
  });

  assert.deepEqual(timeoutResult, { status: 'failed', reason: 'timeout' });
});
