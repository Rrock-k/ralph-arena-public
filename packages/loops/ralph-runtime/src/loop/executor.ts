import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import { tmpdir } from 'os';
import path from 'path';
import type {
  FeedbackEvidence,
  RalphConfig,
  ProjectConfig,
  Task,
  Phase,
  LoopState,
  VerificationResult,
  AgentResult,
  AgentErrorCategory,
  IterationLog,
  Plan,
  Judgment,
  ControllerReport,
} from '../config/types.js';
import { createAgent, type Agent } from '../agents/index.js';
import { VerificationPipeline } from '../verification/pipeline.js';
import { GitManager, type CommitResult } from '../git/manager.js';
import { GitHubClient } from '../git/github.js';
import { ProgressTracker } from '../memory/progress.js';
import {
  ContextBuilder,
  TASK_WORKSPACE_PLAN_TEMPLATE_HINT,
  getTaskWorkspaceAbsolutePath,
} from '../memory/context.js';
import { LocalDockerDeploy, checkHealthUrl, findFreePort } from '../deploy/local-docker.js';
import { runPostDeployVerification } from '../verification/post-deploy.js';
import { runVisionQA, type VisionQAReport } from '../verification/vision-qa.js';
import { formatActionableCompletion, formatPlanTaskBreakdown, PlanManager } from '../planning/plan-manager.js';
import { Planner, PlannerAgentFailure } from '../planning/planner.js';
import { JudgmentLog } from '../planning/judgments.js';
import {
  applyPendingSpecMigrations as applyPendingSpecMigrationsThroughOwner,
  collectMarkdownFiles,
  hasPendingSpecMigrations as hasPendingSpecMigrationsThroughOwner,
  shouldRecordLegacySingleSpecBootstrap,
} from '../planning/spec-migration-apply.js';
import { Controller, ControllerAuditFailure, type ControllerTrigger } from '../control/controller.js';
import { enforceGitignore } from '../control/gitignore-enforcer.js';
import { validateRuntimeDataContract } from '../control/runtime-data-contract.js';
import { applyQAPlanning } from '../control/qa-planner.js';
import { buildTaskProofExpectations, collectTaskVerificationEvidence } from '../feedback/evidence.js';
import {
  runVisualWorkbenchEvidenceAutomation,
  type VisualWorkbenchEvidenceAutomationResult,
} from '../verification/visual-workbench-automation.js';
import {
  ProviderSessionCheckpointStore,
  buildProviderSessionTaskFingerprint,
  type ProviderSessionCheckpointMatch,
} from '../agents/provider-session-checkpoint.js';
import { log, formatDuration } from '../utils/logger.js';
import { formatTaskLogLabel } from '../utils/task-display.js';
import { ArenaEventManager } from '../arena/events.js';
import { appendPromptModelCallTrace } from '../prompts/runtime-trace.js';
import { runExecutorActionCore, type ExecutorActionCoreResult } from './executor-action-core.js';
import {
  normalizeExecutorChangedFiles,
  parseExecutorGitStatusChangedFiles,
  shouldRunVisualWorkbenchEvidenceAutomationForTask,
} from './executor-observer.js';
import {
  buildExecutorVisualWorkbenchEvidenceCommitMessage,
  commitExecutorTaskIterationSourceChanges,
} from './executor-source-commit.js';
import {
  readExecutorGitStatusLines,
} from './executor-source-evidence.js';

const VISUAL_WORKBENCH_MANIFEST_PATH = 'visual-workbench/manifest.json' as const;
const CONTROLLER_DURABLE_COMMIT_PATHS = [
  '.ralph/plan.json',
  '.ralph/plan-archive.jsonl',
  '.ralph/decisions-log.json',
  '.ralph/ralph-progress.json',
] as const;
const LOOP_DURABLE_STATE_COMMIT_PATHS = [
  '.ralph/plan.json',
  '.ralph/plan-archive.jsonl',
  '.ralph/decisions-log.json',
  '.ralph/ralph-progress.json',
  '.ralph/iteration-log.json',
] as const;

export interface ExecutorOptions {
  workDir: string;
  ralphConfig: RalphConfig;
  projectConfig: ProjectConfig;
  specPath?: string;
  specDirPath?: string;
  githubToken?: string;
}

class FinalizedRunFailure extends Error {
  constructor() {
    super('Run finished in failed state');
    this.name = 'FinalizedRunFailure';
  }
}

export class LoopExecutor {
  private agent: Agent;
  private verification: VerificationPipeline;
  private git: GitManager;
  private github: GitHubClient | null = null;
  private localDocker: LocalDockerDeploy | null = null;
  private progress: ProgressTracker;
  private context: ContextBuilder;
  
  private planManager: PlanManager;
  private planner: Planner;
  private judgmentLog: JudgmentLog;
  private controller: Controller;
  private providerSessionCheckpoints: ProviderSessionCheckpointStore;

  // State
  private terminated = false;
  private state: LoopState = 'initializing';
  private currentTask: Task | null = null;
  private iteration = 0;
  private previousErrors: string[] = [];
  private lastVerification: VerificationResult | null = null;
  private startTime: number = 0;
  private deployAttempts = 0;
  private lastDeployError: string = '';
  private _lastTaskId: string | null = null;
  private consecutiveEmptyCommits = 0;
  private dynamicAppPort: number | null = null;
  private lastVisionReport: VisionQAReport | null = null;
  private iterationHistory: IterationLog[] = [];
  private iterationLogPath: string;
  private visualWorkbenchEvidenceAutomationRunner = runVisualWorkbenchEvidenceAutomation;

  // Controller tracking
  private completedTasksSinceLastControl = 0;
  private consecutiveFailures = 0;
  private consecutiveRateLimits = 0;
  private consecutiveTaskExhaustions = 0;
  private tasksSinceLastSuccess: string[] = [];
  private lastControllerPhaseId: string | null = null;
  private pauseReason: 'manual' | 'budget' | 'rate_limit' | 'infra' | null = null;
  private pauseRetryAt: string | null = null;
  private manualPauseRequested = false;

  private readonly isArenaRuntime: boolean;

  // Arena contract (v1.1+)
  public exitReason: 'success' | 'paused' | 'failed' = 'failed';
  private arenaCapabilities: Set<string> = new Set();
  private arenaEvents: ArenaEventManager;
  
  constructor(private options: ExecutorOptions) {
    const { workDir, ralphConfig, projectConfig, githubToken } = options;
    
    this.agent = createAgent(ralphConfig.agent);
    this.verification = new VerificationPipeline();
    this.git = new GitManager(workDir);
    this.progress = new ProgressTracker(workDir, projectConfig.name);
    this.context = new ContextBuilder();
    this.iterationLogPath = path.join(workDir, '.ralph', 'iteration-log.json');
    
    // Plan-based modules
    this.planManager = new PlanManager(workDir, ralphConfig.planCompaction);
    this.planner = new Planner();
    this.judgmentLog = new JudgmentLog(workDir);
    this.controller = new Controller(workDir);
    this.providerSessionCheckpoints = new ProviderSessionCheckpointStore(workDir);

    this.isArenaRuntime = !!(process.env.ARENA_PROJECT_ID && process.env.ARENA_GOVERNANCE_URL);
    this.arenaEvents = new ArenaEventManager(workDir);
    
    if (githubToken && projectConfig.repository?.url) {
      this.github = new GitHubClient(githubToken, projectConfig.repository.url);
    }
    
    if (projectConfig.deploy?.localDocker?.enabled && this.shouldRunLocalPreviewVerification()) {
      this.localDocker = new LocalDockerDeploy(workDir, {
        composeFile: projectConfig.deploy.localDocker.composeFile ?? 'docker-compose.yml',
        serviceName: projectConfig.deploy.localDocker.serviceName,
      });
    }
    // Auto-detect Docker in initialize() if not configured explicitly
  }
  
  /**
   * Run the main loop
   */
  async run(): Promise<void> {
    this.startTime = Date.now();

    try {
      await this.initialize();

      // RA-247: Long-running loop — work cycle repeats on spec changes
      while (true) {
        // Smart startup: initSpecDrivenMode() may have set state to 'completed'
        if (this.state !== 'completed' && this.state !== 'paused') {
          await this.runExecutionLoop();

          // Final spec-driven pass:
          // 1) optionally run Vision QA, 2) run final controller audit,
          // 3) if controller adds tasks, execute them and repeat.
          if (this.options.ralphConfig.controller.enabled) {
            while ((this.state as string) !== 'failed' && (this.state as string) !== 'paused') {
              if (this.options.ralphConfig.visionQA?.enabled && this.dynamicAppPort) {
                await this.runVisionQA();
              }

              try {
                await this.runController('final');
              } catch (error) {
                if (error instanceof ControllerAuditFailure) {
                  const controllerSummary = error.agentError?.message.trim()
                    || error.message.trim()
                    || this.describeFatalError(error);

                  if (error.agentError?.category === 'rate_limit') {
                    await this.pauseArenaRun('rate_limit', controllerSummary, error.agentError.retryAt ?? null);
                  } else if (error.agentError?.category === 'budget') {
                    await this.pauseArenaRun('budget', controllerSummary);
                  } else if (this.isArenaRuntime && this.isRecoverablePlatformAgentError(error.agentError?.category)) {
                    await this.pauseArenaRun('infra', controllerSummary);
                  } else if (!error.agentError && this.isArenaRuntime) {
                    await this.pauseArenaRun('infra', controllerSummary);
                  } else {
                    log.error(controllerSummary);
                    this.previousErrors = [controllerSummary];
                    this.setState('failed');
                  }
                  break;
                }
                throw error;
              }
              if ((this.state as string) === 'failed' || (this.state as string) === 'paused') break;

              const remaining = await this.selectNextTask();
              if (!remaining) {
                if (this.planManager.hasUnfinishedTasks()) {
                  log.warn('Controller left unfinished tasks but no runnable task — resuming execution loop for replan/unblock before terminal completion');
                  this.setState('context_building');
                  await this.runExecutionLoop();
                  continue;
                }

                if ((this.state as string) !== 'completed') {
                  this.setState('completed');
                }
                break;
              }

              log.info('Controller added new tasks — resuming execution loop');
              this.setState('context_building');
              await this.runExecutionLoop();
            }
          } else if (this.options.ralphConfig.visionQA?.enabled && this.dynamicAppPort) {
            await this.runVisionQA();
          }
        }

        await this.finalize();

        if ((this.state as string) === 'failed') {
          throw new FinalizedRunFailure();
        }
        if ((this.state as string) === 'paused') {
          break;
        }

        // RA-247: Watch for new specs instead of exiting
        const hasNewSpecs = await this.watchForNewSpecs();
        if (!hasNewSpecs) break; // SIGTERM received

        await this.prepareNewCycle();
      }

    } catch (error) {
      if (error instanceof FinalizedRunFailure) {
        throw error;
      }

      const plannerAgentError = error instanceof PlannerAgentFailure ? error.agentError : undefined;
      if (
        plannerAgentError
        && (plannerAgentError.category === 'rate_limit'
          || plannerAgentError.category === 'budget'
          || (this.isArenaRuntime && this.isRecoverablePlatformAgentError(plannerAgentError.category)))
      ) {
        const summary = plannerAgentError.message.trim() || this.describeFatalError(error);
        log.warn(`Fatal planner provider/platform failure — parking arena run instead of failing: ${summary}`);
        if (plannerAgentError.category === 'rate_limit') {
          await this.pauseArenaRun('rate_limit', summary, plannerAgentError.retryAt ?? null);
        } else if (plannerAgentError.category === 'budget') {
          await this.pauseArenaRun('budget', summary);
        } else {
          await this.pauseArenaRun('infra', summary);
        }
        try {
          await this.writeTerminalResult(summary);
        } catch (resultError) {
          log.warn(`Failed to write terminal result: ${resultError}`);
        }
        try {
          await fs.ensureDir(path.join(this.options.workDir, '.ralph'));
          await this.progress.save();
        } catch (progressError) {
          log.warn(`Failed to persist progress after planner pause: ${progressError}`);
        }
        return;
      }

      log.error(`Fatal error: ${error}`);
      this.setState('failed');
      try {
        await this.writeTerminalResult(this.describeFatalError(error));
      } catch (resultError) {
        log.warn(`Failed to write terminal result: ${resultError}`);
      }
      try {
        await fs.ensureDir(path.join(this.options.workDir, '.ralph'));
        await this.progress.save();
      } catch (progressError) {
        log.warn(`Failed to persist progress after fatal error: ${progressError}`);
      }
      throw error;
    }
  }

  private async runExecutionLoop(): Promise<void> {
    while (this.state !== 'completed' && this.state !== 'failed' && this.state !== 'paused') {
      if (this.options.specPath) {
        await this.applyPendingSpecMigrations(this.options.specPath);
        if ((this.state as string) === 'failed' || (this.state as string) === 'paused') break;
      }

      const result = await this.executeIteration();
      if (result !== 'rate_limit' && result !== 'no_work') {
        this.iteration++;
        this.progress.incrementIteration();
        await this.progress.save();
      }
    }
  }

  private async tryEnableLocalDockerDeploy(trigger: 'startup' | 'pre_deploy'): Promise<void> {
    if (this.localDocker) return;
    if (!this.shouldRunLocalPreviewVerification()) {
      if (this.isArenaRuntime && trigger === 'startup') {
        log.info('Arena runtime detected → skipping local in-process deploy; runner owns final preview startup');
      }
      return;
    }

    const composeFile = this.options.projectConfig.deploy?.localDocker?.composeFile ?? 'docker-compose.yml';
    const serviceName = this.options.projectConfig.deploy?.localDocker?.serviceName;

    // Enable deploy if project has a runnable package.json (npm start)
    // or Docker files (Dockerfile + docker-compose.yml)
    const packageJsonPath = path.join(this.options.workDir, 'package.json');
    const hasPackageJson = await fs.pathExists(packageJsonPath);
    const hasDockerfile = await fs.pathExists(path.join(this.options.workDir, 'Dockerfile'));
    const hasCompose = await fs.pathExists(path.join(this.options.workDir, composeFile));

    let hasStartScript = false;
    if (hasPackageJson) {
      try {
        const pkg = await fs.readJSON(packageJsonPath);
        hasStartScript = !!(pkg.scripts?.start || pkg.scripts?.dev);
      } catch { /* ignore */ }
    }

    if (!hasStartScript && !(hasDockerfile && hasCompose)) return;

    this.localDocker = new LocalDockerDeploy(this.options.workDir, {
      composeFile,
      serviceName,
    });

    if (hasStartScript && !hasDockerfile) {
      log.info(`Auto-detected package.json with start script → enabling in-process deploy`);
    } else if (trigger === 'startup') {
      log.info(`Auto-detected Dockerfile + ${composeFile} → enabling Docker deploy`);
    } else {
      log.info(`Detected Docker deploy files during run → enabling local Docker deploy (${composeFile})`);
    }
  }
  
