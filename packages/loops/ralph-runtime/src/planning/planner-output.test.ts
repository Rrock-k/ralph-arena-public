import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePlannerAgentOutput,
  validatePlannerAgentOutput,
} from './planner-output.js';

test('parsePlannerAgentOutput extracts fenced planner JSON', () => {
  const parsed = parsePlannerAgentOutput(jsonBlock(buildPlannerOutput()));

  assert.equal(parsed.projectGoal, 'Build visual workbench coverage.');
  assert.equal(parsed.phases.length, 1);
  assert.equal(parsed.judgments.length, 0);
  assert.deepEqual(parsed.feedbackDispositions, [{
    itemId: 'DIFF-001',
    disposition: 'coveredByOpenTask',
    taskIds: ['task-001'],
    reason: 'Initial task covers the accepted diff item.',
  }]);
});

test('validatePlannerAgentOutput extracts Claude stream-json text', () => {
  const streamJson = `${JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'text',
        text: jsonBlock(buildPlannerOutput()),
      }],
    },
  })}\n`;

  const parsed = validatePlannerAgentOutput(streamJson);

  assert.equal(parsed.phases[0].id, 'phase-1');
  assert.equal(parsed.phases[0].tasks[0].id, 'task-001');
});

test('validatePlannerAgentOutput fills planner-owned judgment metadata', () => {
  const output = buildPlannerOutput() as any;
  output.judgments = [{
    id: 'judgment-001',
    timestamp: '2026-06-08T00:00:00.000Z',
    phaseId: null,
    taskId: null,
    ambiguity: 'Which implementation path should the planner choose?',
    options: ['A', 'B'],
    chosen: 0,
    reasoning: 'The planner owns this planning-time decision.',
  }];

  const parsed = validatePlannerAgentOutput(jsonBlock(output));

  assert.equal(parsed.judgments[0].madeBy, 'planner');
});

test('parsePlannerAgentOutput rejects missing phases', () => {
  assert.throws(
    () => parsePlannerAgentOutput('```json\n{"judgments":[]}\n```'),
    /Missing "phases" array/,
  );
});

function buildPlannerOutput(): unknown {
  return {
    projectGoal: 'Build visual workbench coverage.',
    phases: [{
      id: 'phase-1',
      name: 'Visual coverage',
      description: 'Add isolated visual stories.',
      order: 1,
      status: 'pending',
      planLater: false,
      tasks: [{
        id: 'task-001',
        displayTitle: 'Add SynthPad story',
        description: 'Render the SynthPad playing state in the Visual Workbench.',
        acceptanceCriteria: [
          'SynthPad playing state is rendered through visual-workbench/manifest.json.',
        ],
        status: 'pending',
        attempts: 0,
        dependencies: [],
      }],
    }],
    judgments: [],
    feedbackDispositions: [{
      itemId: 'DIFF-001',
      disposition: 'coveredByOpenTask',
      taskIds: ['task-001'],
      reason: 'Initial task covers the accepted diff item.',
    }],
  };
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}
