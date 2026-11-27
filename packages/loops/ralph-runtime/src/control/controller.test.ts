import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Controller, ControllerAuditFailure } from './controller.js';
import { PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH } from '../agents/provider-call-checkpoint.js';
import { ControllerReportSchema } from '../config/types.js';
import { PlanManager } from '../planning/plan-manager.js';

function visualEvidenceRequiredRalphConfig() {
  return {
    visualWorkbench: {
      visualEvidenceMode: 'required',
    },
  };
}

test('controller report ids continue from files already on disk', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-'));
  const reportsDir = path.join(workDir, '.ralph', 'controller-reports');
  mkdirSync(reportsDir, { recursive: true });

  writeFileSync(path.join(reportsDir, 'report-001.json'), '{}', { flag: 'w' });
  writeFileSync(path.join(reportsDir, 'report-002.json'), '{}', { flag: 'w' });

  const controller = new Controller(workDir);

  assert.equal((controller as any).nextReportId(), 'report-003');
});

test('controller report schema accepts spec migration trigger', () => {
  const parsed = ControllerReportSchema.parse({
    id: 'report-001',
    timestamp: new Date().toISOString(),
    trigger: 'spec_migration',
    verdict: 'continue',
    summary: 'ok',
    planChanges: [],
    newJudgments: [],
    revisedJudgments: [],
  });

  assert.equal(parsed.trigger, 'spec_migration');
});

test('controller report schema accepts semantic feedback guard fields', () => {
  const legacy = ControllerReportSchema.parse({
    id: 'report-001',
    timestamp: new Date().toISOString(),
    trigger: 'final',
    verdict: 'continue',
    summary: 'ok',
    planChanges: [],
    newJudgments: [],
    revisedJudgments: [],
  });
  assert.equal(legacy.feedbackMatrix, undefined);

  const guarded = ControllerReportSchema.parse({
    id: 'report-002',
    timestamp: new Date().toISOString(),
    trigger: 'final',
    reportType: 'semantic_audit',
    semanticAudit: true,
    verdict: 'revise',
    summary: 'needs work',
    planChanges: [],
    newJudgments: [],
    revisedJudgments: [],
    feedbackMatrix: [{
      itemId: 'BUG-005',
      status: 'implemented_unverified',
      linkedTaskIds: ['task-001'],
      closureAllowed: false,
      operatorSummary: 'BUG-005 needs evidence',
    }],
    overclaimWarnings: ['BUG-005 needs evidence'],
  });

  assert.equal(guarded.semanticAudit, true);
  assert.equal(guarded.feedbackMatrix?.[0].itemId, 'BUG-005');
  assert.deepEqual(guarded.overclaimWarnings, ['BUG-005 needs evidence']);
});

test('controller audits request a no-tools agent response contract', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-no-tools-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);
  await planManager.save();

  const controller = new Controller(workDir);
  let observedAllowedTools: string[] | undefined;
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async ({ allowedTools }: any) => {
        observedAllowedTools = allowedTools;
        return {
          success: true,
          output: jsonReport({
            verdict: 'continue',
            summary: 'No changes.',
            planChanges: [],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.deepEqual(observedAllowedTools, []);
  assert.equal(report.verdict, 'continue');
});

test('controller production audit resumes failed provider call for identical rendered prompt', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-provider-call-resume-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);
  await planManager.save();

  const controller = new Controller(workDir);
  (controller as any).gatherProjectSnapshot = async () => 'stable snapshot';
  (controller as any).buildAuditPrompt = () => 'stable controller audit prompt';

  await assert.rejects(
    () => controller.audit({
      workDir,
      specPath,
      projectConfig: {} as any,
      ralphConfig: {} as any,
      agent: {
        name: 'fake-controller',
        execute: async ({ providerSessionResumeId }: any) => {
          assert.equal(providerSessionResumeId, undefined);
          return {
            success: false,
            output: 'provider failed',
            filesChanged: [],
            completionPromiseFound: false,
            error: { category: 'infra', message: 'provider failed' },
            providerSession: { id: 'session-old' },
          };
        },
      } as any,
      model: 'gpt-5-codex',
      planManager,
      judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
      iterationHistory: [],
      verbose: false,
    }, 'final'),
    ControllerAuditFailure,
  );

  let observedResumeId: string | undefined;
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      name: 'fake-controller',
      execute: async ({ providerSessionResumeId }: any) => {
        observedResumeId = providerSessionResumeId;
        return {
          success: true,
          output: jsonReport({
            verdict: 'continue',
            summary: 'No changes.',
            planChanges: [],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
          providerSession: { id: 'session-new', resumedFrom: 'session-old' },
        };
      },
    } as any,
    model: 'gpt-5-codex',
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(observedResumeId, 'session-old');
  assert.equal(report.verdict, 'continue');
});

test('controller final audit retries once when the report contract is invalid', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-final-report-repair-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const prompts: string[] = [];
  const resumeIds: Array<string | undefined> = [];
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      name: 'fake-controller',
      execute: async ({ prompt, allowedTools, providerSessionResumeId }: any) => {
        prompts.push(prompt);
        resumeIds.push(providerSessionResumeId);
        assert.deepEqual(allowedTools, []);
        return {
          success: true,
          output: prompts.length === 1
            ? "I'll start by examining the current codebase before giving a verdict."
            : jsonReport({
                verdict: 'continue',
                summary: 'No changes.',
                planChanges: [],
                newJudgments: [],
                revisedJudgments: [],
              }),
          filesChanged: [],
          completionPromiseFound: false,
          providerSession: { id: prompts.length === 1 ? 'session-invalid-report' : 'session-repair-report' },
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Previous Controller Output Was Invalid/);
  assert.match(prompts[1], /Could not find JSON in controller output/);
  assert.match(prompts[1], /examining the current codebase/);
  assert.deepEqual(resumeIds, [undefined, undefined]);
});

test('controller replan retries an invalid plan-change packet without applying a partial report', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-replan-report-repair-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Phase 1',
    description: 'Phase 1',
    order: 1,
    status: 'pending',
    planLater: false,
    tasks: [
      {
        id: 'task-327',
        description: 'Completed prerequisite',
        acceptanceCriteria: ['done'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      },
      {
        id: 'task-331',
        description: 'Open recovery work',
        acceptanceCriteria: ['done'],
        status: 'pending',
        attempts: 0,
        dependencies: ['task-327'],
      },
    ],
  }], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const prompts: string[] = [];
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      name: 'fake-controller',
      execute: async ({ prompt }: any) => {
        prompts.push(prompt);
        const complexity = prompts.length === 1 ? 'small' : 'low';
        return {
          success: true,
          output: jsonReport({
            verdict: 'revise',
            summary: 'Create the missing prerequisite before recovery work.',
            planChanges: [
              {
                action: 'addTask',
                phaseId: 'phase-1',
                task: {
                  id: 'task-333',
                  displayTitle: 'Restore Mobile Title',
                  description: 'Restore the responsive title.',
                  acceptanceCriteria: ['The title fits on mobile.'],
                  status: 'pending',
                  priority: 3,
                  dependencies: [],
                  estimatedComplexity: complexity,
                  attempts: 0,
                  addedBy: 'controller',
                },
              },
              {
                action: 'updateTask',
                taskId: 'task-331',
                changes: { dependencies: ['task-327', 'task-333'] },
              },
            ],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'replan');

  assert.equal(report.verdict, 'revise');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Previous Controller Output Was Invalid/);
  assert.match(prompts[1], /estimatedComplexity/);
  assert.equal(planManager.findTask('task-333')?.estimatedComplexity, 'low');
  assert.deepEqual(planManager.findTask('task-331')?.dependencies, ['task-327', 'task-333']);
});

test('controller dry-run audit does not write provider call checkpoint', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-dry-run-provider-call-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const result = await controller.dryRunAudit({
    workDir,
    specPath,
    ralphConfig: {} as any,
    agent: {
      name: 'fake-controller',
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'No changes.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
        providerSession: { id: 'session-dry-run' },
      }),
    } as any,
    model: 'gpt-5-codex',
    timeoutMinutes: 1,
    planManager,
    iterationHistory: [],
    trigger: 'final',
    verbose: false,
  });

  assert.equal(result.status, 'parsed');
  assert.equal(existsSync(path.join(workDir, PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH)), false);
});

test('controller compacts oversized plans without dropping feedback-linked tasks', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-compact-plan-'));
  const controller = new Controller(workDir);
  const hugeText = 'Long completed task context. '.repeat(1200);
  const oldTasks = Array.from({ length: 80 }, (_, index) => ({
    id: `task-old-${String(index + 1).padStart(3, '0')}`,
    description: hugeText,
    acceptanceCriteria: [hugeText],
    status: 'completed' as const,
    attempts: 0,
    dependencies: [],
  }));
  const currentTask = {
    id: 'task-current',
    displayTitle: 'Current feedback task',
    description: hugeText,
    acceptanceCriteria: [hugeText],
    status: 'completed' as const,
    attempts: 0,
    dependencies: [],
    feedbackItemRefs: [{
      itemId: 'BUG-020',
      diffItemId: 'DIFF-057-BUG-020',
      summary: 'Dropdowns must stay inside mobile viewport.',
      sourceEvidence: [{
        sourceRef: 'telegram:1210',
        quote: 'баг: кнопки не помещаются',
        intent: 'Dropdown buttons still do not fit on mobile.',
      }],
    }],
    verificationEvidence: [{
      kind: 'unit_test' as const,
      ref: 'verification:unit-tests',
      summary: 'Unit tests passed (218/218).',
      result: 'pass' as const,
      feedbackItemIds: ['DIFF-057-BUG-020'],
    }],
  };
  const plan = {
    version: 1,
    specFile: 'spec.md',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T01:00:00.000Z',
    phases: [{
      id: 'phase-1',
      name: 'Implementation',
      description: hugeText,
      order: 1,
      status: 'completed' as const,
      tasks: [...oldTasks, currentTask],
      planLater: false,
    }],
    judgments: [],
    specMigrations: [],
  };

  const compactJson = (controller as any).buildControllerPlanJson(plan, [{
    itemId: 'BUG-020',
    status: 'implemented_unverified',
    linkedTaskIds: ['task-current'],
    closureAllowed: false,
    operatorSummary: 'needs product-facing proof',
  }]);

  assert.ok(compactJson.length < 240_000);
  assert.match(compactJson, /controllerAuditProjection/);
  assert.match(compactJson, /task-current/);
  assert.match(compactJson, /omittedTaskCount/);
  assert.doesNotMatch(compactJson, /task-old-001/);
});

