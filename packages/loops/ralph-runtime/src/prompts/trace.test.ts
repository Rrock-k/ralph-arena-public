import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test, { beforeEach } from 'node:test';
import fs from 'fs-extra';
import {
  appendPromptModelCallTrace,
  parsePromptTraceLine,
  PROMPT_TRACE_SCHEMA_VERSION,
  readPromptTraceEvents,
} from './trace.js';

beforeEach(() => {
  delete process.env.LANGFUSE_BASE_URL;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
});

test('appends prompt model call events as jsonl', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-prompt-trace-'));

  const event = await appendPromptModelCallTrace(workDir, {
    promptId: 'planner.initial',
    owner: 'planner',
    label: 'Initial plan',
    prompt: 'Plan this project',
    result: {
      success: true,
      output: '{"phases":[]}',
      usage: {
        inputTokens: 1_000,
        outputTokens: 200,
        totalTokens: 1_200,
      },
    },
    model: 'gpt-5-codex',
    context: {
      attempt: 1,
      ignored: undefined,
    },
    parse: {
      status: 'ok',
      summary: 'parsed plan',
    },
  });

  const events = await readPromptTraceEvents(workDir);

  assert.equal(events.length, 1);
  assert.equal(events[0].schemaVersion, PROMPT_TRACE_SCHEMA_VERSION);
  assert.equal(events[0].eventId, event.eventId);
  assert.equal(events[0].promptId, 'planner.initial');
  assert.equal(events[0].owner, 'planner');
  assert.equal(events[0].prompt.text, 'Plan this project');
  assert.equal(events[0].prompt.charCount, 'Plan this project'.length);
  assert.equal(events[0].output.text, '{"phases":[]}');
  assert.equal(events[0].model, 'gpt-5-codex');
  assert.equal(events[0].context.attempt, 1);
  assert.equal(Object.hasOwn(events[0].context, 'ignored'), false);
  assert.equal(events[0].parse.status, 'ok');
  assert.equal(events[0].parse.summary, 'parsed plan');
  assert.equal(events[0].usage?.inputTokens, 1_000);
  assert.equal(events[0].usage?.outputTokens, 200);
  assert.equal(events[0].usage?.totalTokens, 1_200);
  assert.equal(events[0].usage?.pricingSource, '@arena/contracts');
  assert.equal(events[0].usage?.inputCostUsd, 0.00125);
  assert.equal(events[0].usage?.outputCostUsd, 0.002);
  assert.ok(Math.abs((events[0].usage?.apiEquivalentCostUsd ?? 0) - 0.00325) < 0.000000001);
});

test('returns an empty list when prompt trace file does not exist', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-prompt-trace-empty-'));

  assert.deepEqual(await readPromptTraceEvents(workDir), []);
});

test('rejects malformed prompt trace lines loudly', () => {
  assert.throws(
    () => parsePromptTraceLine('{"schemaVersion":"wrong"}'),
    /Invalid prompt trace event at line 1/,
  );

  assert.throws(
    () => parsePromptTraceLine('{', 7),
    /Invalid prompt trace JSON at line 7/,
  );
});
