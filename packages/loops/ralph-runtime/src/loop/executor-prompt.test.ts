import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPromptLabFixture } from '../prompts/prompt-lab.js';
import { renderExecutorAgentPrompt } from '../prompts/repository.js';
import { buildExecutorAgentPromptEnvelope } from './executor-prompt.js';

test('buildExecutorAgentPromptEnvelope creates the shared executor.agentPrompt fixture and rendered prompt', () => {
  const contextSections = '# Current Task\nImplement a synth pad state.';
  const envelope = buildExecutorAgentPromptEnvelope({
    name: 'executor-shared-prompt',
    contextSections,
  });

  assert.equal(envelope.ownerBoundary, 'ralph.executor-prompt');
  assert.equal(envelope.promptId, 'executor.agentPrompt');
  assert.equal(envelope.fixture.schemaVersion, 'ra-356.prompt-fixture.v1');
  assert.equal(envelope.fixture.promptId, 'executor.agentPrompt');
  assert.equal(envelope.fixture.name, 'executor-shared-prompt');
  assert.equal(envelope.fixture.input.contextSections, contextSections);
  assert.equal(envelope.prompt, renderExecutorAgentPrompt(contextSections));
  assert.equal(renderPromptLabFixture({ fixture: envelope.fixture }).rendered.text, envelope.prompt);
});