test('controller audit prompt treats browser verification infra as platform-owned', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-browser-policy-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);
  await planManager.save();

  const controller = new Controller(workDir);
  let observedPrompt = '';
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: { e2eEnforcer: { enabled: true } } as any,
    agent: {
      execute: async ({ prompt }: any) => {
        observedPrompt = prompt;
        return {
          success: true,
          output: jsonReport({
            verdict: 'continue',
            summary: 'No changes.',
            planChanges: [],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.match(observedPrompt, /Browser verification infrastructure is platform-owned/);
  assert.match(observedPrompt, /INFRA_BROWSER_UNAVAILABLE/);
  assert.match(observedPrompt, /Do NOT add tasks that install Chromium/);
});

test('controller final audit throws on rate-limit failure instead of degrading to continue', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-final-rate-limit-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const controller = new Controller(workDir);

  await assert.rejects(
    () => controller.audit({
      workDir,
      specPath,
      projectConfig: {} as any,
      ralphConfig: {} as any,
      agent: {
        execute: async () => ({
          success: false,
          output: "You've hit your limit · resets 10am (UTC)",
          filesChanged: [],
          completionPromiseFound: false,
          error: {
            category: 'rate_limit',
            message: "You've hit your limit · resets 10am (UTC)",
            retryAt: '2026-04-23T10:00:00.000Z',
          },
        }),
      } as any,
      model: undefined,
      planManager: { currentPlan: { phases: [], judgments: [] } } as any,
      judgmentLog: {} as any,
      iterationHistory: [],
      verbose: false,
    }, 'final'),
    (error) => {
      assert.ok(error instanceof ControllerAuditFailure);
      assert.equal(error.trigger, 'final');
      assert.equal(error.agentError?.category, 'rate_limit');
      assert.match(error.message, /Final controller audit failed/);
      return true;
    },
  );
});

test('controller periodic audit still falls back to continue on agent failure', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-periodic-fallback-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const controller = new Controller(workDir);

  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: false,
        output: 'tool crash',
        filesChanged: [],
        completionPromiseFound: false,
        error: {
          category: 'infra',
          message: 'tool crash',
        },
      }),
    } as any,
    model: undefined,
    planManager: { currentPlan: { phases: [], judgments: [] } } as any,
    judgmentLog: {} as any,
    iterationHistory: [],
    verbose: false,
  }, 'periodic');

  assert.equal(report.verdict, 'continue');
  assert.match(report.summary, /Controller audit failed/);
});

test('controller final audit ignores loop-owned result.json task instead of adding executor work', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-result-json-guard-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build working app',
      acceptanceCriteria: ['App works'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
    }],
  }], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async ({ prompt }: any) => {
        assert.match(prompt, /Do NOT add tasks to create, write, read, or verify `\.arena\/result\.json`/);
        return {
          success: true,
          output: [
            '```json',
            JSON.stringify({
              verdict: 'revise',
              summary: 'Only missing gap is Arena deployment signal.',
              planChanges: [{
                action: 'addTask',
                phaseId: 'phase-1',
                task: {
                  id: 'task-002',
                  description: 'Write Arena deployment signal to .arena/result.json with {"status":"DEPLOYED"}.',
                  acceptanceCriteria: [
                    '.arena/result.json exists and contains {"status":"DEPLOYED"}',
                  ],
                  status: 'pending',
                  priority: 1,
                  dependencies: [],
                  estimatedComplexity: 'low',
                  attempts: 0,
                  addedBy: 'controller',
                },
              }],
              newJudgments: [],
              revisedJudgments: [],
            }),
            '```',
          ].join('\n'),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.planChanges.length, 0);
  assert.match(report.summary, /Controller guard: ignored 1 loop-owned lifecycle plan change/);
  assert.equal(planManager.getAllTasks().some(task => task.id === 'task-002'), false);
  assert.equal(planManager.currentPlan.phases[0].status, 'completed');
});

test('controller keeps product plan changes while dropping result.json lifecycle tasks', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-result-json-mixed-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build working app',
      acceptanceCriteria: ['App works'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
    }],
  }], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: [
          '```json',
          JSON.stringify({
            verdict: 'revise',
            summary: 'Product polish and lifecycle signal are missing.',
            planChanges: [
              {
                action: 'addTask',
                phaseId: 'phase-1',
                task: {
                  id: 'task-002',
                  description: 'Improve title screen contrast.',
                  acceptanceCriteria: ['Title text remains readable over the game scene'],
                  status: 'pending',
                  priority: 3,
                  dependencies: [],
                  estimatedComplexity: 'low',
                  attempts: 0,
                  addedBy: 'controller',
                },
              },
              {
                action: 'addTask',
                phaseId: 'phase-1',
                task: {
                  id: 'task-003',
                  description: 'Create .arena/result.json deployment signal with {"status":"DEPLOYED"}.',
                  acceptanceCriteria: ['The platform lifecycle signal exists'],
                  status: 'pending',
                  priority: 1,
                  dependencies: [],
                  estimatedComplexity: 'low',
                  attempts: 0,
                  addedBy: 'controller',
                },
              },
            ],
            newJudgments: [],
            revisedJudgments: [],
          }),
          '```',
        ].join('\n'),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.deepEqual(report.planChanges.map(change => change.action === 'addTask' ? change.task.id : ''), ['task-002']);
  assert.equal(planManager.getAllTasks().some(task => task.id === 'task-002'), true);
  assert.equal(planManager.getAllTasks().some(task => task.id === 'task-003'), false);
});