  private async initialize(): Promise<void> {
    log.info('Initializing Ralph Loop...');
    
    // Check agent availability
    const spinner = ora('Checking agent availability...').start();
    const available = await this.agent.isAvailable();
    if (!available) {
      spinner.fail(`Agent ${this.agent.name} is not available`);
      throw new Error(`Agent ${this.agent.name} is not installed or not in PATH`);
    }
    const version = await this.agent.getVersion();
    spinner.succeed(`Agent: ${this.agent.name} (${version})`);
    
    // Initialize git
    await this.git.init();
    
    // Auto-detect Docker files if localDocker wasn't configured explicitly
    await this.tryEnableLocalDockerDeploy('startup');
    
    // Ensure .gitignore has all essential entries
    await enforceGitignore(this.options.workDir);
    
    // Parse arena capabilities
    const capsRaw = process.env.ARENA_CAPABILITIES ?? '';
    this.arenaCapabilities = new Set(capsRaw.split(',').map(c => c.trim()).filter(Boolean));
    if (this.arenaCapabilities.size > 0) {
      log.info(`Arena capabilities: ${[...this.arenaCapabilities].join(', ')}`);
    }

    // Load or create progress
    await this.progress.load();
    
    // Load iteration history
    await this.loadIterationHistory();

    // Recover iteration counter from persisted artifacts when progress file is stale/missing.
    await this.recoverIterationCounter();

    // Load judgment log
    await this.judgmentLog.load();

    // Resolve --spec-dir: combine all .md files into a single spec
    if (this.options.specDirPath && !this.options.specPath) {
      this.options.specPath = await this.resolveSpecDir(this.options.specDirPath);
    }

    await this.initSpecDrivenMode();

    // RA-247: Skip controller if no-work check already marked completed
    if (this.state === 'completed') {
      log.info('No work to do — skipping startup controller');
    } else if (this.options.ralphConfig.controller.enabled) {
      // Startup controller: run e2e enforcer to add missing e2e tasks
      const startupControllerReport = await this.runController('startup');
      if (this.isPaused()) {
        await this.progress.save();
        return;
      }
      this.syncProgressFeaturesFromPlan();
    }
    
    await this.progress.save();
    
    // Kill placeholder server (started by WorkerFactory for instant preview)
    // to free port 3000 for the agent to use during coding
    try {
      const pidFile = '/tmp/placeholder.pid';
      if (await fs.pathExists(pidFile)) {
        const pid = parseInt(await fs.readFile(pidFile, 'utf-8'), 10);
        if (pid > 0) {
          process.kill(pid, 'SIGTERM');
          await fs.remove(pidFile);
          log.info(`Placeholder server stopped (pid ${pid}) — port 3000 freed`);
        }
      }
    } catch {
      // Non-critical — placeholder may already be gone
    }

    this.iteration = this.progress.getProgress().totalIterations + 1;
    if (this.state !== 'completed' && this.state !== 'paused' && this.state !== 'failed') {
      this.setState('context_building');
    }
    log.success('Initialization complete');
  }

  /**
   * Spec-driven mode: plan from spec (or resume existing plan).
   */
  private async initSpecDrivenMode(): Promise<void> {
    const specPath = this.options.specPath!;

    if (!await fs.pathExists(specPath)) {
      throw new Error(`Spec file not found: ${specPath}`);
    }

    log.info('Mode: spec-driven (spec > plan > execute)');
    let createdFreshPlan = false;

    // Check if plan already exists (resume)
    if (await this.planManager.exists()) {
      log.info('Existing plan found - resuming...');
      await this.planManager.load();
      await this.normalizeLegacySpecFilePath();
      log.info(this.planManager.generateSummary());

      // Check if spec changed since last plan
      const currentHash = await this.planManager.computeSpecHash(specPath);
      if (this.planManager.currentPlan.specHash && this.planManager.currentPlan.specHash !== currentHash) {
        log.warn('Spec file has changed since last plan! Consider re-planning.');
      }

      // Backward compatibility: older plans had no spec migration history.
      if (this.planManager.getSpecMigrations().length === 0) {
        const planSpecRel = this.planManager.currentPlan.specFile || path.relative(this.options.workDir, specPath);
        const planSpecAbs = path.join(this.options.workDir, planSpecRel);
        if (
          await fs.pathExists(planSpecAbs)
          && await shouldRecordLegacySingleSpecBootstrap({
            workDir: this.options.workDir,
            specFile: planSpecAbs,
          })
        ) {
          const bootstrapHash = this.planManager.currentPlan.specHash
            || await this.planManager.computeSpecHash(planSpecAbs);
          this.planManager.recordSpecMigration(planSpecRel, bootstrapHash, 'Bootstrap from legacy single-spec plan');
          await this.planManager.save();
        } else if (await fs.pathExists(planSpecAbs)) {
          log.info('Legacy plan bootstrap skipped: accepted artifact has required loop-work and must use structured migration disposition.');
        }
      }

      // Smart startup: if all tasks are done and specs haven't changed, skip work entirely.
      // This handles Turn On / recovery / restart of a completed project — ralph exits
      // immediately so the runner can just hold the preview.
      if (!this.planManager.hasUnfinishedTasks()) {
        const hasPendingSpecs = await this.hasPendingSpecMigrations(specPath);
        if (!hasPendingSpecs) {
          const stats = this.planManager.getStats();
          log.success(`Smart startup: plan complete (${formatPlanTaskBreakdown(stats)}), specs unchanged — nothing to do`);
          this.syncProgressFeaturesFromPlan();
          this.setState('completed');
          return;
        }
        log.info('All tasks done but specs changed — will apply migrations');
      }
    } else {
      // No plan exists. This is either:
      // - Fresh first launch (empty workspace) → plan and work
      // - Relaunch (workspace has code, plan was lost/never saved) → plan and work
      // Without a plan we can't know if work is done, so always proceed to planning.
      // The plan-exists path above handles the "completed, nothing to do" case.

      // Fresh or relaunched project: create plan from spec
      this.setState('planning');
      createdFreshPlan = true;
      await this.planner.createPlan({
        workDir: this.options.workDir,
        specPath,
        projectConfig: this.options.projectConfig,
        agent: this.agent,
        model: this.options.ralphConfig.model,
        verbose: this.options.ralphConfig.verbose,
        visualEvidenceMode: this.options.ralphConfig.visualWorkbench.visualEvidenceMode,
      }, this.planManager, this.judgmentLog);
    }

    // Ensure spec migrations are applied before execution starts.
    await this.applyPendingSpecMigrations(specPath);

    // A first plan is built from inputs the runner just materialized, and the
    // migration path above has nothing pending to apply for it. Deliver those
    // inputs here so accepted specs/assets reach origin even if the first
    // iteration never completes.
    if (createdFreshPlan && !this.isPaused()) {
      await this.commitMaterializedSpecInputs(specPath);
    }

    // QA Planner: inject qa-* tasks for visual/interactive features
    if (this.arenaCapabilities.has('community_qa')) {
      const specContent = await this.loadSpecContent();
      if (specContent) {
        const qaResult = await applyQAPlanning({
          planManager: this.planManager,
          specContent,
          agent: this.agent,
          model: this.options.ralphConfig.model,
          workDir: this.options.workDir,
        });
        if (qaResult.tasksAdded > 0) {
          await this.planManager.save();
          log.info(`QA Planner: added ${qaResult.tasksAdded} task(s): ${qaResult.taskIds.join(', ')}`);
        }
      }
    }

    // Register/sync features from plan
    this.syncProgressFeaturesFromPlan();
  }

  private async normalizeLegacySpecFilePath(): Promise<void> {
    const legacySpecRel = '.ralph/combined-spec.md';
    if (this.planManager.currentPlan.specFile !== legacySpecRel) return;

    const canonicalSpecRel = 'spec.md';
    const canonicalSpecAbs = path.join(this.options.workDir, canonicalSpecRel);
    if (!await fs.pathExists(canonicalSpecAbs)) return;

    this.planManager.currentPlan.specFile = canonicalSpecRel;
    await this.planManager.save();
    log.info(`Normalized legacy plan specFile ${legacySpecRel} → ${canonicalSpecRel}`);
  }

  private syncProgressFeaturesFromPlan(): void {
    this.progress.syncFeatures(this.planManager.getAllTasks().map((task) => ({
      id: task.id,
      category: 'task',
      displayTitle: task.displayTitle,
      description: task.description,
      status: task.status,
      feedbackItemRefs: task.feedbackItemRefs,
      proofExpectations: buildTaskProofExpectations(this.options.projectConfig, task),
      verificationEvidence: task.verificationEvidence ?? [],
    })));
  }

  private async applyPendingSpecMigrations(primarySpecPath: string): Promise<boolean> {
    if (!this.options.ralphConfig.planning.enabled) return false;

    const previousState = this.state;
    const result = await applyPendingSpecMigrationsThroughOwner({
      workDir: this.options.workDir,
      primarySpecPath,
      specDirPath: this.options.specDirPath,
      planningEnabled: this.options.ralphConfig.planning.enabled,
      projectConfig: this.options.projectConfig,
      agent: this.agent,
      model: this.options.ralphConfig.model,
      verbose: this.options.ralphConfig.verbose,
      visualEvidenceMode: this.options.ralphConfig.visualWorkbench.visualEvidenceMode,
      planner: this.planner,
      planManager: this.planManager,
      judgmentLog: this.judgmentLog,
      onBeforePlannerApply: () => this.setState('planning'),
    });

    if (result.plannerAppliedCount > 0) {
      this.syncProgressFeaturesFromPlan();
      await this.progress.save();
    }

    if (result.applied) {
      await this.commitMaterializedSpecInputs(primarySpecPath);
    }

    if ((this.state as string) !== 'failed' && (this.state as string) !== 'paused' && previousState !== 'planning') {
      this.setState(previousState);
    }

    return result.applied;
  }

  private async commitMaterializedSpecInputs(primarySpecPath: string): Promise<boolean> {
    if (!this.options.ralphConfig.autoCommit) return true;

    const paths = await this.collectMaterializedSpecInputCommitPaths(primarySpecPath);
    const commitResult = await this.git.commitPaths(
      'chore: record accepted spec inputs',
      paths,
    );
    if (!commitResult.success) {
      await this.pauseForSourceDeliveryFailure('accepted spec input commit', commitResult.error);
      return false;
    }

    if (commitResult.hash !== 'no-changes' && this.options.ralphConfig.autoPush) {
      const pushResult = await this.pushChanges();
      if (!pushResult.success) {
        await this.pauseForSourceDeliveryFailure('accepted spec input push', pushResult.error);
        return false;
      }
    }

    return true;
  }

  private async collectMaterializedSpecInputCommitPaths(primarySpecPath: string): Promise<string[]> {
    const paths = new Set<string>([...LOOP_DURABLE_STATE_COMMIT_PATHS, '.gitignore']);
    this.addWorkspaceRelativeCommitPath(paths, primarySpecPath);

    const specsDir = this.options.specDirPath
      ? path.resolve(this.options.specDirPath)
      : path.join(this.options.workDir, 'specs');
    this.addWorkspaceRelativeCommitPath(paths, specsDir);

    for (const assetPath of await this.readRunnerManagedAssetCommitPaths()) {
      this.addWorkspaceRelativeCommitPath(paths, path.join(this.options.workDir, assetPath));
    }

    for (const sourcePath of await this.readRunnerMaterializedSourceCommitPaths()) {
      this.addWorkspaceRelativeCommitPath(paths, path.join(this.options.workDir, sourcePath));
    }

    return [...paths];
  }

  private async retryMaterializedSpecInputSourceDeliveryBeforeAgent(primarySpecPath: string): Promise<boolean> {
    const statusLines = await this.readExecutorGitStatusLines();
    if (!statusLines || statusLines.length === 0) return true;

    const changedFiles = normalizeExecutorChangedFiles(
      parseExecutorGitStatusChangedFiles(statusLines),
      'materialized spec input source delivery retry changed files',
    );
    if (changedFiles.length === 0) return true;

    const commitPaths = await this.collectMaterializedSpecInputCommitPaths(primarySpecPath);
    const allChangedFilesAreDeliverable = changedFiles.every((file) => (
      commitPaths.some((commitPath) => this.changedFileMatchesCommitPath(file, commitPath))
    ));
    if (!allChangedFilesAreDeliverable) {
      const undeliverable = changedFiles.filter((file) => (
        !commitPaths.some((commitPath) => this.changedFileMatchesCommitPath(file, commitPath))
      ));
      log.warn(
        'Skipping accepted spec input source delivery: pre-existing changed files are not '
        + `platform-deliverable: ${undeliverable.join(', ')}. `
        + 'Runner-materialized product source must be declared in .arena/materialized-source.json.',
      );
      return true;
    }

    const hasMaterializedInputChange = changedFiles.some((file) => (
      !LOOP_DURABLE_STATE_COMMIT_PATHS.includes(file as typeof LOOP_DURABLE_STATE_COMMIT_PATHS[number])
      && commitPaths.some((commitPath) => this.changedFileMatchesCommitPath(file, commitPath))
    ));
    if (!hasMaterializedInputChange) return true;

    log.info(`Retrying accepted spec input source delivery before executor: ${changedFiles.join(', ')}`);
    return this.commitMaterializedSpecInputs(primarySpecPath);
  }

  private changedFileMatchesCommitPath(file: string, commitPath: string): boolean {
    const normalizedCommitPath = commitPath.replaceAll(path.sep, '/').replace(/\/+$/, '');
    return file === normalizedCommitPath || file.startsWith(`${normalizedCommitPath}/`);
  }

  private addWorkspaceRelativeCommitPath(paths: Set<string>, absoluteOrRelativePath: string): void {
    const absolute = path.isAbsolute(absoluteOrRelativePath)
      ? path.resolve(absoluteOrRelativePath)
      : path.resolve(this.options.workDir, absoluteOrRelativePath);
    const root = path.resolve(this.options.workDir);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return;
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    if (!relative || relative.startsWith('..')) return;
    paths.add(relative);
  }

