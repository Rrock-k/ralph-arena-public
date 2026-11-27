import { log } from '../utils/logger.js';
import type { PlanManager } from '../planning/plan-manager.js';
import type { Task, Phase, PlanChange } from '../config/types.js';

/**
 * E2E Coverage Enforcer
 * 
 * Deterministic (no LLM) module that ensures every completed feature task
 * has a corresponding e2e test task in the same phase.
 * Each e2e task depends on its feature task, so it becomes runnable only after that feature is done.
 * 
 * Runs at startup and after each controller audit. Fully idempotent.
 * 
 * Logic:
 * 1. Scan all completed tasks that are NOT themselves test/infrastructure tasks
 * 2. For each, check if an e2e test task referencing it already exists (anywhere in the plan)
 * 3. If not, insert one into the **same phase** as the feature, with a dependency on it
 * 4. Also ensures there's a "run all e2e tests" meta-task in the final phase
 *
 * Important: this module enforces e2e coverage tasks in the plan.
 * It does NOT mean e2e tests already passed.
 */

const E2E_TASK_PREFIX = 'e2e-';
const E2E_RUN_ALL_ID = 'e2e-run-all';
export const E2E_ENFORCER_MIN_FEATURE_TASKS = getMinFeatureTasksThreshold();

// Tasks matching these patterns are NOT feature tasks — don't generate e2e for them
const NON_FEATURE_PATTERNS = [
  /e2e/i,
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
  /responsive/i,
  /accessibility/i,
  /focus.state/i,
];

function getMinFeatureTasksThreshold(): number {
  const raw = process.env.RALPH_E2E_ENFORCER_MIN_FEATURE_TASKS ?? '2';
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 2;
  return parsed;
}

/**
 * Check if a task is a "feature" task that should have e2e coverage.
 * Filters out infrastructure, testing, and setup tasks.
 */
function isFeatureTask(task: Task): boolean {
  const desc = task.description.toLowerCase();
  const id = task.id.toLowerCase();
  
  // Skip tasks that are themselves test/infra tasks
  if (id.startsWith('e2e-')) return false;
  if (NON_FEATURE_PATTERNS.some(p => p.test(desc))) return false;
  
  return true;
}

/**
 * Generate the e2e task ID for a given feature task
 */
function e2eTaskId(featureTaskId: string): string {
  return `${E2E_TASK_PREFIX}${featureTaskId}`;
}

export interface EnforcerResult {
  tasksAdded: number;
  changesApplied: number;
  phaseCreated: boolean;
  taskIds: string[];
}

function featureE2EDescription(feature: Task, eid = e2eTaskId(feature.id)): string {
  return `Write Playwright e2e test for: "${feature.description}". ` +
    `Launch the app (or use existing running instance at the healthCheckUrl), ` +
    `navigate to the relevant page, verify the feature works visually and functionally. ` +
    `The test file should be in e2e/ directory and named ${eid}.spec.ts. ` +
    `Use @playwright/test with platform-provided browser readiness. ` +
    `Do not install Chromium, run \`npx playwright install\`, or run \`playwright install-deps\` in the project workspace. ` +
    `When platform browser readiness is available, \`npx playwright test e2e/${eid}.spec.ts\` should pass; when it is unavailable, record INFRA_BROWSER_UNAVAILABLE instead of changing project code to install browser infra.`;
}

function featureE2EAcceptanceCriteria(feature: Task, eid = e2eTaskId(feature.id)): string[] {
  return [
    `e2e/${eid}.spec.ts exists`,
    `Test uses Playwright @playwright/test`,
    `Test navigates to the correct page and verifies the feature from ${feature.id}`,
    `\`npx playwright test e2e/${eid}.spec.ts\` passes when platform browser readiness is available`,
    `Missing platform browser readiness is recorded as INFRA_BROWSER_UNAVAILABLE without project-local browser install`,
  ];
}