test('controller final guard keeps completed-but-unverified feedback as private runtime evidence', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-completed-only-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005 (reopened#1): Queue is still too dense',
    '  - Expected: show only 5-6 customers.',
    '  - Actual: too many customers are still visible.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Fix BUG-005 queue readability',
      acceptanceCriteria: ['BUG-005 is fixed'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'hash-v2', {
    specChangeSource: { kind: 'extracted_current_feedback', itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'current_feedback_snapshot',
      summary: 'Queue is still too dense.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      disposition: 'addTask',
      taskIds: ['task-001'],
      reason: 'Existing completed task is the current implementation attempt.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async ({ prompt }: any) => {
        assert.match(prompt, /Current Feedback Evidence Matrix/);
        assert.match(prompt, /implemented_unverified/);
        assert.match(prompt, /Do not create `newJudgments` for `implemented_unverified`/);
        assert.doesNotMatch(prompt, /implemented by Ralph judgment/);
        assert.doesNotMatch(prompt, /record a judgment instead of creating another verification-only task/);
        return {
          success: true,
          output: [
            '```json',
            JSON.stringify({
              verdict: 'continue',
              summary: 'Everything is resolved.',
              planChanges: [],
              newJudgments: [],
              revisedJudgments: [],
            }),
            '```',
          ].join('\n'),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.reportType, 'semantic_audit');
  assert.equal(report.semanticAudit, true);
  assert.equal(report.feedbackMatrix?.[0].itemId, 'BUG-005');
  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.match(report.summary, /private runtime evidence/);
  assert.match(report.overclaimWarnings?.join('\n') ?? '', /BUG-005/);

  const followUp = planManager.getAllTasks().find(task => task.id === 'task-002');
  assert.equal(followUp, undefined);
  assert.equal(planManager.currentPlan.phases[0].status, 'completed');
  assert.equal(planManager.currentPlan.judgments.length, 0);
});

test('controller final guard keeps hard accepted spec diff weak evidence private when no concrete work exists', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-hard-spec-diff-completed-only-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Game and level UI must be HTML elements, not canvas.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Interpret REQ-HTML and keep the Phaser canvas game while improving touch behavior.',
      acceptanceCriteria: ['REQ-HTML has been considered.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-009-002',
        diffItemId: 'DIFF-009-002',
        targetType: 'spec',
        targetId: 'REQ-HTML',
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v3', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 9, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-009-002',
      diffItemId: 'DIFF-009-002',
      targetType: 'spec',
      targetId: 'REQ-HTML',
      kind: 'accepted_diff:spec',
      changeType: 'updated',
      status: 'updated',
      summary: 'Game and level UI must move from canvas to HTML elements.',
      sourceEvidence: [{
        sourceRef: 'SRC-003',
        quote: 'Game and level UI must be HTML elements, not canvas.',
        intent: 'Game and level UI must move from Phaser/canvas rendering to HTML/DOM elements; keeping canvas is not enough.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-009-002',
      feedbackStatus: 'updated',
      disposition: 'addTask',
      taskIds: ['task-001'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Initial attempt claimed the accepted spec diff work.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const auditOptions = {
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async ({ prompt }: any) => {
        assert.match(prompt, /Current Feedback Evidence Matrix/);
        assert.match(prompt, /REQ-HTML/);
        assert.match(prompt, /sourceEvidence/);
        assert.match(prompt, /Phaser\/canvas rendering to HTML\/DOM elements/);
        assert.match(prompt, /hard accepted diff rows/);
        return {
          success: true,
          output: jsonReport({
            verdict: 'continue',
            summary: 'Looks done.',
            planChanges: [],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  };
  const report = await controller.audit(auditOptions, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.feedbackMatrix?.[0].itemId, 'DIFF-009-002');
  assert.equal(report.feedbackMatrix?.[0].targetType, 'spec');
  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(report.feedbackMatrix?.[0].closureAllowed, false);
  assert.match(report.summary, /private runtime evidence/);
  assert.match(report.overclaimWarnings?.join('\n') ?? '', /DIFF-009-002/);
  assert.equal(planManager.currentPlan.judgments.length, 0);
  const followUp = planManager.findTask('task-002');
  assert.equal(followUp, null);
  assert.equal(report.planChanges.length, 0);
});

test('controller does not close source-evidence accepted diff with generic unit evidence', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-source-evidence-unit-only-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'The play control is an icon-only button with no visible Play text.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Replace visible Play text with an icon-only play control.',
      acceptanceCriteria: ['No visible Play text remains and the play button is still present.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-009-PLAY',
        diffItemId: 'DIFF-009-PLAY',
        targetType: 'spec',
        targetId: 'REQ-PLAY',
      }],
      verificationEvidence: [{
        kind: 'unit_test',
        ref: 'verification:unit-tests',
        result: 'pass',
        feedbackItemIds: ['DIFF-009-PLAY'],
        taskId: 'task-001',
        summary: 'Unit tests passed for play button rendering.',
        recordedBy: 'executor',
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-play', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 9, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-009-PLAY',
      diffItemId: 'DIFF-009-PLAY',
      targetType: 'spec',
      targetId: 'REQ-PLAY',
      kind: 'accepted_diff:spec',
      changeType: 'updated',
      status: 'updated',
      summary: 'Play control must be icon-only without visible Play text.',
      sourceEvidence: [{
        sourceRef: 'SRC-PLAY',
        quote: 'Кнопку-иконку PLAY - убираем, саму кнопку play оставляем и делаем иконкой.',
        intent: 'Remove visible Play text while keeping the real play button as an icon-only control.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-009-PLAY',
      feedbackStatus: 'updated',
      disposition: 'addTask',
      taskIds: ['task-001'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Initial attempt claimed the accepted diff work.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Unit test evidence is enough.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(report.feedbackMatrix?.[0].closureAllowed, false);
  assert.match(report.overclaimWarnings?.join('\n') ?? '', /DIFF-009-PLAY/);
});

test('controller keeps frontend source-evidence proof gaps as warnings when no implementable work remains', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-frontend-source-proof-gap-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Notation rows must render at full mobile width on first paint.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-127',
      description: 'Repair notation scaling.',
      acceptanceCriteria: ['Notation rows render at full mobile width.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-070-BUG-028',
        diffItemId: 'DIFF-070-BUG-028',
        targetType: 'feedback',
        targetId: 'BUG-028',
        workImpact: 'requires_loop_work',
        workSurface: 'frontend',
      }],
      verificationEvidence: [{
        kind: 'unit_test',
        ref: 'verification:unit-tests',
        result: 'pass',
        feedbackItemIds: ['DIFF-070-BUG-028'],
        taskId: 'task-127',
        summary: 'Unit tests passed.',
        recordedBy: 'executor',
      }, {
        kind: 'test',
        ref: 'verification:unit-tests:browser-responsive',
        result: 'pass',
        feedbackItemIds: ['DIFF-070-BUG-028'],
        taskId: 'task-127',
        summary: 'Browser-responsive visual test suite ran inside the unit test command.',
        recordedBy: 'executor',
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v70', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 70, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-070-BUG-028',
      diffItemId: 'DIFF-070-BUG-028',
      targetType: 'feedback',
      targetId: 'BUG-028',
      kind: 'accepted_diff:feedback',
      changeType: 'updated',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
      status: 'open',
      summary: 'Notation rows still appear narrow on mobile first paint.',
      sourceEvidence: [{
        sourceRef: 'SRC-070',
        quote: 'ширину контента нот он не исправил',
        intent: 'Notation content must occupy the available mobile width immediately, not only after hydration.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-070-BUG-028',
      feedbackStatus: 'open',
      disposition: 'addTask',
      taskIds: ['task-127'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Task was added for the accepted feedback.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async ({ prompt }: any) => {
        assert.match(prompt, /`implemented_unverified` is not automatic new work/);
        assert.doesNotMatch(prompt, /Frontend `sourceEvidence` proof gaps are concrete work/);
        return {
          success: true,
          output: jsonReport({
            verdict: 'revise',
            summary: 'Need one evidence-close follow-up for BUG-028.',
            overclaimWarnings: ['DIFF-070-BUG-028 is implemented by history but lacks sourceEvidence closure proof.'],
            planChanges: [{
              action: 'addTask',
              phaseId: 'phase-1',
              task: {
                id: 'task-128',
                description: 'Evidence-close DIFF-070-BUG-028 in the Mini App and fix notation width if the mismatch remains visible.',
                acceptanceCriteria: [
                  'Product-facing proof shows DIFF-070-BUG-028 is semantically verified.',
                  'If the mismatch remains visible, notation width is fixed.',
                ],
                status: 'pending',
                priority: 3,
                dependencies: [],
                estimatedComplexity: 'medium',
                attempts: 0,
                addedBy: 'controller',
              },
            }],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(report.feedbackMatrix?.[0].closureAllowed, false);
  assert.equal(report.planChanges.length, 0);
  assert.equal(planManager.findTask('task-128'), null);
  assert.match(report.overclaimWarnings?.join('\n') ?? '', /DIFF-070-BUG-028/);
  assert.match(report.summary, /ignored 1 sourceEvidence implemented_unverified feedback follow-up task/);
});

test('controller final audit adds Workbench source repair when completed frontend accepted work leaves invalid manifest', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-invalid-manifest-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, {
    schemaVersion: 'ra-355.visual-coverage-manifest.v0',
    projectClass: 'ordinary_web',
    workbench: {
      serveCommand: 'npm run visual-workbench',
      storyRoutePattern: '/__visual/:storyId',
    },
    coveragePolicy: {
      mode: 'strict_canary',
      selectionDefault: 'full_manifest',
      simplificationRequiresEvidence: true,
    },
    stories: [{
      id: 'synth-pad.ready',
      title: 'Synth pad ready',
      kind: 'widget',
      feature: 'synth-jam',
      widget: 'SynthPad',
      state: 'ready',
      claim: 'The synth pad ready state renders.',
      render: { type: 'workbench_route', path: '/__visual/synth-pad.ready' },
      mockState: { name: 'ready' },
      viewports: [{ name: 'desktop', width: 1280, height: 720 }],
      source: 'stories/synth-pad.ready.json',
    }],
  });

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Visual Workbench manifest.',
      acceptanceCriteria: [
        'The synth pad renders in ordinary DOM.',
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
      verificationEvidence: [{
        kind: 'unit_test',
        ref: 'verification:unit-tests',
        result: 'pass',
        feedbackItemIds: ['DIFF-WB-001'],
        taskId: 'task-001',
        summary: 'Unit tests passed.',
        recordedBy: 'executor',
      }],
    }, {
      id: 'task-002',
      displayTitle: 'Verify accepted changes',
      description: 'Verify completed accepted diff work DIFF-WB-001.',
      acceptanceCriteria: ['Concrete product-facing proof is recorded.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      feedbackItemRefs: [workbenchFeedbackRef()],
    }],
  }], []);
  recordWorkbenchMigration(planManager);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.match(report.summary, /Visual Workbench source contract is blocked/);
  assert.match(report.summary, /field source/);
  const followUp = planManager.currentPlan.phases
    .flatMap((phase) => phase.tasks)
    .find((task) => task.displayTitle === 'Repair Visual Workbench coverage');
  assert.ok(followUp);
  assert.equal(followUp.displayTitle, 'Repair Visual Workbench coverage');
  assert.deepEqual(followUp.requiredRolePasses, ['ux']);
  assert.equal(followUp.visualEvidenceRequired, undefined);
  assert.equal(followUp.feedbackItemRefs?.[0]?.itemId, 'DIFF-WB-001');
  assert.match(followUp.description, /Manifest issue details/);
  assert.match(followUp.description, /field source/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /ra-355\.visual-coverage-manifest\.v0/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /Do not edit `\.ralph\/`, `\.arena\/`/);
});

test('controller final audit does not add Workbench source repair when manifest is valid', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-valid-manifest-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, validWorkbenchManifest({ defaultFor: ['DIFF-WB-001'] }));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Visual Workbench manifest.',
      acceptanceCriteria: [
        'The synth pad renders in ordinary DOM.',
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
      verificationEvidence: [{
        kind: 'unit_test',
        ref: 'verification:unit-tests',
        result: 'pass',
        feedbackItemIds: ['DIFF-WB-001'],
        taskId: 'task-001',
        summary: 'Unit tests passed.',
        recordedBy: 'executor',
      }],
    }, {
      id: 'task-002',
      displayTitle: 'Verify accepted changes',
      description: 'Verify completed accepted diff work DIFF-WB-001.',
      acceptanceCriteria: ['Concrete product-facing proof is recorded.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      feedbackItemRefs: [workbenchFeedbackRef()],
    }],
  }], []);
  recordWorkbenchMigration(planManager);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(planManager.findTask('task-003'), null);
  assert.doesNotMatch(report.summary, /Visual Workbench source contract is blocked/);
});

test('controller final audit explains ambiguous Workbench selector ownership', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-ambiguous-selector-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, validWorkbenchManifest({ defaultFor: ['DIFF-WB-001'] }));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Visual Workbench manifest.',
      acceptanceCriteria: [
        'The synth pad renders in ordinary DOM.',
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
      verificationEvidence: [{
        kind: 'unit_test',
        ref: 'verification:unit-tests',
        result: 'pass',
        feedbackItemIds: ['DIFF-WB-001'],
        taskId: 'task-001',
        summary: 'Unit tests passed.',
        recordedBy: 'executor',
      }],
    }, {
      id: 'task-002',
      description: 'Add mobile synth pad Visual Workbench coverage for the same accepted frontend work.',
      acceptanceCriteria: [
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
      verificationEvidence: [{
        kind: 'unit_test',
        ref: 'verification:unit-tests:mobile',
        result: 'pass',
        feedbackItemIds: ['DIFF-WB-001'],
        taskId: 'task-002',
        summary: 'Mobile unit tests passed.',
        recordedBy: 'executor',
      }],
    }, {
      id: 'task-003',
      displayTitle: 'Verify accepted changes',
      description: 'Verify completed accepted diff work DIFF-WB-001.',
      acceptanceCriteria: ['Concrete product-facing proof is recorded.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      feedbackItemRefs: [workbenchFeedbackRef()],
    }],
  }], []);
  recordWorkbenchMigration(planManager, ['task-001', 'task-002']);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.match(report.summary, /story_matches_multiple_tasks:synth-pad\.ready/);
  assert.match(report.summary, /ambiguities=synth-pad\.ready->task-001\|task-002/);
  assert.match(report.summary, /task-001\[DIFF-WB-001\]/);
  assert.match(report.summary, /task-002\[DIFF-WB-001\]/);
  const followUp = planManager.currentPlan.phases
    .flatMap((phase) => phase.tasks)
    .find((task) => task.displayTitle === 'Repair Visual Workbench coverage');
  assert.ok(followUp);
  assert.match(followUp.description, /ambiguities=synth-pad\.ready->task-001\|task-002/);
  assert.match(followUp.description, /task-001\[DIFF-WB-001\]/);
  assert.match(followUp.description, /task-002\[DIFF-WB-001\]/);
  assert.match(followUp.description, /exact owner selector token\(s\) task-001#DIFF-WB-001\|task-001#REQ-WB-001\|task-002#DIFF-WB-001\|task-002#REQ-WB-001/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /exact owner selector tokens from Selector owner guidance/);
});

test('controller final audit adds Workbench source repair when valid manifest has no task selector mapping', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-missing-selector-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, validWorkbenchManifest());

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Visual Workbench manifest.',
      acceptanceCriteria: [
        'The synth pad renders in ordinary DOM.',
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
      verificationEvidence: [{
        kind: 'unit_test',
        ref: 'verification:unit-tests',
        result: 'pass',
        feedbackItemIds: ['DIFF-WB-001'],
        taskId: 'task-001',
        summary: 'Unit tests passed.',
        recordedBy: 'executor',
      }],
    }, {
      id: 'task-002',
      displayTitle: 'Verify accepted changes',
      description: 'Verify completed accepted diff work DIFF-WB-001.',
      acceptanceCriteria: ['Concrete product-facing proof is recorded.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      feedbackItemRefs: [workbenchFeedbackRef()],
    }, {
      id: 'task-900',
      description: 'Inspect DIFF-WB-001 Visual Workbench coverage manually without attached accepted refs.',
      acceptanceCriteria: ['Do not become a screenshot evidence owner without task feedback refs.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
    }],
  }], []);
  recordWorkbenchMigration(planManager, ['task-001', 'task-900']);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.match(report.summary, /Visual Workbench source contract is blocked/);
  assert.match(report.summary, /selector_readiness_blocked/);
  assert.match(report.summary, /no_story_selection/);
  const followUp = planManager.currentPlan.phases
    .flatMap((phase) => phase.tasks)
    .find((task) => task.displayTitle === 'Repair Visual Workbench coverage');
  assert.ok(followUp);
  assert.equal(followUp.displayTitle, 'Repair Visual Workbench coverage');
  assert.match(followUp.description, /Selector issue details/);
  assert.match(followUp.description, /no_story_selection/);
  assert.match(followUp.description, /Selector owner guidance/);
  assert.match(followUp.description, /DIFF-WB-001 .*exact owner selector token\(s\) task-001#DIFF-WB-001\|task-001#REQ-WB-001/);
  assert.match(followUp.description, /owner task id\(s\) task-001\|task-900/);
  assert.doesNotMatch(followUp.description, /task-900#DIFF-WB-001/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /taskRelevance\.defaultFor/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /Do not make this repair task the screenshot evidence owner/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /do not use this repair task id or its attached feedback refs/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /exact owner selector tokens from Selector owner guidance/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /plain task id only when it cannot select multiple tasks or multiple feedback refs/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /exactly one task, one feedback item id and one diff item id/);
  assert.match(followUp.acceptanceCriteria.join('\n'), /Do not edit `\.ralph\/`, `\.arena\/`/);
});

test('controller final audit suppresses generic accepted-diff verification while keeping Workbench source repair', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-generic-verify-not-repair-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, validWorkbenchManifest());

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Visual Workbench manifest.',
      acceptanceCriteria: [
        'The synth pad renders in ordinary DOM.',
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
      verificationEvidence: [{
        kind: 'unit_test',
        ref: 'verification:unit-tests',
        result: 'pass',
        feedbackItemIds: ['DIFF-WB-001'],
        taskId: 'task-001',
        summary: 'Unit tests passed.',
        recordedBy: 'executor',
      }],
    }],
  }], []);
  recordWorkbenchMigration(planManager);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete after adding verification.',
          planChanges: [{
            action: 'addTask',
            phaseId: 'phase-1',
            task: {
              id: 'task-002',
              displayTitle: 'Verify accepted changes',
              description: 'Verify completed accepted diff work DIFF-WB-001 for the Visual Workbench frontend feature.',
              acceptanceCriteria: ['Concrete product-facing proof is recorded.'],
              status: 'pending',
              attempts: 0,
              dependencies: [],
              addedBy: 'controller',
              feedbackItemRefs: [workbenchFeedbackRef()],
            },
          }],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.ok(report.planChanges.some((change) => change.action === 'addTask'
    && change.task.displayTitle === 'Repair Visual Workbench coverage'));
  assert.equal(planManager.findTask('task-002')?.displayTitle, 'Repair Visual Workbench coverage');
  assert.equal(planManager.findTask('task-003'), null);
  assert.match(report.summary, /ignored 1 generic implemented_unverified hard accepted diff verification task/);
  const followUp = planManager.findTask('task-002');
  assert.ok(followUp);
  assert.equal(followUp.displayTitle, 'Repair Visual Workbench coverage');
  assert.match(followUp.description, /Selector issue details/);
  assert.match(followUp.description, /no_story_selection/);
});