  private async readRunnerManagedAssetCommitPaths(): Promise<string[]> {
    const manifestPath = path.join(this.options.workDir, '.arena', 'assets-manifest.json');
    if (!await fs.pathExists(manifestPath)) return [];

    try {
      const manifest = await fs.readJSON(manifestPath);
      if (!manifest) return [];

      const materializedPaths = Array.isArray(manifest.assets)
        ? manifest.assets.map((asset: unknown) => {
          if (!asset || typeof asset !== 'object') return null;
          const candidate = (asset as { path?: unknown }).path;
          return typeof candidate === 'string' ? candidate : null;
        })
        : [];
      // Assets the accepted manifest dropped are deleted from the workspace by
      // the runner, which declares them here. Undelivered, that deletion stays
      // uncommitted and reads as ambiguous pre-existing source forever.
      const retiredPaths = Array.isArray(manifest.retiredPaths) ? manifest.retiredPaths : [];

      return [...materializedPaths, ...retiredPaths]
        .filter((assetPath: unknown): assetPath is string => (
          typeof assetPath === 'string'
          && assetPath.startsWith('assets/')
          && !assetPath.startsWith('/')
          && !assetPath.split(/[\\/]+/).includes('..')
        ));
    } catch (error: any) {
      log.warn(`Could not read runner asset manifest for source delivery: ${error?.message ?? String(error)}`);
      return [];
    }
  }

  /**
   * Product-source paths the runner declares it materialized (e.g. the platform
   * contract stamp in CLAUDE.md). Without this declaration those files look like
   * ambiguous pre-existing source and block the pre-agent source evidence guard.
   */
  private async readRunnerMaterializedSourceCommitPaths(): Promise<string[]> {
    const manifestPath = path.join(this.options.workDir, '.arena', 'materialized-source.json');
    if (!await fs.pathExists(manifestPath)) return [];

    try {
      const manifest = await fs.readJSON(manifestPath);
      if (!manifest || !Array.isArray(manifest.paths)) return [];

      return manifest.paths.filter((candidate: unknown): candidate is string => (
        typeof candidate === 'string'
        && !!candidate
        && !candidate.startsWith('/')
        && !candidate.split(/[\\/]+/).includes('..')
        && !candidate.startsWith('.arena/')
        && !candidate.startsWith('.ralph/')
        && !candidate.startsWith('.git/')
      ));
    } catch (error: any) {
      log.warn(`Could not read runner materialized source manifest for source delivery: ${error?.message ?? String(error)}`);
      return [];
    }
  }

  /**
   * Resolve --spec-dir to a combined spec file.
   * Uses the canonical workDir/spec.md when available; otherwise synthesizes it there.
   */
  private async resolveSpecDir(specDirPath: string): Promise<string> {
    const dir = path.resolve(specDirPath);
    if (!await fs.pathExists(dir)) {
      throw new Error(`Spec directory not found: ${dir}`);
    }

    const mdFiles = await collectMarkdownFiles(dir);
    if (mdFiles.length === 0) {
      throw new Error(`No .md files found in spec directory: ${dir}`);
    }

    const parts: string[] = [];
    for (const file of mdFiles) {
      const content = await fs.readFile(file, 'utf-8');
      parts.push(`<!-- spec: ${path.basename(file)} -->\n${content}`);
    }

    const canonicalSpecPath = path.join(this.options.workDir, 'spec.md');
    if (!await fs.pathExists(canonicalSpecPath)) {
      await fs.writeFile(canonicalSpecPath, parts.join('\n\n---\n\n'));
      log.info(`Combined ${mdFiles.length} specs from ${dir} → ${canonicalSpecPath}`);
    } else {
      log.info(`Using canonical spec file ${canonicalSpecPath} for spec-dir ${dir}`);
    }
    return canonicalSpecPath;
  }

  /**
   * Check if any spec files have changed since the last migration was recorded.
   * Used by smart startup to decide if completed plans need re-work.
   */
  private async hasPendingSpecMigrations(primarySpecPath: string): Promise<boolean> {
    return hasPendingSpecMigrationsThroughOwner({
      workDir: this.options.workDir,
      primarySpecPath,
      specDirPath: this.options.specDirPath,
      planManager: this.planManager,
    });
  }

