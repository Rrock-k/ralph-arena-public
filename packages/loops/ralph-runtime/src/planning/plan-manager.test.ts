import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { formatActionableCompletion, formatPlanTaskBreakdown, PlanManager } from './plan-manager.js';
import type { Phase, Task } from '../config/types.js';

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'status'>): Task {
  const { id, status, ...rest } = overrides;
  return {
    id,
    description: `Task ${id}`,
    acceptanceCriteria: ['done'],
    status,
    attempts: 0,
    priority: 5,
    dependencies: [],
    ...rest,
  };
}

function phase(overrides: Partial<Phase> & Pick<Phase, 'id' | 'tasks'>): Phase {
  const { id, ...rest } = overrides;
  return {
    id,
    name: id,
    description: id,
    order: 1,
    status: 'pending',
    planLater: false,
    ...rest,
  };
}

async function withPlan<T>(phases: Phase[], fn: (manager: PlanManager) => Promise<T> | T): Promise<T> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-plan-manager-'));
  try {
    const manager = new PlanManager(workDir);
    const initialPhases = phases.map(phase => ({
      ...phase,
      tasks: phase.tasks.map(planTask => ({
        ...planTask,
        status: planTask.status === 'in_progress' ? 'pending' as const : planTask.status,
      })),
    }));
    manager.createPlan('spec.md', initialPhases, [], 'goal');
    for (const phase of phases) {
      for (const planTask of phase.tasks) {
        if (planTask.status === 'in_progress') {
          manager.findTask(planTask.id)!.status = 'in_progress';
        }
      }
    }
    return await fn(manager);
  } finally {
    await fs.remove(workDir);
  }
}

test('getNextTask resumes the active in_progress task before higher-priority pending work', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'in_progress', priority: 5 }),
        task({ id: 'task-002', status: 'pending', priority: 1 }),
      ],
    }),
  ], (manager) => {
    assert.equal(manager.getNextTask()?.id, 'task-001');
  });
});

test('getNextTask rejects multiple active in_progress tasks', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'in_progress' }),
        task({ id: 'task-002', status: 'in_progress' }),
      ],
    }),
  ], (manager) => {
    assert.throws(
      () => manager.getNextTask(),
      /multiple in_progress tasks/,
    );
  });
});

test('getStats separates skipped tasks from actionable progress', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'completed' }),
        task({ id: 'task-002', status: 'skipped' }),
        task({ id: 'task-003', status: 'pending' }),
        task({ id: 'task-004', status: 'failed' }),
        task({ id: 'task-005', status: 'in_progress' }),
      ],
    }),
  ], (manager) => {
    assert.deepEqual(manager.getStats(), {
      totalPhases: 1,
      completedPhases: 0,
      totalTasks: 5,
      completedTasks: 1,
      skippedTasks: 1,
      failedTasks: 1,
      pendingTasks: 1,
      inProgressTasks: 1,
      actionableTasks: 4,
      totalJudgments: 0,
      revisedJudgments: 0,
    });
    assert.equal(
      manager.generateSummary(),
      'Progress: 1 completed, 1 skipped, 1 failed, 2 open / 5 total, actionable completion 25% (1/4 non-skipped tasks), 0/1 phases done. Full plan: `.ralph/plan.json`',
    );
    assert.equal(formatPlanTaskBreakdown(manager.getStats()), '1 completed, 1 skipped, 1 failed, 2 open / 5 total');
    assert.equal(formatActionableCompletion(manager.getStats()), '25% (1/4 non-skipped tasks)');
  });
});

test('reconcileTaskStateForSelection marks exhausted failed tasks skipped once', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'failed', attempts: 3 }),
      ],
    }),
  ], (manager) => {
    assert.equal(manager.reconcileTaskStateForSelection(3), true);
    assert.equal(manager.findTask('task-001')?.status, 'skipped');
    assert.equal(manager.getStats().skippedTasks, 1);
    assert.equal(manager.getStats().completedPhases, 1);
    assert.equal(manager.getNextTask(), null);
    assert.equal(manager.reconcileTaskStateForSelection(3), false);
  });
});

test('plan changes cannot create or mutate executor-owned active work (dropped, not fatal)', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'in_progress' }),
        task({ id: 'task-002', status: 'pending' }),
        task({ id: 'task-003', status: 'completed' }),
      ],
    }),
  ], (manager) => {
    // RA-375: boundary-violating changes are dropped (reported in `dropped`),
    // never in `errors`, and never mutate the protected task.
    assert.deepEqual(manager.applyChanges([{
      action: 'addTask',
      phaseId: 'phase-1',
      task: task({ id: 'task-004', status: 'in_progress' }),
    }]), {
      applied: 0,
      errors: [],
      dropped: ['addTask: addTask: task-004 cannot start as in_progress; only the executor may claim active work'],
    });
    assert.equal(manager.findTask('task-004'), null);

    assert.deepEqual(manager.applyChanges([{
      action: 'updateTask',
      taskId: 'task-001',
      changes: { description: 'updated' },
    }]), {
      applied: 0,
      errors: [],
      dropped: ['updateTask: updateTask: cannot mutate active in_progress task task-001; executor must reconcile the WIP'],
    });
    assert.notEqual(manager.findTask('task-001')?.description, 'updated');

    assert.deepEqual(manager.applyChanges([{
      action: 'updateTask',
      taskId: 'task-002',
      changes: { status: 'in_progress' },
    }]), {
      applied: 0,
      errors: [],
      dropped: ['updateTask: updateTask: cannot set task-002 to in_progress; executor owns task lifecycle status'],
    });
    assert.equal(manager.findTask('task-002')?.status, 'pending');

    assert.deepEqual(manager.applyChanges([{
      action: 'updateTask',
      taskId: 'task-002',
      changes: { status: 'completed' },
    }]), {
      applied: 0,
      errors: [],
      dropped: ['updateTask: updateTask: cannot set task-002 to completed; executor owns task lifecycle status'],
    });

    assert.deepEqual(manager.applyChanges([{
      action: 'removeTask',
      taskId: 'task-001',
    }]), {
      applied: 0,
      errors: [],
      dropped: ['removeTask: removeTask: cannot remove active in_progress task task-001; executor must reconcile the WIP'],
    });
    assert.ok(manager.findTask('task-001'));

    assert.deepEqual(manager.applyChanges([{
      action: 'removeTask',
      taskId: 'task-003',
    }]), {
      applied: 0,
      errors: [],
      dropped: ['removeTask: removeTask: cannot remove terminal task task-003; add follow-up work instead'],
    });

    assert.deepEqual(manager.applyChanges([{
      action: 'addPhase',
      phase: phase({
        id: 'phase-2',
        order: 2,
        tasks: [task({ id: 'task-005', status: 'in_progress' })],
      }),
    }]), {
      applied: 0,
      errors: [],
      dropped: ['addPhase: addPhase: task-005 cannot start as in_progress; only the executor may claim active work'],
    });
  });
});

