import type { Agent, AgentOptions } from '../agents/base.js';
import type { AgentResult } from '../config/types.js';
import { detectExecutorCompletionPromise } from './executor-signals.js';

export type ExecutorAgentCallInput = {
  agent: Pick<Agent, 'name' | 'execute'>;
  workDir: string;
  prompt: string;
  completionPromise: string;
  model?: string | null;
  timeoutMinutes?: number | null;
  verbose: boolean;
  providerSessionResumeId?: string | null;
};

export type ExecutorAgentCallResult = {
  ownerBoundary: 'ralph.executor-agent-call';
  agentName: string;
  model: string | null;
  timeoutMinutes: number | null;
  providerSessionResumeId: string | null;
  completionPromiseFound: boolean;
  result: AgentResult;
};

export async function runExecutorAgentCall(input: ExecutorAgentCallInput): Promise<ExecutorAgentCallResult> {
  const providerSessionResumeId = input.providerSessionResumeId?.trim() || null;
  const result = await input.agent.execute({
    workDir: input.workDir,
    prompt: input.prompt,
    timeout: input.timeoutMinutes ?? undefined,
    verbose: input.verbose,
    model: input.model ?? undefined,
    providerSessionResumeId: providerSessionResumeId ?? undefined,
  } satisfies AgentOptions);
  const completionPromiseFound = detectExecutorCompletionPromise(
    result.output,
    input.completionPromise,
  );
  const normalizedResult: AgentResult = {
    ...result,
    completionPromiseFound,
  };

  return {
    ownerBoundary: 'ralph.executor-agent-call',
    agentName: input.agent.name,
    model: input.model ?? null,
    timeoutMinutes: input.timeoutMinutes ?? null,
    providerSessionResumeId,
    completionPromiseFound,
    result: normalizedResult,
  };
}