  /**
   * Execute one loop iteration.
   * Returns:
   * - 'success': iteration finished normally
   * - 'error': iteration failed (will retry if allowed)
   * - 'rate_limit': rate limit hit (sleep happened, iteration NOT incremented)
   * - 'no_work': agent couldn't run at all (auth/infra) — iteration NOT incremented
   */
  private async executeIteration(): Promise<'success' | 'error' | 'rate_limit' | 'no_work'> {
    // Check max iterations
    if (this.options.ralphConfig.maxIterations &&
        this.iteration > this.options.ralphConfig.maxIterations) {
      log.warn(`Max iterations (${this.options.ralphConfig.maxIterations}) reached`);
      this.setState('completed');
      return 'success';
    }

    // 1. Select task
    this.currentTask = await this.selectNextTask();
    log.iteration(this.iteration, this.currentTask?.id);
    this.setState('context_building');
    
    if (!this.currentTask) {
      // Check if a planLater phase is ready for expansion
      const deferredPhase = this.planManager.getNextPlanLaterPhase();
      if (deferredPhase) {
        log.info(`Phase ${deferredPhase.id} ("${deferredPhase.name}") is planLater — expanding with planner...`);
        await this.expandDeferredPhase(deferredPhase);
        this.currentTask = await this.selectNextTask();
        if (this.currentTask) {
          log.info(`Deferred planning produced task: ${formatTaskLogLabel(this.currentTask)}`);
          // Fall through to continue iteration with this task
        }
      }
    }

    if (!this.currentTask) {
      const hasUnfinished = this.planManager.hasUnfinishedTasks();

      if (hasUnfinished) {
        // Try controller replan before giving up
        if (this.options.ralphConfig.controller.enabled) {
          log.warn('No runnable tasks — triggering controller replan to unblock...');
          await this.runController('replan');
          if (this.isPaused()) return 'no_work';

          // Check again after replan
          const nextAfterReplan = await this.selectNextTask();
          if (nextAfterReplan) {
            log.info(`Replan unblocked task: ${formatTaskLogLabel(nextAfterReplan)}`);
            this.currentTask = nextAfterReplan;
            // Fall through to continue iteration with this task
          } else {
            log.error('No runnable tasks even after replan — giving up');
            this.setState('failed');
            return 'error';
          }
        } else {
          log.error('No runnable tasks found, but unfinished tasks remain (failed or blocked by dependencies)');
          this.setState('failed');
          return 'error';
        }
      }

      // Guard: if zero tasks actually completed (all were skipped), treat as failure.
      const hasAnyCompleted = this.planManager.getStats().completedTasks > 0;

      if (!hasAnyCompleted) {
        log.error('All tasks were skipped — no tasks completed successfully');
        this.setState('failed');
        return 'error';
      }

      log.success('All tasks completed!');
      this.setState('completed');
      return 'success';
    }

    const phase = this.planManager.findTaskPhase(this.currentTask.id);
    if (phase) this.planManager.markPhaseInProgress(phase.id);
    const isResumingActiveWip = await this.shouldResumeActiveWipForCurrentTask(this.currentTask.status);
    
    log.info(`Working on ${formatTaskLogLabel(this.currentTask)}:`);
    console.log('');
    console.log(this.currentTask.description);
    console.log('');

    // Reset per-task counters when switching to a different task
    if (!this._lastTaskId || this._lastTaskId !== this.currentTask.id) {
      this.deployAttempts = 0;
      this.lastDeployError = '';
      this.consecutiveEmptyCommits = 0;
      this._lastTaskId = this.currentTask.id;
    }

    this.currentTask.status = 'in_progress';
    this.progress.setCurrentTask(this.currentTask.id);
    this.progress.updateFeature(this.currentTask.id, { status: 'in_progress' });
    this.savePlanState();

    if (this.options.specPath) {
      const sourceDeliveryReady = await this.retryMaterializedSpecInputSourceDeliveryBeforeAgent(this.options.specPath);
      if (!sourceDeliveryReady || this.isPaused()) return 'no_work';
    }
    
    // 2. Build context
    const qaFeedback = this.arenaCapabilities.has('community_qa')
      ? await this.arenaEvents.formatTestFeedback()
      : null;

    const contextSections = await this.context.build({
      workDir: this.options.workDir,
      task: this.currentTask,
      previousErrors: this.previousErrors,
      verificationResult: this.lastVerification || undefined,
      iteration: this.iteration,
      completionPromise: this.options.ralphConfig.completionPromise,
      iterationHistory: this.getTaskHistory(this.currentTask.id),
      specPath: this.options.specPath!,
      projectGoal: this.planManager.getProjectGoal(),
      planSummary: this.planManager.generateSummary(),
      activeWipReconciliation: isResumingActiveWip,
      visualEvidenceMode: this.options.ralphConfig.visualWorkbench.visualEvidenceMode,
      iterationTimeoutMinutes: this.options.ralphConfig.iterationTimeoutMinutes,
      // Arena QA feedback
      qaFeedback: qaFeedback ?? undefined,
    });
    // 3. Execute agent
    this.setState('coding');
    const executorActionCoreResult = await this.runExecutorActionCoreForCurrentTask(contextSections, {
      allowActiveWipWorkspaceResume: isResumingActiveWip,
      allowSpecHashMismatch: isResumingActiveWip,
      allowProviderSessionResume: isResumingActiveWip,
    });
    if (executorActionCoreResult.status === 'blocked_before_agent') {
      return this.pauseForSourceDeliveryFailure(
        'pre-agent source evidence check',
        executorActionCoreResult.error.message,
        { currentTaskStatusOnPause: 'pending' },
      );
    }
    const terminatedAfterAgent = this.stopIfTerminated('agent execution');
    if (terminatedAfterAgent) return terminatedAfterAgent;
    const agentResult = executorActionCoreResult.agentResult;
    const executorObservation = executorActionCoreResult.actionObservation.observation;
    const executorMutationOutcome = executorActionCoreResult.mutationOutcome;
    const executorOutput = executorActionCoreResult.executorOutput;
    if (executorMutationOutcome.status === 'forbidden_mutation') {
      const failureSummary = executorMutationOutcome.error?.message ?? 'Executor changed forbidden runner/loop/proof/lifecycle paths.';
      this.consecutiveFailures++;
      log.error(`Executor mutation guard failed: ${failureSummary}`);
      await this.recordIteration(agentResult, 'error', [failureSummary.slice(0, 500)], executorOutput);
      this.previousErrors = [
        `${failureSummary} Only edit product source files for this task; do not edit runner/loop/proof/lifecycle truth files.`,
      ];
      if (this.currentTask) {
        this.currentTask.status = 'failed';
        this.currentTask.attempts++;
        this.currentTask.lastError = failureSummary.slice(0, 4000);
        this.progress.updateFeature(this.currentTask.id, { status: 'failed' });
        this.savePlanState();
      }
      this.setState('failed');
      return 'error';
    }
    
    // 3.5. Handle agent-level failures (rate limits, crashes) before verification
    if (!agentResult.success) {
      if (agentResult.error?.category === 'budget') {
        return this.pauseArenaRun('budget', agentResult.error.message);
      }

      if (agentResult.error?.category === 'rate_limit') {
        return this.handleRateLimit(agentResult);
      }

      if (agentResult.error?.category === 'infra' && this.isArenaRuntime) {
        return this.pauseArenaRun('infra', agentResult.error.message);
      }

      // Iteration timeout: agent was killed by Ralph. Treat as a normal task failure
      // (retry or skip), NOT as a fatal infra error that kills the entire run.
      if (agentResult.error?.category === 'timeout') {
        log.warn(`Task ${this.currentTask ? formatTaskLogLabel(this.currentTask) : 'unknown'} timed out — treating as task failure`);
      }

      const agentErrorClass = agentResult.error?.category ?? 'unknown';
      const failureSummary = agentResult.error?.message ?? agentResult.output.slice(0, 1000);

      // Config/auth errors are platform/provider availability, not product-task
      // progress. In Arena, pause without consuming task retries so the same
      // WIP task can continue after auth/config is corrected.
      if (agentErrorClass === 'config' || agentErrorClass === 'auth') {
        this.consecutiveFailures++;
        this.previousErrors = [`Agent error (${agentErrorClass}): ${failureSummary}`];
        log.error(`Recoverable provider/platform error (${agentErrorClass}) — pausing run`);
        if (this.isArenaRuntime) {
          return this.pauseArenaRun('infra', `Provider ${agentErrorClass} unavailable: ${failureSummary}`);
        }
        this.setState('failed');
        return 'no_work';
      }

      this.consecutiveFailures++;
      await this.recordIteration(agentResult, 'error', [failureSummary.slice(0, 500)], executorOutput);
      this.previousErrors = [`Agent error (${agentErrorClass}): ${failureSummary}`];

      const { exhausted } = this.applyAgentFailureToTask(failureSummary);
      if (exhausted) {
        await this.failCurrentTaskAndMaybeReplan(failureSummary);
        return 'error';
      }

      log.warn(`Agent failed (attempt ${this.consecutiveFailures}) — will retry`);

      if (this.shouldRunController()) {
        await this.runController('failure_threshold');
        if (this.isPaused()) return 'no_work';
      }
      return 'error';
    }

    // 3.6. Guard: agent "succeeded" but changed nothing — likely a silent failure
    //       (e.g. API error with exit 0, or agent misunderstood the task)
    if (executorObservation.filesChanged.length === 0 && !executorObservation.completionPromiseFound) {
      this.consecutiveFailures++;
      log.warn(`Agent succeeded but changed 0 files (no-op iteration ${this.consecutiveFailures}) — treating as failure`);
      await this.recordIteration(agentResult, 'error', ['Agent changed 0 files — no-op iteration'], executorOutput);
      this.previousErrors = ['You ran but made no file changes. The task is NOT complete. Please actually implement the required changes.'];

      const { exhausted } = this.applyAgentFailureToTask('Agent changed 0 files — no-op iteration');
      if (exhausted) {
        await this.failCurrentTaskAndMaybeReplan('Agent changed 0 files repeatedly — no-op iteration');
        return 'error';
      }

      if (this.shouldRunController()) {
        await this.runController('failure_threshold');
        if (this.isPaused()) return 'no_work';
      }
      return 'error';
    }
    
    // 3.7. Check for NEEDS_REPLAN signal — agent is stuck and wants a controller/planner pass
    if (executorObservation.needsReplanSignalDetected) {
      log.warn(`Agent signaled NEEDS_REPLAN for task ${this.currentTask ? formatTaskLogLabel(this.currentTask) : 'unknown'} — routing to controller`);
      agentResult.signal = 'needs_replan';
      await this.recordIteration(agentResult, 'error', ['Agent requested replan'], executorOutput);

      if (this.options.ralphConfig.controller.enabled) {
        await this.runController('replan');
        if (this.isPaused()) return 'no_work';
      }
      // Don't increment attempts — this isn't a failure, it's a request for help
      this.previousErrors = ['Your replan request was processed. The plan may have been updated. Try again with the current task.'];
      return 'error';
    }

    // 4. Check for completion promise
    if (executorObservation.completionPromiseFound) {
      log.success('Task completion signal detected');
      const taskWorkspaceErrors = await this.validateTaskWorkspaceCompletion(executorObservation.filesChanged);
      const runtimeDataErrors = await this.validateRuntimeDataContractCompletion();
      const completionContractErrors = [...taskWorkspaceErrors, ...runtimeDataErrors];
      if (completionContractErrors.length > 0) {
        this.consecutiveFailures++;
        const message = [
          'Task completion contract incomplete:',
          ...completionContractErrors.map((error) => `- ${error}`),
        ].join('\n');
        log.warn(message);
        await this.recordIteration(agentResult, 'error', completionContractErrors, executorOutput);
        this.previousErrors = [message];

        const { exhausted } = this.applyAgentFailureToTask(message);
        if (exhausted) {
          await this.failCurrentTaskAndMaybeReplan(message);
          return 'error';
        }

        if (this.shouldRunController()) {
          await this.runController('failure_threshold');
          if (this.isPaused()) return 'no_work';
        }
        return 'error';
      }
    } else {
      // Check if agent TRIED to signal completion but used wrong format
      const malformedHint = executorObservation.malformedCompletion;
      if (malformedHint) {
        log.warn(`Agent attempted completion signal in wrong format — will remind on next iteration`);
        this.previousErrors.push(malformedHint);
      }
    }
    
    // 5. Verify result
    this.setState('verification');
    const verificationResult = await this.verify();
    const terminatedAfterVerification = this.stopIfTerminated('verification');
    if (terminatedAfterVerification) return terminatedAfterVerification;
    this.lastVerification = verificationResult;
    
    if (!verificationResult.passed) {
      this.consecutiveFailures++;
      await this.recordIteration(agentResult, 'verification_failed', this.verification.getErrors(verificationResult), executorOutput);
      await this.handleVerificationFailure(verificationResult, {
        hasExecutorSourceChanges: executorObservation.filesChanged.length > 0,
      });
      return 'error';
    }
    
    // SUCCESS
    this.consecutiveFailures = 0;
    this.consecutiveRateLimits = 0;
    this.consecutiveTaskExhaustions = 0;
    this.tasksSinceLastSuccess = [];
    this.previousErrors = [];
    this.iterationHistory = []; // clear per-task errors
    
    await this.recordIteration(agentResult, 'completed', ['Verification passed'], executorOutput);
    
    // Auto-commit
    if (this.options.ralphConfig.autoCommit) {
      this.setState('committing');
      const commitResult = await this.commitCurrentExecutorSourceChanges(verificationResult.passed);
      
      if (!commitResult.success) {
        return this.pauseForSourceDeliveryFailure('agent iteration commit', commitResult.error);
      } else if (commitResult.hash === 'no-changes') {
        // This is a weird case: filesChanged was > 0, but git says no changes.
        // Likely files were already in original state or ignored.
        this.consecutiveEmptyCommits++;
        const maxEmpty = 3;
        if (this.consecutiveEmptyCommits >= maxEmpty) {
          log.error(
            `agent keeps changing excluded files. The issue is likely outside the project code (infra/Ralph-side). Skipping task.`
          );
          await this.recordIteration(agentResult, 'error', [
            `${maxEmpty} empty commits in a row — agent cannot fix this issue (changes in excluded paths only)`,
          ], executorOutput);
          if (this.currentTask) {
            this.currentTask.status = 'failed';
            this.currentTask.lastError = 'Agent repeatedly modified only excluded files — issue is outside project code';
            this.progress.updateFeature(this.currentTask.id, { status: 'failed' });
            this.savePlanState();
            this.currentTask = null;
          }
          return 'error';
        }

        // Still under threshold — tell agent what happened
        this.previousErrors = [
          'Your last changes were all in excluded paths (.arena/, .ralph/, dist/, etc.) and produced an empty commit. ' +
          'The deploy ran on unchanged code. Focus ONLY on source files that affect the build output.',
        ];
        // Skip deploy + mark task completed anyway (deploy already passed on previous code)
        await this.recordIteration(agentResult, 'completed', undefined, executorOutput);
        this.markTaskComplete();
        return 'success';
      } else {
        // Real commit — reset empty counter
        this.consecutiveEmptyCommits = 0;
      }
    }

    // 8. Push changes
    if (this.options.ralphConfig.autoPush) {
      this.setState('pushing');
      const pushResult = await this.pushChanges();
      if (!pushResult.success) {
        return this.pauseForSourceDeliveryFailure('agent iteration push', pushResult.error);
      }
    }

    // QA test generation is now handled by qa-* plan tasks (see qa-planner.ts)

    // Docker files can appear in this very iteration (for example in task-002).
    // Re-detect before deploy steps so deploy starts immediately without restart.
    await this.tryEnableLocalDockerDeploy('pre_deploy');
    
    // 9. Wait for deploy (cloud)
    if (this.shouldRunCloudDeployChecks()) {
      const github = this.github;
      if (!github) {
        throw new Error('Cloud deploy checks requested without GitHub client');
      }
      this.setState('waiting_deploy');
      const deployResult = await this.waitForDeploy();
      const terminatedAfterDeployWait = this.stopIfTerminated('deploy wait');
      if (terminatedAfterDeployWait) return terminatedAfterDeployWait;
      
      if (!deployResult.success) {
        await this.handleDeployFailure(deployResult.error || 'Deploy failed');
        return 'error';
      }
      
      this.setState('deploy_verification');
      if (deployResult.url) {
        const healthy = await github.checkDeployHealth(
          deployResult.url,
          this.getConfiguredHealthPath(),
        );
        const terminatedAfterDeployHealth = this.stopIfTerminated('deploy health check');
        if (terminatedAfterDeployHealth) return terminatedAfterDeployHealth;
        if (!healthy) {
          await this.handleDeployFailure('Health check failed');
          return 'error';
        }
      }
    }
    
    // 9.5. Local Docker deploy
    if (this.localDocker && this.shouldRunLocalPreviewVerification()) {
      this.setState('deploy_verification');
      log.info('Deploying locally via Docker...');

      // Use APP_PORT from env (set by container orchestration) or find a free port
      if (!this.dynamicAppPort) {
        const envPort = Number(process.env.APP_PORT || 0);
        this.dynamicAppPort = envPort > 0 ? envPort : await findFreePort();
        log.info(`Dynamic port assigned: APP_PORT=${this.dynamicAppPort}`);
      }
      const envOverrides: Record<string, string> = {
        APP_PORT: String(this.dynamicAppPort),
      };

      const dockerResult = await this.localDocker.deploy(envOverrides);
      const terminatedAfterLocalDeploy = this.stopIfTerminated('local deploy');
      if (terminatedAfterLocalDeploy) return terminatedAfterLocalDeploy;
      
      if (!dockerResult.success) {
        await this.handleDeployFailure(dockerResult.error || 'Docker deploy failed');
        return 'error';
      }

      if (dockerResult.skipped) {
        log.info('Docker infra is not ready yet — skipping local deploy verification for this iteration');
      } else {

        // In-process deploy (npm start) runs in the SAME container/machine,
        // so always use localhost. host.docker.internal would incorrectly
        // reach the Docker host instead of the container itself.
        const healthUrl = `http://localhost:${this.dynamicAppPort}`;
        const healthPath = await this.resolvePreferredHealthPath();
        log.info(`Running health check: ${healthUrl}${healthPath ? ` (discovered path: ${healthPath})` : ''}`);
        const healthy = await checkHealthUrl(healthUrl, undefined, undefined, healthPath);
        const terminatedAfterLocalHealth = this.stopIfTerminated('local health check');
        if (terminatedAfterLocalHealth) return terminatedAfterLocalHealth;
        if (!healthy) {
          const containerLogs = await this.localDocker.getContainerLogs();
          const exitInfo = await this.localDocker.getContainerExitInfo();
          const detail = [
            `Health check failed: ${healthUrl}`,
            '',
            '--- Container status ---',
            exitInfo,
            '',
            '--- Container logs (last 80 lines) ---',
            containerLogs,
          ].join('\n');
          await this.handleDeployFailure(detail);
          return 'error';
        }
        log.success(`Health check passed: ${healthUrl}`);

        // 9.6. Post-deploy verification (Playwright smoke + Docker logs + screenshots)
        log.info('Running post-deploy verification (Playwright)...');
        try {
          const containerLogs = await this.localDocker.getContainerLogs();
          const postDeployResult = await runPostDeployVerification({
            baseUrl: healthUrl,
            workDir: this.options.workDir,
            dockerLogs: containerLogs,
            maxPages: 10,
            screenshots: true,
          });
          const terminatedAfterPostDeploy = this.stopIfTerminated('post-deploy verification');
          if (terminatedAfterPostDeploy) return terminatedAfterPostDeploy;

          log.info(`Post-deploy: ${postDeployResult.summary}`);

          // Store result in verification result for reporting
          if (this.lastVerification) {
            this.lastVerification.postDeploy = {
              passed: postDeployResult.passed,
              infraUnavailable: postDeployResult.infraUnavailable,
              summary: postDeployResult.summary,
              errors: postDeployResult.smoke.errors,
              screenshotDir: postDeployResult.screenshotDir,
            };
          }

          if (!postDeployResult.passed && !postDeployResult.infraUnavailable) {
            const errorSummary = [
              'Post-deploy verification failed:',
              postDeployResult.summary,
              '',
              ...postDeployResult.smoke.errors.slice(0, 10),
              ...postDeployResult.dockerLogs.errorLines.slice(0, 5).map(l => `Docker: ${l}`),
            ].join('\n');
            await this.handleDeployFailure(errorSummary);
            return 'error';
          }
          if (postDeployResult.infraUnavailable) {
            log.warn('Post-deploy browser verification unavailable at platform layer; continuing without project failure');
          } else {
            log.success('Post-deploy verification passed');
          }
        } catch (err: any) {
          log.warn(`Post-deploy verification error (non-fatal): ${err.message}`);
        }
      }
    }
    
    // 10. Mark task complete
    const terminatedBeforeCompletion = this.stopIfTerminated('completion');
    if (terminatedBeforeCompletion) return terminatedBeforeCompletion;
    const completedTaskIdForWorkbench = agentResult.completionPromiseFound
      ? this.currentTask?.id ?? null
      : null;
    if (agentResult.completionPromiseFound) {
      await this.refreshArenaRuntimePreviewAfterTaskCompletion();
      await this.recordIteration(agentResult, 'completed', undefined, executorOutput);
      this.recordCurrentTaskTargetEvidence();
      this.markTaskComplete();
    } else {
      await this.recordIteration(agentResult, 'completed', undefined, executorOutput);
    }
    
    // 11. Commit task status update
    let taskStatusReadyForVisualWorkbench = false;
    if (this.options.ralphConfig.autoCommit) {
      const statusResult = await this.git.commitPaths(
        'chore: update task status',
        [...LOOP_DURABLE_STATE_COMMIT_PATHS],
      );
      const terminatedAfterStatusCommit = this.stopIfTerminated('status commit');
      if (terminatedAfterStatusCommit) return terminatedAfterStatusCommit;
      if (!statusResult.success) {
        return this.pauseForSourceDeliveryFailure('task status commit', statusResult.error);
      }
      if (statusResult.hash !== 'no-changes' && this.options.ralphConfig.autoPush) {
        const pushResult = await this.git.push();
        if (!pushResult.success) {
          return this.pauseForSourceDeliveryFailure('task status push', pushResult.error);
        }
        const terminatedAfterStatusPush = this.stopIfTerminated('status push');
        if (terminatedAfterStatusPush) return terminatedAfterStatusPush;
      }
      taskStatusReadyForVisualWorkbench = statusResult.success;
    }

    if (completedTaskIdForWorkbench && taskStatusReadyForVisualWorkbench) {
      const visualWorkbenchPause = await this.runPostTaskVisualWorkbenchEvidenceAutomation(completedTaskIdForWorkbench);
      if (visualWorkbenchPause) return visualWorkbenchPause;
    }
    
    // 12. Check if controller should run
    if (this.shouldRunController()) {
      const trigger = this.detectControllerTrigger();
      await this.runController(trigger);
      if (this.isPaused()) return 'no_work';
    }

    // Clear errors for next iteration
    this.previousErrors = [];
    
    await this.progress.save();
    return 'success';
  }

  // ── Task selection ────────────────────────────────────────────
  
  private async selectNextTask(): Promise<Task | null> {
    // If current task needs retry (still in_progress or pending from previous iteration)
    if (this.currentTask && 
        this.currentTask.status !== 'completed' && 
        this.currentTask.status !== 'failed' &&
        this.currentTask.status !== 'skipped') {
      return this.currentTask;
    }

    const taskStateChanged = this.planManager.reconcileTaskStateForSelection(this.options.ralphConfig.maxRetries);
    if (taskStateChanged) {
      await this.flushTaskStateNow();
      this.syncProgressFeaturesFromPlan();
      await this.progress.flushNow();
    }

    return this.planManager.getNextTask();
  }

  // ── Deferred phase expansion ─────────────────────────────────

  private async expandDeferredPhase(phase: Phase): Promise<void> {
    if (!this.options.specPath) return;

    const previousState = this.state;
    this.setState('planning');
    try {
      const reason = [
        `Phase "${phase.name}" (${phase.id}) is marked planLater and all earlier phases are done.`,
        `Phase description: ${phase.description}`,
        `Expand this phase into concrete implementation tasks based on the current codebase state and completed work.`,
      ].join('\n');

      await this.planner.revisePlan({
        workDir: this.options.workDir,
        specPath: this.options.specPath,
        projectConfig: this.options.projectConfig,
        agent: this.agent,
        model: this.options.ralphConfig.model,
        verbose: this.options.ralphConfig.verbose,
        visualEvidenceMode: this.options.ralphConfig.visualWorkbench.visualEvidenceMode,
      }, this.planManager, this.judgmentLog, reason);

      const updatedPhase = this.planManager.currentPlan.phases.find(p => p.id === phase.id);
      if (!updatedPhase) {
        throw new Error(`Deferred phase ${phase.id} disappeared during expansion`);
      }

      if (updatedPhase.tasks.length === 0) {
        updatedPhase.planLater = true;
        updatedPhase.status = 'pending';
        await this.planManager.save();
        throw new Error(`Planner did not add tasks to ${phase.id}; leaving deferred phase pending`);
      }

      updatedPhase.planLater = false;
      if (updatedPhase.status === 'completed') {
        updatedPhase.status = 'pending';
      }

      await this.planManager.save();
      this.syncProgressFeaturesFromPlan();
      await this.progress.save();
      log.info(`Deferred phase ${phase.id} expanded — ${updatedPhase.tasks.length} tasks added`);
    } catch (err: any) {
      log.error(`Failed to expand deferred phase ${phase.id}: ${err.message}`);
    }
    if ((this.state as string) !== 'failed') {
      this.setState(previousState);
    }
  }

