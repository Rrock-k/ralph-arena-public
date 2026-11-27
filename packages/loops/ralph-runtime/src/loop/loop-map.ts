import type { PromptOwner } from '../prompts/repository.js';

export const RALPH_LOOP_MAP_SCHEMA_VERSION = 'ra-308.ralph-loop-map.v3' as const;

export type RalphLoopNodeId =
  | 'initialize'
  | 'plan'
  | 'control'
  | 'select_task'
  | 'build_prompt'
  | 'agent'
  | 'verify'
  | 'ship'
  | 'decide'
  | 'wait_for_specs';

export type RalphLoopNodeKind =
  | 'runtime'
  | 'planning'
  | 'control'
  | 'execution'
  | 'verification'
  | 'delivery'
  | 'decision'
  | 'waiting';

export interface RalphLoopSource {
  file: string;
  symbol: string;
  lineHint?: number;
}

export interface RalphLoopInternal {
  label: string;
  description: string;
  promptOwner?: PromptOwner;
  source?: RalphLoopSource;
}

export interface RalphLoopNode {
  id: RalphLoopNodeId;
  title: string;
  subtitle: string;
  kind: RalphLoopNodeKind;
  inputs: string[];
  outputs: string[];
  next: string[];
  internals: RalphLoopInternal[];
  source: RalphLoopSource;
  notes?: string[];
}

export interface RalphLoopDecision {
  id: string;
  nodeId: RalphLoopNodeId;
  when: string;
  out: string;
  source: RalphLoopSource;
}

export interface RalphLoopMap {
  schemaVersion: typeof RALPH_LOOP_MAP_SCHEMA_VERSION;
  generatedAt: string;
  owner: 'packages/loops/ralph-runtime';
  summary: string;
  nodes: RalphLoopNode[];
  decisions: RalphLoopDecision[];
  runtimeNotes: string[];
}

const EXECUTOR_SOURCE_FILE = 'packages/loops/ralph-runtime/src/loop/executor.ts';