test('a boundary-violating change is dropped while the rest of the packet applies (RA-375)', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'in_progress' }),
        task({ id: 'task-002', status: 'pending' }),
      ],
    }),
  ], (manager) => {
    const result = manager.applyChanges([
      // Boundary violation: planner tries to skip executor-owned active work.
      { action: 'updateTask', taskId: 'task-001', changes: { status: 'pending' } },
      // Valid change in the same packet — must still land.
      { action: 'updateTask', taskId: 'task-002', changes: { description: 'refined scope' } },
    ]);

    assert.equal(result.applied, 1);
    assert.deepEqual(result.errors, []);
    assert.equal(result.dropped.length, 1);
    // Executor-owned task untouched; valid sibling change applied.
    assert.equal(manager.findTask('task-001')?.status, 'in_progress');
    assert.equal(manager.findTask('task-002')?.description, 'refined scope');
  });
});

test('planner-created plans and deferred expansions cannot pre-claim active work', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-plan-manager-'));
  try {
    const manager = new PlanManager(workDir);

    assert.throws(() => manager.createPlan('spec.md', [
      phase({
        id: 'phase-1',
        tasks: [task({ id: 'task-001', status: 'in_progress' })],
      }),
    ], [], 'goal'), /createPlan: task-001 cannot start as in_progress/);

    manager.createPlan('spec.md', [
      phase({
        id: 'phase-1',
        planLater: true,
        tasks: [],
      }),
    ], [], 'goal');

    assert.throws(() => manager.expandPlanLaterPhase('phase-1', [
      task({ id: 'task-002', status: 'in_progress' }),
    ]), /expandPlanLaterPhase: task-002 cannot start as in_progress/);
  } finally {
    await fs.remove(workDir);
  }
});

test('updateTask can reset failed rewritten work to pending without terminalizing it', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'failed' }),
      ],
    }),
  ], (manager) => {
    manager.updateTask('task-001', {
      status: 'pending',
      description: 'Retry with narrowed scope',
    });

    const updated = manager.findTask('task-001')!;
    assert.equal(updated.status, 'pending');
    assert.equal(updated.description, 'Retry with narrowed scope');
  });
});

test('updateTask can attach executor role-pass requirements to open work', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'pending' }),
      ],
    }),
  ], (manager) => {
    manager.updateTask('task-001', {
      requiredRolePasses: ['product', 'ux'],
    });

    assert.deepEqual(manager.findTask('task-001')?.requiredRolePasses, ['product', 'ux']);
  });
});

test('applyChanges rejects a packet atomically when its final dependency graph is invalid', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'pending', description: 'original task' }),
        task({ id: 'task-002', status: 'pending' }),
      ],
    }),
  ], (manager) => {
    const result = manager.applyChanges([
      {
        action: 'updateTask',
        taskId: 'task-001',
        changes: { description: 'must not persist alone' },
      },
      {
        action: 'updateTask',
        taskId: 'task-002',
        changes: { dependencies: ['task-333'] },
      },
    ]);

    assert.deepEqual(result, {
      applied: 0,
      errors: ['Plan dependency error: task-002 depends on missing task task-333'],
      dropped: [],
    });
    assert.equal(manager.findTask('task-001')?.description, 'original task');
    assert.deepEqual(manager.findTask('task-002')?.dependencies, []);
  });
});

test('applyChanges rejects cyclic dependencies without retaining the packet', async () => {
  await withPlan([
    phase({
      id: 'phase-1',
      tasks: [
        task({ id: 'task-001', status: 'pending' }),
        task({ id: 'task-002', status: 'pending' }),
      ],
    }),
  ], (manager) => {
    const result = manager.applyChanges([
      {
        action: 'updateTask',
        taskId: 'task-001',
        changes: { dependencies: ['task-002'] },
      },
      {
        action: 'updateTask',
        taskId: 'task-002',
        changes: { dependencies: ['task-001'] },
      },
    ]);

    assert.deepEqual(result, {
      applied: 0,
      errors: ['Plan dependency error: cycle includes task-001'],
      dropped: [],
    });
    assert.deepEqual(manager.findTask('task-001')?.dependencies, []);
    assert.deepEqual(manager.findTask('task-002')?.dependencies, []);
  });
});