  // ── Controller integration ────────────────────────────────────

  private shouldRunController(): boolean {
    if (!this.options.ralphConfig.controller.enabled) return false;

    const config = this.options.ralphConfig.controller;

    // Phase just completed?
    if (config.runAfterPhase) {
      const currentPhase = this.planManager.getCurrentPhase();
      const prevPhaseId = this.lastControllerPhaseId;
      if (currentPhase && prevPhaseId && currentPhase.id !== prevPhaseId) {
        return true;
      }
      if (this.currentTask) {
        const taskPhase = this.planManager.findTaskPhase(this.currentTask.id);
        if (taskPhase && this.planManager.isPhaseComplete(taskPhase.id)) {
          this.planManager.markPhaseComplete(taskPhase.id);
          return true;
        }
      }
    }

    // Too many consecutive failures?
    if (config.runOnConsecutiveFailures > 0 && this.consecutiveFailures >= config.runOnConsecutiveFailures) {
      return this.consecutiveFailures % config.runOnConsecutiveFailures === 0;
    }

    // Periodic (every N completed tasks)?
    if (config.runAfterNTasks > 0 && this.completedTasksSinceLastControl >= config.runAfterNTasks) {
      return true;
    }

    return false;
  }

  private detectControllerTrigger(): ControllerTrigger {
    const config = this.options.ralphConfig.controller;
    
    if (this.consecutiveFailures >= config.runOnConsecutiveFailures) return 'failure_threshold';
    
    if (this.currentTask) {
      const taskPhase = this.planManager.findTaskPhase(this.currentTask.id);
      if (taskPhase && this.planManager.isPhaseComplete(taskPhase.id)) return 'phase_complete';
    }
    
    return 'periodic';
  }

  private async handleRateLimit(agentResult: AgentResult): Promise<'rate_limit' | 'no_work'> {
    const baseWait = agentResult.error!.retryAfterSec ?? 300;
    this.consecutiveRateLimits++;
    const backoffMultiplier = Math.min(Math.pow(2, this.consecutiveRateLimits - 1), 8);
    const effectiveWait = Math.ceil(baseWait * backoffMultiplier);
    const mins = Math.ceil(effectiveWait / 60);

    if (this.isArenaRuntime) {
      const summary = agentResult.error?.message?.trim()
        || `Provider rate limit hit (retry after ~${mins}m)`;
      log.warn(
        `Rate limit hit (${this.consecutiveRateLimits}x consecutive) — pausing arena run instead of sleeping ${mins} min`,
      );
      return this.pauseArenaRun('rate_limit', summary, agentResult.error?.retryAt ?? null);
    }

    log.warn(`Rate limit hit (${this.consecutiveRateLimits}x consecutive) — waiting ${mins} min (base ${baseWait}s × ${backoffMultiplier})`);
    await this.recordIteration(agentResult, 'error', [`Rate limit (${this.consecutiveRateLimits}x) — waiting ${mins}m`]);
    await new Promise(r => setTimeout(r, effectiveWait * 1000));
    return 'rate_limit';
  }

  private isRecoverablePlatformAgentError(category: AgentErrorCategory | undefined): boolean {
    return category === 'auth' || category === 'config' || category === 'infra';
  }

  private async pauseArenaRun(
    kind: 'manual' | 'budget' | 'rate_limit' | 'infra',
    summary: string,
    retryAt?: string | null,
    options: {
      currentTaskStatusOnPause?: 'pending' | 'in_progress';
    } = {},
  ): Promise<'no_work'> {
    const arenaState = kind === 'manual' ? 'paused_manual'
      : kind === 'budget' ? 'paused_budget'
      : kind === 'rate_limit' ? 'paused_rate_limit'
      : 'paused_infra';
    const message = summary.slice(0, 1000);

    log.warn(message);
    this.previousErrors = [message];

    if (this.currentTask) {
      const currentTaskStatusOnPause = options.currentTaskStatusOnPause ?? 'in_progress';
      this.currentTask.status = currentTaskStatusOnPause;
      this.currentTask.lastError = message;
      this.progress.updateFeature(this.currentTask.id, { status: currentTaskStatusOnPause });
      this.savePlanState();
    }

    await this.recordIteration(
      { success: false, output: message, filesChanged: [], completionPromiseFound: false },
      'error',
      [message],
    );

    this.progress.setArenaPause(arenaState, message);
    await this.progress.flushNow();
    this.pauseReason = kind;
    this.pauseRetryAt = kind === 'rate_limit' ? retryAt ?? null : null;
    this.exitReason = 'paused';
    this.setState('paused');
    return 'no_work';
  }

  private applyAgentFailureToTask(lastError: string): { exhausted: boolean } {
    if (!this.currentTask) return { exhausted: false };
    this.currentTask.attempts++;
    this.currentTask.lastError = lastError.slice(0, 4000);
    this.savePlanState();

    // Escalation: after 2+ failed attempts, add a hint to change approach
    if (this.currentTask.attempts >= 2) {
      const hint = `\n\n⚠️ ESCALATION: This task has failed ${this.currentTask.attempts} times. ` +
        `Your previous approach is not working. You MUST change strategy:\n` +
        `- Simplify the implementation (remove non-essential parts)\n` +
        `- Try a completely different technical approach\n` +
        `- If the error is in a config or build tool, do NOT keep tweaking the same file — revert and try a different setup\n` +
        `- If a dependency is broken, work around it or remove it`;
      this.previousErrors = [...this.previousErrors, hint];
    }

    return { exhausted: this.currentTask.attempts >= this.options.ralphConfig.maxRetries };
  }

  private async failCurrentTaskAndMaybeReplan(reason: string): Promise<void> {
    if (!this.currentTask) return;
    log.error(`Task ${formatTaskLogLabel(this.currentTask)} exhausted — marking failed`);
    this.currentTask.status = 'failed';
    this.currentTask.attempts = Math.max(this.currentTask.attempts, this.options.ralphConfig.maxRetries);
    this.currentTask.lastError = reason.slice(0, 4000);
    this.progress.updateFeature(this.currentTask.id, { status: 'failed' });
    this.savePlanState();

    // Circuit breaker: if multiple tasks in a row are exhausted without any
    // success in between, the problem is systemic (expired token, API down, etc.).
    // Pause instead of churning through the entire plan.
    this.consecutiveTaskExhaustions++;
    this.tasksSinceLastSuccess.push(this.currentTask.id);
    const circuitBreakerThreshold = 3;
    if (this.consecutiveTaskExhaustions >= circuitBreakerThreshold && this.isArenaRuntime) {
      log.error(
        `Circuit breaker: ${this.consecutiveTaskExhaustions} tasks exhausted in a row — likely systemic failure, pausing run`,
      );

      // Reset victims of the systemic failure back to pending so they'll be
      // retried once the infra issue is resolved and the run resumes.
      for (const taskId of this.tasksSinceLastSuccess) {
        const task = this.planManager.findTask(taskId);
        if (task && (task.status === 'failed' || task.status === 'skipped')) {
          task.status = 'pending';
          task.attempts = 0;
          task.lastError = `Reset by circuit breaker — was failed due to systemic error, not task-specific issue`;
          log.info(`Circuit breaker: reset task ${taskId} to pending`);
        }
      }
      this.savePlanState();

      this.currentTask = null;
      await this.pauseArenaRun('infra', `${this.consecutiveTaskExhaustions} consecutive tasks failed — systemic error: ${reason.slice(0, 200)}`);
      return;
    }

    if (this.options.ralphConfig.controller.enabled) {
      log.info('Triggering controller replan to recover from repeated agent failure...');
      await this.runController('replan');
      if (this.isPaused()) return;
      const next = await this.selectNextTask();
      if (next) {
        log.info(`Replan produced new runnable task: ${formatTaskLogLabel(next)}`);
      }
    }

    this.currentTask = null;
    this.setState('recovery');
  }

  private async runController(trigger: ControllerTrigger): Promise<ControllerReport | null> {
    if (!this.options.specPath) return null;

    this.setState('controlling');

    const report = await this.controller.audit({
      workDir: this.options.workDir,
      specPath: this.options.specPath,
      projectConfig: this.options.projectConfig,
      ralphConfig: this.options.ralphConfig,
      agent: this.agent,
      model: this.options.ralphConfig.model,
      planManager: this.planManager,
      judgmentLog: this.judgmentLog,
      iterationHistory: this.iterationHistory,
      verbose: this.options.ralphConfig.verbose,
      visionReport: this.lastVisionReport ?? undefined,
    }, trigger);

    this.publishPublicAssumptionReviews(report.newJudgments);

    // Reset controller tracking
    this.completedTasksSinceLastControl = 0;
    const currentPhase = this.planManager.getCurrentPhase();
    this.lastControllerPhaseId = currentPhase?.id ?? null;

    // If controller added new tasks, register them as features
    if (report.verdict === 'revise') {
      this.syncProgressFeaturesFromPlan();
    }

    // Commit only controller-owned durable artifacts. Failed executor WIP must
    // not be swept into a controller audit commit by a broad git add.
    if (report.verdict === 'revise' || report.verdict === 'continue') {
      try {
        const result = await this.git.commitPaths(
          `chore: controller ${trigger} audit — ${report.verdict}`,
          [...CONTROLLER_DURABLE_COMMIT_PATHS],
        );
        if (result.success && result.hash && result.hash !== 'no-changes') {
          log.success(`Committed controller changes: ${result.hash.slice(0, 7)}`);
          if (this.options.ralphConfig.autoPush) {
            const pushResult = await this.pushChanges();
            if (!pushResult.success) {
              await this.pauseForSourceDeliveryFailure(`controller ${trigger} audit push`, pushResult.error);
            }
          }
        }
      } catch {
        // Non-critical — might be nothing to commit
      }
    }

    if (report.verdict === 'escalate') {
      log.warn('Controller requested escalation; continuing without a lifecycle pause');
      log.warn(`Reason: ${report.summary}`);
    }

    return report;
  }

  private publishPublicAssumptionReviews(judgments: Judgment[]): void {
    const reviews = judgments
      .map((judgment) => judgment.publicAssumption)
      .filter((review): review is NonNullable<Judgment['publicAssumption']> => !!review);
    if (reviews.length === 0) return;
    this.progress.addAssumptionReviews(reviews);
  }

  // ── Agent execution ───────────────────────────────────────────

  private async runExecutorActionCoreForCurrentTask(
    contextSections: string,
    options: {
      allowActiveWipWorkspaceResume?: boolean;
      allowSpecHashMismatch?: boolean;
      allowProviderSessionResume?: boolean;
    } = {},
  ): Promise<ExecutorActionCoreResult> {
    if (!this.currentTask) {
      throw new Error('LoopExecutor.executeIteration requires a current task before executor action core.');
    }

    const verbose = this.options.ralphConfig.verbose;
    const spinner = verbose ? null : ora(`${this.agent.name} is working...`).start();
    const providerSessionMatch = this.buildProviderSessionCheckpointMatch();
    let providerSessionResumeId: string | undefined;

    if (providerSessionMatch && options.allowProviderSessionResume) {
      const checkpoint = await this.providerSessionCheckpoints.readResumableMatching(providerSessionMatch, {
        // Active WIP owns its partial diff. A fresh accepted spec can change
        // specHash before the same task is resumed for reconciliation.
        allowSpecHashMismatch: options.allowSpecHashMismatch,
      });
      if (checkpoint) {
        providerSessionResumeId = checkpoint.sessionId;
        log.info(`Resuming provider session checkpoint for ${providerSessionMatch.taskId}`);
      }
    }
    const isProviderSessionContinuation = !!providerSessionResumeId;
    const isActiveWipWorkspaceContinuation = options.allowActiveWipWorkspaceResume === true;
    const isContinuationWorkspace = isActiveWipWorkspaceContinuation || isProviderSessionContinuation;

    if (isActiveWipWorkspaceContinuation && !providerSessionResumeId && providerSessionMatch) {
      log.info(`Continuing active WIP for ${providerSessionMatch.taskId} without provider session checkpoint`);
    }

    if (verbose) {
      log.info(`${this.agent.name} is working... (live output below)`);
      log.divider();
    }

    try {
      const result = await runExecutorActionCore({
        stageId: 'LoopExecutor.executeIteration',
        task: this.currentTask,
        workDir: this.options.workDir,
        prompt: {
          kind: 'context_sections',
          name: `executor-iteration-${this.iteration}`,
          contextSections,
        },
        agent: this.agent,
        agentCall: {
          model: this.options.ralphConfig.model,
          timeoutMinutes: this.options.ralphConfig.iterationTimeoutMinutes,
          verbose,
          providerSessionResumeId,
        },
        completionPromise: this.options.ralphConfig.completionPromise,
        visualEvidenceMode: this.options.ralphConfig.visualWorkbench.visualEvidenceMode,
        changedFilesSourceLabel: isContinuationWorkspace ? 'Continuation workspace diff' : 'Workspace diff',
        allowedLoopOwnedPreExistingChangedFiles: [...LOOP_DURABLE_STATE_COMMIT_PATHS],
        sourceMode: isContinuationWorkspace
          ? {
              kind: 'post_call_status',
              preAgentPolicy: 'caller_validated',
            }
          : {
              kind: 'post_call_delta',
              preAgentPolicy: 'allow_current_task_workspace_only',
            },
        agentFailureMessage: 'Executor agent failed.',
        readGitStatusLines: () => this.readExecutorGitStatusLines(),
        readHeadRef: () => this.resolveCurrentGitHeadRef(),
      });

      if (result.status === 'blocked_before_agent') {
        spinner?.fail(`${this.agent.name} did not start`);
        return result;
      }

      await this.saveAgentLog(result.promptEnvelope.prompt, result.agentResult);
      await this.updateProviderSessionCheckpoint(providerSessionMatch, result.agentResult);

      if (result.agentResult.success) {
        if (verbose) log.divider();
        log.success(`${this.agent.name} completed`);
        spinner?.succeed(`${this.agent.name} completed`);
      } else {
        if (verbose) log.divider();
        log.warn(`${this.agent.name} encountered an error`);
        spinner?.fail(`${this.agent.name} encountered an error`);
      }

      if (result.agentResult.filesChanged.length > 0) {
        log.info(`Agent-declared files changed: ${result.agentResult.filesChanged.join(', ')}`);
      }

      return result;
    } catch (error: any) {
      if (verbose) log.divider();
      log.error(`${this.agent.name} failed`);
      spinner?.fail(`${this.agent.name} failed`);
      if (providerSessionResumeId) {
        await this.clearProviderSessionCheckpointBestEffort(providerSessionMatch);
      }
      throw error;
    }
  }

