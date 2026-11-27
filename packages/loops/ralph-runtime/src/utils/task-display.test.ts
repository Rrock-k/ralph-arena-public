import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTaskLogLabel, getTaskDisplayTitle } from './task-display.js';

test('task display title prefers explicit displayTitle', () => {
  const task = {
    id: 'task-036',
    displayTitle: 'Prepare notation renderer brief',
    description: 'Create the near-term renderer design brief required before custom notation implementation.',
  };

  assert.equal(getTaskDisplayTitle(task), 'Prepare notation renderer brief');
  assert.equal(formatTaskLogLabel(task), 'task-036 - Prepare notation renderer brief');
});

test('task display title falls back to first sentence of description', () => {
  const task = {
    id: 'task-999',
    description: 'Create the near-term renderer design brief required before custom notation implementation. Document details later.',
  };

  assert.equal(
    getTaskDisplayTitle(task, 80),
    'Create the near-term renderer design brief required before custom notation...',
  );
});

test('task display title falls back to id when no text is available', () => {
  assert.equal(formatTaskLogLabel({ id: 'task-empty' }), 'task-empty');
});