const LOOP_NODES: readonly RalphLoopNode[] = [
  {
    id: 'initialize',
    title: 'Init',
    subtitle: 'env -> runtime state',
    kind: 'runtime',
    inputs: ['workDir', 'ralph.config', 'project.config', 'env', 'spec/tasks'],
    outputs: ['progress', 'history', 'mode', 'agent availability', 'runtime state'],
    next: ['plan'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.initialize',
      lineHint: 335,
    },
    internals: [
      {
        label: 'agent availability',
        description: 'Checks the selected agent adapter before any loop work starts.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.initialize', lineHint: 338 },
      },
      {
        label: 'durable state load',
        description: 'Loads progress, iteration history and judgment log.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.initialize', lineHint: 359 },
      },
      {
        label: 'spec-driven initialization',
        description: 'Requires accepted spec input, resumes or creates the plan, and applies pending spec migrations.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.initialize', lineHint: 380 },
      },
    ],
  },
  {
    id: 'plan',
    title: 'Plan',
    subtitle: 'spec -> plan/status',
    kind: 'planning',
    inputs: ['accepted spec', 'existing plan?', 'spec migrations', 'project config', 'arena capabilities'],
    outputs: ['plan', 'tasks', 'judgments', 'spec migration history', 'progress features'],
    next: ['control', 'select_task', 'wait_for_specs'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.initSpecDrivenMode',
      lineHint: 425,
    },
    internals: [
      {
        label: 'smart startup',
        description: 'Completed unchanged plans converge without new work.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.initSpecDrivenMode', lineHint: 461 },
      },
      {
        label: 'planner prompts',
        description: 'Creates first plan, replans, applies accepted spec migrations and audits priority.',
        promptOwner: 'planner',
      },
      {
        label: 'qa planner prompts',
        description: 'Adds qa-* tasks when Arena community QA capability is enabled.',
        promptOwner: 'qa-planner',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.initSpecDrivenMode', lineHint: 500 },
      },
    ],
    notes: [
      'The loop does not treat fresh accepted specs as a hidden relaunch; they enter through spec migration truth.',
    ],
  },
  {
    id: 'control',
    title: 'Control',
    subtitle: 'plan -> audit/replan',
    kind: 'control',
    inputs: ['spec', 'plan', 'history', 'snapshot', 'failure context'],
    outputs: ['controller report', 'plan changes', 'judgments', 'new tasks?', 'pause/fail?'],
    next: ['select_task', 'plan', 'wait_for_specs', 'pause', 'fail'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.runController',
      lineHint: 1379,
    },
    internals: [
      {
        label: 'startup controller',
        description: 'Runs after spec-driven initialization unless smart startup already completed.',
        promptOwner: 'controller',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.initialize', lineHint: 384 },
      },
      {
        label: 'failure/replan controller',
        description: 'Runs when no runnable tasks remain or repeated failures require a plan revision.',
        promptOwner: 'controller',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 752 },
      },
      {
        label: 'final controller',
        description: 'Audits the completed pass and can add more tasks before the loop idles.',
        promptOwner: 'controller',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.run', lineHint: 168 },
      },
    ],
  },
  {
    id: 'select_task',
    title: 'Task',
    subtitle: 'plan -> runnable task',
    kind: 'execution',
    inputs: ['plan tasks', 'dependencies', 'task status', 'deferred planLater phases'],
    outputs: ['current task', 'phase in progress', 'no runnable work signal'],
    next: ['build_prompt', 'control', 'wait_for_specs', 'fail'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.runExecutionLoop',
      lineHint: 727,
    },
    internals: [
      {
        label: 'select runnable task',
        description: 'Chooses the next task whose dependencies and status allow execution.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.selectNextTask', lineHint: 2100 },
      },
      {
        label: 'planLater expansion',
        description: 'Expands deferred phases before declaring no runnable task.',
        promptOwner: 'planner',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 731 },
      },
      {
        label: 'no-runnable replan',
        description: 'Routes unfinished but blocked plans through the controller before failing.',
        promptOwner: 'controller',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 747 },
      },
    ],
  },
  {
    id: 'build_prompt',
    title: 'Prompt',
    subtitle: 'task -> agent context',
    kind: 'execution',
    inputs: ['current task', 'task workspace', 'project goal', 'plan reference', 'previous errors', 'verification result', 'QA feedback'],
    outputs: ['rendered executor prompt', 'task-local skill files', 'task brief', 'task plan scaffold'],
    next: ['agent'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.runExecutionLoop',
      lineHint: 816,
    },
    internals: [
      {
        label: 'executor context sections',
        description: 'Builds current task, task workspace, role-pass instructions, goal, references, error and verification context sections.',
        promptOwner: 'executor',
      },
      {
        label: 'task workspace role passes',
        description: 'Seeds .ralph/tasks/<task-id>/brief.md, plan.md and task skill files for product / ux passes when required.',
        promptOwner: 'executor',
        source: { file: 'packages/loops/ralph-runtime/src/memory/context.ts', symbol: 'ContextBuilder.prepareTaskWorkspace', lineHint: 134 },
      },
      {
        label: 'community QA context',
        description: 'Injects user/test feedback when Arena community QA capability is active.',
        promptOwner: 'executor',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 816 },
      },
    ],
  },
  {
    id: 'agent',
    title: 'Agent',
    subtitle: 'prompt -> diff/signal',
    kind: 'execution',
    inputs: ['rendered prompt', 'agent adapter', 'workDir'],
    outputs: ['agent output', 'files changed', 'completion signal', 'failure category', 'needs_replan?'],
    next: ['verify', 'control', 'decide'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.executeAgent',
      lineHint: 1533,
    },
    internals: [
      {
        label: 'agent adapter',
        description: 'Runs Claude Code, Codex or another configured adapter.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.executeAgent', lineHint: 1533 },
      },
      {
        label: 'agent failure classification',
        description: 'Routes budget, rate-limit, infra, timeout, auth and config failures explicitly.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 845 },
      },
      {
        label: 'no-op guard',
        description: 'Treats success-without-changes as a failed iteration unless completion was promised.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 894 },
      },
      {
        label: 'replan signal',
        description: 'Routes NEEDS_REPLAN through controller instead of treating it as completion.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 914 },
      },
    ],
  },
  {
    id: 'verify',
    title: 'Verify',
    subtitle: 'diff -> local result',
    kind: 'verification',
    inputs: ['files changed', 'project scripts', 'verification config'],
    outputs: ['verification result', 'errors', 'evidence'],
    next: ['ship', 'decide'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.verify',
      lineHint: 1217,
    },
    internals: [
      {
        label: 'verification pipeline',
        description: 'Runs configured lint, typecheck, build and tests.',
        source: {
          file: 'packages/loops/ralph-runtime/src/verification/pipeline.ts',
          symbol: 'VerificationPipeline.verify',
          lineHint: 1,
        },
      },
    ],
  },
  {
    id: 'ship',
    title: 'Ship',
    subtitle: 'verified diff -> preview evidence',
    kind: 'delivery',
    inputs: ['verified changes', 'git settings', 'deploy settings', 'local Docker config'],
    outputs: ['commit?', 'push?', 'deploy result?', 'health/post-deploy evidence?'],
    next: ['decide'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.runExecutionLoop',
      lineHint: 980,
    },
    internals: [
      {
        label: 'auto commit/push',
        description: 'Commits code changes and task-status changes when configured.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 980 },
      },
      {
        label: 'cloud deploy check',
        description: 'Waits for GitHub deploy and checks configured health path.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 1023 },
      },
      {
        label: 'local Docker preview',
        description: 'Deploys locally, performs health check and optional post-deploy Playwright smoke against platform-owned browser readiness.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 1052 },
      },
      {
        label: 'vision QA',
        description: 'Optional visual QA pass can run before final controller audits when platform browser readiness is available.',
        promptOwner: 'vision-qa',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.run', lineHint: 173 },
      },
    ],
  },
  {
    id: 'decide',
    title: 'Decide',
    subtitle: 'result -> next action',
    kind: 'decision',
    inputs: ['verification/deploy result', 'agent output', 'attempt counters', 'controller policy', 'limits'],
    outputs: ['retry', 'controller pass', 'task complete', 'pause', 'fail', 'idle'],
    next: ['select_task', 'build_prompt', 'control', 'wait_for_specs', 'pause', 'fail'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.runExecutionLoop',
      lineHint: 943,
    },
    internals: [
      {
        label: 'mark task complete',
        description: 'Records completion when verification passed and completion promise was found.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 1156 },
      },
      {
        label: 'post-task controller trigger',
        description: 'Runs controller when spec-driven policy says the plan needs another audit.',
        promptOwner: 'controller',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 1174 },
      },
    ],
  },
  {
    id: 'wait_for_specs',
    title: 'Wait',
    subtitle: 'idle -> next accepted spec',
    kind: 'waiting',
    inputs: ['finalized run state', 'accepted spec directory', 'agent/app intent'],
    outputs: ['idle', 'pending spec migration', 'paused/final exit'],
    next: ['plan', 'initialize'],
    source: {
      file: EXECUTOR_SOURCE_FILE,
      symbol: 'LoopExecutor.run',
      lineHint: 217,
    },
    internals: [
      {
        label: 'finalize',
        description: 'Persists run end-state before deciding whether to keep watching.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.finalize', lineHint: 1854 },
      },
      {
        label: 'watch for new specs',
        description: 'Long-running spec-driven mode waits for newer accepted specs instead of ending forever.',
        source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.watchForNewSpecs', lineHint: 626 },
      },
    ],
  },
] as const;