function runAllE2EDescription(): string {
  return `Run ALL Playwright e2e tests together and ensure they all pass. ` +
    `Fix flaky or broken project tests. Run: \`npx playwright test e2e/\` only against platform-provided browser readiness. ` +
    `Do not install Chromium, run \`npx playwright install\`, or run \`playwright install-deps\` in the project workspace. ` +
    `If platform browser readiness is unavailable, record INFRA_BROWSER_UNAVAILABLE and do not treat that as a project bug.`;
}

function runAllE2EAcceptanceCriteria(): string[] {
  return [
    '`npx playwright test e2e/` runs successfully when platform browser readiness is available',
    'All runnable e2e tests pass with 0 project failures',
    'Missing platform browser readiness is recorded as INFRA_BROWSER_UNAVAILABLE without project-local browser install',
    'No flaky tests (run twice to confirm)',
  ];
}

function needsBrowserContractNormalization(task: Task): boolean {
  const text = [task.description, ...task.acceptanceCriteria].join('\n');
  return !text.includes('INFRA_BROWSER_UNAVAILABLE')
    || /Must pass `npx playwright test/i.test(text)
    || /All tests must pass with 0 failures/i.test(text);
}

/**
 * Scan the plan and idempotently ensure e2e test tasks exist 
 * for all completed feature tasks.
 * 
 * E2e tasks are added to the SAME phase as their feature (not a separate end phase).
 * Exact execution order is determined by scheduler priorities + dependencies.
 * 
 * Returns plan changes that can be applied via planManager.applyChanges().
 */
export function enforceE2ECoverage(planManager: PlanManager): { changes: PlanChange[]; summary: string } {
  const allTasks = planManager.getAllTasks();
  const changes: PlanChange[] = [];
  const featureTasks = allTasks.filter(isFeatureTask);

  if (featureTasks.length < E2E_ENFORCER_MIN_FEATURE_TASKS) {
    return {
      changes: [],
      summary: `Skipping e2e enforcer: only ${featureTasks.length} feature task(s), threshold is ${E2E_ENFORCER_MIN_FEATURE_TASKS}`,
    };
  }
  
  // 1. Find completed feature tasks that need e2e coverage
  const completedFeatures = featureTasks.filter(t => t.status === 'completed');
  
  if (completedFeatures.length === 0) {
    return { changes: [], summary: 'No completed features yet — nothing to enforce' };
  }

  // 2. Check which e2e tasks already exist
  const existingIds = new Set(allTasks.map(t => t.id));
  const missingE2e: { feature: Task; phaseId: string }[] = [];

  for (const feature of completedFeatures) {
    const eid = e2eTaskId(feature.id);
    if (!existingIds.has(eid)) {
      // Find which phase this feature belongs to
      const phase = planManager.findTaskPhase(feature.id);
      if (phase) {
        missingE2e.push({ feature, phaseId: phase.id });
      }
    }
  }

  const existingFeatureE2e = completedFeatures
    .map(f => allTasks.find(t => t.id === e2eTaskId(f.id)))
    .filter((t): t is Task => t !== undefined);
  const completedFeatureE2eCount = existingFeatureE2e
    .filter(t => t.status === 'completed' || t.status === 'skipped')
    .length;
  const pendingFeatureE2eCount = existingFeatureE2e.length - completedFeatureE2eCount;

  const normalizedTaskIds: string[] = [];
  for (const feature of completedFeatures) {
    const existing = allTasks.find(t => t.id === e2eTaskId(feature.id));
    if (!existing || existing.status !== 'pending' || !needsBrowserContractNormalization(existing)) continue;

    const eid = e2eTaskId(feature.id);
    changes.push({
      action: 'updateTask',
      taskId: existing.id,
      changes: {
        description: featureE2EDescription(feature, eid),
        acceptanceCriteria: featureE2EAcceptanceCriteria(feature, eid),
      },
    });
    normalizedTaskIds.push(existing.id);
  }

  const existingRunAll = allTasks.find(t => t.id === E2E_RUN_ALL_ID);
  if (existingRunAll?.status === 'pending' && needsBrowserContractNormalization(existingRunAll)) {
    changes.push({
      action: 'updateTask',
      taskId: E2E_RUN_ALL_ID,
      changes: {
        description: runAllE2EDescription(),
        acceptanceCriteria: runAllE2EAcceptanceCriteria(),
      },
    });
    normalizedTaskIds.push(E2E_RUN_ALL_ID);
  }

  if (missingE2e.length === 0 && existingIds.has(E2E_RUN_ALL_ID)) {
    return {
      changes,
      summary: `All ${completedFeatures.length} completed features have e2e tasks defined (${completedFeatureE2eCount} completed, ${pendingFeatureE2eCount} pending)` +
        (normalizedTaskIds.length > 0 ? `; normalizing ${normalizedTaskIds.length} legacy e2e task(s): ${normalizedTaskIds.join(', ')}` : ''),
    };
  }

  // 3. Add missing e2e tasks — each goes into the SAME phase as its feature
  for (const { feature, phaseId } of missingE2e) {
    const eid = e2eTaskId(feature.id);
    
    const e2eTask: Task = {
      id: eid,
      description: featureE2EDescription(feature, eid),
      acceptanceCriteria: featureE2EAcceptanceCriteria(feature, eid),
      status: 'pending',
      attempts: 0,
      priority: 5,
      dependencies: [feature.id],  // depends on the feature → runs right after it
      estimatedComplexity: 'medium',
      addedBy: 'controller',
    };

    changes.push({
      action: 'addTask',
      phaseId,
      task: e2eTask,
    });
    
    log.info(`E2E Enforcer: adding test task ${eid} → phase ${phaseId} (after ${feature.id})`);
  }

  // 4. Ensure "run all e2e" meta-task exists (in the last phase)
  if (!existingIds.has(E2E_RUN_ALL_ID)) {
    const plan = planManager.currentPlan;
    const lastPhase = [...plan.phases].sort((a, b) => b.order - a.order)[0];

    // Gather all e2e task ids (existing + just added)
    const allE2eIds = [
      ...missingE2e.map(m => e2eTaskId(m.feature.id)),
      ...allTasks.filter(t => t.id.startsWith(E2E_TASK_PREFIX) && t.id !== E2E_RUN_ALL_ID).map(t => t.id),
    ];

    const runAllTask: Task = {
      id: E2E_RUN_ALL_ID,
      description: runAllE2EDescription(),
      acceptanceCriteria: runAllE2EAcceptanceCriteria(),
      status: 'pending',
      attempts: 0,
      priority: 5,
      dependencies: allE2eIds,
      estimatedComplexity: 'low',
      addedBy: 'controller',
    };

    changes.push({
      action: 'addTask',
      phaseId: lastPhase.id,
      task: runAllTask,
    });

    log.info(`E2E Enforcer: adding "run all e2e tests" → phase ${lastPhase.id}`);
  }

  const summary = missingE2e.length > 0
    ? `Adding ${missingE2e.length} e2e test task(s) inline: ${missingE2e.map(m => e2eTaskId(m.feature.id)).join(', ')}` +
      (normalizedTaskIds.length > 0 ? `; normalizing ${normalizedTaskIds.length} legacy e2e task(s): ${normalizedTaskIds.join(', ')}` : '')
    : `All completed features already have e2e tasks defined (${completedFeatureE2eCount} completed, ${pendingFeatureE2eCount} pending)`;

  return { changes, summary };
}

/**
 * Apply e2e enforcement to the plan. Idempotent.
 * Returns number of tasks added.
 */
export function applyE2EEnforcement(planManager: PlanManager): EnforcerResult {
  const { changes, summary } = enforceE2ECoverage(planManager);

  if (changes.length === 0) {
    log.info(`E2E Enforcer: ${summary}`);
    return { tasksAdded: 0, changesApplied: 0, phaseCreated: false, taskIds: [] };
  }

  log.info(`E2E Enforcer: ${summary}`);
  
  const phaseCreated = changes.some(c => c.action === 'addPhase');
  const taskIds = changes
    .filter(c => c.action === 'addTask')
    .map(c => (c as any).task.id);

  const { applied, errors } = planManager.applyChanges(changes);
  
  for (const err of errors) {
    log.warn(`E2E Enforcer: ${err}`);
  }

  return { tasksAdded: taskIds.length, changesApplied: applied, phaseCreated, taskIds };
}
