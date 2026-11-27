import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ContextBuilder,
  buildExecutorContextSections,
  type ContextOptions,
} from './context.js';

test('context builder keeps platform prompt as the single Arena/Ralph boundary', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-runtime-boundary-'));
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(
    path.join(workDir, '.arena', 'platform.md'),
    [
      '# Arena Platform Contract',
      '',
      '- Write `{"status":"DEPLOYED"}` to `.arena/result.json` when done.',
      '- Current product executor tasks MUST NOT write, create, repair, read, or verify `.arena/result.json`.',
      '- Product executor tasks treat `.arena/platform.md`, `.arena/events.json`, `.arena/auth.json`, `.arena/stop-request.json`, `.arena/spec-input.json`, and other `.arena/` files as read-only platform inputs.',
    ].join('\n'),
  );

  const context = await new ContextBuilder().build({
    workDir,
    task: {
      id: 'task-001',
      description: 'Improve the title screen contrast.',
      acceptanceCriteria: ['Title remains readable'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
    },
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
  });

  assert.doesNotMatch(context, /# Ralph Runtime Boundary/);
  assert.doesNotMatch(context, /Write `\{"status":"DEPLOYED"\}` to `\.arena\/result\.json` when done/);
  assert.match(context, /Current product executor tasks MUST NOT write, create, repair, read, or verify `\.arena\/result\.json`/);
  assert.match(context, /`\.arena\/spec-input\.json`, and other `\.arena\/` files as read-only platform inputs/);
  assert.match(context, /Ralph runtime handles `\.arena\/result\.json`/);
});

test('context builder keeps Ralph loop bookkeeping off-limits to executor', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-loop-bookkeeping-boundary-'));

  const context = await new ContextBuilder().build({
    workDir,
    task: {
      id: 'task-001',
      description: 'Attach semantic closure evidence for BUG-001.',
      acceptanceCriteria: ['BUG-001 has current target evidence'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-001' }],
    },
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
  });

  assert.match(context, /Do NOT edit `\.ralph\/plan\.json`/);
  assert.doesNotMatch(context, /`\.ralph\/ralph-features\.json`/);
  assert.match(context, /Do not manufacture task completion or feedback closure evidence by editing them/);
  assert.match(context, /Ralph records verificationEvidence after your product\/test work verifies the task/);
});

test('context builder seeds task workspace and role skills for executor role passes', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-task-workspace-'));

  const context = await new ContextBuilder().build({
    workDir,
    task: {
      id: 'task-ux-001',
      displayTitle: 'Improve hero flow',
      description: 'Make the landing screen feel production-ready.',
      acceptanceCriteria: ['Hero works on mobile', 'Primary action is obvious'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      requiredRolePasses: ['product', 'ux'],
      feedbackItemRefs: [{
        itemId: 'DIFF-002-FEATURE-001',
        targetType: 'spec',
          targetId: 'REQ-HERO',
          changeType: 'updated',
          workImpact: 'requires_loop_work',
          summary: 'Hero screen behavior changed in the accepted diff.',
          sourceRefs: ['SRC-002'],
          sourceEvidence: [{
            sourceRef: 'SRC-002',
            quote: 'кнопку Play не текстом, а той же play-иконкой',
            intent: 'Play icon replaces visible Play/play text; icon plus text is not enough.',
          }],
        }],
    },
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
  });

  const taskFolder = path.join(workDir, '.ralph', 'tasks', 'task-ux-001');
  const brief = readFileSync(path.join(taskFolder, 'brief.md'), 'utf-8');
  const plan = readFileSync(path.join(taskFolder, 'plan.md'), 'utf-8');
  const productSkill = readFileSync(path.join(workDir, '.ralph', 'task-skills', 'product.md'), 'utf-8');
  const uxSkill = readFileSync(path.join(workDir, '.ralph', 'task-skills', 'ux.md'), 'utf-8');

  assert.equal(existsSync(taskFolder), true);
  assert.match(brief, /# task-ux-001 Task Workspace/);
  assert.match(brief, /- product/);
    assert.match(brief, /- ux/);
    assert.match(brief, /## Current Accepted Diff Packet/);
    assert.match(brief, /verify absence as well as the new presence/);
    assert.match(brief, /DIFF-002-FEATURE-001 \(type=spec, target=REQ-HERO, change=updated, impact=requires_loop_work\)/);
    assert.match(brief, /Summary: Hero screen behavior changed in the accepted diff\./);
    assert.match(brief, /Source refs: SRC-002/);
    assert.match(brief, /Source evidence:/);
    assert.match(brief, /quote="кнопку Play не текстом, а той же play-иконкой"/);
    assert.match(brief, /intent="Play icon replaces visible Play\/play text; icon plus text is not enough\."/);
    assert.match(brief, /- `plan\.md` always/);
  assert.match(plan, /# task-ux-001 Plan/);
  assert.match(plan, /Write\/update this before product code changes/);
  assert.match(productSkill, /# Product Skill/);
  assert.match(productSkill, /primary intent/);
  assert.match(productSkill, /primary action/);
  assert.match(productSkill, /nice-to-have detail/);
  assert.match(uxSkill, /# UX Skill/);
  assert.match(uxSkill, /design mobile-first/);
  assert.match(uxSkill, /protect user attention/);
  assert.match(uxSkill, /viewport fit checks/);
  assert.match(context, /## Task Workspace/);
  assert.match(context, /Folder: `\.ralph\/tasks\/task-ux-001\/`/);
  assert.match(context, /write or update `plan\.md`/);
  assert.match(context, /## Required Role Passes/);
  assert.match(context, /write `\.ralph\/tasks\/task-ux-001\/product\.md`/);
  assert.match(context, /write `\.ralph\/tasks\/task-ux-001\/ux\.md`/);
  assert.match(context, /If your agent environment supports subagents\/delegation/);
});

test('context builder rejects non-path-safe task ids instead of aliasing task folders', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-task-id-strict-'));

  await assert.rejects(() => new ContextBuilder().build({
    workDir,
    task: {
      id: 'task:001',
      description: 'Unsafe id should not map to another folder.',
      acceptanceCriteria: ['It fails loudly'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
    },
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
  }), /Task id must be path-safe/);
});

test('context builder does not overwrite executor task plan notes', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-task-plan-preserve-'));
  const taskFolder = path.join(workDir, '.ralph', 'tasks', 'task-001');
  mkdirSync(taskFolder, { recursive: true });
  writeFileSync(path.join(taskFolder, 'plan.md'), '# Custom Plan\n\nKeep this executor note.\n');

  const options: ContextOptions = {
    workDir,
    task: {
      id: 'task-001',
      description: 'Improve checkout layout.',
      acceptanceCriteria: ['Checkout layout remains usable'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      requiredRolePasses: ['ux'],
    },
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
  };

  await new ContextBuilder().build(options);
  await new ContextBuilder().build(options);

  const plan = readFileSync(path.join(taskFolder, 'plan.md'), 'utf-8');
  assert.equal(plan, '# Custom Plan\n\nKeep this executor note.\n');
});

test('pure executor context assembly can omit task workspace without writing .ralph files', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-pure-assembly-'));

  const context = buildExecutorContextSections({
    autonomousInstructions: '# Autonomous Instructions\nFinish only this task.',
    task: {
      id: 'task-visual-001',
      description: 'Add the visual story for the synth pad ready state.',
      acceptanceCriteria: ['Ready state has source-owned Workbench coverage'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      requiredRolePasses: ['ux'],
      visualEvidenceRequired: true,
    },
    iteration: 1,
    specPath: path.join(workDir, 'spec.md'),
    visualEvidenceMode: 'required',
  });

  assert.equal(existsSync(path.join(workDir, '.ralph')), false);
  assert.match(context, /# Autonomous Instructions/);
  assert.match(context, /# YOUR CURRENT TASK: task-visual-001/);
  assert.match(context, /## Visual Workbench Coverage/);
  assert.doesNotMatch(context, /## Task Workspace/);
  assert.doesNotMatch(context, /Folder: `\.ralph\/tasks\/task-visual-001/);
});

test('context builder does not embed raw relevant file contents', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-no-relevant-files-'));
  writeFileSync(path.join(workDir, 'package.json'), '{"scripts":{"start":"vite"}}');
  writeFileSync(path.join(workDir, 'README.md'), 'Project README that should not be prompt-injected.');
  mkdirSync(path.join(workDir, 'src'), { recursive: true });
  writeFileSync(path.join(workDir, 'src', 'app.ts'), 'export const promptInjected = false;');

  const context = await new ContextBuilder().build({
    workDir,
    task: {
      id: 'task-001',
      description: 'Fix the route in src/app.ts after DEPLOY ERROR.',
      acceptanceCriteria: ['Route works'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      lastError: 'DEPLOY ERROR: route failed',
    },
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
  });

  assert.doesNotMatch(context, /# Relevant Files/);
  assert.doesNotMatch(context, /Project README that should not be prompt-injected/);
  assert.doesNotMatch(context, /promptInjected/);
  assert.doesNotMatch(context, /"start":"vite"/);
});

test('context builder keeps plan summary inside references and omits judgments', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-thin-references-'));

  const context = await new ContextBuilder().build({
    workDir,
    task: {
      id: 'task-010',
      description: 'Fix BUG-005 queue behavior.',
      acceptanceCriteria: ['BUG-005 is covered'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'DIFF-001-BUG-005', targetId: 'BUG-005' }],
    },
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
    planSummary: 'Progress: 2/5 tasks done, 1/2 phases done. Full plan: `.ralph/plan.json`',
  });

  assert.match(context, /# References \(read-only\)/);
  assert.match(context, /Full spec:/);
  assert.match(context, /Full plan: `\.ralph\/plan\.json`/);
  assert.match(context, /Progress: 2\/5 tasks done/);
  assert.doesNotMatch(context, /# Plan\n/);
  assert.doesNotMatch(context, /# Judgments/);
});

test('context builder adds active WIP reconciliation instructions only when requested', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-active-wip-'));

  const baseOptions: ContextOptions = {
    workDir,
    task: {
      id: 'task-010',
      description: 'Remove the legacy turn logic.',
      acceptanceCriteria: ['Turn logic is gone'],
      status: 'in_progress',
      attempts: 0,
      dependencies: [],
      lastError: 'Rate limit pause — awaiting resume',
    },
    iteration: 10,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
  };

  const freshClaimContext = await new ContextBuilder().build(baseOptions);
  assert.doesNotMatch(freshClaimContext, /# Active WIP Reconciliation/);

  const context = await new ContextBuilder().build({
    ...baseOptions,
    activeWipReconciliation: true,
  });

  assert.match(context, /# Active WIP Reconciliation/);
  assert.match(context, /partial WIP, not as a clean slate/);
  assert.match(context, /complete, adapt, or clean it up/);
  // RA-374 (D): reuse existing role notes on WIP resume instead of redoing passes.
  assert.match(context, /Reuse them; re-run a role pass only if the accepted spec changed/);
});

test('context builder surfaces the iteration time budget when configured (RA-374)', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-time-budget-'));
  const baseTask = {
    id: 'task-030',
    description: 'Ship the leaderboard.',
    acceptanceCriteria: ['Leaderboard opens'],
    status: 'pending' as const,
    attempts: 0,
    dependencies: [],
  };

  const withBudget = await new ContextBuilder().build({
    workDir,
    task: baseTask,
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
    iterationTimeoutMinutes: 15,
  });
  assert.match(withBudget, /hard-limited to 15 minutes/);

  const withoutBudget = await new ContextBuilder().build({
    workDir,
    task: baseTask,
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
  });
  assert.doesNotMatch(withoutBudget, /Iteration Time Budget/);
});

test('context builder omits broad progress and git history from executor prompt', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-no-progress-git-'));

  const context = await new ContextBuilder().build({
    workDir,
    task: {
      id: 'task-020',
      description: 'Update the checkout button.',
      acceptanceCriteria: ['Checkout button works'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
    },
    iteration: 1,
    completionPromise: 'TASK_COMPLETE',
    specPath: path.join(workDir, 'spec.md'),
    planSummary: 'Progress: 2/5 tasks done, 1/2 phases done. Full plan: `.ralph/plan.json`',
  });

  assert.doesNotMatch(context, /# Ralph Loop Progress Summary/);
  assert.doesNotMatch(context, /# Recent Git History/);
  assert.match(context, /# References \(read-only\)/);
  assert.match(context, /Progress: 2\/5 tasks done/);
});

test('context builder keeps core external secrets blocking by default', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-context-secret-boundary-'));
  const prevProjectId = process.env.ARENA_PROJECT_ID;
  const prevGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;
  process.env.ARENA_PROJECT_ID = 'project-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance.test';

  try {
    const context = await new ContextBuilder().build({
      workDir,
      task: {
        id: 'task-001',
        description: 'Build the Telegram policy bot.',
        acceptanceCriteria: ['Bot uses the real Telegram integration when complete'],
        status: 'pending',
        attempts: 0,
        dependencies: [],
      },
      iteration: 1,
      completionPromise: 'TASK_COMPLETE',
      specPath: path.join(workDir, 'spec.md'),
    });

    assert.match(context, /Missing required secrets are blocking by default/);
    assert.match(context, /node \/arena\/request-secrets\.js SECRET_KEY/);
    assert.doesNotMatch(context, /TELEGRAM_BOT_TOKEN .*--non-blocking/);
  } finally {
    if (prevProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = prevProjectId;
    }
    if (prevGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = prevGovernanceUrl;
    }
  }
});
