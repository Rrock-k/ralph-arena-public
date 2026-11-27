import {
  PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
  type PromptLabFixture,
} from '../prompts/prompt-lab.js';
import { renderExecutorAgentPrompt } from '../prompts/repository.js';

export type ExecutorAgentPromptFixture = PromptLabFixture & {
  promptId: 'executor.agentPrompt';
  input: {
    contextSections: string;
  };
};

export type ExecutorAgentPromptEnvelope = {
  ownerBoundary: 'ralph.executor-prompt';
  promptId: 'executor.agentPrompt';
  fixture: ExecutorAgentPromptFixture;
  prompt: string;
};

export function buildExecutorAgentPromptEnvelope(input: {
  name?: string;
  contextSections: string;
}): ExecutorAgentPromptEnvelope {
  const fixture: ExecutorAgentPromptFixture = {
    schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
    promptId: 'executor.agentPrompt',
    ...(input.name ? { name: input.name } : {}),
    input: {
      contextSections: input.contextSections,
    },
  };

  return {
    ownerBoundary: 'ralph.executor-prompt',
    promptId: 'executor.agentPrompt',
    fixture,
    prompt: renderExecutorAgentPrompt(input.contextSections),
  };
}