test('controller final audit does not treat an open generic verification task as Workbench source repair', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-open-generic-not-repair-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, validWorkbenchManifest());

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'in_progress',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Visual Workbench manifest.',
      acceptanceCriteria: [
        'The synth pad renders in ordinary DOM.',
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
    }, {
      id: 'task-002',
      displayTitle: 'Verify accepted changes',
      description: 'Verify completed accepted diff work DIFF-WB-001 for the Visual Workbench frontend feature.',
      acceptanceCriteria: ['Concrete product-facing proof is recorded.'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      addedBy: 'controller',
      feedbackItemRefs: [workbenchFeedbackRef()],
    }],
  }], []);
  recordWorkbenchMigration(planManager);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  const followUp = planManager.findTask('task-003');
  assert.ok(followUp);
  assert.equal(followUp.displayTitle, 'Repair Visual Workbench coverage');
  assert.match(followUp.description, /no_story_selection/);
});

test('controller final audit does not duplicate an open explicit Workbench source repair task', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-open-repair-no-duplicate-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, validWorkbenchManifest());

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'in_progress',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Visual Workbench manifest.',
      acceptanceCriteria: [
        'The synth pad renders in ordinary DOM.',
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
    }, {
      id: 'task-002',
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage for frontend accepted diff row(s): DIFF-WB-001. Current blocker(s): selector_readiness_blocked. Selector issue details: task task-001: blockers=no_story_selection.',
      acceptanceCriteria: [
        '`taskRelevance.defaultFor` maps affected frontend tasks or accepted-diff refs to explicit Workbench stories.',
        'Do not fall back to unrelated page screenshots.',
      ],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
    }],
  }], []);
  recordWorkbenchMigration(planManager);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.match(report.summary, /Visual Workbench source contract is blocked/);
  assert.equal(planManager.findTask('task-003'), null);
});

test('controller final audit does not keep adding Workbench repairs after a completed source repair attempt', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-completed-repair-no-loop-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, validWorkbenchManifest());

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Visual Workbench manifest.',
      acceptanceCriteria: [
        'The synth pad renders in ordinary DOM.',
        'Create source-owned Visual Workbench coverage in visual-workbench/manifest.json and visual-workbench/stories/.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      visualEvidenceRequired: true,
      feedbackItemRefs: [workbenchFeedbackRef()],
    }, {
      id: 'task-002',
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage for frontend accepted diff row(s): DIFF-WB-001.',
      acceptanceCriteria: [
        '`taskRelevance.defaultFor` maps original frontend evidence-owner tasks to explicit Workbench stories.',
        'Do not make this repair task the screenshot evidence owner.',
      ],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
    }],
  }], []);
  recordWorkbenchMigration(planManager);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.match(report.summary, /Visual Workbench source contract is blocked/);
  assert.match(report.summary, /no_story_selection/);
  assert.equal(planManager.findTask('task-003'), null);
});

test('controller final audit keeps source repair from becoming the only Workbench evidence owner', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-workbench-repair-only-owner-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Build an ordinary web synth pad with source-owned Visual Workbench coverage.',
  ].join('\n'));
  writeWorkbenchManifest(workDir, validWorkbenchManifest());

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Workbench repair',
    description: 'Repair source-owned Workbench coverage',
    order: 1,
    status: 'in_progress',
    planLater: false,
    tasks: [{
      id: 'task-002',
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage for frontend accepted diff row(s): DIFF-WB-001.',
      acceptanceCriteria: [
        'Fix source-owned Workbench stories without becoming the screenshot evidence owner.',
      ],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [workbenchFeedbackRef()],
    }],
  }], []);
  recordWorkbenchMigration(planManager, ['task-002']);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: visualEvidenceRequiredRalphConfig() as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks complete.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.match(report.summary, /current accepted diff still has open/);
  assert.doesNotMatch(report.summary, /selector_readiness_blocked/);
  assert.equal(planManager.findTask('task-003'), null);
});

