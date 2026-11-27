import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportRalphLoopMap,
  getRalphLoopDecisions,
  getRalphLoopNodes,
  RALPH_LOOP_MAP_SCHEMA_VERSION,
} from './loop-map.js';

const REQUIRED_NODE_IDS = [
  'initialize',
  'plan',
  'control',
  'select_task',
  'build_prompt',
  'agent',
  'verify',
  'ship',
  'decide',
  'wait_for_specs',
] as const;

test('exports the current Ralph loop stages', () => {
  const nodes = getRalphLoopNodes();
  const ids = new Set(nodes.map(node => node.id));

  for (const id of REQUIRED_NODE_IDS) {
    assert.equal(ids.has(id), true, `missing loop node: ${id}`);
  }
});

test('loop node ids and decision ids are unique', () => {
  const nodeIds = getRalphLoopNodes().map(node => node.id);
  const decisionIds = getRalphLoopDecisions().map(decision => decision.id);

  assert.equal(new Set(nodeIds).size, nodeIds.length);
  assert.equal(new Set(decisionIds).size, decisionIds.length);
});

test('loop map points back to runtime-owned sources', () => {
  const nodes = getRalphLoopNodes();
  const decisions = getRalphLoopDecisions();
  const nodeIds = new Set(nodes.map(node => node.id));

  for (const node of nodes) {
    assert.match(node.source.file, /^packages\/loops\/ralph-runtime\/src\/.+\.ts$/);
    assert.ok(node.source.symbol.length > 0);
    assert.ok(node.title.length > 0);
    assert.ok(node.subtitle.length > 0);
  }

  for (const decision of decisions) {
    assert.equal(nodeIds.has(decision.nodeId), true, `decision points to missing node: ${decision.id}`);
    assert.match(decision.source.file, /^packages\/loops\/ralph-runtime\/src\/.+\.ts$/);
  }
});

test('loop map includes branches that made the old UI sketch stale', () => {
  const map = exportRalphLoopMap({ generatedAt: '2026-05-18T00:00:00.000Z' });
  const planNode = map.nodes.find(node => node.id === 'plan');
  const controlNode = map.nodes.find(node => node.id === 'control');
  const waitNode = map.nodes.find(node => node.id === 'wait_for_specs');

  assert.equal(map.schemaVersion, RALPH_LOOP_MAP_SCHEMA_VERSION);
  assert.equal(map.generatedAt, '2026-05-18T00:00:00.000Z');
  assert.ok(planNode?.internals.some(internal => internal.label === 'smart startup'));
  assert.ok(planNode?.internals.some(internal => internal.promptOwner === 'qa-planner'));
  assert.ok(controlNode?.internals.some(internal => internal.label === 'final controller'));
  assert.ok(waitNode?.internals.some(internal => internal.label === 'watch for new specs'));
  assert.ok(map.nodes.find(node => node.id === 'build_prompt')?.internals.some(internal => internal.label === 'task workspace role passes'));
  assert.ok(map.decisions.some(decision => decision.id === 'accepted_spec_changed'));
  assert.ok(map.decisions.some(decision => decision.id === 'new_specs_arrive'));
});

test('export returns cloned loop structures', () => {
  const first = getRalphLoopNodes();
  first[0].inputs.push('mutated');
  first[0].internals[0].label = 'mutated';

  const second = getRalphLoopNodes();

  assert.equal(second[0].inputs.includes('mutated'), false);
  assert.notEqual(second[0].internals[0].label, 'mutated');
});