const LOOP_DECISIONS: readonly RalphLoopDecision[] = [
  {
    id: 'smart_startup_done',
    nodeId: 'plan',
    when: 'existing plan complete && no pending spec migration',
    out: 'wait_for_specs',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.initSpecDrivenMode', lineHint: 461 },
  },
  {
    id: 'accepted_spec_changed',
    nodeId: 'plan',
    when: 'new accepted spec hash is not recorded in plan migrations',
    out: 'plan -> control/select_task',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.applyPendingSpecMigrations', lineHint: 568 },
  },
  {
    id: 'no_runnable_tasks_replan',
    nodeId: 'select_task',
    when: 'unfinished tasks exist but none is runnable',
    out: 'control',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 747 },
  },
  {
    id: 'agent_pause',
    nodeId: 'agent',
    when: 'budget || rate_limit || infra pause category',
    out: 'pause',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 845 },
  },
  {
    id: 'agent_needs_replan',
    nodeId: 'agent',
    when: 'agent output contains NEEDS_REPLAN',
    out: 'control',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 914 },
  },
  {
    id: 'verification_failed',
    nodeId: 'verify',
    when: 'verificationResult.passed === false',
    out: 'decide retry/control/fail',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 943 },
  },
  {
    id: 'deploy_failed',
    nodeId: 'ship',
    when: 'cloud/local deploy or health check fails',
    out: 'decide retry/control/fail',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 1023 },
  },
  {
    id: 'task_complete',
    nodeId: 'decide',
    when: 'verification/deploy passed && completion promise found',
    out: 'select_task/control/wait_for_specs',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.runExecutionLoop', lineHint: 1156 },
  },
  {
    id: 'final_controller_adds_tasks',
    nodeId: 'control',
    when: 'final controller audit creates more runnable work',
    out: 'select_task',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.run', lineHint: 200 },
  },
  {
    id: 'new_specs_arrive',
    nodeId: 'wait_for_specs',
    when: 'watchForNewSpecs sees unprocessed accepted spec',
    out: 'plan',
    source: { file: EXECUTOR_SOURCE_FILE, symbol: 'LoopExecutor.run', lineHint: 226 },
  },
] as const;

