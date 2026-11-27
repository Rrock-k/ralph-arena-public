import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execa } from 'execa';
import type { AgentOptions } from '../agents/base.js';
import { buildProviderSessionTaskFingerprint } from '../agents/provider-session-checkpoint.js';
import type { AgentResult } from '../config/types.js';
import {
  EXECUTOR_PROJECT_TASK_GENERATED_PROMPT_FIXTURE_FILE,
  EXECUTOR_PROJECT_TASK_GENERATED_TASK_FIXTURE_FILE,
  EXECUTOR_PROJECT_TASK_REPORT_FILE,
  EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION,
  type ExecutorProjectTaskAgent,
  runExecutorProjectTask,
} from './executor-project-task.js';
import { EXECUTOR_TASK_WORKSPACE_REPORT_FILE } from './executor-task-workspace.js';
import { runExecutorWorkspaceSourceSnapshot } from './executor-workspace-source-snapshot.js';

test('executor_project_task delegates pending snapshot task to executor_task_workspace in a fork workspace', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let capturedPrompt = '';

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath,
      sourceRef,
      providerSessions: {
        status: 'ready',
        selectedTaskSessionCount: 1,
        selectedTaskSessions: [providerSession()],
      },
    }),
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async (options) => {
      capturedPrompt = options.prompt;
      assert.equal(options.workDir, workDir);
      assert.equal(options.model, 'test-model');
      assert.equal(options.timeout, 3);
      assert.equal(options.verbose, false);
      assert.equal(options.providerSessionResumeId, undefined);
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "manual stage";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  const report = JSON.parse(await readFile(path.join(outDir, EXECUTOR_PROJECT_TASK_REPORT_FILE), 'utf8'));
  const generatedTask = JSON.parse(await readFile(path.join(outDir, EXECUTOR_PROJECT_TASK_GENERATED_TASK_FIXTURE_FILE), 'utf8'));
  const generatedPromptFixture = JSON.parse(await readFile(path.join(outDir, EXECUTOR_PROJECT_TASK_GENERATED_PROMPT_FIXTURE_FILE), 'utf8'));
  await access(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE));
  const snapshotOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-source-snapshot-out-'));
  const sourceSnapshotResult = await runExecutorWorkspaceSourceSnapshot({
    executorWorkspaceReportPath: result.output.delegatedWorkspaceReportPath,
    workDir,
    sourceRef,
    outDir: snapshotOutDir,
    commitMessage: 'snapshot executor project task workspace',
    projectId: result.input.projectId,
  });

  assert.equal(result.schemaVersion, EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'completed');
  assert.equal(result.stage.adapterFor, 'executor_task_workspace');
  assert(result.stage.forbiddenMutations.includes('.ralph/tasks/'));
  assert.equal(result.input.projectId, 'project-stook');
  assert.equal(result.input.selectedTaskId, 'task-001');
  assert.equal(result.prepared?.taskId, 'task-001');
  assert.equal(result.prepared?.visualEvidenceMode, 'required');
  assert.equal(result.prepared?.providerSessionResume, null);
  assert.equal(result.output.generatedTaskFixturePath, path.join(outDir, EXECUTOR_PROJECT_TASK_GENERATED_TASK_FIXTURE_FILE));
  assert.equal(result.output.generatedPromptFixturePath, path.join(outDir, EXECUTOR_PROJECT_TASK_GENERATED_PROMPT_FIXTURE_FILE));
  assert.equal(result.workspaceResult?.stage.stageId, 'executor_task_workspace');
  assert.equal(result.workspaceResult?.status, 'completed');
  assert.equal(result.workspaceResult?.executorOutput.ownerBoundary, 'ralph.executor-observer');
  assert.equal(result.workspaceResult?.agent.providerSessionResumeId, null);
  assert.match(capturedPrompt, /Manual Stage Boundary/);
  assert.match(capturedPrompt, /# YOUR CURRENT TASK: task-001/);
  assert.match(capturedPrompt, /## Visual Workbench Coverage/);
  assert.match(capturedPrompt, /DIFF-001/);
  assert.doesNotMatch(capturedPrompt, /Folder: `\.ralph\/tasks\/task-001/);
  assert.equal(report.status, 'completed');
  assert.equal(report.output.generatedTaskFixturePath, result.output.generatedTaskFixturePath);
  assert.equal(generatedTask.id, 'task-001');
  assert.equal(generatedPromptFixture.promptId, 'executor.agentPrompt');
  assert.match(generatedPromptFixture.input.contextSections, /Manual Stage Boundary/);
  assert.match(generatedPromptFixture.input.contextSections, /# References \(read-only\)/);
  assert.match(generatedPromptFixture.input.contextSections, /Full spec: `.*spec\.md`/);
  assert.equal(sourceSnapshotResult.status, 'snapshotted');
  assert.equal(sourceSnapshotResult.arenaReadback.projectId, 'project-stook');
  assert.equal(sourceSnapshotResult.arenaReadback.projectIdSource, 'operator_input');
  assert.equal(sourceSnapshotResult.executorReport.path, result.output.delegatedWorkspaceReportPath);
  assert.match(sourceSnapshotResult.nextCommands.visualWorkbenchEvidenceChainReadiness ?? '', /--project-id project-stook/);
});

test('executor_project_task uses project visualEvidenceMode for structured visual tasks', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath,
      sourceRef,
      visualEvidenceMode: 'required',
      visualEvidenceRequired: false,
      requiredRolePasses: ['ux'],
    }),
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "required visual";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  const generatedPromptFixture = JSON.parse(await readFile(path.join(outDir, EXECUTOR_PROJECT_TASK_GENERATED_PROMPT_FIXTURE_FILE), 'utf8'));

  assert.equal(result.status, 'completed');
  assert.equal(result.prepared?.visualEvidenceMode, 'required');
  assert.match(generatedPromptFixture.input.contextSections, /## Visual Workbench Coverage/);
});

test('executor_project_task keeps new_tasks_only mode when task is explicitly visual-marked', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath,
      sourceRef,
      visualEvidenceMode: 'new_tasks_only',
      visualEvidenceRequired: true,
      requiredRolePasses: [],
      feedbackItemRefs: [],
    }),
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "new task visual";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.prepared?.visualEvidenceMode, 'new_tasks_only');
});

test('executor_project_task blocks when project visual evidence policy is not readable', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: {
      ...baseSnapshot({ liveWorkspacePath, sourceRef }),
      visualEvidencePolicy: {
        owner: 'governance.runner-init-readiness.ralphConfig',
        status: 'unavailable',
        visualEvidenceMode: null,
        blockers: ['runner_init_ralph_config_unavailable'],
        notes: [],
      },
    },
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'visual_evidence_policy_not_ready');
  assert.equal(result.prepared, null);
  assert.equal(result.output.generatedPromptFixturePath, null);
});

test('executor_project_task live_workspace_action uses live snapshot workspace and creates local project commit', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-out-'));
  let capturedPrompt = '';

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath: workDir,
      sourceRef,
      providerSessions: {
        status: 'ready',
        selectedTaskSessionCount: 1,
        selectedTaskSessions: [providerSession({
          outcome: 'error',
          errorCategory: 'agent_failed',
        })],
      },
    }),
    mode: 'new_task',
    workspaceMode: 'live_workspace_action',
    completionPromise: 'TASK_COMPLETE',
    outDir,
    agent: testAgent(async (options) => {
      capturedPrompt = options.prompt;
      assert.equal(options.workDir, workDir);
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "live action";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  const afterHead = await git(workDir, 'rev-parse', 'HEAD');
  const subject = await git(workDir, 'log', '-1', '--format=%s');
  const body = await git(workDir, 'log', '-1', '--format=%b');
  const status = await git(workDir, 'status', '--porcelain', '-uall');

  assert.equal(result.status, 'completed');
  assert.equal(result.input.workspaceMode, 'live_workspace_action');
  assert.equal(result.input.workDir, workDir);
  assert.equal(result.input.sourceRef, sourceRef);
  assert.equal(result.workspaceResult?.source.headBefore, sourceRef);
  assert.equal(result.workspaceResult?.source.headAfter, sourceRef);
  assert.equal(result.projectCommit?.status, 'committed');
  assert.equal(result.projectCommit?.beforeCommit, sourceRef);
  assert.equal(result.projectCommit?.afterCommit, afterHead);
  assert.notEqual(afterHead, sourceRef);
  assert.equal(result.visualWorkbenchHandoffGate.status, 'ready_for_selector_readiness');
  assert.equal(result.visualWorkbenchHandoffGate.nextStageId, 'visual_workbench_selector_readiness');
  assert.equal(result.visualWorkbenchHandoffGate.sourceRef, afterHead);
  assert.deepEqual(result.visualWorkbenchHandoffGate.commandInputValues, {
    '<project-source-workspace>': workDir,
    '<taskId>': 'task-001',
  });
  assert.equal(subject, 'executor task-001: Add synth pad story');
  assert.match(body, /workspaceMode: live_workspace_action/);
  assert.match(body, /stage: executor_project_task/);
  assert.doesNotMatch(subject, /RA-356/);
  assert.doesNotMatch(body, /RA-356/);
  assert.equal(status, '');
  assert.match(capturedPrompt, /explicit live project workspace/);
  assert.match(capturedPrompt, /The adapter owns any local project commit after a successful run/);
});

test('executor_project_task live_workspace_action uses shared git policy for excluded generated files', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-out-'));
  const generatedSnapshotPath = path.join(workDir, 'generated', 'visual-responsive-snapshots', 'mobile.png');

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath: workDir,
      sourceRef,
      providerSessions: {
        status: 'ready',
        selectedTaskSessionCount: 1,
        selectedTaskSessions: [providerSession()],
      },
    }),
    mode: 'new_task',
    workspaceMode: 'live_workspace_action',
    completionPromise: 'TASK_COMPLETE',
    outDir,
    agent: testAgent(async (options) => {
      assert.equal(options.workDir, workDir);
      await mkdir(path.dirname(generatedSnapshotPath), { recursive: true });
      await writeFile(generatedSnapshotPath, 'generated snapshot\n', 'utf8');
      return agentResult({
        filesChanged: ['generated/visual-responsive-snapshots/mobile.png'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  const afterHead = await git(workDir, 'rev-parse', 'HEAD');
  const status = await git(workDir, 'status', '--porcelain', '-uall');

  assert.equal(result.status, 'completed');
  assert.equal(result.projectCommit?.status, 'blocked');
  assert.equal(result.visualWorkbenchHandoffGate.status, 'blocked');
  assert.equal(result.visualWorkbenchHandoffGate.reason, 'selected_source_output_missing');
  assert.equal(result.projectCommit?.error?.code, 'git_policy_no_changes');
  assert.equal(result.projectCommit?.beforeCommit, sourceRef);
  assert.equal(result.projectCommit?.afterCommit, null);
  assert.deepEqual(result.projectCommit?.afterGitStatus, []);
  assert.equal(afterHead, sourceRef);
  assert.equal(status, '');
  assert.equal(await pathExists(generatedSnapshotPath), false);
});

test('executor_project_task visual handoff blocks without accepted diff identity', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-out-'));

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath: workDir,
      sourceRef,
      feedbackItemRefs: [{
        itemId: 'DIFF-001',
        diffItemId: null,
        workSurface: 'frontend',
        workImpact: 'requires_loop_work',
        summary: 'Add visible synth pad playing state.',
      }],
    }),
    mode: 'new_task',
    workspaceMode: 'live_workspace_action',
    completionPromise: 'TASK_COMPLETE',
    outDir,
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "missing diff ref";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.projectCommit?.status, 'committed');
  assert.equal(result.visualWorkbenchHandoffGate.status, 'blocked');
  assert.equal(result.visualWorkbenchHandoffGate.reason, 'accepted_diff_identity_missing');
  assert(result.visualWorkbenchHandoffGate.blockers.includes('accepted_diff_identity_missing'));
  assert.deepEqual(result.visualWorkbenchHandoffGate.acceptedDiffRefs, []);
});

test('executor_project_task visual handoff is not applicable outside ordinary web projects', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-out-'));

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath: workDir,
      sourceRef,
      visualWorkbenchManifestReadiness: {
        projectClass: 'roblox',
      },
    }),
    mode: 'new_task',
    workspaceMode: 'live_workspace_action',
    completionPromise: 'TASK_COMPLETE',
    outDir,
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "non-web";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.visualWorkbenchHandoffGate.status, 'not_applicable');
  assert.equal(result.visualWorkbenchHandoffGate.reason, 'non_ordinary_web_project');
  assert.equal(result.visualWorkbenchHandoffGate.nextStageId, null);
});

test('executor_project_task delegates failed snapshot task with last error in failed_task mode', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let capturedPrompt = '';

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath,
      sourceRef,
      taskStatus: 'failed',
      attempts: 2,
      lastError: 'Previous executor run missed the release affordance.',
      providerSessions: {
        status: 'ready',
        selectedTaskSessionCount: 1,
        selectedTaskSessions: [providerSession()],
      },
    }),
    mode: 'failed_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async (options) => {
      capturedPrompt = options.prompt;
      assert.equal(options.providerSessionResumeId, undefined);
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "fixed";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.input.mode, 'failed_task');
  assert.equal(result.input.selectedTaskStatus, 'failed');
  assert.equal(result.prepared?.providerSessionResume, null);
  assert.equal(result.workspaceResult?.status, 'completed');
  assert.equal(result.workspaceResult?.agent.providerSessionResumeId, null);
  assert.match(capturedPrompt, /# YOUR CURRENT TASK: task-001 \(iteration 3, attempt 2\)/);
  assert.match(capturedPrompt, /## Last Error\nPrevious executor run missed the release affordance\./);
  await access(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE));
});

test('executor_project_task delegates in-progress snapshot task with provider session in resume_interrupted mode', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let capturedPrompt = '';

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath,
      sourceRef,
      taskStatus: 'in_progress',
      attempts: 3,
      providerSessions: {
        status: 'ready',
        selectedTaskSessionCount: 1,
        selectedTaskSessions: [providerSession({
          outcome: 'error',
          errorCategory: 'agent_failed',
        })],
      },
    }),
    mode: 'resume_interrupted',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async (options) => {
      capturedPrompt = options.prompt;
      assert.equal(options.providerSessionResumeId, 'session-task-001');
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "resumed";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
        providerSession: {
          id: 'session-task-001',
          resumedFrom: 'session-task-001',
        },
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.input.mode, 'resume_interrupted');
  assert.equal(result.input.selectedTaskStatus, 'in_progress');
  assert.equal(result.input.providerSessionStatus, 'ready');
  assert.equal(result.prepared?.providerSessionResume?.sessionId, 'session-task-001');
  assert.equal(result.workspaceResult?.agent.providerSessionResumeId, 'session-task-001');
  assert.equal(result.workspaceResult?.agent.providerSessionResumedFrom, 'session-task-001');
  assert.match(capturedPrompt, /Active WIP Reconciliation/);
  assert.match(capturedPrompt, /# YOUR CURRENT TASK: task-001 \(iteration 4, attempt 3\)/);
  await access(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE));
});

test('executor_project_task blocks resume_interrupted when matching provider session already succeeded', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath,
      sourceRef,
      taskStatus: 'in_progress',
      providerSessions: {
        status: 'ready',
        selectedTaskSessionCount: 1,
        selectedTaskSessions: [providerSession({
          outcome: 'success',
          errorCategory: null,
        })],
      },
    }),
    mode: 'resume_interrupted',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'provider_session_not_found');
  assert.match(result.error?.message ?? '', /matching failed provider session/);
  assert.equal(result.prepared, null);
  assert.equal(result.workspaceResult, null);
  assert.equal(result.output.generatedTaskFixturePath, null);
  assert.equal(result.output.generatedPromptFixturePath, null);
  assert.equal(await pathExists(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE)), false);
});

test('executor_project_task blocks resume_interrupted without matching provider session before calling agent', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath,
      sourceRef,
      taskStatus: 'in_progress',
      providerSessions: {
        status: 'ready',
        selectedTaskSessionCount: 0,
        selectedTaskSessions: [],
      },
    }),
    mode: 'resume_interrupted',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'provider_session_not_found');
  assert.equal(result.workspaceResult, null);
  assert.equal(result.output.generatedTaskFixturePath, null);
  assert.equal(result.output.generatedPromptFixturePath, null);
  assert.equal(await pathExists(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE)), false);
});

test('executor_project_task blocks pending selected task in resume_interrupted mode before calling agent', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({
      liveWorkspacePath,
      sourceRef,
      taskStatus: 'pending',
      providerSessions: {
        status: 'ready',
        selectedTaskSessionCount: 1,
        selectedTaskSessions: [providerSession()],
      },
    }),
    mode: 'resume_interrupted',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'selected_task_not_resume_interrupted');
  assert.equal(result.workspaceResult, null);
});

test('executor_project_task blocks completed selected task before calling agent', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef, taskStatus: 'completed' }),
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'selected_task_not_new_task');
  assert.equal(result.workspaceResult, null);
  assert.equal(await pathExists(path.join(outDir, EXECUTOR_PROJECT_TASK_REPORT_FILE)), true);
  assert.equal(await pathExists(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE)), false);
});

test('executor_project_task blocks pending selected task in failed_task mode before calling agent', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef, taskStatus: 'pending' }),
    mode: 'failed_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'selected_task_not_failed_task');
  assert.equal(result.workspaceResult, null);
  assert.equal(await pathExists(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE)), false);
});

test('executor_project_task rejects using the live snapshot workspace as fork workDir', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({ liveWorkspacePath: workDir, sourceRef }),
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'live_workspace_forbidden');
  assert.equal(result.workspaceResult, null);
});

test('executor_project_task blocks when snapshot live workspace path is missing', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({ liveWorkspacePath: null, sourceRef }),
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'source_workspace_path_unavailable');
  assert.equal(result.workspaceResult, null);
});

test('executor_project_task requires sourceRef to equal snapshot source commit', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef }),
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef: 'HEAD',
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'source_ref_not_snapshot_commit');
  assert.equal(result.input.snapshotSourceRef, sourceRef);
});

test('executor_project_task blocks snapshot without plan specFile before calling agent', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-out-'));
  let called = false;

  const result = await runExecutorProjectTask({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef, specFile: null }),
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir,
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'spec_file_unavailable');
  assert.equal(result.workspaceResult, null);
  assert.equal(result.output.generatedPromptFixturePath, null);
});

async function createGitWorkspace(): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'executor-project-task-src-'));
  await mkdir(path.join(workDir, 'src', 'components'), { recursive: true });
  await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "idle";\n', 'utf8');
  await git(workDir, 'init');
  await git(workDir, 'config', 'user.email', 'test@example.com');
  await git(workDir, 'config', 'user.name', 'Test User');
  await git(workDir, 'add', '.');
  await git(workDir, 'commit', '-m', 'initial');
  return workDir;
}

function baseSnapshot(input: {
  liveWorkspacePath: string | null;
  sourceRef: string;
  taskStatus?: 'pending' | 'completed' | 'failed' | 'in_progress';
  attempts?: number;
  lastError?: string | null;
  specFile?: string | null;
  feedbackItemRefs?: Array<{
    itemId: string | null;
    diffItemId: string | null;
    workSurface: string | null;
    workImpact: string | null;
    summary: string | null;
  }>;
  visualEvidenceMode?: 'off' | 'required' | 'new_tasks_only';
  visualEvidenceRequired?: boolean | null;
  requiredRolePasses?: string[];
  visualWorkbenchManifestReadiness?: Partial<{
    available: boolean;
    status: 'ready' | 'blocked' | 'unknown' | null;
    canRunWorkbenchCapture: boolean;
    schemaVersion: string | null;
    projectClass: string | null;
    blockers: string[];
    unknowns: string[];
  }>;
  providerSessions?: {
    status: 'ready' | 'missing' | 'invalid' | 'unavailable';
    selectedTaskSessionCount: number | null;
    selectedTaskSessions: Array<ReturnType<typeof providerSession>>;
  };
}) {
  return {
    schemaVersion: 'ra-356.project-stage-snapshot.v1',
    generatedAt: '2026-06-12T13:00:00.000Z',
    projectId: 'project-stook',
    selectedTaskId: 'task-001',
    stageBoundary: {
      ownerBoundary: 'arena-ctl.project-stage-snapshot',
      mode: 'read_only',
      allowed: ['none'],
      forbidden: ['no_provider_call'],
    },
    ownerReads: [],
    project: { id: 'project-stook', name: 'STOOK' },
    lifecycleContext: {},
    source: {
      runnerExpectation: {},
      workspace: {
        available: true,
        unavailableReason: null,
        path: input.liveWorkspacePath,
        exists: true,
        isGitRepo: true,
        originUrl: null,
        branch: 'main',
        commitSha: input.sourceRef,
      },
      workspaceDecision: {},
      gitSyncRisk: {},
      remoteFreshnessChecked: false,
    },
    acceptedArtifactAudit: {
      available: true,
      projectId: 'project-stook',
      projectName: 'STOOK',
      classification: 'current_v1_artifact',
      runnerReady: true,
      storageMode: 'accepted_artifact_v1',
      latestSpec: {
        specId: 'spec-1',
        specVersionId: 'version-1',
        version: 1,
        sourceProjectId: 'tg-spec-1',
        sourceVersion: 1,
        metadataHash: 'hash-1',
      },
      recommendedNextAction: 'no_action',
      allowedActions: ['no_action'],
      why: [],
      operatorNotes: [],
      error: null,
    },
    visualEvidencePolicy: {
      owner: 'governance.runner-init-readiness.ralphConfig',
      status: 'ready',
      visualEvidenceMode: input.visualEvidenceMode ?? 'required',
      blockers: [],
      notes: [`visualEvidenceMode=${input.visualEvidenceMode ?? 'required'}`],
    },
    visualWorkbenchManifestReadiness: {
      available: input.visualWorkbenchManifestReadiness?.available ?? true,
      status: input.visualWorkbenchManifestReadiness?.status ?? 'ready',
      canRunWorkbenchCapture: input.visualWorkbenchManifestReadiness?.canRunWorkbenchCapture ?? true,
      schemaVersion: input.visualWorkbenchManifestReadiness?.schemaVersion ?? 'ra-355.visual-coverage-manifest.v0',
      projectClass: input.visualWorkbenchManifestReadiness?.projectClass ?? 'ordinary_web',
      blockers: input.visualWorkbenchManifestReadiness?.blockers ?? [],
      unknowns: input.visualWorkbenchManifestReadiness?.unknowns ?? [],
    },
    plan: {
      owner: '@arena/ralph-runtime:PlanSchema',
      path: `${input.liveWorkspacePath}/.ralph/plan.json`,
      status: 'ready',
      reasonCode: null,
      schemaOwner: '@arena/ralph-runtime',
      version: 1,
      specFile: input.specFile === undefined ? 'spec.md' : input.specFile,
      specHash: 'spec-hash',
      createdAt: '2026-06-12T12:00:00.000Z',
      updatedAt: '2026-06-12T12:10:00.000Z',
      phaseCount: 1,
      judgmentCount: 0,
      specMigrationCount: 0,
      taskCounts: {
        pending: input.taskStatus === 'pending' || !input.taskStatus ? 1 : 0,
        in_progress: input.taskStatus === 'in_progress' ? 1 : 0,
        completed: input.taskStatus === 'completed' ? 1 : 0,
        failed: input.taskStatus === 'failed' ? 1 : 0,
        skipped: 0,
        unknown: 0,
        total: 1,
      },
      selectedTask: {
        id: 'task-001',
        displayTitle: 'Add synth pad story',
        description: 'Add a SynthPad visual workbench story for the playing state.',
        acceptanceCriteria: ['SynthPad playing state renders through visual-workbench/manifest.json.'],
        status: input.taskStatus ?? 'pending',
        statusSource: 'explicit',
        attempts: input.attempts ?? 0,
        lastError: input.lastError ?? null,
        requiredRolePasses: input.requiredRolePasses ?? ['ux'],
        visualEvidenceRequired: input.visualEvidenceRequired ?? true,
        feedbackItemRefs: input.feedbackItemRefs ?? [{
          itemId: 'DIFF-001',
          diffItemId: 'DIFF-001',
          workSurface: 'frontend',
          workImpact: 'requires_loop_work',
          summary: 'Add visible synth pad playing state.',
        }],
        verificationEvidence: {
          total: 0,
          screenshot: 0,
          pass: 0,
          fail: 0,
          inconclusive: 0,
        },
      },
      blockers: [],
      warnings: [],
    },
    providerSessions: input.providerSessions ?? {
      owner: '@arena/ralph-runtime:ProviderSessionCheckpointStore',
      path: `${input.liveWorkspacePath}/.ralph/provider-session-checkpoint.json`,
      status: 'missing',
      reasonCode: 'checkpoint_missing',
      sessionCount: null,
      selectedTaskSessionCount: null,
      selectedTaskSessions: [],
      blockers: ['checkpoint_missing'],
      warnings: [],
    },
    nextHandoff: [],
    evidenceNotes: [],
  };
}

function providerSession(overrides: Partial<{
  agent: string;
  model: string | null;
  taskId: string;
  taskFingerprint: string;
  specHash: string | null;
  sessionId: string;
  reason: string;
  outcome: string;
  errorCategory: string | null;
  resumedFrom: string | null;
  resumeFallbackReason: string | null;
  updatedAt: string;
}> = {}) {
  return {
    agent: 'test-injected-agent',
    model: 'test-model',
    taskId: 'task-001',
    taskFingerprint: buildProviderSessionTaskFingerprint({
      taskId: 'task-001',
      taskDescription: 'Add a SynthPad visual workbench story for the playing state.',
    }),
    specHash: 'old-spec-hash',
    sessionId: 'session-task-001',
    reason: 'task_attempt',
    outcome: 'success',
    errorCategory: null,
    resumedFrom: null,
    resumeFallbackReason: null,
    updatedAt: '2026-06-12T12:09:00.000Z',
    ...overrides,
  };
}

function testAgent(execute: (options: AgentOptions) => Promise<AgentResult>): ExecutorProjectTaskAgent {
  return {
    name: 'test-injected-agent',
    execute,
  };
}

function agentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    output: 'Done.\n<promise>TASK_COMPLETE</promise>',
    filesChanged: [],
    completionPromiseFound: true,
    ...overrides,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}