  private async shouldResumeActiveWipForCurrentTask(initialStatus: Task['status']): Promise<boolean> {
    if (!this.currentTask) return false;
    if (initialStatus === 'in_progress') return true;
    if (initialStatus !== 'pending') return false;

    const match = this.buildProviderSessionCheckpointMatch();
    if (match) {
      const checkpoint = await this.providerSessionCheckpoints.readMatching(match, {
        // Controller can rewrite the same task around a fresh accepted spec while
        // preserving its existing source WIP. The dirty workspace lease is scoped
        // to the task id/fingerprint, not to the previous spec hash alone.
        allowSpecHashMismatch: true,
      });
      if (checkpoint) {
        log.info(`Continuing pending WIP for ${match.taskId} from provider session history`);
        return true;
      }
    }

    const hasTaskSourceHistory = this.getTaskHistory(this.currentTask.id).some(entry => entry.filesChanged.length > 0);
    if (hasTaskSourceHistory) {
      log.info(`Continuing pending WIP for ${this.currentTask.id} from task iteration history`);
      return true;
    }

    return false;
  }

  private buildProviderSessionCheckpointMatch(): ProviderSessionCheckpointMatch | null {
    if (!this.currentTask) return null;

    return {
      agent: this.agent.name,
      model: this.options.ralphConfig.model?.trim() || null,
      taskId: this.currentTask.id,
      taskFingerprint: buildProviderSessionTaskFingerprint({
        taskId: this.currentTask.id,
        taskDescription: this.currentTask.description,
      }),
      specHash: this.planManager.hasPlan
        ? this.planManager.currentPlan.specHash ?? null
        : null,
    };
  }

  private async updateProviderSessionCheckpoint(
    match: ProviderSessionCheckpointMatch | null,
    result: AgentResult,
  ): Promise<void> {
    if (!match) return;

    try {
      const sessionId = result.providerSession?.id || result.providerSession?.resumedFrom;
      if (!sessionId) return;
      await this.providerSessionCheckpoints.recordTaskSession({
        ...match,
        sessionId,
        reason: result.error?.category === 'rate_limit' ? 'rate_limit' : 'task_attempt',
        outcome: result.success ? 'success' : 'error',
        ...(result.error?.category ? { errorCategory: result.error.category } : {}),
        ...(result.providerSession?.resumedFrom ? { resumedFrom: result.providerSession.resumedFrom } : {}),
        ...(result.providerSession?.resumeFallbackReason ? { resumeFallbackReason: result.providerSession.resumeFallbackReason } : {}),
      });
    } catch (error: any) {
      log.warn(`Provider session checkpoint update skipped: ${error?.message ?? String(error)}`);
    }
  }

  private async clearProviderSessionCheckpointBestEffort(match: ProviderSessionCheckpointMatch | null): Promise<void> {
    try {
      if (match) await this.providerSessionCheckpoints.clearMatching(match);
    } catch {
      // Best-effort cleanup only. The durable resume contract remains plan.json.
    }
  }
  
  /**
   * Save full agent prompt + output to a per-iteration log file
   */
  private async saveAgentLog(prompt: string, result: AgentResult): Promise<void> {
    try {
      const logsDir = path.join(this.options.workDir, '.ralph', 'agent-logs');
      await fs.ensureDir(logsDir);
      
      const taskId = this.currentTask?.id ?? 'unknown';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `iter-${String(this.iteration).padStart(3, '0')}-${taskId}-${timestamp}.md`;
      
      const content = [
        `# Agent Log — Iteration ${this.iteration}`,
        ``,
        `- **Task:** ${taskId}`,
        `- **Agent:** ${this.agent.name}`,
        `- **Timestamp:** ${new Date().toISOString()}`,
        `- **Success:** ${result.success}`,
        `- **Agent-declared files changed:** ${result.filesChanged.length > 0 ? result.filesChanged.join(', ') : 'none'}`,
        ``,
        `## Prompt`,
        ``,
        '```',
        prompt,
        '```',
        ``,
        `## Agent Output`,
        ``,
        '```',
        result.output,
        '```',
        ``,
      ].join('\n');
      
      await fs.writeFile(path.join(logsDir, filename), content, 'utf-8');
      try {
        await appendPromptModelCallTrace(this.options.workDir, {
          promptId: 'executor.agentPrompt',
          owner: 'executor',
          label: 'Rendered executor agent prompt',
          prompt,
          result,
          model: this.options.ralphConfig.model,
          parse: {
            status: result.success ? 'ok' : 'error',
            summary: result.success
              ? `completionPromise=${result.completionPromiseFound ? 'found' : 'missing'}; declaredFilesChanged=${result.filesChanged.length}`
              : 'agent call failed',
          },
          context: {
            iteration: this.iteration,
            taskId,
            agent: this.agent.name,
            declaredFilesChanged: result.filesChanged.length,
            completionPromiseFound: result.completionPromiseFound ?? false,
          },
        });
      } catch (err) {
        log.warn(`Failed to write prompt trace: ${err}`);
      }
    } catch (err) {
      // Non-critical — don't break the loop
      log.warn(`Failed to save agent log: ${err}`);
    }
  }
  
  private async validateRuntimeDataContractCompletion(): Promise<string[]> {
    const result = await validateRuntimeDataContract(this.options.workDir);
    return result.blockingFindings.map((finding) => {
      const location = finding.line ? `${finding.path}:${finding.line}` : finding.path;
      const excerpt = finding.excerpt ? ` Found: \`${finding.excerpt}\`` : '';
      return `${location}: ${finding.message}${excerpt}`;
    });
  }

  private async validateTaskWorkspaceCompletion(filesChanged: string[]): Promise<string[]> {
    if (!this.currentTask) return [];

    const errors: string[] = [];
    const changedTaskSkill = filesChanged.some((filePath) => {
      const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
      return normalized === '.ralph/task-skills'
        || normalized.startsWith('.ralph/task-skills/')
        || normalized === 'ralph/task-skills'
        || normalized.startsWith('ralph/task-skills/');
    });
    if (changedTaskSkill) {
      errors.push('Do not edit `.ralph/task-skills/*`; read those files as role instructions only.');
    }

    const taskWorkspacePath = getTaskWorkspaceAbsolutePath(this.options.workDir, this.currentTask.id);
    const planPath = path.join(taskWorkspacePath, 'plan.md');
    const plan = await this.readOptionalTextFile(planPath);
    if (!plan) {
      errors.push(`Write \`.ralph/tasks/${this.currentTask.id}/plan.md\` before completing this task.`);
    } else if (!this.hasMeaningfulTaskWorkspaceNote(plan, [TASK_WORKSPACE_PLAN_TEMPLATE_HINT])) {
      errors.push(`Update \`.ralph/tasks/${this.currentTask.id}/plan.md\` with the real approach, touched surfaces and checks before completing this task.`);
    }

    for (const role of this.currentTask.requiredRolePasses ?? []) {
      const fileName = role === 'product' ? 'product.md' : 'ux.md';
      const note = await this.readOptionalTextFile(path.join(taskWorkspacePath, fileName));
      if (!note) {
        errors.push(`Write \`.ralph/tasks/${this.currentTask.id}/${fileName}\` because requiredRolePasses includes \`${role}\`.`);
        continue;
      }
      if (!this.hasMeaningfulTaskWorkspaceNote(note, [])) {
        errors.push(`Make \`.ralph/tasks/${this.currentTask.id}/${fileName}\` a short, meaningful ${role} pass before completing this task.`);
      }
    }

    return errors;
  }

  private async readOptionalTextFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  private hasMeaningfulTaskWorkspaceNote(content: string, templateHints: string[]): boolean {
    let reduced = content;
    for (const hint of templateHints) {
      reduced = reduced.replaceAll(hint, '');
    }

    reduced = reduced
      .replace(/^# .+$/gm, '')
      .replace(/^## (Approach|Files \/ Surfaces|Checks)$/gm, '')
      .replace(/^-+\s*$/gm, '')
      .replace(/^\s*-\s*$/gm, '')
      .trim();

    return reduced.length >= 20;
  }

  private async verify(): Promise<VerificationResult> {
    log.info('Running verification pipeline...');
    
    const result = await this.verification.verify({
      workDir: this.options.workDir,
      level: this.options.ralphConfig.verificationLevel,
      buildCommand: this.options.ralphConfig.buildCommand,
      buildTimeoutMs: this.options.ralphConfig.buildTimeoutMs,
    });
    
    console.log(this.verification.formatResult(result));
    
    if (result.unitTests) {
      this.progress.updateMetrics({
        testsPassing: result.unitTests.passed_count,
        testsTotal: result.unitTests.total,
      });
    }
    
    return result;
  }
  
  private async handleVerificationFailure(
    result: VerificationResult,
    options: { hasExecutorSourceChanges?: boolean } = {},
  ): Promise<void> {
    log.warn('Verification failed, will retry...');

    if (this.currentTask) {
      this.currentTask.attempts++;
      this.currentTask.lastError = this.verification.getErrors(result).join('\n');
      this.savePlanState();
    }

    this.previousErrors = this.verification.getErrors(result);

    // Escalation: after 2+ failed verification attempts, hint the agent to change strategy
    if (this.currentTask && this.currentTask.attempts >= 2 &&
        this.currentTask.attempts < this.options.ralphConfig.maxRetries) {
      const hint = `\n\n⚠️ ESCALATION: Verification has failed ${this.currentTask.attempts} times for this task. ` +
        `Your current approach is NOT working. You MUST try something different:\n` +
        `- If build fails: revert your config changes and use a simpler setup\n` +
        `- If tests fail repeatedly on the same assertion: the test expectation may be wrong, not the code\n` +
        `- If lint/typecheck fails: fix types directly instead of adding suppressions\n` +
        `- Consider simplifying: a working simple solution beats a broken complex one`;
      this.previousErrors.push(hint);
      log.warn(`Escalation hint added for task ${formatTaskLogLabel(this.currentTask)} (attempt ${this.currentTask.attempts})`);
    }

    if (this.currentTask &&
        this.currentTask.attempts >= this.options.ralphConfig.maxRetries) {
      if (options.hasExecutorSourceChanges) {
        log.warn(
          `Verification failed after source changes for ${formatTaskLogLabel(this.currentTask)}; preserving active WIP lease for same-task reconciliation`,
        );
        this.currentTask.status = 'in_progress';
        this.progress.updateFeature(this.currentTask.id, { status: 'in_progress' });
        this.savePlanState();
        this.setState('recovery');
        return;
      }
      await this.failCurrentTaskAndMaybeReplan(
        `Verification failed ${this.currentTask.attempts} times: ${this.verification.getErrors(result).slice(0, 3).join('; ')}`,
      );
      return;
    }
    
    this.setState('recovery');
  }
  
  private async commitCurrentExecutorSourceChanges(verificationPassed: boolean): Promise<CommitResult> {
    return commitExecutorTaskIterationSourceChanges({
      git: this.git,
      task: this.currentTask,
      iteration: this.iteration,
      verificationPassed,
    });
  }
  
  private async pushChanges(): Promise<{ success: boolean; error?: string }> {
    const result = await this.git.push();
    if (!result.success) {
      log.warn(`Push failed: ${result.error}`);
    }
    return result;
  }

  private async runPostTaskVisualWorkbenchEvidenceAutomation(taskId: string): Promise<'no_work' | null> {
    if (!this.shouldRunPostTaskVisualWorkbenchEvidenceAutomation(taskId)) {
      return null;
    }

    const shellPolicy = this.options.ralphConfig.visualWorkbench.executorCaptureShell;
    if (shellPolicy.mode !== 'allowlisted') {
      return null;
    }

    let sourceRef: string;
    let result: VisualWorkbenchEvidenceAutomationResult;
    try {
      sourceRef = await this.resolveCurrentGitHeadRef();
      const baseUrl = await this.allocateVisualWorkbenchBaseUrl();
      const outDir = await this.createVisualWorkbenchCaptureOutDir(taskId);
      result = await this.visualWorkbenchEvidenceAutomationRunner({
        workDir: this.options.workDir,
        taskId,
        sourceRef,
        baseUrl,
        outDir,
        manifestPath: VISUAL_WORKBENCH_MANIFEST_PATH,
        ralphConfig: this.options.ralphConfig,
      });
    } catch (error) {
      log.warn(`Visual Workbench evidence automation skipped for ${taskId}: ${this.describeFatalError(error)}`);
      return null;
    }

    this.logVisualWorkbenchEvidenceAutomationResult(result);
    await this.recordVisualWorkbenchAutomationIterationReadback(taskId, result);
    if (!this.visualWorkbenchAutomationWroteTaskEvidence(result)) {
      return null;
    }

    await this.planManager.load();
    if (result.status === 'published') {
      this.syncProgressFeaturesFromPlan();
      await this.progress.flushNow();
    }

    if (!this.options.ralphConfig.autoCommit) {
      log.info(`Visual Workbench evidence for ${taskId} recorded locally; autoCommit is disabled`);
      return null;
    }

    const task = this.planManager.getAllTasks().find((candidate) => candidate.id === taskId);
    const evidenceRefs = result.exports.reduce((count, entry) => count + entry.evidenceRefs.length, 0);
    const commitMessage = buildExecutorVisualWorkbenchEvidenceCommitMessage({
      task,
      taskId,
      sourceRef,
      status: result.status,
      reportPath: result.reportPath,
      diagnosticReportPath: result.diagnosticReportPath,
      evidenceRefs,
      publishedRows: result.publish.visualEvidenceRows,
    });
    const commitResult = await this.git.commit(commitMessage.message);
    if (!commitResult.success) {
      return this.pauseForSourceDeliveryFailure('visual workbench evidence commit', commitResult.error);
    }

    if (commitResult.hash !== 'no-changes' && this.options.ralphConfig.autoPush) {
      const pushResult = await this.pushChanges();
      if (!pushResult.success) {
        return this.pauseForSourceDeliveryFailure('visual workbench evidence push', pushResult.error);
      }
    }

    return null;
  }

  private shouldRunPostTaskVisualWorkbenchEvidenceAutomation(taskId: string): boolean {
    const mode = this.options.ralphConfig.visualWorkbench.visualEvidenceMode;
    const task = this.planManager.getAllTasks().find((candidate) => candidate.id === taskId);
    if (!task) return false;
    return shouldRunVisualWorkbenchEvidenceAutomationForTask({
      task,
      visualEvidenceMode: mode,
    });
  }

  private async resolveCurrentGitHeadRef(): Promise<string> {
    const { execa } = await import('execa');
    const { stdout } = await execa('git', ['rev-parse', 'HEAD'], {
      cwd: this.options.workDir,
    });
    return stdout.trim();
  }

  private async readExecutorGitStatusLines(): Promise<string[] | null> {
    return readExecutorGitStatusLines(this.options.workDir);
  }

  private async allocateVisualWorkbenchBaseUrl(): Promise<string> {
    const port = await findFreePort();
    return `http://127.0.0.1:${port}`;
  }

  private async createVisualWorkbenchCaptureOutDir(taskId: string): Promise<string> {
    const safeTaskId = taskId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'task';
    const outDir = await fs.mkdtemp(path.join(tmpdir(), `ralph-visual-workbench-${safeTaskId}-`));
    const [realWorkDir, realOutDir] = await Promise.all([
      fs.realpath(this.options.workDir),
      fs.realpath(outDir),
    ]);
    const relative = path.relative(realWorkDir, realOutDir);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error('Visual Workbench capture outDir must resolve outside workDir.');
    }
    return outDir;
  }

  private visualWorkbenchAutomationWroteTaskEvidence(result: VisualWorkbenchEvidenceAutomationResult): boolean {
    return result.exports.some((entry) => entry.evidenceRefs.length > 0);
  }

  private async recordVisualWorkbenchAutomationIterationReadback(
    taskId: string,
    result: VisualWorkbenchEvidenceAutomationResult,
  ): Promise<void> {
    const entry = [...this.iterationHistory]
      .reverse()
      .find((candidate) => candidate.taskId === taskId && candidate.outcome === 'completed');
    if (!entry) return;

    entry.visualWorkbenchAutomation = {
      ownerBoundary: result.ownerBoundary,
      status: result.status,
      taskId: result.taskId,
      sourceRef: result.sourceRef,
      reportPath: result.reportPath,
      diagnosticReportPath: result.diagnosticReportPath,
      selectorStatus: result.selector.status,
      selectedStories: result.selector.selectedStories,
      selectedViewports: result.selector.selectedViewports,
      shellPolicyStatus: result.shellPolicy.status,
      browserReadinessStatus: result.browserReadiness.status,
      captureStatus: result.capture.status,
      exportedEvidenceRefs: result.exports.reduce((count, item) => count + item.evidenceRefs.length, 0),
      publishedRows: result.publish.visualEvidenceRows,
      blockers: result.blockers,
    };
    await this.saveIterationHistory();
  }

  private logVisualWorkbenchEvidenceAutomationResult(result: VisualWorkbenchEvidenceAutomationResult): void {
    const exportedRefs = result.exports.reduce((count, entry) => count + entry.evidenceRefs.length, 0);
    const summary = [
      `status=${result.status}`,
      `selector=${result.selector.status}`,
      ...(result.selector.ambiguities.length > 0
        ? [`selectorAmbiguities=${this.formatVisualWorkbenchSelectorAmbiguities(result.selector.ambiguities)}`]
        : []),
      `shellPolicy=${result.shellPolicy.status}`,
      `browser=${result.browserReadiness.status}`,
      ...(result.browserReadiness.errorCode ? [`browserError=${result.browserReadiness.errorCode}`] : []),
      `capture=${result.capture.status ?? 'skipped'}`,
      `exports=${exportedRefs}`,
      `publishedRows=${result.publish.visualEvidenceRows}`,
      `report=${result.reportPath}`,
      `diagnostic=${result.diagnosticReportPath}`,
      ...(result.capture.viewerPath ? [`viewer=${result.capture.viewerPath}`] : []),
    ].join(' ');

    if (result.status === 'published') {
      log.success(`Visual Workbench evidence automation completed for ${result.taskId}: ${summary}`);
      return;
    }

    const blockers = result.blockers.length > 0 ? ` blockers=${result.blockers.join(',')}` : '';
    log.info(`Visual Workbench evidence automation did not publish for ${result.taskId}: ${summary}${blockers}`);
  }

  private formatVisualWorkbenchSelectorAmbiguities(
    ambiguities: VisualWorkbenchEvidenceAutomationResult['selector']['ambiguities'],
  ): string {
    return ambiguities.slice(0, 4).map((ambiguity) => (
      `${ambiguity.storyId}->${ambiguity.matchedTaskIds.join('|')}`
    )).join(',');
  }

  private isPaused(): boolean {
    return (this.state as string) === 'paused';
  }

  private async pauseForSourceDeliveryFailure(
    context: string,
    error?: string,
    options: {
      currentTaskStatusOnPause?: 'pending' | 'in_progress';
    } = {},
  ): Promise<'no_work'> {
    const detail = error?.trim() ? `: ${error.trim().slice(0, 500)}` : '';
    return this.pauseArenaRun(
      'infra',
      `Source delivery failed during ${context}${detail}. The project commit was not pushed to origin, so Ralph cannot honestly mark the work complete yet.`,
      null,
      options,
    );
  }

  private shouldRunExternalDeployChecks(): boolean {
    return this.options.projectConfig.deploy?.enabled !== false;
  }

  private shouldRunCloudDeployChecks(): boolean {
    if (this.isArenaRuntime) return false;
    if (!this.shouldRunExternalDeployChecks()) return false;
    return !!(this.options.projectConfig.deploy?.waitForDeploy && this.github);
  }

  private shouldRunLocalPreviewVerification(): boolean {
    if (this.isArenaRuntime) return false;
    return this.shouldRunExternalDeployChecks();
  }

  private getConfiguredHealthPath(): string | undefined {
    const raw = this.options.projectConfig.deploy?.healthCheckUrl?.trim();
    if (!raw) return undefined;

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        return `${parsed.pathname || '/'}${parsed.search || ''}`;
      } catch {
        return undefined;
      }
    }

    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  private async resolvePreferredHealthPath(): Promise<string | undefined> {
    const configured = this.getConfiguredHealthPath();
    if (configured) return configured;
    return this.localDocker ? await this.localDocker.getHealthPath() : undefined;
  }
  
