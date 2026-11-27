import { log } from '../utils/logger.js';
import type { PlanManager } from '../planning/plan-manager.js';
import type { Agent } from '../agents/base.js';
import type { AgentResult, Task, PlanChange } from '../config/types.js';
import {
  COMMUNITY_QA_CONTEXT_TEMPLATE,
  renderQAPlannerSelectTasksPrompt,
  renderQATestRequestTaskDescription,
} from '../prompts/repository.js';
import { appendPromptModelCallTrace } from '../prompts/runtime-trace.js';

const QA_TASK_PREFIX = 'qa-';
const QA_MAX_TASKS = 10;

export const COMMUNITY_QA_CONTEXT = COMMUNITY_QA_CONTEXT_TEMPLATE;

/** Check if a task is a QA task by its id */
export function isQATask(taskId: string): boolean {
  return taskId.startsWith(QA_TASK_PREFIX);
}

/** Patterns that indicate non-feature (infra/test/setup) tasks — skip for QA */
const NON_FEATURE_PATTERNS = [
  /e2e/i,
  /qa-/i,
  /test/i,
  /lint/i,
  /typecheck/i,
  /build.check/i,
  /docker.*verif/i,
  /seed/i,
  /infrastructure/i,
  /setup/i,
  /foundation/i,
  /fix.*dockerfile/i,
  /ci[\s/-]?cd/i,
  /deploy/i,
  /config/i,
];

export interface QAPlannerResult {
  tasksAdded: number;
  taskIds: string[];
}

interface QATestItem {
  parentTaskId: string;
  title: string;
  steps: Array<{ question: string }>;
}

function isFeatureTask(task: Task): boolean {
  const desc = task.description.toLowerCase();
  const id = task.id.toLowerCase();
  if (id.startsWith(QA_TASK_PREFIX)) return false;
  if (id.startsWith('e2e-')) return false;
  if (NON_FEATURE_PATTERNS.some(p => p.test(desc))) return false;
  return true;
}

function qaTaskId(parentTaskId: string): string {
  return `${QA_TASK_PREFIX}${parentTaskId}`;
}

function buildQATaskDescription(parentDescription: string, steps: Array<{ question: string }>, specSummary?: string): string {
  return renderQATestRequestTaskDescription({ parentDescription, steps, specSummary });
}

function buildPlannerPrompt(specContent: string, candidateTasks: Task[], remainingSlots: number): string {
  const taskList = candidateTasks
    .map(t => `- ${t.id}: ${t.description}`)
    .join('\n');

  return renderQAPlannerSelectTasksPrompt({ specContent, taskList, remainingSlots });
}

/**
 * QA Planner — LLM-based plan augmentation module.
 *
 * Analyzes the plan + spec to identify tasks with visual/interactive features
 * that an AI agent cannot verify programmatically. Injects qa-* tasks into the
 * plan that instruct the agent to write community QA test requests.
 *
 * Follows the E2E Enforcer pattern: idempotent, protected namespace, dependency-based ordering.
 */
