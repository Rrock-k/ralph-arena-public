import {
  appendPromptModelCallTrace as appendLocalPromptModelCallTrace,
  type PromptModelCallTraceInput,
  type PromptTraceEvent,
} from './trace.js';
import { mirrorPromptTraceEventToLangfuse } from './langfuse.js';

export async function appendPromptModelCallTrace(
  workDir: string,
  input: PromptModelCallTraceInput,
): Promise<PromptTraceEvent> {
  const event = await appendLocalPromptModelCallTrace(workDir, input);
  // Optional runtime observability sink; local JSONL remains Prompt Calls truth.
  void mirrorPromptTraceEventToLangfuse(event);
  return event;
}