test('controller closes source-evidence accepted diff with explicit product proof', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-source-evidence-manual-proof-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'The play control is an icon-only button with no visible Play text.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Replace visible Play text with an icon-only play control.',
      acceptanceCriteria: ['No visible Play text remains and the play button is still present.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-009-PLAY',
        diffItemId: 'DIFF-009-PLAY',
        targetType: 'spec',
        targetId: 'REQ-PLAY',
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-play', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 9, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-009-PLAY',
      diffItemId: 'DIFF-009-PLAY',
      targetType: 'spec',
      targetId: 'REQ-PLAY',
      kind: 'accepted_diff:spec',
      changeType: 'updated',
      status: 'updated',
      summary: 'Play control must be icon-only without visible Play text.',
      sourceEvidence: [{
        sourceRef: 'SRC-PLAY',
        quote: 'Кнопку-иконку PLAY - убираем, саму кнопку play оставляем и делаем иконкой.',
        intent: 'Remove visible Play text while keeping the real play button as an icon-only control.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-009-PLAY',
      feedbackStatus: 'updated',
      disposition: 'closedByEvidence',
      taskIds: ['task-001'],
      relatedCompletedTaskIds: [],
      evidence: [{
        kind: 'manual_note',
        ref: 'controller:visual-proof',
        result: 'pass',
        summary: 'Manual visual check confirmed no visible Play text remains and the real play button is still present as an icon-only control.',
      }],
      judgmentIds: [],
      reason: 'Product-facing proof covers the source evidence.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Manual product proof closes the row.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.feedbackMatrix?.[0].status, 'closed_by_evidence');
  assert.deepEqual(report.overclaimWarnings, []);
});

test('controller closes source-evidence accepted diff with current-state screenshot proof', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-source-evidence-after-only-proof-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Practice exercise must be centered and unclipped on mobile.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-207',
      description: 'Verify Practice centering.',
      acceptanceCriteria: ['Practice is centered and the first bar is not clipped.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-074-BUG-029',
        diffItemId: 'DIFF-074-BUG-029',
        targetType: 'feedback',
        targetId: 'BUG-029',
        workImpact: 'requires_loop_work',
        workSurface: 'frontend',
      }],
      verificationEvidence: [{
        kind: 'screenshot',
        ref: 'screenshot-proof:after-only',
        result: 'pass',
        feedbackItemIds: ['DIFF-074-BUG-029'],
        taskId: 'task-207',
        summary: 'Current-state screenshot proof captured for task-207.',
        artifactPath: 'assets/proof/task-207/after.png',
        artifactSha256: 'd02c9354cc3712fb45780fa334171ed8e32be3879c5999a8a227a1ef8713b6c2',
        recordedBy: 'executor',
        screenshotProof: {
          expectationKind: 'before_after_screenshot',
          role: 'after_only',
        },
        target: {
          route: '/?tab=feed',
          viewport: { width: 430, height: 844 },
          claim: 'Practice exercise is centered and the first bar is fully visible with top inset.',
        },
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v74', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 74, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-074-BUG-029',
      diffItemId: 'DIFF-074-BUG-029',
      targetType: 'feedback',
      targetId: 'BUG-029',
      kind: 'accepted_diff:feedback',
      changeType: 'created',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
      status: 'open',
      summary: 'Practice exercise is shifted upward and the first bar is clipped.',
      sourceEvidence: [{
        sourceRef: 'SRC-074',
        quote: 'первый такт слегка обрезается сверху',
        intent: 'Practice exercise is centered and the first bar is not clipped.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-074-BUG-029',
      feedbackStatus: 'open',
      disposition: 'addTask',
      taskIds: ['task-207'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Task was added for accepted feedback.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Current-state product proof closes the row.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.feedbackMatrix?.[0].status, 'closed_by_evidence');
  assert.deepEqual(report.planChanges, []);
  assert.deepEqual(report.overclaimWarnings, []);
});

test('controller does not close source-evidence accepted diff with generic post-deploy smoke', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-source-evidence-smoke-gap-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'The Play button must be icon-only without visible Play text.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Replace visible Play text with an icon-only play control.',
      acceptanceCriteria: ['No visible Play text remains and the play button is still present.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-009-PLAY',
        diffItemId: 'DIFF-009-PLAY',
        targetType: 'spec',
        targetId: 'REQ-PLAY',
      }],
      verificationEvidence: [{
        kind: 'post_deploy_smoke',
        ref: 'verification:post-deploy',
        result: 'pass',
        feedbackItemIds: ['DIFF-009-PLAY'],
        taskId: 'task-001',
        summary: 'Generic smoke passed on the home route.',
        recordedBy: 'executor',
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-play', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 9, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-009-PLAY',
      diffItemId: 'DIFF-009-PLAY',
      targetType: 'spec',
      targetId: 'REQ-PLAY',
      kind: 'accepted_diff:spec',
      changeType: 'updated',
      status: 'updated',
      summary: 'Play control must be icon-only without visible Play text.',
      sourceEvidence: [{
        sourceRef: 'SRC-PLAY',
        quote: 'Кнопку-иконку PLAY - убираем, саму кнопку play оставляем и делаем иконкой.',
        intent: 'Remove visible Play text while keeping the real play button as an icon-only control.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-009-PLAY',
      feedbackStatus: 'updated',
      disposition: 'addTask',
      taskIds: ['task-001'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Task was added for the accepted spec diff.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Generic smoke is enough.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(report.feedbackMatrix?.[0].closureAllowed, false);
});

test('controller does not close source-evidence accepted diff with identical before-after screenshot proof', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-source-evidence-identical-proof-'));
  const specPath = path.join(workDir, 'spec.md');
  const sharedDigest = 'b8301033b194268de5c972a80774a8df3f9a8643eefffb74eec182da99ee3769';
  writeFileSync(specPath, [
    '## Product Spec',
    'Practice must be fullscreen on 430px and 431px mobile viewports.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-117',
      description: 'Fix wide mobile Practice fullscreen behavior.',
      acceptanceCriteria: ['Practice is fullscreen at 430px and 431px.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-062-BUG-007',
        diffItemId: 'DIFF-062-BUG-007',
        targetType: 'feedback',
        targetId: 'BUG-007',
      }],
      verificationEvidence: [{
        kind: 'screenshot',
        ref: 'screenshot-proof:before',
        result: 'pass',
        feedbackItemIds: ['DIFF-062-BUG-007'],
        taskId: 'task-117',
        summary: 'Before screenshot proof captured for task-117.',
        artifactPath: 'assets/proof/task-117/before.png',
        artifactSha256: sharedDigest,
        recordedBy: 'executor',
        screenshotProof: {
          expectationKind: 'before_after_screenshot',
          role: 'before',
        },
        target: {
          route: '/practice',
          viewport: { width: 430, height: 932 },
          claim: 'Practice still shows centered modal chrome before the fix.',
        },
      }, {
        kind: 'screenshot',
        ref: 'screenshot-proof:after',
        result: 'pass',
        feedbackItemIds: ['DIFF-062-BUG-007'],
        taskId: 'task-117',
        summary: 'After screenshot proof captured for task-117.',
        artifactPath: 'assets/proof/task-117/after.png',
        artifactSha256: sharedDigest,
        recordedBy: 'executor',
        screenshotProof: {
          expectationKind: 'before_after_screenshot',
          role: 'after',
        },
        target: {
          route: '/practice',
          viewport: { width: 430, height: 932 },
          claim: 'Practice is fullscreen after the fix.',
        },
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v62', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 62, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-062-BUG-007',
      diffItemId: 'DIFF-062-BUG-007',
      targetType: 'feedback',
      targetId: 'BUG-007',
      kind: 'accepted_diff:feedback',
      changeType: 'updated',
      status: 'open',
      summary: 'Practice still looks like a centered modal at 430px/431px.',
      sourceEvidence: [{
        sourceRef: 'SRC-062',
        quote: 'На 430px и 431px снова виден centered modal',
        intent: 'Practice must not show modal chrome at 430px or 431px.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-062-BUG-007',
      feedbackStatus: 'open',
      disposition: 'addTask',
      taskIds: ['task-117'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Task was added for the accepted feedback.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Identical screenshots are enough.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(report.feedbackMatrix?.[0].closureAllowed, false);
});

test('controller does not close source-evidence accepted diff with bare before-after screenshot proof', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-source-evidence-bare-proof-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Study buttons must stay visible during the replacement animation.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-118',
      description: 'Fix Study answer buttons disappearing during animation.',
      acceptanceCriteria: ['Study buttons remain visible while disabled during animation.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-024-BUG-004',
        diffItemId: 'DIFF-024-BUG-004',
        targetType: 'feedback',
        targetId: 'BUG-004',
      }],
      verificationEvidence: [{
        kind: 'screenshot',
        ref: 'screenshot-proof:before',
        result: 'pass',
        feedbackItemIds: ['DIFF-024-BUG-004'],
        taskId: 'task-118',
        summary: 'Before screenshot proof captured for task-118.',
        artifactPath: 'assets/proof/task-118/before.png',
        artifactSha256: '7c2d22d5570329544959adaef13df00be9e6bd906b79fb1c1826c5ddd8b34234',
        recordedBy: 'executor',
        screenshotProof: {
          expectationKind: 'before_after_screenshot',
          role: 'before',
        },
      }, {
        kind: 'screenshot',
        ref: 'screenshot-proof:after',
        result: 'pass',
        feedbackItemIds: ['DIFF-024-BUG-004'],
        taskId: 'task-118',
        summary: 'After screenshot proof captured for task-118.',
        artifactPath: 'assets/proof/task-118/after.png',
        artifactSha256: '503585acdd77d4e5f7035b6207b63fe2d55356efcf8fe5eae6c9bef41cf7868d',
        recordedBy: 'executor',
        screenshotProof: {
          expectationKind: 'before_after_screenshot',
          role: 'after',
        },
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v24', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 24, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-024-BUG-004',
      diffItemId: 'DIFF-024-BUG-004',
      targetType: 'feedback',
      targetId: 'BUG-004',
      kind: 'accepted_diff:feedback',
      changeType: 'created',
      status: 'open',
      summary: 'Study buttons disappear during animation and cause layout shift.',
      sourceEvidence: [{
        sourceRef: 'SRC-024',
        quote: 'они не должны полностью пропадать, чтобы не прыгал лайаут',
        intent: 'Study answer buttons remain visible and temporarily inactive during animation.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-024-BUG-004',
      feedbackStatus: 'open',
      disposition: 'addTask',
      taskIds: ['task-118'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Task was added for the accepted feedback.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Bare screenshots are enough.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(report.feedbackMatrix?.[0].closureAllowed, false);
});

test('controller treats disputed accepted assumptions as fresh hard product truth', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-assumption-diff-disputed-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'BUG-005 needs a smaller visible customer queue.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [],
  }], [{
    id: 'judgment-001',
    timestamp: new Date().toISOString(),
    taskId: null,
    ambiguity: 'Ralph assumed BUG-005 was already implemented.',
    options: ['Proceed with old assumption'],
    chosen: 0,
    reasoning: 'Legacy private judgment before the accepted assumption dispute.',
    madeBy: 'controller',
  }]);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v4', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 10, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-010-ASM-001',
      diffItemId: 'DIFF-010-ASM-001',
      targetType: 'assumption',
      targetId: 'ASM-RALPH-BUG-005',
      kind: 'accepted_diff:assumption',
      changeType: 'disputed',
      status: 'disputed',
      summary: 'Users disputed Ralph assumption that BUG-005 was already handled.',
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-010-ASM-001',
      feedbackStatus: 'disputed',
      disposition: 'needsJudgment',
      taskIds: [],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: ['judgment-001'],
      reason: 'Old private judgment exists but the accepted artifact disputed it.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async ({ prompt }: any) => {
        assert.match(prompt, /ASM-RALPH-BUG-005/);
        return {
          success: true,
          output: jsonReport({
            verdict: 'continue',
            summary: 'Old judgment is enough.',
            planChanges: [],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.equal(report.feedbackMatrix?.[0].targetType, 'assumption');
  assert.equal(report.feedbackMatrix?.[0].targetId, 'ASM-RALPH-BUG-005');
  assert.equal(report.feedbackMatrix?.[0].status, 'needs_judgment');
  assert.equal(report.feedbackMatrix?.[0].closureAllowed, false);
  assert.equal(report.planChanges.length, 1);
  assert.deepEqual(report.planChanges[0].action === 'addTask' ? report.planChanges[0].task.feedbackItemRefs : [], [{
    itemId: 'DIFF-010-ASM-001',
    diffItemId: 'DIFF-010-ASM-001',
    targetType: 'assumption',
    targetId: 'ASM-RALPH-BUG-005',
    changeType: 'disputed',
    status: 'disputed',
    summary: 'Users disputed Ralph assumption that BUG-005 was already handled.',
    specFile: 'spec.md',
    specHash: 'runner:input-hash-v4',
    migrationId: 'spec-001',
  }]);
});

test('controller final guard keeps hard accepted diff blocking statuses explicit', async () => {
  const cases: Array<{
    name: string;
    taskStatus?: 'pending' | 'completed';
    disposition?: 'coveredByOpenTask' | 'needsJudgment';
    expectedStatus: 'needs_disposition' | 'open_task' | 'needs_judgment';
    expectedPlanChanges: number;
  }> = [
    {
      name: 'needs-disposition',
      expectedStatus: 'needs_disposition',
      expectedPlanChanges: 1,
    },
    {
      name: 'open-task',
      taskStatus: 'pending',
      disposition: 'coveredByOpenTask',
      expectedStatus: 'open_task',
      expectedPlanChanges: 0,
    },
    {
      name: 'needs-judgment',
      disposition: 'needsJudgment',
      expectedStatus: 'needs_judgment',
      expectedPlanChanges: 1,
    },
  ];

  for (const entry of cases) {
    const workDir = mkdtempSync(path.join(tmpdir(), `ralph-controller-hard-diff-${entry.name}-`));
    const specPath = path.join(workDir, 'spec.md');
    writeFileSync(specPath, [
      '## Product Spec',
      'Game and level UI must be HTML elements, not canvas.',
    ].join('\n'));

    const tasks = entry.taskStatus
      ? [{
        id: 'task-001',
        description: 'Handle DIFF-009-002 / REQ-HTML accepted diff work.',
        acceptanceCriteria: ['REQ-HTML is handled.'],
        status: entry.taskStatus,
        attempts: entry.taskStatus === 'completed' ? 1 : 0,
        dependencies: [],
        feedbackItemRefs: [{
          itemId: 'DIFF-009-002',
          diffItemId: 'DIFF-009-002',
          targetType: 'spec',
          targetId: 'REQ-HTML',
        }],
      }]
      : [];
    const judgments = entry.disposition === 'needsJudgment'
      ? [{
        id: 'judgment-001',
        timestamp: new Date().toISOString(),
        taskId: null,
        ambiguity: 'Need product interpretation.',
        options: ['Proceed'],
        chosen: 0,
        reasoning: 'Legacy hard diff judgment.',
        madeBy: 'controller' as const,
      }]
      : [];

    const planManager = new PlanManager(workDir);
    planManager.createPlan('spec.md', [{
      id: 'phase-1',
      name: 'Implementation',
      description: 'Build the app',
      order: 1,
      status: entry.taskStatus === 'pending' ? 'in_progress' : 'completed',
      planLater: false,
      tasks,
    }], judgments);
    planManager.recordSpecMigration('spec.md', 'runner:input-hash-v3', {
      specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 9, itemCount: 1 },
      requiredFeedbackItems: [{
        itemId: 'DIFF-009-002',
        diffItemId: 'DIFF-009-002',
        targetType: 'spec',
        targetId: 'REQ-HTML',
        kind: 'accepted_diff:spec',
        changeType: 'updated',
        status: 'updated',
        summary: 'Game and level UI must move from canvas to HTML elements.',
        sourceEvidence: [{
          sourceRef: 'SRC-003',
          quote: 'Game and level UI must be HTML elements, not canvas.',
          intent: 'Game and level UI must move from Phaser/canvas rendering to HTML/DOM elements; keeping canvas is not enough.',
        }],
      }],
      feedbackDispositions: entry.disposition
        ? [{
          itemId: 'DIFF-009-002',
          disposition: entry.disposition,
          taskIds: entry.disposition === 'coveredByOpenTask' ? ['task-001'] : [],
          judgmentIds: entry.disposition === 'needsJudgment' ? ['judgment-001'] : [],
          reason: 'Case fixture disposition.',
        }]
        : [],
    });
    await planManager.save();

    const controller = new Controller(workDir);
    const report = await controller.audit({
      workDir,
      specPath,
      projectConfig: {} as any,
      ralphConfig: {} as any,
      agent: {
        execute: async () => ({
          success: true,
          output: jsonReport({
            verdict: 'continue',
            summary: 'Model says continue.',
            planChanges: [],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
        }),
      } as any,
      model: undefined,
      planManager,
      judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
      iterationHistory: [],
      verbose: false,
    }, 'final');

    assert.equal(report.verdict, 'revise', entry.name);
    assert.equal(report.feedbackMatrix?.[0].status, entry.expectedStatus, entry.name);
    assert.equal(report.feedbackMatrix?.[0].closureAllowed, false, entry.name);
    assert.equal(report.planChanges.length, entry.expectedPlanChanges, entry.name);
  }
});

test('controller final guard does not record hard accepted diff judgment when report adds product work', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-hard-diff-implemented-with-work-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Game and level UI must be HTML elements, not canvas.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Interpret REQ-HTML and keep the Phaser canvas game while improving touch behavior.',
      acceptanceCriteria: ['REQ-HTML has been considered.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-009-002',
        diffItemId: 'DIFF-009-002',
        targetType: 'spec',
        targetId: 'REQ-HTML',
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v3', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 9, itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'DIFF-009-002',
      diffItemId: 'DIFF-009-002',
      targetType: 'spec',
      targetId: 'REQ-HTML',
      kind: 'accepted_diff:spec',
      changeType: 'updated',
      status: 'updated',
      summary: 'Game and level UI must move from canvas to HTML elements.',
      sourceEvidence: [{
        sourceRef: 'SRC-003',
        quote: 'Game and level UI must be HTML elements, not canvas.',
        intent: 'Game and level UI must move from Phaser/canvas rendering to HTML/DOM elements; keeping canvas is not enough.',
      }],
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-009-002',
      disposition: 'addTask',
      taskIds: ['task-001'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Initial attempt claimed the accepted spec diff work.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'revise',
          summary: 'Need one concrete product follow-up for REQ-HTML.',
          planChanges: [{
            action: 'addTask',
            phaseId: 'phase-1',
            task: {
              id: 'task-002',
              description: 'Replace REQ-HTML canvas rendering with HTML elements.',
              acceptanceCriteria: ['REQ-HTML is implemented with HTML elements.'],
              status: 'pending',
              priority: 3,
              dependencies: [],
              estimatedComplexity: 'medium',
              attempts: 0,
              addedBy: 'controller',
            },
          }],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(planManager.currentPlan.judgments.length, 0);
  assert.deepEqual(planManager.getAllTasks().map(task => task.id), ['task-001', 'task-002']);
  assert.deepEqual(planManager.findTask('task-002')?.feedbackItemRefs, [{
    itemId: 'DIFF-009-002',
    diffItemId: 'DIFF-009-002',
    targetType: 'spec',
    targetId: 'REQ-HTML',
    changeType: 'updated',
    status: 'updated',
    summary: 'Game and level UI must move from canvas to HTML elements.',
    sourceEvidence: [{
      sourceRef: 'SRC-003',
      quote: 'Game and level UI must be HTML elements, not canvas.',
      intent: 'Game and level UI must move from Phaser/canvas rendering to HTML/DOM elements; keeping canvas is not enough.',
    }],
    specFile: 'spec.md',
    specHash: 'runner:input-hash-v3',
    migrationId: 'spec-001',
  }]);
});

test('controller final guard carries current accepted diff refs onto a single grouped follow-up task', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-grouped-followup-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Product Spec',
    'Notation must follow the renderer methodology document.',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Apply the initial notation renderer methodology.',
      acceptanceCriteria: ['The renderer methodology is applied.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [
        {
          itemId: 'DIFF-050-SPEC',
          diffItemId: 'DIFF-050-SPEC',
          targetType: 'spec',
          targetId: 'SPEC-050',
        },
        {
          itemId: 'DIFF-050-ASSET',
          diffItemId: 'DIFF-050-ASSET',
          targetType: 'asset',
          targetId: 'ASSET-METHODOLOGY-MD',
        },
      ],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v50', {
    specChangeSource: { kind: 'accepted_artifact', projectId: 'tg-proj-1', version: 50, itemCount: 2 },
    requiredFeedbackItems: [
      {
        itemId: 'DIFF-050-SPEC',
        diffItemId: 'DIFF-050-SPEC',
        targetType: 'spec',
        targetId: 'SPEC-050',
        kind: 'accepted_diff:spec',
        changeType: 'updated',
        status: 'updated',
        summary: 'Use VexFlow renderer methodology everywhere.',
      },
      {
        itemId: 'DIFF-050-ASSET',
        diffItemId: 'DIFF-050-ASSET',
        targetType: 'asset',
        targetId: 'ASSET-METHODOLOGY-MD',
        kind: 'accepted_diff:asset',
        changeType: 'created',
        status: 'created',
        summary: 'Methodology markdown asset is required.',
      },
    ],
    feedbackDispositions: [
      {
        itemId: 'DIFF-050-SPEC',
        disposition: 'addTask',
        taskIds: ['task-001'],
        reason: 'Initial methodology implementation.',
      },
      {
        itemId: 'DIFF-050-ASSET',
        disposition: 'addTask',
        taskIds: ['task-001'],
        reason: 'Initial methodology asset implementation.',
      },
    ],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'revise',
          summary: 'Need one follow-up for methodology parity.',
          planChanges: [{
            action: 'addTask',
            phaseId: 'phase-1',
            task: {
              id: 'task-002',
              description: 'Sync video highlight geometry with the shared renderer methodology.',
              acceptanceCriteria: ['Video highlights use the same renderer-derived geometry as app notation.'],
              status: 'pending',
              priority: 3,
              dependencies: ['task-001'],
              estimatedComplexity: 'medium',
              attempts: 0,
              addedBy: 'controller',
            },
          }],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.deepEqual(
    (planManager.findTask('task-002')?.feedbackItemRefs ?? []).map((ref) => ref.itemId),
    ['DIFF-050-SPEC', 'DIFF-050-ASSET'],
  );
});

test('controller final guard does not accumulate judgments for implemented-unverified evidence', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-private-evidence-repeat-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Queue is still too dense',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Fix current BUG-005 queue feedback',
      acceptanceCriteria: ['BUG-005 current feedback is handled'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'hash-v2', {
    specChangeSource: { kind: 'extracted_current_feedback', itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'current_feedback_snapshot',
      summary: 'Queue is still too dense.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      disposition: 'addTask',
      taskIds: ['task-001'],
      reason: 'Existing completed task is the current implementation attempt.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const auditOptions = {
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Implemented but not externally proven.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  };

  await controller.audit(auditOptions, 'final');
  const second = await controller.audit(auditOptions, 'final');

  assert.equal(second.verdict, 'continue');
  assert.equal(second.planChanges.length, 0);
  assert.equal(planManager.currentPlan.judgments.length, 0);
});

test('controller final guard does not record proceed judgment when report adds product work', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-implemented-with-work-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Queue is still too dense',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Fix current BUG-005 queue feedback',
      acceptanceCriteria: ['BUG-005 current feedback is handled'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'hash-v2', {
    specChangeSource: { kind: 'extracted_current_feedback', itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'current_feedback_snapshot',
      summary: 'Queue is still too dense.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      disposition: 'addTask',
      taskIds: ['task-001'],
      reason: 'Existing completed task is the current implementation attempt.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'revise',
          summary: 'Queue behavior still needs product adjustment.',
          planChanges: [{
            action: 'addTask',
            phaseId: 'phase-1',
            task: {
              id: 'task-002',
              description: 'Reduce visible queue density for BUG-005.',
              acceptanceCriteria: ['BUG-005 queue density is visibly reduced in product behavior.'],
              status: 'pending',
              priority: 3,
              dependencies: [],
              estimatedComplexity: 'medium',
              attempts: 0,
              addedBy: 'controller',
              feedbackItemRefs: [{ itemId: 'BUG-005' }],
            },
          }],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(planManager.currentPlan.judgments.length, 0);
  assert.deepEqual(planManager.getAllTasks().map(task => task.id), ['task-001', 'task-002']);
});

test('controller guard does not mass-reopen legacy full-spec open items with existing tasks', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-legacy-full-open-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-001: Touch hit area is offset',
    '- BUG-002: HUD overlaps the board',
    '- BUG-003: Basket creates two items',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [
      {
        id: 'task-001',
        description: 'Fix BUG-001 touch hit area',
        acceptanceCriteria: ['BUG-001 is fixed'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      },
      {
        id: 'task-002',
        description: 'Fix BUG-002 HUD overlap',
        acceptanceCriteria: ['BUG-002 is fixed'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      },
      {
        id: 'task-003',
        description: 'Fix BUG-003 double spawn',
        acceptanceCriteria: ['BUG-003 is fixed'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      },
    ],
  }], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async ({ prompt }: any) => {
        assert.doesNotMatch(prompt, /Current Feedback Evidence Matrix/);
        return {
          success: true,
          output: jsonReport({
            verdict: 'continue',
            summary: 'No current diff-scoped feedback requires a new task.',
            planChanges: [],
            newJudgments: [],
            revisedJudgments: [],
          }),
          filesChanged: [],
          completionPromiseFound: false,
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.deepEqual(report.feedbackMatrix, []);
  assert.deepEqual(report.planChanges, []);
  assert.deepEqual(planManager.getAllTasks().map(task => task.id), ['task-001', 'task-002', 'task-003']);
});

test('controller final guard keeps open feedback task without adding duplicate follow-up', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-open-task-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Queue is still too dense',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'in_progress',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Fix current BUG-005 queue feedback',
      acceptanceCriteria: ['BUG-005 current feedback is handled'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'hash-v2', {
    specChangeSource: { kind: 'extracted_current_feedback', itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'current_feedback_snapshot',
      summary: 'Queue is still too dense.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      disposition: 'coveredByOpenTask',
      taskIds: ['task-001'],
      reason: 'Existing open task covers the current feedback.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Looks done.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.equal(report.feedbackMatrix?.[0].status, 'open_task');
  assert.equal(report.planChanges.length, 0);
  assert.deepEqual(planManager.getAllTasks().map(task => task.id), ['task-001']);
});

test('controller guard scopes full spec to latest migration feedback item', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-scoped-latest-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-001: Touch hit area is offset',
    '- BUG-002: HUD overlaps the board',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [
      {
        id: 'task-001',
        description: 'Fix BUG-001 touch hit area',
        acceptanceCriteria: ['BUG-001 is fixed'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
        feedbackItemRefs: [{ itemId: 'BUG-001' }],
      },
      {
        id: 'task-002',
        description: 'Fix BUG-002 HUD overlap',
        acceptanceCriteria: ['BUG-002 is fixed'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
        feedbackItemRefs: [{ itemId: 'BUG-002' }],
      },
    ],
  }], []);
  planManager.recordSpecMigration('spec.md', 'hash-v2', {
    specChangeSource: { kind: 'extracted_current_feedback', itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'BUG-002',
      kind: 'implementation_gap',
      changeType: 'current_feedback_snapshot',
      summary: 'HUD overlaps the board.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-002',
      disposition: 'addTask',
      taskIds: ['task-002'],
      reason: 'BUG-002 was the current changed feedback item.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Everything is resolved.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.deepEqual(report.feedbackMatrix?.map(row => row.itemId), ['BUG-002']);
  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.equal(report.planChanges.length, 0);
  assert.equal(planManager.currentPlan.judgments.length, 0);
});

test('controller final guard does not duplicate a feedback task already proposed by the report', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-report-task-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Queue is still too dense',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [],
  }], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'revise',
          summary: 'Need one follow-up for the current queue feedback.',
          planChanges: [{
            action: 'addTask',
            phaseId: 'phase-1',
            task: {
              id: 'task-001',
              description: 'Revisit BUG-005 queue density against the current accepted feedback.',
              acceptanceCriteria: ['BUG-005 is handled against the current accepted spec.'],
              status: 'pending',
              priority: 3,
              dependencies: [],
              estimatedComplexity: 'medium',
              attempts: 0,
              addedBy: 'controller',
              feedbackItemRefs: [{ itemId: 'BUG-005' }],
            },
          }],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.equal(report.feedbackMatrix?.[0].status, 'needs_disposition');
  assert.deepEqual(report.planChanges.map(change => change.action === 'addTask' ? change.task.id : ''), ['task-001']);
  assert.deepEqual(planManager.getAllTasks().map(task => task.id), ['task-001']);
});

test('controller final audit ignores model-supplied feedbackMatrix rows', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-owned-matrix-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Queue is still too dense',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Fix current BUG-005 queue feedback',
      acceptanceCriteria: ['BUG-005 current feedback is handled'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'hash-v2', {
    specChangeSource: { kind: 'extracted_current_feedback', itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'current_feedback_snapshot',
      summary: 'Queue is still too dense.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      disposition: 'addTask',
      taskIds: ['task-001'],
      reason: 'Follow-up task was added for the current feedback.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'escalate',
          summary: 'External integration evidence is missing.',
          feedbackMatrix: [{
            itemId: 'BUG-999',
            status: 'closed_by_evidence',
            closureAllowed: true,
            operatorSummary: 'Model tried to own the matrix.',
          }],
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.feedbackMatrix?.[0].itemId, 'BUG-005');
  assert.equal(report.feedbackMatrix?.[0].status, 'implemented_unverified');
  assert.deepEqual(report.feedbackMatrix?.map(row => row.itemId), ['BUG-005']);
  assert.equal(report.planChanges.length, 0);
  assert.equal(planManager.currentPlan.judgments.length, 0);
});

test('controller final audit normalizes object overclaim warnings', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-object-overclaim-warnings-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'revise',
          summary: 'Production integration evidence is missing.',
          overclaimWarnings: [{
            scope: 'production readiness',
            warning: 'Local fake-mode tests do not prove real provider connectivity.',
          }],
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'revise');
  assert.deepEqual(report.overclaimWarnings, [
    'production readiness: Local fake-mode tests do not prove real provider connectivity.',
  ]);
});

test('controller escalation is normalized to non-blocking judgment output', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-escalate-nonblocking-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n\nBuild a product with best available local behavior.\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'escalate',
          summary: 'Product owner confirmation is missing.',
          overclaimWarnings: [],
          planChanges: [],
          newJudgments: [{
            id: 'judgment-001',
            timestamp: new Date().toISOString(),
            ambiguity: 'Whether local placeholder behavior is acceptable for MVP.',
            options: ['Ship placeholder MVP and record the risk', 'Stop until product owner confirms'],
            chosen: 0,
            reasoning: 'Ralph should continue with a recorded product judgment instead of pausing lifecycle.',
            madeBy: 'controller',
          }],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.match(report.summary, /not allowed to pause project lifecycle/i);
  assert.match(report.overclaimWarnings?.join('\n') ?? '', /normalized to continue/i);
  assert.equal(planManager.currentPlan.judgments.length, 1);
});

test('controller strips LLM-supplied public assumption candidates from new judgments', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-public-assumption-strip-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n\nBuild a product with best available local behavior.\n');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);
  await planManager.save();

  const controller = new Controller(workDir);
  await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Record a private judgment.',
          overclaimWarnings: [],
          planChanges: [],
          newJudgments: [{
            id: 'judgment-001',
            timestamp: new Date().toISOString(),
            ambiguity: 'Whether placeholder behavior is acceptable.',
            options: ['Proceed', 'Stop'],
            chosen: 0,
            reasoning: 'Private reasoning should stay private.',
            madeBy: 'controller',
            publicAssumption: {
              id: 'ASM-RALPH-PRIVATE',
              title: 'Leaky title',
              statement: 'secret-like text must not be published from agent JSON',
              sourceRefs: ['judgment-001'],
            },
          }],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(planManager.currentPlan.judgments.length, 1);
  assert.equal(planManager.currentPlan.judgments[0].publicAssumption, undefined);
});

test('controller final guard allows current feedback closed by concrete evidence', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-evidence-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Queue is still too dense',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Fix current BUG-005 queue feedback',
      acceptanceCriteria: ['BUG-005 current feedback is handled'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'hash-v2', {
    specChangeSource: { kind: 'extracted_current_feedback', itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'current_feedback_snapshot',
      summary: 'Queue is still too dense.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      disposition: 'closedByEvidence',
      taskIds: ['task-001'],
      evidence: [{
        kind: 'manual_note',
        ref: 'controller:test',
        summary: 'Manual verification confirmed queue density is fixed.',
      }],
      reason: 'Verified against current accepted feedback.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Evidence closes the feedback.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.feedbackMatrix?.[0].status, 'closed_by_evidence');
  assert.deepEqual(report.overclaimWarnings, []);
});

test('controller final guard closes completed feedback task with positive target evidence', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-feedback-task-evidence-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Queue is still too dense',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the app',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Fix current BUG-005 queue feedback',
      acceptanceCriteria: ['BUG-005 current feedback is handled'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
      verificationEvidence: [{
        kind: 'post_deploy_smoke',
        ref: 'verification:post-deploy',
        result: 'pass',
        feedbackItemIds: ['BUG-005'],
        taskId: 'task-001',
        summary: 'Smoke: queue page checked with screenshots.',
        recordedBy: 'executor',
      }],
    }],
  }], []);
  planManager.recordSpecMigration('spec.md', 'hash-v2', {
    specChangeSource: { kind: 'extracted_current_feedback', itemCount: 1 },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'current_feedback_snapshot',
      summary: 'Queue is still too dense.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      disposition: 'addTask',
      taskIds: ['task-001'],
      reason: 'Follow-up task was added for the current feedback.',
    }],
  });
  await planManager.save();

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => ({
        success: true,
        output: jsonReport({
          verdict: 'continue',
          summary: 'Target evidence closes the feedback.',
          planChanges: [],
          newJudgments: [],
          revisedJudgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      }),
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'final');

  assert.equal(report.verdict, 'continue');
  assert.equal(report.feedbackMatrix?.[0].status, 'closed_by_evidence');
  assert.deepEqual(report.planChanges, []);
});

test('controller startup report is typed as non-semantic and skips feedback matrix', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-startup-report-type-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Queue is still too dense',
  ].join('\n'));

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: { e2eEnforcer: { enabled: false } } as any,
    agent: {
      execute: async () => {
        throw new Error('startup should not ask agent when e2e is explicitly disabled');
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'startup');

  assert.equal(report.reportType, 'startup_e2e_enforcer');
  assert.equal(report.semanticAudit, false);
  assert.deepEqual(report.feedbackMatrix, []);
  assert.deepEqual(report.overclaimWarnings, []);
});

test('controller startup keeps e2e enforcer disabled by default', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-startup-e2e-default-off-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, 'Build a small web app.');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [], []);

  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: {} as any,
    agent: {
      execute: async () => {
        throw new Error('startup should not ask agent when e2e is default-disabled');
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'startup');

  assert.equal(report.reportType, 'startup_e2e_enforcer');
  assert.equal(report.semanticAudit, false);
  assert.equal(report.summary, 'Startup: E2E enforcer disabled by project policy');
  assert.equal(planManager.currentPlan.e2eApplicable, false);
});

test('controller startup e2e applicability auto-decision uses agent timeout in minutes when explicitly enabled with null', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-controller-startup-timeout-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, 'Build a small web app.');

  const planManager = new PlanManager(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-001',
    name: 'Core',
    description: 'Core phase',
    order: 1,
    status: 'pending',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Build core app',
      acceptanceCriteria: ['App exists'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
    }],
  }], []);

  const seenTimeouts: unknown[] = [];
  const controller = new Controller(workDir);
  const report = await controller.audit({
    workDir,
    specPath,
    projectConfig: {} as any,
    ralphConfig: { e2eEnforcer: { enabled: null } } as any,
    agent: {
      execute: async (options: { timeout?: number }) => {
        seenTimeouts.push(options.timeout);
        return {
          success: true,
          output: JSON.stringify({ e2eApplicable: false, reasoning: 'not needed' }),
          filesChanged: [],
          completionPromiseFound: false,
          providerSession: { id: 'session-e2e-applicability' },
        };
      },
    } as any,
    model: undefined,
    planManager,
    judgmentLog: { save: async () => {}, record: () => {}, recordRevision: () => {} } as any,
    iterationHistory: [],
    verbose: false,
  }, 'startup');

  assert.equal(report.reportType, 'startup_e2e_enforcer');
  assert.equal(report.verdict, 'continue');
  assert.deepEqual(seenTimeouts, [1]);
  assert.equal(existsSync(path.join(workDir, PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH)), false);
});

function jsonReport(value: unknown): string {
  return ['```json', JSON.stringify(value), '```'].join('\n');
}

function writeWorkbenchManifest(workDir: string, manifest: unknown): void {
  const dir = path.join(workDir, 'visual-workbench');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function validWorkbenchManifest(options: { defaultFor?: string[] } = {}): unknown {
  return {
    schemaVersion: 'ra-355.visual-coverage-manifest.v0',
    projectClass: 'ordinary_web',
    workbench: {
      serveCommand: 'npm run visual-workbench',
      storyRoutePattern: '/__visual/:storyId',
    },
    coveragePolicy: {
      mode: 'strict_canary',
      selectionDefault: 'full_manifest',
      simplificationRequiresEvidence: true,
    },
    stories: [{
      id: 'synth-pad.ready',
      title: 'Synth pad ready',
      kind: 'widget',
      feature: 'synth-jam',
      widget: 'SynthPad',
      state: 'ready',
      claim: 'The synth pad ready state renders.',
      render: { type: 'workbench_route', path: '/__visual/synth-pad.ready' },
      mockState: { name: 'ready' },
      viewports: [{ name: 'desktop', width: 1280, height: 720 }],
      ...(options.defaultFor ? { taskRelevance: { defaultFor: options.defaultFor } } : {}),
    }],
  };
}

function workbenchFeedbackRef() {
  return {
    itemId: 'DIFF-WB-001',
    diffItemId: 'DIFF-WB-001',
    targetType: 'spec',
    targetId: 'REQ-WB-001',
    changeType: 'created',
    workImpact: 'requires_loop_work',
    workSurface: 'frontend',
    status: 'created',
    summary: 'Build ordinary-web synth pad UI with source-owned Visual Workbench coverage.',
    sourceRefs: ['SRC-WB-001'],
    sourceEvidence: [{
      sourceRef: 'SRC-WB-001',
      intent: 'The UI task must produce Workbench render recipes for reviewable screenshots.',
    }],
    specFile: 'spec.md',
    specHash: 'runner:workbench-hash',
    fingerprint: 'fingerprint-wb-001',
  };
}

function recordWorkbenchMigration(planManager: PlanManager, taskIds = ['task-001']): void {
  planManager.recordSpecMigration('spec.md', 'runner:workbench-hash', {
    specChangeSource: {
      kind: 'accepted_artifact',
      system: 'tg-spec',
      projectId: 'tg-workbench',
      version: 1,
      itemCount: 1,
    },
    requiredFeedbackItems: [{
      itemId: 'DIFF-WB-001',
      diffItemId: 'DIFF-WB-001',
      targetType: 'spec',
      targetId: 'REQ-WB-001',
      kind: 'accepted_diff:spec',
      changeType: 'created',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
      status: 'created',
      summary: 'Build ordinary-web synth pad UI with source-owned Visual Workbench coverage.',
      sourceRefs: ['SRC-WB-001'],
      sourceEvidence: [{
        sourceRef: 'SRC-WB-001',
        intent: 'The UI task must produce Workbench render recipes for reviewable screenshots.',
      }],
      fingerprint: 'fingerprint-wb-001',
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-WB-001',
      feedbackStatus: 'created',
      disposition: 'addTask',
      taskIds,
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Task was added for accepted Workbench frontend work.',
    }],
  });
}