const RUNTIME_NOTES = [
  'This map is an operator-facing read-only export. It documents current Ralph control flow but does not drive execution.',
  'Prompt Map live run evidence still comes from prompt traces; this loop map is static runtime structure.',
  'Preview/runtime lifecycle truth remains owned by Arena project/component contracts, not by this map.',
] as const;

export function getRalphLoopNodes(): RalphLoopNode[] {
  return LOOP_NODES.map(cloneLoopNode);
}

export function getRalphLoopDecisions(): RalphLoopDecision[] {
  return LOOP_DECISIONS.map(cloneLoopDecision);
}

export function exportRalphLoopMap(options: { generatedAt?: string } = {}): RalphLoopMap {
  return {
    schemaVersion: RALPH_LOOP_MAP_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    owner: 'packages/loops/ralph-runtime',
    summary: 'Current Ralph spec-driven flow: initialize, plan or migrate accepted specs, audit/control, select task, render prompt, run agent, verify, ship, decide, then idle for the next accepted spec.',
    nodes: getRalphLoopNodes(),
    decisions: getRalphLoopDecisions(),
    runtimeNotes: [...RUNTIME_NOTES],
  };
}

function cloneLoopNode(node: RalphLoopNode): RalphLoopNode {
  return {
    ...node,
    inputs: [...node.inputs],
    outputs: [...node.outputs],
    next: [...node.next],
    source: { ...node.source },
    internals: node.internals.map((internal) => ({
      ...internal,
      ...(internal.source ? { source: { ...internal.source } } : {}),
    })),
    ...(node.notes ? { notes: [...node.notes] } : {}),
  };
}

function cloneLoopDecision(decision: RalphLoopDecision): RalphLoopDecision {
  return {
    ...decision,
    source: { ...decision.source },
  };
}