export async function applyQAPlanning(options: {
  planManager: PlanManager;
  specContent: string;
  agent: Agent;
  model?: string;
  workDir: string;
}): Promise<QAPlannerResult> {
  const { planManager, specContent, agent, model, workDir } = options;

  const allTasks = planManager.getAllTasks();

  // Count existing qa-* tasks
  const existingQaTasks = allTasks.filter(t => t.id.startsWith(QA_TASK_PREFIX));
  const remainingSlots = QA_MAX_TASKS - existingQaTasks.length;

  if (remainingSlots <= 0) {
    log.info(`QA Planner: cap reached (${existingQaTasks.length}/${QA_MAX_TASKS} qa tasks exist)`);
    return { tasksAdded: 0, taskIds: [] };
  }

  // Find candidate feature tasks that don't already have a qa-* counterpart
  const existingQaIds = new Set(existingQaTasks.map(t => t.id));
  const candidates = allTasks
    .filter(isFeatureTask)
    .filter(t => !existingQaIds.has(qaTaskId(t.id)));

  if (candidates.length === 0) {
    log.info('QA Planner: all feature tasks already have QA coverage or no candidates');
    return { tasksAdded: 0, taskIds: [] };
  }

  // Call LLM to decide which tasks need QA
  log.info(`QA Planner: analyzing ${candidates.length} candidate task(s) for community QA...`);

  const prompt = buildPlannerPrompt(specContent, candidates, remainingSlots);

  let qaItems: QATestItem[];
  try {
    const result = await agent.execute({
      prompt,
      workDir,
      model,
      timeout: 3,
    });

    // Parse JSON array from output (strip markdown fences if present)
    const clean = result.output.replace(/```json?\n?/g, '').replace(/```\n?/g, '');
    const start = clean.indexOf('[');
    if (start === -1) {
      await recordQAPlannerPromptTrace(workDir, prompt, result, model, {
        status: 'error',
        summary: 'no JSON array found',
        candidates: candidates.length,
        remainingSlots,
      });
      log.warn('QA Planner: no JSON array found in agent output');
      return { tasksAdded: 0, taskIds: [] };
    }

    // Balanced bracket match
    let depth = 0;
    let end = -1;
    for (let i = start; i < clean.length; i++) {
      if (clean[i] === '[') depth++;
      else if (clean[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) {
      await recordQAPlannerPromptTrace(workDir, prompt, result, model, {
        status: 'error',
        summary: 'unbalanced JSON array',
        candidates: candidates.length,
        remainingSlots,
      });
      log.warn('QA Planner: unbalanced JSON array in agent output');
      return { tasksAdded: 0, taskIds: [] };
    }

    qaItems = JSON.parse(clean.slice(start, end + 1));

    if (!Array.isArray(qaItems)) {
      await recordQAPlannerPromptTrace(workDir, prompt, result, model, {
        status: 'error',
        summary: 'parsed output is not an array',
        candidates: candidates.length,
        remainingSlots,
      });
      log.warn('QA Planner: parsed output is not an array');
      return { tasksAdded: 0, taskIds: [] };
    }
    await recordQAPlannerPromptTrace(workDir, prompt, result, model, {
      status: 'ok',
      summary: `selected=${qaItems.length}; candidates=${candidates.length}; remainingSlots=${remainingSlots}`,
      candidates: candidates.length,
      remainingSlots,
    });
  } catch (err: any) {
    await recordQAPlannerPromptTrace(workDir, prompt, {
      success: false,
      output: err.message,
    }, model, {
      status: 'error',
      summary: err.message,
      candidates: candidates.length,
      remainingSlots,
    });
    log.error(`QA Planner: agent call failed: ${err.message}`);
    return { tasksAdded: 0, taskIds: [] };
  }

  // Filter to valid items that reference real tasks and respect the cap
  const validItems = qaItems
    .filter(item => {
      if (!item.parentTaskId || !item.steps || !Array.isArray(item.steps)) return false;
      const parentExists = candidates.some(c => c.id === item.parentTaskId);
      if (!parentExists) {
        log.warn(`QA Planner: skipping item with unknown parentTaskId "${item.parentTaskId}"`);
        return false;
      }
      return true;
    })
    .slice(0, remainingSlots);

  if (validItems.length === 0) {
    log.info('QA Planner: LLM decided no tasks need community QA');
    return { tasksAdded: 0, taskIds: [] };
  }

  // Build PlanChanges
  const changes: PlanChange[] = [];
  const taskIds: string[] = [];

  for (const item of validItems) {
    const parentTask = candidates.find(c => c.id === item.parentTaskId)!;
    const phase = planManager.findTaskPhase(item.parentTaskId);
    if (!phase) {
      log.warn(`QA Planner: no phase found for ${item.parentTaskId}, skipping`);
      continue;
    }

    const qid = qaTaskId(item.parentTaskId);
    // Give the agent a brief spec summary so it understands the project context
    const specSummary = specContent.length > 1000
      ? specContent.slice(0, 1000) + '\n... (see full spec in project files)'
      : specContent;
    const qaTask: Task = {
      id: qid,
      displayTitle: item.title,
      description: buildQATaskDescription(parentTask.description, item.steps, specSummary),
      acceptanceCriteria: [
        '.arena/outgoing-events.json contains the visual QA test request(s)',
        'All questions are visual/interactive, answerable with Yes/No',
        'No technical questions about servers, ports, or endpoints',
      ],
      status: 'pending',
      attempts: 0,
      priority: 5,
      dependencies: [item.parentTaskId],
      estimatedComplexity: 'low',
      addedBy: 'qa-planner',
    };

    changes.push({ action: 'addTask', phaseId: phase.id, task: qaTask });
    taskIds.push(qid);

    log.info(`QA Planner: adding ${qid} → phase ${phase.id} (after ${item.parentTaskId})`);
  }

  if (changes.length === 0) {
    return { tasksAdded: 0, taskIds: [] };
  }

  const { applied, errors } = planManager.applyChanges(changes);
  for (const err of errors) {
    log.warn(`QA Planner: ${err}`);
  }

  return { tasksAdded: applied, taskIds };
}

async function recordQAPlannerPromptTrace(
  workDir: string,
  prompt: string,
  result: Pick<AgentResult, 'success' | 'output'> | { success: boolean; output: string },
  model: string | undefined,
  parse: {
    status: 'ok' | 'error';
    summary: string;
    candidates: number;
    remainingSlots: number;
  },
): Promise<void> {
  try {
    await appendPromptModelCallTrace(workDir, {
      promptId: 'qaPlanner.selectTasks',
      owner: 'qa-planner',
      label: 'Community QA task selection',
      prompt,
      result,
      model,
      parse: {
        status: parse.status,
        summary: parse.summary,
      },
      context: {
        candidates: parse.candidates,
        remainingSlots: parse.remainingSlots,
      },
    });
  } catch (err: any) {
    log.warn(`QA Planner: failed to write prompt trace: ${err.message}`);
  }
}