  private async waitForDeploy(): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!this.github) return { success: true };
    
    const spinner = ora('Waiting for deploy...').start();
    
    try {
      const { execa } = await import('execa');
      const { stdout: commitSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: this.options.workDir,
      });
      
      const result = await this.github.waitForDeploy(
        commitSha.trim(),
        this.options.projectConfig.deploy?.timeoutMinutes || 15
      );
      
      if (result.status === 'success') {
        spinner.succeed(`Deploy successful${result.url ? `: ${result.url}` : ''}`);
        return { success: true, url: result.url };
      } else {
        spinner.fail('Deploy failed');
        return { success: false, error: result.logs };
      }
    } catch (error: any) {
      spinner.fail('Deploy check failed');
      return { success: false, error: error.message };
    }
  }
  
  private async handleDeployFailure(error: string): Promise<void> {
    this.deployAttempts++;
    this.consecutiveFailures++;
    const maxDeployRetries = this.options.ralphConfig.maxDeployRetries;
    const skipOnFailure = this.options.ralphConfig.skipDeployOnFailure;

    log.error(`Deploy failed (attempt ${this.deployAttempts}/${maxDeployRetries}): ${error.split('\n')[0]}`);
    
    await this.recordIteration(
      { success: true, output: '', filesChanged: [], completionPromiseFound: false },
      'deploy_failed',
      [error.split('\n')[0]]
    );
    
    const errorClass = this.classifyDeployError(error);
    log.info(`Error classification: ${errorClass}`);

    const isSameError = this.lastDeployError !== '' && 
      this.normalizeError(error) === this.normalizeError(this.lastDeployError);
    this.lastDeployError = error;

    if (isSameError) {
      log.warn('Same deploy error as previous attempt - likely not fixable by code changes');
    }

    const exhausted = this.deployAttempts >= maxDeployRetries;
    const notRetriable = errorClass === 'infra' || (isSameError && this.deployAttempts >= 2);

    if (this.isArenaRuntime && errorClass === 'infra') {
      await this.pauseArenaRun('infra', error.split('\n')[0]);
      return;
    }

    if (exhausted || notRetriable) {
      if (skipOnFailure) {
        log.warn(
          exhausted
            ? `Deploy retry limit (${maxDeployRetries}) reached - marking task completed with deploy warning`
            : `Deploy error not fixable by code (${errorClass}) - skipping deploy`
        );
        this.previousErrors = [];
        this.markTaskComplete();
        return;
      } else {
        log.error('Deploy failed and skipDeployOnFailure is disabled - failing task');
        if (this.currentTask) {
          this.currentTask.status = 'failed';
          this.progress.updateFeature(this.currentTask.id, { status: 'failed' });
          this.savePlanState();
          this.currentTask = null;
        }
        return;
      }
    }

    this.previousErrors = [`DEPLOY ERROR (${errorClass}, attempt ${this.deployAttempts}/${maxDeployRetries}):\n${error}`];
    this.setState('recovery');
    
    if (this.currentTask) {
      this.currentTask.attempts++;
      this.currentTask.lastError = error;
    }
  }

  private classifyDeployError(error: string): 'code' | 'infra' | 'config' {
    const lower = error.toLowerCase();
    const infraPatterns = [
      'cannot connect to the docker daemon',
      'docker daemon is not running',
      'port is already allocated',
      'address already in use',
      'no space left on device',
      'permission denied',
      'network .* not found',
    ];
    for (const p of infraPatterns) {
      if (new RegExp(p).test(lower)) return 'infra';
    }
    const configPatterns = [
      'dockerfile',
      'docker-compose',
      'unknown or unexpected option',
      'exited with code',
      'command not found',
      'no such file or directory',
      'module not found',
      'cannot find module',
    ];
    for (const p of configPatterns) {
      if (lower.includes(p)) return 'config';
    }
    return 'code';
  }

  private normalizeError(error: string): string {
    return error
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[\w.+-]*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  private markTaskComplete(): void {
    if (this.currentTask) {
      this.currentTask.status = 'completed';
      delete this.currentTask.lastError;
      this.progress.completeFeature(this.currentTask.id, 'completed');
      log.success(`Task ${formatTaskLogLabel(this.currentTask)} completed!`);
      this.completedTasksSinceLastControl++;
      this.currentTask = null;
      this.deployAttempts = 0;
      this.lastDeployError = '';
      this.consecutiveEmptyCommits = 0;
      this.savePlanState();
    }
  }

  private async refreshArenaRuntimePreviewAfterTaskCompletion(): Promise<boolean> {
    return this.refreshArenaRuntimePreview('task_completion');
  }

  private async refreshArenaRuntimePreview(trigger: string): Promise<boolean> {
    if (!this.isArenaRuntime) return false;
    if (!this.currentTask) return false;

    const controlUrl = this.resolveArenaRuntimePreviewControlUrl();
    if (!controlUrl) {
      log.warn('Preview refresh skipped: invalid Arena preview control port');
      return false;
    }

    const url = new URL('/__arena/internal/refresh-preview', controlUrl);
    url.searchParams.set('trigger', trigger);
    url.searchParams.set('taskId', this.currentTask.id);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.text();
      if (!response.ok) {
        log.warn(`Preview refresh failed (${response.status}) ${body.slice(0, 240)}`);
        return false;
      }

      let parsed: unknown = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        parsed = null;
      }
      if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).previewActual !== 'SERVING') {
        log.warn('Preview refresh did not return SERVING');
        return false;
      }

      log.info(`Preview refreshed (${trigger})`);
      return true;
    } catch (error) {
      log.warn(`Preview refresh failed: ${this.describeFatalError(error)}`);
      return false;
    }
  }

  private resolveArenaRuntimePreviewControlUrl(): string | null {
    const rawPort = process.env.ARENA_PREVIEW_CONTROL_PORT?.trim() || '3999';
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
    return `http://127.0.0.1:${port}`;
  }

  private recordCurrentTaskTargetEvidence(): void {
    if (!this.currentTask || !this.lastVerification) return;
    const evidence = collectTaskVerificationEvidence(this.currentTask, this.lastVerification);
    if (evidence.length === 0) return;
    this.planManager.recordTaskVerificationEvidence(this.currentTask.id, evidence);
  }

  /**
   * Persist spec-driven plan task state.
   */
  private savePlanState(): void {
    this.flushTaskStateNow().catch(err => {
      log.warn(`Failed to save task state: ${err}`);
    });
  }

  private stopIfTerminated(phase: string): 'no_work' | null {
    if (!this.terminated) return null;
    log.info(`Termination latched during ${phase} — skipping further completion-side effects`);
    return 'no_work';
  }

  private async flushTaskStateNow(): Promise<void> {
    if (!this.planManager.hasPlan) return;
    await this.planManager.save();
  }
  
  private setState(state: LoopState): void {
    this.state = state;
    this.progress.setState(state);
    log.state(state);
  }

  /**
   * Run Vision QA: e2e tests with video → ffmpeg frames → GPT-4o → report.
   * Stores the structured report in this.lastVisionReport for controller use.
   */
  private async runVisionQA(): Promise<void> {
    const visionConfig = this.options.ralphConfig.visionQA;
    if (!visionConfig?.enabled) return;

    const apiKey = visionConfig.openaiApiKey || process.env.OPENAI_API_KEY;
    const openaiBaseUrl = apiKey === process.env.OPENAI_API_KEY
      ? process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE
      : undefined;
    if (!apiKey) {
      log.warn('Vision QA: no OpenAI API key configured, skipping');
      return;
    }

    if (!this.dynamicAppPort) {
      log.warn('Vision QA: no deployed app port available, skipping');
      return;
    }

    const baseUrl = `http://localhost:${this.dynamicAppPort}`;
    const healthPath = await this.resolvePreferredHealthPath();
    const healthCheckUrl = `${baseUrl}${healthPath || '/health'}`;

    log.divider();
    log.info('🎥 Running Vision QA (e2e video analysis)...');

    try {
      const report = await runVisionQA({
        projectDir: this.options.workDir,
        baseUrl,
        healthCheckUrl,
        openaiApiKey: apiKey,
        openaiBaseUrl,
        workDir: this.options.workDir,
        model: visionConfig.model,
        fps: visionConfig.fps,
        maxFramesPerTest: visionConfig.maxFramesPerTest,
      });

      this.lastVisionReport = report;
      log.info(`Vision QA complete: ${report.visionPassed} pass / ${report.visionFailed} fail — $${report.totalCost.toFixed(4)}`);
    } catch (err: any) {
      log.error(`Vision QA failed: ${err.message}`);
      this.lastVisionReport = {
        status: 'skipped',
        timestamp: new Date().toISOString(),
        totalTests: 0,
        playwrightPassed: 0,
        visionPassed: 0,
        visionFailed: 0,
        totalCost: 0,
        results: [],
        summary: `## Visual QA Report\nError: ${err.message}`,
      };
    }
  }

  private async finalize(): Promise<void> {
    const duration = Date.now() - this.startTime;

    // Set exit reason based on final state
    if (this.state === 'completed') {
      this.exitReason = 'success';
    }

    await this.progress.save();
    
    const stats = this.planManager.getStats();
    const controllerAddedTasks = this.planManager.getAllTasks().filter(t => t.addedBy === 'controller').length;
    const taskBreakdown = formatPlanTaskBreakdown(stats);
    const actionableCompletion = formatActionableCompletion(stats);

    log.divider();
    log.box('Ralph Project Report', [
      `Status: ${this.state}`,
      'Mode: spec-driven',
      `Total Iterations: ${this.iteration}`,
      `Duration: ${formatDuration(duration)}`,
      '',
      `Phases: ${stats.completedPhases}/${stats.totalPhases} completed`,
      `Tasks: ${taskBreakdown}` + (controllerAddedTasks > 0 ? ` (${controllerAddedTasks} added by Controller)` : ''),
      `Judgments: ${stats.totalJudgments}` + (stats.revisedJudgments > 0 ? ` (${stats.revisedJudgments} revised)` : ''),
      `Actionable Completion: ${actionableCompletion}`,
    ].join('\n'));

    // Final commit: capture only loop-owned state. Product/source changes are
    // owned by executor source delivery, not by terminal state bookkeeping.
    if (this.options.ralphConfig.autoCommit) {
      const finalResult = await this.git.commitPaths(
        'chore: final run state',
        [...LOOP_DURABLE_STATE_COMMIT_PATHS],
      );
      if (finalResult.success && finalResult.hash !== 'no-changes' && this.options.ralphConfig.autoPush) {
        const pushResult = await this.git.push();
        if (!pushResult.success) {
          await this.pauseForSourceDeliveryFailure('final run state push', pushResult.error);
        }
      }
    }

    await this.writeTerminalResult();
    await this.progress.save();
  }

  // ── RA-247: Long-running idle watch ──────────────────────

  /**
   * Block until new spec changes are detected or SIGTERM received.
   * Returns true if new specs found, false if terminated.
   */
  private async watchForNewSpecs(): Promise<boolean> {
    const POLL_INTERVAL_MS = 30_000;
    const HEARTBEAT_INTERVAL_MS = 60_000;

    if (this.isArenaRuntime) {
      log.info('Arena runtime: skip resident idle watch — runner owns preview and idle supervision');
      return false;
    }

    log.info('Entering idle watch mode — waiting for spec changes');

    this.setState('idle');
    this.currentTask = null;
    this.progress.setCurrentTask(undefined);
    await this.progress.save();

    // Resident idle is not terminal. Clear stale result.json from the last work cycle.
    await this.clearTerminalResult();

    const specPath = this.options.specPath || this.options.specDirPath;
    if (!specPath) {
      log.warn('No spec path configured — cannot watch for changes');
      return false;
    }

    let lastHeartbeat = Date.now();

    while (!this.terminated) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (this.terminated) break;

      // Heartbeat: keep progress.json fresh so runner doesn't idle-kill us
      if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        this.progress.setState('idle');
        await this.progress.save();
        lastHeartbeat = Date.now();
      }

      try {
        const hasPending = await this.hasPendingSpecMigrations(specPath);
        if (hasPending) {
          log.info('New spec changes detected — starting new work cycle');
          return true;
        }
      } catch (err) {
        log.warn(`Spec check failed (will retry): ${err}`);
      }
    }

    log.info('Terminated during idle watch');
    return false;
  }

  /**
   * Reset state for a new work cycle after spec changes detected.
   */
  private async prepareNewCycle(): Promise<void> {
    const specPath = this.options.specPath!;

    this.setState('planning');
    this.iteration = 0;
    this.previousErrors = [];
    this.pauseReason = null;
    this.pauseRetryAt = null;
    this.manualPauseRequested = false;
    this.startTime = Date.now();

    await this.applyPendingSpecMigrations(specPath);

    if (this.options.ralphConfig.controller.enabled) {
      await this.runController('spec_migration');
      if (this.isPaused()) return;
    }

    this.syncProgressFeaturesFromPlan();
  }

  /**
   * Graceful shutdown: commit WIP and push on SIGTERM/SIGINT.
   */
  async gracefulShutdown(): Promise<void> {
    await this.syncPauseReasonFromStopRequest();
    const verificationInterrupted = this.state === 'verification' || this.state === 'deploy_verification';
    const verificationInterruptionMessage = this.state === 'deploy_verification'
      ? 'Deploy verification interrupted by signal before completion'
      : 'Verification interrupted by signal before completion';
    const shutdownMessage = this.pauseReason === 'manual'
      ? 'Manual evidence required — awaiting resume'
      : this.pauseReason === 'budget'
        ? 'Budget threshold reached — awaiting resume'
        : this.pauseReason === 'rate_limit'
          ? 'Rate limit pause — awaiting resume'
          : this.manualPauseRequested
            ? 'Agent stopped by operator — awaiting resume'
            : verificationInterrupted
              ? verificationInterruptionMessage
              : 'Interrupted by signal — awaiting resume';

    this.terminated = true;
    if (!this.pauseReason && !this.manualPauseRequested) {
      this.pauseReason = 'infra';
    }
    this.exitReason = 'paused';
    if (verificationInterrupted && this.currentTask) {
      this.currentTask.lastError = verificationInterruptionMessage;
    }
    this.setState('idle');
    this.progress.setArenaPause(this.getArenaPauseState(), shutdownMessage);
    await this.flushTaskStateNow();
    await this.writeTerminalResult(shutdownMessage);
    await this.progress.save();
    await this.clearStopRequestArtifact();

    if (this.options.ralphConfig.autoCommit) {
      const result = await this.git.commit('wip: interrupted by signal');
      if (result.success && result.hash !== 'no-changes' && this.options.ralphConfig.autoPush) {
        await this.git.push();
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async loadSpecContent(): Promise<string | undefined> {
    if (!this.options.specPath) return undefined;
    try {
      return await fs.readFile(this.options.specPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  // ── Iteration History ────────────────────────────────────────

  private async loadIterationHistory(): Promise<void> {
    try {
      if (await fs.pathExists(this.iterationLogPath)) {
        this.iterationHistory = await fs.readJson(this.iterationLogPath);
      }
    } catch {
      this.iterationHistory = [];
    }
  }

  private async recoverIterationCounter(): Promise<void> {
    const progressIterations = this.progress.getProgress().totalIterations;
    const historyIterations = this.getMaxIterationFromHistory();
    const agentLogIterations = await this.getMaxIterationFromAgentLogs();
    const recoveredIterations = Math.max(progressIterations, historyIterations, agentLogIterations);

    if (this.progress.ensureTotalIterationsAtLeast(recoveredIterations)) {
      log.info(
        `Recovered iteration counter: progress=${progressIterations}, iteration-log=${historyIterations}, agent-logs=${agentLogIterations} -> using ${recoveredIterations}`,
      );
    }
  }

  private getMaxIterationFromHistory(): number {
    let maxIteration = 0;
    for (const entry of this.iterationHistory) {
      if (!entry || typeof entry.iteration !== 'number' || !Number.isFinite(entry.iteration)) {
        continue;
      }
      maxIteration = Math.max(maxIteration, Math.floor(entry.iteration));
    }
    return maxIteration;
  }

  private async getMaxIterationFromAgentLogs(): Promise<number> {
    const logsDir = path.join(this.options.workDir, '.ralph', 'agent-logs');
    if (!await fs.pathExists(logsDir)) return 0;

    let maxIteration = 0;
    const entries = await fs.readdir(logsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^iter-(\d+)-.*\.md$/i);
      if (!match) continue;
      const parsed = Number.parseInt(match[1], 10);
      if (!Number.isFinite(parsed)) continue;
      maxIteration = Math.max(maxIteration, parsed);
    }
    return maxIteration;
  }

  private async saveIterationHistory(): Promise<void> {
    await fs.ensureDir(path.dirname(this.iterationLogPath));
    await fs.writeJson(this.iterationLogPath, this.iterationHistory, { spaces: 2 });
  }

  private async recordIteration(
    agentResult: AgentResult,
    outcome: IterationLog['outcome'],
    errors?: string[],
    executorOutput?: IterationLog['executorOutput'],
  ): Promise<void> {
    const entry: IterationLog = {
      iteration: this.iteration,
      taskId: this.currentTask?.id || 'unknown',
      timestamp: new Date().toISOString(),
      outcome,
      filesChanged: this.resolveIterationFilesChanged(agentResult, executorOutput),
      verificationPassed: this.lastVerification?.passed ?? false,
      errors: errors?.map(e => e.split('\n')[0].slice(0, 200)),
      summary: this.extractSummary(agentResult.output),
      ...(executorOutput ? { executorOutput } : {}),
    };

    this.iterationHistory.push(entry);
    await this.saveIterationHistory();
  }

  private resolveIterationFilesChanged(
    agentResult: AgentResult,
    executorOutput?: IterationLog['executorOutput'],
  ): string[] {
    if (!executorOutput) return agentResult.filesChanged;
    return Array.from(new Set([
      ...executorOutput.summary.changedProductFiles,
      ...executorOutput.summary.changedTaskWorkspaceFiles,
      ...executorOutput.summary.forbiddenChangedFiles,
      ...executorOutput.summary.adHocProofLikeFiles,
    ]));
  }

  private getTaskHistory(taskId: string): IterationLog[] {
    return this.iterationHistory.filter(e => e.taskId === taskId);
  }

  private extractSummary(output: string): string {
    if (!output) return '';

    const lines = output.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'result' && msg.result) {
          return msg.result.slice(0, 300);
        }
      } catch {
        // Not JSON
      }
    }

    const lastChunk = output.slice(-500).trim();
    const sentences = lastChunk.split(/[.!\n]/).filter(s => s.trim().length > 10);
    return sentences.length > 0 ? sentences[sentences.length - 1].trim().slice(0, 200) : '';
  }

  /**
   * Check if code is running inside a Docker container
   */
  private async isRunningInContainer(): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      // Check for /.dockerenv file (common indicator)
      try {
        await fs.access('/.dockerenv');
        return true;
      } catch {
        // File doesn't exist
      }

      // Check /proc/1/cgroup for docker or containerd
      try {
        const cgroup = await fs.readFile('/proc/1/cgroup', 'utf-8');
        return cgroup.includes('docker') || cgroup.includes('containerd');
      } catch {
        // File doesn't exist or not accessible
      }

      return false;
    } catch {
      return false;
    }
  }

  private async writeTerminalResult(reasonOverride?: string): Promise<void> {
    const resultPath = path.join(this.options.workDir, '.arena', 'result.json');
    await fs.ensureDir(path.dirname(resultPath));

    const status = this.resolveTerminalStatus();
    const reason = this.resolveTerminalReason(status, reasonOverride);
    await fs.writeJson(resultPath, {
      status,
      reason,
      ...(this.exitReason === 'paused' && this.pauseReason
        ? { pauseReason: this.pauseReason.toUpperCase() }
        : {}),
      ...(this.exitReason === 'paused' && this.pauseReason === 'rate_limit' && this.pauseRetryAt
        ? { retryAt: this.pauseRetryAt }
        : {}),
    });
  }

  private async clearTerminalResult(): Promise<void> {
    const resultPath = path.join(this.options.workDir, '.arena', 'result.json');
    try {
      await fs.remove(resultPath);
    } catch {
      // Best-effort cleanup: idle watch can continue even if stale result cleanup fails.
    }
  }

  private async syncPauseReasonFromStopRequest(): Promise<void> {
    if (this.pauseReason || this.manualPauseRequested) return;

    const stopRequestPath = path.join(this.options.workDir, '.arena', 'stop-request.json');
    try {
      const parsed = await fs.readJson(stopRequestPath);
      if (parsed?.pauseReason === 'BUDGET') {
        this.pauseReason = 'budget';
      } else if (parsed?.pauseReason === 'RATE_LIMIT') {
        this.pauseReason = 'rate_limit';
      } else if (parsed?.pauseReason === 'INFRA') {
        this.pauseReason = 'infra';
      } else if (parsed?.pauseReason === 'MANUAL') {
        this.pauseReason = 'manual';
      } else if (parsed?.interruption === 'manual' || parsed?.reason === 'agent_off') {
        this.manualPauseRequested = true;
      }
    } catch {
      // Best-effort read only: missing or malformed stop request falls back to inferred shutdown reason.
    }
  }

  private async clearStopRequestArtifact(): Promise<void> {
    const stopRequestPath = path.join(this.options.workDir, '.arena', 'stop-request.json');
    try {
      await fs.remove(stopRequestPath);
    } catch {
      // Best-effort cleanup only.
    }
  }

  private getArenaPauseState(): 'paused_budget' | 'paused_rate_limit' | 'paused_infra' | 'paused_manual' {
    if (this.pauseReason === 'manual') return 'paused_manual';
    if (this.pauseReason === 'budget') return 'paused_budget';
    if (this.pauseReason === 'rate_limit') return 'paused_rate_limit';
    if (this.manualPauseRequested) return 'paused_manual';
    return 'paused_infra';
  }

  private resolveTerminalStatus(): string {
    if (this.state === 'completed' && this.planManager.hasPlan) {
      const tasks = this.planManager.getAllTasks();
      const hasCompletedTask = tasks.some(t => t.status === 'completed');
      if (tasks.length > 0 && !hasCompletedTask) {
        log.warn(`All ${tasks.length} tasks skipped or failed — marking as FAILED`);
        return 'FAILED';
      }
      return 'DEPLOYED';
    }

    if (this.state === 'completed') {
      return 'DEPLOYED';
    }

    if (this.exitReason === 'paused' && (this.pauseReason || this.manualPauseRequested)) {
      return 'CANCELED';
    }

    return 'FAILED';
  }

  private resolveTerminalReason(status: string, reasonOverride?: string): string {
    if (reasonOverride?.trim()) {
      return reasonOverride.trim().slice(0, 4000);
    }

    if (status === 'FAILED' && this.state === 'completed') {
      return 'All tasks skipped or failed, no completed work';
    }

    if (status === 'FAILED') {
      const failureDetail = this.previousErrors.find(message => message.trim());
      if (failureDetail) {
        return failureDetail.trim().slice(0, 4000);
      }
    }

    if (this.exitReason === 'paused') {
      const pauseDetail = this.previousErrors.find(message => message.trim());
      if (pauseDetail) {
        return pauseDetail.trim().slice(0, 4000);
      }
    }

    if (this.exitReason === 'paused' && this.pauseReason) {
      return `paused_${this.pauseReason}`;
    }
    if (this.exitReason === 'paused' && this.manualPauseRequested) {
      return 'paused_manual';
    }

    return this.exitReason || this.state;
  }

  private describeFatalError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    if (typeof error === 'string' && error.trim()) {
      return error.trim().slice(0, 4000);
    }
    return 'fatal_error';
  }
}
