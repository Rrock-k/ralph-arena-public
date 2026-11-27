import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTextFromStreamJson, mergeExtractedStreamText } from './stream-json.js';

test('extractTextFromStreamJson keeps success result text only once', () => {
  const output = [
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '```json\n{"summary":"ok","planChanges":[],"newJudgments":[]}\n```',
    }),
  ].join('\n');

  const extracted = extractTextFromStreamJson(output);

  assert.equal(
    extracted,
    '```json\n{"summary":"ok","planChanges":[],"newJudgments":[]}\n```',
  );
});

test('extractTextFromStreamJson preserves assistant text plus single final result', () => {
  const output = [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Planning update' },
        ],
      },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Final answer',
    }),
  ].join('\n');

  const extracted = extractTextFromStreamJson(output);

  assert.equal(extracted, 'Planning update\nFinal answer');
});

test('extractTextFromStreamJson deduplicates identical assistant and result blocks', () => {
  const jsonBlock = '```json\n{"summary":"ok","planChanges":[],"newJudgments":[]}\n```';
  const output = [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: jsonBlock },
        ],
      },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: jsonBlock,
    }),
  ].join('\n');

  const extracted = extractTextFromStreamJson(output);

  assert.equal(extracted, jsonBlock);
});

test('mergeExtractedStreamText keeps assistant text when result duplicates it', () => {
  const jsonBlock = '```json\n{"summary":"ok","planChanges":[],"newJudgments":[]}\n```';

  const merged = mergeExtractedStreamText(jsonBlock, jsonBlock);

  assert.equal(merged, jsonBlock);
});
