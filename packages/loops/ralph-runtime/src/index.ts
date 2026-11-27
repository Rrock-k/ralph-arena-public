#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { config as dotenvConfig } from 'dotenv';
import { log } from './utils/logger.js';
import { startLogCapture, stopLogCapture } from './utils/log-file.js';
import { exportRalphPromptRepository } from './prompts/repository.js';
import { formatPromptLabReplayResult, replayPromptFixtureFile } from './prompts/prompt-lab.js';

// Load environment variables
dotenvConfig();

const program = new Command();

program
  .name('ralph')
  .description('Ralph Loop - Autonomous agent development framework')
  .version('1.4.0');

program
  .command('run')
  .description('Start the Ralph loop')
  .option('-w, --work-dir <path>', 'Working directory', process.cwd())
  .option('-c, --config <path>', 'Path to ralph.config.json')
  .option('-p, --project <path>', 'Path to project.config.json')
  .option('-s, --spec <path>', 'Path to spec.md')
  .option('--spec-dir <path>', 'Path to specs directory (alternative to --spec)')
  .option('-a, --agent <type>', 'Agent type: claude-code, codex, antigravity, or opencode', 'claude-code')
  .option('-m, --model <model>', 'Model to use (e.g. haiku, sonnet, gpt-4o)')
  .action(async (options) => {
    let executor: any | undefined;
    try {
      console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██████╗  █████╗ ██╗     ██████╗ ██╗  ██╗                   ║
║   ██╔══██╗██╔══██╗██║     ██╔══██╗██║  ██║                   ║
║   ██████╔╝███████║██║     ██████╔╝███████║                   ║
║   ██╔══██╗██╔══██║██║     ██╔═══╝ ██╔══██║                   ║
║   ██║  ██║██║  ██║███████╗██║     ██║  ██║                   ║
║   ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝                   ║
║                                                              ║
║   Autonomous Agent Loop Framework                            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`));

      const workDir = path.resolve(options.workDir);

      // Start capturing all output to a log file
      const logFile = await startLogCapture(workDir);

      // Load .env from work directory (project-specific env vars)
      dotenvConfig({ path: path.join(workDir, '.env'), override: true });

      // Load configs
      const ralphConfig = await loadRalphConfig(options.config, workDir, options);
      const projectConfig = await loadProjectConfig(options.project, workDir);

      // Ralph is spec-driven: a spec file or spec directory is required.
      const specPath = options.spec ? path.resolve(options.spec) : undefined;
      const specDirPath = options.specDir ? path.resolve(options.specDir) : undefined;
      if (!specPath && !specDirPath) {
        throw new Error('Ralph requires --spec <path> or --spec-dir <path>. Legacy tasks.json / --prompt mode has been removed.');
      }

      log.info(`Working directory: ${workDir}`);
      log.info(`Log file: ${logFile}`);
      log.info(`Agent: ${ralphConfig.agent}`);
      if (ralphConfig.model) log.info(`Model: ${ralphConfig.model}`);
      log.info('Mode: spec-driven');
      if (specPath) log.info(`Spec: ${specPath}`);
      if (specDirPath) log.info(`Spec dir: ${specDirPath}`);
      log.divider();

      // Create and run executor
      const { LoopExecutor } = await import('./loop/executor.js');
      executor = new LoopExecutor({
        workDir,
        ralphConfig,
        projectConfig,
        specPath,
        specDirPath,
        githubToken: process.env.GITHUB_TOKEN,
      });

      // SIGTERM/SIGINT: commit WIP and exit gracefully (Arena contract)
      let shuttingDown = false;
      const handleSignal = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        log.warn(`Received ${signal} — committing WIP and shutting down...`);
        try {
          await executor!.gracefulShutdown();
        } catch (err: any) {
          log.error(`Shutdown error: ${err.message}`);
        }
        await stopLogCapture();
        process.exit(executor?.exitReason === 'paused' ? 2 : 0);
      };
      process.on('SIGTERM', () => { handleSignal('SIGTERM'); });
      process.on('SIGINT', () => { handleSignal('SIGINT'); });

      await executor.run();

      await stopLogCapture();

      // Arena contract: exit 0 on success, non-zero on pause/failure
      if (executor.exitReason === 'paused') process.exit(2);

    } catch (error: any) {
      await stopLogCapture();
      if (executor?.exitReason === 'paused') {
        log.warn(`Paused: ${error.message}`);
        process.exit(2);
      }
      log.error(error.message);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize Ralph configuration in current directory')
  .option('-w, --work-dir <path>', 'Working directory', process.cwd())
  .action(async (options) => {
    const workDir = path.resolve(options.workDir);
    
    // Create .arena (contract) and .ralph (internal state) directories
    await fs.ensureDir(path.join(workDir, '.arena'));
    await fs.ensureDir(path.join(workDir, '.ralph'));
    
    // Create default ralph.config.json
    const ralphConfig = {
      agent: 'claude-code',
      verificationLevel: 'standard',
      maxRetries: 5,
      completionPromise: 'TASK_COMPLETE',
      autoCommit: true,
      autoPush: true,
      verbose: true,
    };
    await fs.writeJson(
      path.join(workDir, 'ralph.config.json'), 
      ralphConfig, 
      { spaces: 2 }
    );
    
    // Create default project.config.json
    const projectConfig = {
      name: path.basename(workDir),
      description: 'Project description',
      techStack: {
        language: 'typescript',
        framework: 'node',
      },
      repository: {
        url: '',
        branch: 'main',
      },
      deploy: {
        enabled: true,
        waitForDeploy: true,
        timeoutMinutes: 10,
        localDocker: {
          enabled: true,
          composeFile: 'docker-compose.yml',
        },
      },
    };
    await fs.writeJson(
      path.join(workDir, 'project.config.json'),
      projectConfig,
      { spaces: 2 }
    );
    
    await fs.writeFile(
      path.join(workDir, 'spec.md'),
      `# ${path.basename(workDir)}\n\nDescribe the product behavior Ralph should build.\n`,
    );
    
    // Create .github/workflows/ci.yml
    const ciWorkflowDir = path.join(workDir, '.github', 'workflows');
    await fs.ensureDir(ciWorkflowDir);
    const ciWorkflow = `name: CI

on:
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Check if project is initialized
        id: check
        run: |
          if [ ! -f "package.json" ]; then
            echo "skip=true" >> "\\$GITHUB_OUTPUT"
          fi

      - name: Install dependencies
        if: steps.check.outputs.skip != 'true'
        run: npm ci

      - name: Generate Prisma client
        if: steps.check.outputs.skip != 'true' && hashFiles('prisma/schema.prisma') != ''
        run: npx prisma generate

      - name: Lint
        if: steps.check.outputs.skip != 'true'
        run: npm run lint --if-present

      - name: Build
        if: steps.check.outputs.skip != 'true'
        run: npm run build

      - name: Test
        if: steps.check.outputs.skip != 'true'
        run: npm test --if-present
`;
    await fs.writeFile(path.join(ciWorkflowDir, 'ci.yml'), ciWorkflow);
    
    // Create Dockerfile template
    const dockerfile = `# --- Stage 1: Dependencies ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- Stage 2: Build ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage 3: Production ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 appuser

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER appuser
EXPOSE 3000
CMD ["node", "server.js"]
`;
    if (!(await fs.pathExists(path.join(workDir, 'Dockerfile')))) {
      await fs.writeFile(path.join(workDir, 'Dockerfile'), dockerfile);
    }
    
    // Create .gitignore
    const gitignore = `node_modules/
.next/
dist/
*.db
*.db-journal
.env
.env.local
.arena/*
*.log
.ralph/
`;
    if (!(await fs.pathExists(path.join(workDir, '.gitignore')))) {
      await fs.writeFile(path.join(workDir, '.gitignore'), gitignore);
    }

    log.success('Ralph configuration initialized!');
    log.info('Files created:');
    log.info('  - ralph.config.json');
    log.info('  - project.config.json');
    log.info('  - spec.md');
    log.info('  - .arena/ (contract)');
    log.info('  - .ralph/ (internal state)');
    log.info('  - .github/workflows/ci.yml');
    log.info('  - Dockerfile');
    log.info('  - docker-compose.yml');
    log.info('  - .gitignore');
    log.info('');
    log.info('Next steps:');
    log.info('  1. Edit project.config.json with your project details');
    log.info('  2. Edit spec.md with the accepted product spec');
    log.info('  3. Set repository.url in project.config.json');
    log.info('  4. Create GitHub repo and add remote');
    log.info('  5. Set GITHUB_TOKEN in .env');
    log.info('  6. Run: npm run ralph -- run --work-dir <project-dir> --spec spec.md');
  });

program
  .command('status')
  .description('Show current Ralph loop status')
  .option('-w, --work-dir <path>', 'Working directory', process.cwd())
  .action(async (options) => {
    const workDir = path.resolve(options.workDir);
    const progressPath = path.join(workDir, '.ralph', 'ralph-progress.json');
    const arenaProgressPath = path.join(workDir, '.arena', 'progress.json');
    
    if (!(await fs.pathExists(progressPath)) && !(await fs.pathExists(arenaProgressPath))) {
      log.info('No Ralph loop progress found. Run `ralph init` first.');
      return;
    }

    if (await fs.pathExists(progressPath)) {
      const progress = await fs.readJson(progressPath);
      const arenaProgress = await fs.pathExists(arenaProgressPath)
        ? await fs.readJson(arenaProgressPath)
        : null;
      const steps = Array.isArray(arenaProgress?.steps) ? arenaProgress.steps : [];
      const resolved = steps.filter((step: any) => step.status === 'completed' || step.status === 'done' || step.status === 'skipped').length;
      const skipped = steps.filter((step: any) => step.status === 'skipped').length;
      const taskLine = steps.length > 0
        ? `Resolved: ${resolved}/${steps.length}${skipped > 0 ? ` (${skipped} skipped)` : ''}`
        : 'Tasks: derived from .ralph/plan.json';
      log.box('Ralph Loop Status', `
Project: ${progress.projectName}
Started: ${progress.startedAt}
Last Updated: ${progress.lastUpdated}
State: ${progress.currentState}
Iterations: ${progress.totalIterations}

${taskLine}
Tests: ${progress.metrics?.testsPassing ?? 0}/${progress.metrics?.testsTotal ?? 0}
`);
      return;
    }

    const arenaProgress = await fs.readJson(arenaProgressPath);
    const steps = Array.isArray(arenaProgress.steps) ? arenaProgress.steps : [];
    const resolved = steps.filter((step: any) => step.status === 'completed' || step.status === 'done' || step.status === 'skipped').length;
    const skipped = steps.filter((step: any) => step.status === 'skipped').length;
    log.box('Ralph Loop Status', `
State: ${arenaProgress.state}
Message: ${arenaProgress.message || '(none)'}
Iterations: ${arenaProgress.iteration ?? 0}

Resolved: ${resolved}/${steps.length}${skipped > 0 ? ` (${skipped} skipped)` : ''}
`);
  });

const promptsCommand = program
  .command('prompts')
  .description('Inspect the Ralph Prompt Repository');

promptsCommand
  .command('export')
  .description('Export the read-only Ralph Prompt Repository')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action((options) => {
    if (options.format !== 'json') {
      log.error(`Unsupported prompt export format: ${options.format}`);
      process.exit(1);
    }

    const exported = exportRalphPromptRepository();
    console.log(JSON.stringify(exported, null, options.compact ? 0 : 2));
  });

promptsCommand
  .command('replay')
  .description('Render a repository-owned prompt from an explicit Prompt Lab fixture without model calls or runtime writes')
  .requiredOption('--fixture <path>', 'Path to a Prompt Lab fixture JSON file')
  .option('--format <format>', 'Output format: json or text', 'json')
  .option('--out <path>', 'Optional output file for disposable lab output')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json' && options.format !== 'text') {
        throw new Error(`Unsupported prompt replay format: ${options.format}`);
      }
      const result = await replayPromptFixtureFile({
        fixturePath: options.fixture,
        format: options.format,
        outPath: options.out,
        compact: options.compact,
      });
      if (!options.out) {
        process.stdout.write(formatPromptLabReplayResult(result, options.format, options.compact));
      }
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

const stageCommand = program
  .command('stage')
  .description('Run explicit RA-356 isolated stage workflows');

stageCommand
  .command('list')
  .description('List supported RA-356 isolated stage workflows without inspecting project or runtime truth')
  .option('--stage <stageId>', 'Filter to one isolated stage id')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported stage list format: ${options.format}`);
      }
      const {
        formatStageCatalogResult,
        getStageCatalogResult,
      } = await import('./stage-lab/catalog.js');
      process.stdout.write(formatStageCatalogResult(
        getStageCatalogResult({ stageId: options.stage }),
        options.compact,
      ));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

stageCommand
  .command('run <stageId>')
  .description('Run one isolated stage without auto-starting the next stage')
  .option('--fixture <path>', 'Path to the stage fixture JSON file for fixture-mode stages')
  .option('--snapshot <path>', 'Path to a Project Stage Snapshot JSON file for live-project adapter stages')
  .option('--mode <mode>', 'Explicit stage mode such as new_task, failed_task, or resume_interrupted')
  .option('--workspace-mode <mode>', 'Explicit workspace mode: fork or live_workspace_action')
  .option('--task-fixture <path>', 'Path to the executor workspace task fixture JSON file')
  .option('--prompt-fixture <path>', 'Path to the executor workspace prompt fixture JSON file')
  .option('--completion-promise <promise>', 'Explicit completion promise for executor workspace stage')
  .option('--work-dir <path>', 'Explicit forked git workspace for workspace-mutation stages')
  .option('--source-ref <ref>', 'Explicit git source ref; workspace HEAD must match')
  .option('--spec <path>', 'Explicit workDir-relative spec file for planner/controller dry-run stages')
  .option('--trigger <trigger>', 'Explicit controller trigger for controller dry-run stages')
  .option('--visual-evidence-mode <mode>', 'Explicit visual evidence mode for visual-aware planner/controller/executor stages: off, required, or new_tasks_only')
  .option('--out-dir <path>', 'Explicit output directory outside workDir for workspace-mutation stages')
  .option('--agent <type>', 'Explicit agent type for executor workspace stage: claude-code, codex, or opencode')
  .option('--model <model>', 'Explicit model/settings label for executor workspace stage')
  .option('--timeout-minutes <minutes>', 'Explicit agent timeout in minutes for executor workspace stage')
  .option('--prompt-variant <variant>', 'Optional explicit prompt/settings variant label')
  .option('--expected-story <storyId>', 'Expected Visual Workbench story id; may be repeated', collectRepeatedOption, [])
  .option('--visual-workbench-capture <path>', 'Visual Workbench capture run report to include in controller_visual_review; may be repeated', collectRepeatedOption, [])
  .option('--executor-workspace-report <path>', 'Path to executor-task-workspace-run.json for source snapshot handoff')
  .option('--commit-message <message>', 'Explicit local experiment commit message for source snapshot handoff')
  .option('--project-id <projectId>', 'Optional Arena project id for source snapshot/evidence readback handoff hints')
  .option('--out <path>', 'Optional output file for disposable stage output')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (stageId, options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported stage output format: ${options.format}`);
      }
      if (stageId === 'executor_task_workspace') {
        const {
          normalizeExecutorTaskWorkspaceStageRunOptions,
        } = await import('./stage-lab/executor-task-workspace-cli.js');
        const normalizedOptions = normalizeExecutorTaskWorkspaceStageRunOptions(options);
        const { createAgent } = await import('./agents/index.js');
        const {
          formatExecutorTaskWorkspaceResult,
          runExecutorTaskWorkspaceFiles,
        } = await import('./stage-lab/executor-task-workspace.js');
        const result = await runExecutorTaskWorkspaceFiles({
          taskFixturePath: normalizedOptions.taskFixturePath,
          promptFixturePath: normalizedOptions.promptFixturePath,
          completionPromise: normalizedOptions.completionPromise,
          visualEvidenceMode: normalizedOptions.visualEvidenceMode,
          expectedVisualWorkbenchStoryIds: normalizedOptions.expectedVisualWorkbenchStoryIds,
          promptVariantRef: normalizedOptions.promptVariantRef,
          workDir: normalizedOptions.workDir,
          sourceRef: normalizedOptions.sourceRef,
          outDir: normalizedOptions.outDir,
          agent: createAgent(normalizedOptions.agentType),
          model: normalizedOptions.model,
          timeoutMinutes: normalizedOptions.timeoutMinutes,
        });
        process.stdout.write(formatExecutorTaskWorkspaceResult(result, options.compact));
        return;
      }
      if (stageId === 'executor_task_workspace_continue') {
        const {
          normalizeExecutorTaskWorkspaceContinueStageRunOptions,
        } = await import('./stage-lab/executor-task-workspace-cli.js');
        const normalizedOptions = normalizeExecutorTaskWorkspaceContinueStageRunOptions(options);
        const { createAgent } = await import('./agents/index.js');
        const {
          formatExecutorTaskWorkspaceContinueResult,
          runExecutorTaskWorkspaceContinueFiles,
        } = await import('./stage-lab/executor-task-workspace-continue.js');
        const result = await runExecutorTaskWorkspaceContinueFiles({
          executorWorkspaceReportPath: normalizedOptions.executorWorkspaceReportPath,
          taskFixturePath: normalizedOptions.taskFixturePath,
          promptFixturePath: normalizedOptions.promptFixturePath,
          completionPromise: normalizedOptions.completionPromise,
          visualEvidenceMode: normalizedOptions.visualEvidenceMode,
          expectedVisualWorkbenchStoryIds: normalizedOptions.expectedVisualWorkbenchStoryIds,
          promptVariantRef: normalizedOptions.promptVariantRef,
          workDir: normalizedOptions.workDir,
          sourceRef: normalizedOptions.sourceRef,
          outDir: normalizedOptions.outDir,
          agent: createAgent(normalizedOptions.agentType),
          model: normalizedOptions.model,
          timeoutMinutes: normalizedOptions.timeoutMinutes,
        });
        process.stdout.write(formatExecutorTaskWorkspaceContinueResult(result, options.compact));
        return;
      }
      if (stageId === 'executor_project_task') {
        const {
          normalizeExecutorProjectTaskStageRunOptions,
        } = await import('./stage-lab/executor-task-workspace-cli.js');
        const normalizedOptions = normalizeExecutorProjectTaskStageRunOptions(options);
        const { createAgent } = await import('./agents/index.js');
        const {
          formatExecutorProjectTaskResult,
          runExecutorProjectTaskFiles,
        } = await import('./stage-lab/executor-project-task.js');
        const result = await runExecutorProjectTaskFiles({
          snapshotPath: normalizedOptions.snapshotPath,
          mode: normalizedOptions.mode,
          workspaceMode: normalizedOptions.workspaceMode,
          completionPromise: normalizedOptions.completionPromise,
          expectedVisualWorkbenchStoryIds: normalizedOptions.expectedVisualWorkbenchStoryIds,
          promptVariantRef: normalizedOptions.promptVariantRef,
          workDir: normalizedOptions.workDir,
          sourceRef: normalizedOptions.sourceRef,
          outDir: normalizedOptions.outDir,
          agent: createAgent(normalizedOptions.agentType),
          model: normalizedOptions.model,
          timeoutMinutes: normalizedOptions.timeoutMinutes,
        });
        process.stdout.write(formatExecutorProjectTaskResult(result, options.compact));
        return;
      }
      if (stageId === 'planner_project_dry_run') {
        const {
          normalizePlannerProjectDryRunStageRunOptions,
        } = await import('./stage-lab/executor-task-workspace-cli.js');
        const normalizedOptions = normalizePlannerProjectDryRunStageRunOptions(options);
        const { createAgent } = await import('./agents/index.js');
        const {
          formatPlannerProjectDryRunResult,
          runPlannerProjectDryRunFiles,
        } = await import('./stage-lab/planner-project-dry-run.js');
        const result = await runPlannerProjectDryRunFiles({
          snapshotPath: normalizedOptions.snapshotPath,
          workDir: normalizedOptions.workDir,
          sourceRef: normalizedOptions.sourceRef,
          spec: normalizedOptions.spec,
          visualEvidenceMode: normalizedOptions.visualEvidenceMode,
          outDir: normalizedOptions.outDir,
          agent: createAgent(normalizedOptions.agentType),
          model: normalizedOptions.model,
          timeoutMinutes: normalizedOptions.timeoutMinutes,
        });
        process.stdout.write(formatPlannerProjectDryRunResult(result, options.compact));
        return;
      }
      if (stageId === 'planner_spec_migration_apply') {
        const {
          normalizePlannerSpecMigrationApplyStageRunOptions,
        } = await import('./stage-lab/executor-task-workspace-cli.js');
        const normalizedOptions = normalizePlannerSpecMigrationApplyStageRunOptions(options);
        const { createAgent } = await import('./agents/index.js');
        const {
          formatPlannerSpecMigrationApplyResult,
          runPlannerSpecMigrationApplyFiles,
        } = await import('./stage-lab/planner-spec-migration-apply.js');
        const result = await runPlannerSpecMigrationApplyFiles({
          snapshotPath: normalizedOptions.snapshotPath,
          sourceRef: normalizedOptions.sourceRef,
          outDir: normalizedOptions.outDir,
          agent: createAgent(normalizedOptions.agentType),
          model: normalizedOptions.model,
          timeoutMinutes: normalizedOptions.timeoutMinutes,
        });
        process.stdout.write(formatPlannerSpecMigrationApplyResult(result, options.compact));
        return;
      }
      if (stageId === 'controller_project_dry_run') {
        const {
          normalizeControllerProjectDryRunStageRunOptions,
        } = await import('./stage-lab/executor-task-workspace-cli.js');
        const normalizedOptions = normalizeControllerProjectDryRunStageRunOptions(options);
        const { createAgent } = await import('./agents/index.js');
        const {
          formatControllerProjectDryRunResult,
          runControllerProjectDryRunFiles,
        } = await import('./stage-lab/controller-project-dry-run.js');
        const result = await runControllerProjectDryRunFiles({
          snapshotPath: normalizedOptions.snapshotPath,
          workDir: normalizedOptions.workDir,
          sourceRef: normalizedOptions.sourceRef,
          spec: normalizedOptions.spec,
          trigger: normalizedOptions.trigger,
          visualEvidenceMode: normalizedOptions.visualEvidenceMode,
          outDir: normalizedOptions.outDir,
          agent: createAgent(normalizedOptions.agentType),
          model: normalizedOptions.model,
          timeoutMinutes: normalizedOptions.timeoutMinutes,
        });
        process.stdout.write(formatControllerProjectDryRunResult(result, options.compact));
        return;
      }
      if (stageId === 'executor_workspace_source_snapshot') {
        const {
          normalizeExecutorWorkspaceSourceSnapshotStageRunOptions,
        } = await import('./stage-lab/executor-task-workspace-cli.js');
        const normalizedOptions = normalizeExecutorWorkspaceSourceSnapshotStageRunOptions(options);
        const {
          formatExecutorWorkspaceSourceSnapshotResult,
          runExecutorWorkspaceSourceSnapshotFiles,
        } = await import('./stage-lab/executor-workspace-source-snapshot.js');
        const result = await runExecutorWorkspaceSourceSnapshotFiles(normalizedOptions);
        process.stdout.write(formatExecutorWorkspaceSourceSnapshotResult(result, options.compact));
        return;
      }
      if (!options.fixture) {
        throw new Error(`${stageId} requires fixture-mode --fixture.`);
      }
      if (stageId === 'controller_visual_review') {
        const { assertFixtureStageRejectsWorkspaceProviderOptions } = await import('./stage-lab/executor-task-workspace-cli.js');
        assertFixtureStageRejectsWorkspaceProviderOptions(stageId, {
          ...options,
          visualWorkbenchCapture: undefined,
        });
        const {
          formatControllerVisualReviewResult,
          runControllerVisualReviewFixtureFile,
        } = await import('./stage-lab/controller-visual-review.js');
        const result = await runControllerVisualReviewFixtureFile({
          fixturePath: options.fixture,
          outPath: options.out,
          compact: options.compact,
          visualWorkbenchCaptureReportPaths: options.visualWorkbenchCapture,
        });
        if (!options.out) {
          process.stdout.write(formatControllerVisualReviewResult(result, options.compact));
        }
        return;
      }
      if ((options.visualWorkbenchCapture ?? []).length > 0) {
        throw new Error(`${stageId} does not accept --visual-workbench-capture; it is only supported by controller_visual_review.`);
      }
      const { assertFixtureStageRejectsWorkspaceProviderOptions } = await import('./stage-lab/executor-task-workspace-cli.js');
      assertFixtureStageRejectsWorkspaceProviderOptions(stageId, options);
      const { runStageFixtureFile } = await import('./stage-lab/catalog.js');
      const runResult = await runStageFixtureFile({
        stageId,
        fixturePath: options.fixture,
        outPath: options.out,
        compact: options.compact,
      });
      if (!options.out) {
        process.stdout.write(runResult.formatted);
      }
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

function collectRepeatedOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const visualScenariosCommand = program
  .command('visual-scenarios')
  .description('Run disposable Visual Scenario Lab workflows');

visualScenariosCommand
  .command('run')
  .description('Capture an ordinary-web visual scenario into disposable lab output without task, proof or lifecycle writes')
  .requiredOption('--scenario <path>', 'Path to a Visual Scenario JSON file')
  .requiredOption('--base-url <url>', 'Preview base URL to capture')
  .requiredOption('--out-dir <path>', 'Output directory for scenario-run.json and screenshot PNG')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported visual scenario run format: ${options.format}`);
      }
      const {
        formatVisualScenarioRunResult,
        runVisualScenarioFile,
      } = await import('./verification/visual-scenario-runner.js');
      const result = await runVisualScenarioFile({
        scenarioPath: options.scenario,
        baseUrl: options.baseUrl,
        outDir: options.outDir,
      });
      process.stdout.write(formatVisualScenarioRunResult(result, options.format, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualScenariosCommand
  .command('export-evidence')
  .description('Record a captured visual scenario as inconclusive task-linked verification evidence')
  .option('-w, --work-dir <path>', 'Working directory', process.cwd())
  .requiredOption('--run <path>', 'Path to a captured scenario-run.json file')
  .requiredOption('--task <taskId>', 'Task id whose feedback refs should receive the evidence')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported visual scenario evidence export format: ${options.format}`);
      }
      const {
        exportVisualScenarioEvidenceFile,
        formatVisualScenarioEvidenceExportResult,
      } = await import('./verification/visual-scenario-evidence.js');
      const result = await exportVisualScenarioEvidenceFile({
        workDir: options.workDir,
        runPath: options.run,
        taskId: options.task,
      });
      process.stdout.write(formatVisualScenarioEvidenceExportResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualScenariosCommand
  .command('assess')
  .description('Record an explicit manual assessment for an exported visual scenario evidence row')
  .option('-w, --work-dir <path>', 'Working directory', process.cwd())
  .requiredOption('--task <taskId>', 'Task id that owns the source visual scenario evidence')
  .requiredOption('--evidence-ref <ref>', 'Existing visual-scenario-run:* evidence ref on the task')
  .option('--kind <kind>', 'Assessment kind: manual_note', 'manual_note')
  .requiredOption('--result <result>', 'Assessment result: pass, fail or inconclusive')
  .requiredOption('--assessment <text>', 'Explicit manual assessment text')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported visual scenario assessment format: ${options.format}`);
      }
      const {
        assessVisualScenarioEvidenceFile,
        formatVisualScenarioAssessmentResult,
      } = await import('./verification/visual-scenario-evidence.js');
      const result = await assessVisualScenarioEvidenceFile({
        workDir: options.workDir,
        taskId: options.task,
        evidenceRef: options.evidenceRef,
        kind: options.kind,
        result: options.result,
        assessment: options.assessment,
      });
      process.stdout.write(formatVisualScenarioAssessmentResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualScenariosCommand
  .command('status')
  .description('Read visual scenario evidence and assessment status from task verification evidence')
  .option('-w, --work-dir <path>', 'Working directory', process.cwd())
  .option('--task <taskId>', 'Optional task id filter')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported visual scenario status format: ${options.format}`);
      }
      const {
        formatVisualScenarioStatusResult,
        getVisualScenarioStatusFile,
      } = await import('./verification/visual-scenario-evidence.js');
      const result = await getVisualScenarioStatusFile({
        workDir: options.workDir,
        taskId: options.task,
      });
      process.stdout.write(formatVisualScenarioStatusResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

const visualWorkbenchCommand = program
  .command('visual-workbench')
  .description('Run explicit Visual Workbench stage workflows');

visualWorkbenchCommand
  .command('browser-readiness')
  .description('Run visual_workbench_browser_readiness: check platform Playwright Chromium readiness before capture')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      const {
        formatPlatformBrowserReadinessResult,
        getPlatformBrowserReadiness,
      } = await import('./verification/browser-readiness.js');
      const result = await getPlatformBrowserReadiness();
      process.stdout.write(formatPlatformBrowserReadinessResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('inspect')
  .description('Run visual_workbench_manifest_readiness: inspect the source-owned Visual Workbench manifest without starting capture')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .option('--manifest <path>', 'Manifest path relative to work-dir', 'visual-workbench/manifest.json')
  .requiredOption('--source-ref <ref>', 'Explicit git source ref to inspect')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench inspect format: ${options.format}`);
      }
      const {
        formatVisualWorkbenchInspectResult,
        inspectVisualWorkbenchManifestFile,
      } = await import('./verification/visual-workbench-runner.js');
      const result = await inspectVisualWorkbenchManifestFile({
        workDir: options.workDir,
        manifestPath: options.manifest,
        sourceRef: options.sourceRef,
      });
      process.stdout.write(formatVisualWorkbenchInspectResult(result, options.format, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('capture')
  .description('Run visual_workbench_capture: start the source-owned workbench and capture explicit experiment artifacts')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .option('--manifest <path>', 'Manifest path relative to work-dir', 'visual-workbench/manifest.json')
  .requiredOption('--source-ref <ref>', 'Explicit git source ref to capture; current work-dir HEAD must match it')
  .requiredOption('--base-url <url>', 'Explicit http(s) base URL for the workbench server')
  .requiredOption('--out-dir <path>', 'Output directory for visual-workbench-capture-run.json and screenshots; must be outside work-dir')
  .option('--selection <selection>', 'Capture selection: full_manifest or story_viewports', 'full_manifest')
  .option('--story <storyId>', 'Story id required when --selection story_viewports is used')
  .option('--viewport <viewportName>', 'Viewport name required when --selection story_viewports is used; may be repeated', collectRepeatedOption, [])
  .option('--start-timeout-ms <ms>', 'Workbench start timeout in milliseconds', parseIntegerOption, 20_000)
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench capture format: ${options.format}`);
      }
      const {
        formatVisualWorkbenchCaptureResult,
        runVisualWorkbenchCaptureFile,
      } = await import('./verification/visual-workbench-runner.js');
      const result = await runVisualWorkbenchCaptureFile({
        workDir: options.workDir,
        manifestPath: options.manifest,
        sourceRef: options.sourceRef,
        baseUrl: options.baseUrl,
        outDir: options.outDir,
        selection: options.selection,
        storyId: options.story,
        viewportNames: options.viewport,
        startTimeoutMs: options.startTimeoutMs,
      });
      process.stdout.write(formatVisualWorkbenchCaptureResult(result, options.format, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('render-viewer')
  .description('Run visual_workbench_capture_viewer: render static index.html from an existing capture report')
  .requiredOption('--run <path>', 'Path to visual-workbench-capture-run.json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      const {
        formatVisualWorkbenchCaptureViewerResult,
        renderVisualWorkbenchCaptureViewerFile,
      } = await import('./verification/visual-workbench-runner.js');
      const result = await renderVisualWorkbenchCaptureViewerFile({
        runPath: options.run,
      });
      process.stdout.write(formatVisualWorkbenchCaptureViewerResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('shell-policy')
  .description('Run visual_workbench_shell_policy: read whether executor automation may start the source-owned Workbench command')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .option('--manifest <path>', 'Manifest path relative to work-dir', 'visual-workbench/manifest.json')
  .option('-c, --config <path>', 'Path to ralph.config.json')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench shell-policy format: ${options.format}`);
      }
      const workDir = path.resolve(options.workDir);
      const ralphConfig = await loadRalphConfig(options.config, workDir, {});
      const {
        formatVisualWorkbenchShellPolicyResult,
        getVisualWorkbenchShellPolicyFile,
      } = await import('./verification/visual-workbench-evidence.js');
      const result = await getVisualWorkbenchShellPolicyFile({
        workDir,
        manifestPath: options.manifest,
        ralphConfig,
      });
      process.stdout.write(formatVisualWorkbenchShellPolicyResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('automate-evidence')
  .description('Run visual_workbench_evidence_automation: selector + shell policy + capture + export + progress publish with explicit inputs')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .requiredOption('--manifest <path>', 'Manifest path relative to work-dir')
  .requiredOption('--task <taskId>', 'Task id whose explicit Workbench story selections should become evidence')
  .requiredOption('--source-ref <ref>', 'Explicit git source ref to capture; current work-dir HEAD must match it')
  .requiredOption('--base-url <url>', 'Explicit http(s) base URL for the workbench server')
  .requiredOption('--out-dir <path>', 'Output directory for capture artifacts; must be outside work-dir')
  .option('-c, --config <path>', 'Path to ralph.config.json')
  .option('--start-timeout-ms <ms>', 'Workbench start timeout in milliseconds', parseIntegerOption, 20_000)
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench evidence automation format: ${options.format}`);
      }
      const workDir = path.resolve(options.workDir);
      const ralphConfig = await loadRalphConfig(options.config, workDir, {});
      const {
        formatVisualWorkbenchEvidenceAutomationResult,
        runVisualWorkbenchEvidenceAutomation,
      } = await import('./verification/visual-workbench-automation.js');
      const result = await runVisualWorkbenchEvidenceAutomation({
        workDir,
        manifestPath: options.manifest,
        taskId: options.task,
        sourceRef: options.sourceRef,
        baseUrl: options.baseUrl,
        outDir: options.outDir,
        ralphConfig,
        startTimeoutMs: options.startTimeoutMs,
      });
      process.stdout.write(formatVisualWorkbenchEvidenceAutomationResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('automation-status')
  .description('Read the latest Visual Workbench automation diagnostic report without writing evidence, progress or lifecycle truth')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .option('--task <taskId>', 'Task id whose latest Ralph-local automation diagnostic should be read')
  .option('--report <path>', 'Explicit visual-workbench-automation-run.json or latest diagnostic report path')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench automation status format: ${options.format}`);
      }
      const workDir = path.resolve(options.workDir);
      const {
        formatVisualWorkbenchEvidenceAutomationStatusResult,
        getVisualWorkbenchEvidenceAutomationStatusFile,
      } = await import('./verification/visual-workbench-automation.js');
      const result = await getVisualWorkbenchEvidenceAutomationStatusFile({
        workDir,
        taskId: options.task,
        reportPath: options.report,
      });
      process.stdout.write(formatVisualWorkbenchEvidenceAutomationStatusResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

program
  .command('plan')
  .description('Generate or view the plan from a spec (spec-driven mode)')
  .option('-w, --work-dir <path>', 'Working directory', process.cwd())
  .option('-s, --spec <path>', 'Path to spec.md', 'spec.md')
  .option('-c, --config <path>', 'Path to ralph.config.json')
  .option('-p, --project <path>', 'Path to project.config.json')
  .option('--view', 'View existing plan without re-generating')
  .action(async (options) => {
    try {
      const workDir = path.resolve(options.workDir);
      const specPath = path.resolve(options.spec);

      // Import needed modules
      const { PlanManager } = await import('./planning/plan-manager.js');
      const { Planner } = await import('./planning/planner.js');
      const { JudgmentLog } = await import('./planning/judgments.js');
      const { createAgent } = await import('./agents/index.js');

      const planManager = new PlanManager(workDir);

      if (options.view) {
        if (await planManager.exists()) {
          await planManager.load();
          console.log(planManager.generateSummary());
        } else {
          log.info('No plan found. Run `ralph plan --spec <path>` to create one.');
        }
        return;
      }

      if (!await fs.pathExists(specPath)) {
        log.error(`Spec file not found: ${specPath}`);
        process.exit(1);
      }

      const ralphConfig = await loadRalphConfig(options.config, workDir, {});
      const projectConfig = await loadProjectConfig(options.project, workDir);
      const agent = createAgent(ralphConfig.agent);
      const judgmentLog = new JudgmentLog(workDir);
      await judgmentLog.load();

      const planner = new Planner();
      await planner.createPlan({
        workDir,
        specPath,
        projectConfig,
        agent,
        verbose: ralphConfig.verbose,
      }, planManager, judgmentLog);

      log.success('Plan created!');
      console.log(planManager.generateSummary());

    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('export-evidence')
  .description('Record one captured Visual Workbench story viewport as inconclusive task-linked verification evidence')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .requiredOption('--run <path>', 'Path to visual-workbench-capture-run.json')
  .requiredOption('--task <taskId>', 'Task id whose feedback refs should receive the evidence')
  .requiredOption('--story <storyId>', 'Captured Visual Workbench story id to export')
  .requiredOption('--viewport <viewportName>', 'Captured viewport name to export')
  .option('--feedback-item <itemId>', 'Optional existing task feedback item id selected by selector-readiness')
  .option('--diff-item <diffItemId>', 'Optional existing task diff item id selected by selector-readiness')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench evidence export format: ${options.format}`);
      }
      const {
        exportVisualWorkbenchEvidenceFile,
        formatVisualWorkbenchEvidenceExportResult,
      } = await import('./verification/visual-workbench-evidence.js');
      const result = await exportVisualWorkbenchEvidenceFile({
        workDir: options.workDir,
        runPath: options.run,
        taskId: options.task,
        storyId: options.story,
        viewportName: options.viewport,
        feedbackItemId: options.feedbackItem,
        diffItemId: options.diffItem,
      });
      process.stdout.write(formatVisualWorkbenchEvidenceExportResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('assess')
  .description('Record an explicit manual assessment for an exported Visual Workbench evidence row')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .requiredOption('--task <taskId>', 'Task id that owns the source Visual Workbench evidence')
  .requiredOption('--evidence-ref <ref>', 'Existing visual-workbench-capture:* evidence ref on the task')
  .option('--kind <kind>', 'Assessment kind: manual_note', 'manual_note')
  .requiredOption('--result <result>', 'Assessment result: pass, fail or inconclusive')
  .requiredOption('--assessment <text>', 'Explicit manual assessment text')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench assessment format: ${options.format}`);
      }
      const {
        assessVisualWorkbenchEvidenceFile,
        formatVisualWorkbenchAssessmentResult,
      } = await import('./verification/visual-workbench-evidence.js');
      const result = await assessVisualWorkbenchEvidenceFile({
        workDir: options.workDir,
        taskId: options.task,
        evidenceRef: options.evidenceRef,
        kind: options.kind,
        result: options.result,
        assessment: options.assessment,
      });
      process.stdout.write(formatVisualWorkbenchAssessmentResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('status')
  .description('Read Visual Workbench evidence and assessment status from task verification evidence')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .option('--task <taskId>', 'Optional task id filter')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench status format: ${options.format}`);
      }
      const {
        formatVisualWorkbenchStatusResult,
        getVisualWorkbenchStatusFile,
      } = await import('./verification/visual-workbench-evidence.js');
      const result = await getVisualWorkbenchStatusFile({
        workDir: options.workDir,
        taskId: options.task,
      });
      process.stdout.write(formatVisualWorkbenchStatusResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('publish-progress')
  .description('Publish exported Visual Workbench evidence into .arena/progress.json read-side metadata')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .option('--task <taskId>', 'Optional task id filter')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench progress publish format: ${options.format}`);
      }
      const {
        formatVisualWorkbenchProgressPublishResult,
        publishVisualWorkbenchProgressFile,
      } = await import('./verification/visual-workbench-evidence.js');
      const result = await publishVisualWorkbenchProgressFile({
        workDir: options.workDir,
        taskId: options.task,
      });
      process.stdout.write(formatVisualWorkbenchProgressPublishResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('selector-readiness')
  .description('Read explicit task/story/viewport selector readiness before Workbench capture/export automation')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .option('--manifest <path>', 'Manifest path relative to work-dir', 'visual-workbench/manifest.json')
  .option('--task <taskId>', 'Optional task id whose Workbench story selections should be inspected')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench selector readiness format: ${options.format}`);
      }
      const {
        formatVisualWorkbenchSelectorReadinessResult,
        getVisualWorkbenchSelectorReadinessFile,
      } = await import('./verification/visual-workbench-evidence.js');
      const result = await getVisualWorkbenchSelectorReadinessFile({
        workDir: options.workDir,
        manifestPath: options.manifest,
        taskId: options.task,
      });
      process.stdout.write(formatVisualWorkbenchSelectorReadinessResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

visualWorkbenchCommand
  .command('evidence-chain-readiness')
  .description('Read the explicit Workbench evidence chain readiness before export, publish and Arena readback')
  .option('-w, --work-dir <path>', 'Project source working directory', process.cwd())
  .option('--run <path>', 'Optional path to visual-workbench-capture-run.json')
  .option('--task <taskId>', 'Optional task id whose feedback refs should receive or own evidence')
  .option('--story <storyId>', 'Optional captured Visual Workbench story id selected for export')
  .option('--viewport <viewportName>', 'Optional captured viewport name selected for export')
  .option('--feedback-item <itemId>', 'Optional existing task feedback item id selected by selector-readiness')
  .option('--diff-item <diffItemId>', 'Optional existing task diff item id selected by selector-readiness')
  .option('--evidence-ref <ref>', 'Optional exported visual-workbench-capture:* evidence ref to inspect when multiple sources exist')
  .option('--project-id <projectId>', 'Optional Arena project id for the final arena-ctl readback command hint')
  .option('--format <format>', 'Output format: json', 'json')
  .option('--compact', 'Emit compact JSON without indentation')
  .action(async (options) => {
    try {
      if (options.format !== 'json') {
        throw new Error(`Unsupported Visual Workbench evidence-chain readiness format: ${options.format}`);
      }
      const {
        formatVisualWorkbenchEvidenceChainReadinessResult,
        getVisualWorkbenchEvidenceChainReadinessFile,
      } = await import('./verification/visual-workbench-evidence.js');
      const result = await getVisualWorkbenchEvidenceChainReadinessFile({
        workDir: options.workDir,
        runPath: options.run,
        taskId: options.task,
        storyId: options.story,
        viewportName: options.viewport,
        feedbackItemId: options.feedbackItem,
        diffItemId: options.diffItem,
        evidenceRef: options.evidenceRef,
        projectId: options.projectId,
      });
      process.stdout.write(formatVisualWorkbenchEvidenceChainReadinessResult(result, options.compact));
    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

program
  .command('control')
  .description('Run the controller audit manually')
  .option('-w, --work-dir <path>', 'Working directory', process.cwd())
  .option('-s, --spec <path>', 'Path to spec.md', 'spec.md')
  .option('-c, --config <path>', 'Path to ralph.config.json')
  .option('-p, --project <path>', 'Path to project.config.json')
  .action(async (options) => {
    try {
      const workDir = path.resolve(options.workDir);
      const specPath = path.resolve(options.spec);

      const { PlanManager } = await import('./planning/plan-manager.js');
      const { JudgmentLog } = await import('./planning/judgments.js');
      const { Controller } = await import('./control/controller.js');
      const { createAgent } = await import('./agents/index.js');

      const ralphConfig = await loadRalphConfig(options.config, workDir, {});
      const projectConfig = await loadProjectConfig(options.project, workDir);
      const agent = createAgent(ralphConfig.agent);
      const planManager = new PlanManager(workDir);
      const judgmentLog = new JudgmentLog(workDir);

      if (!await planManager.exists()) {
        log.error('No plan found. Run `ralph plan --spec <path>` first.');
        process.exit(1);
      }
      await planManager.load();
      await judgmentLog.load();

      const controller = new Controller(workDir);
      const report = await controller.audit({
        workDir,
        specPath,
        projectConfig,
        ralphConfig,
        agent,
        planManager,
        judgmentLog,
        iterationHistory: [],
        verbose: ralphConfig.verbose,
      }, 'manual');

      log.info(`Verdict: ${report.verdict}`);
      log.info(`Summary: ${report.summary}`);
      if (report.planChanges.length > 0) {
        log.info(`Plan changes: ${report.planChanges.length}`);
      }

    } catch (error: any) {
      log.error(error.message);
      process.exit(1);
    }
  });

// Helper functions

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected integer option value, received: ${value}`);
  }
  return parsed;
}

async function loadRalphConfig(configPath: string | undefined, workDir: string, options: any) {
  const { RalphConfigSchema } = await import('./config/types.js');
  let config;

  if (configPath && await fs.pathExists(configPath)) {
    const raw = await fs.readJson(configPath);
    config = RalphConfigSchema.parse(raw);
  } else {
    // Try default location in work dir
    const defaultPath = path.join(workDir, 'ralph.config.json');
    if (await fs.pathExists(defaultPath)) {
      const raw = await fs.readJson(defaultPath);
      config = RalphConfigSchema.parse(raw);
    } else {
      // Use CLI options as fallback
      config = RalphConfigSchema.parse({
        agent: options.agent,
      });
    }
  }

  // CLI overrides: --agent and --model take precedence over config file
  if (options.agent) config.agent = options.agent;
  if (options.model) config.model = options.model;

  return config;
}

async function loadProjectConfig(configPath: string | undefined, workDir: string) {
  const { ProjectConfigSchema } = await import('./config/types.js');
  if (configPath && await fs.pathExists(configPath)) {
    const raw = await fs.readJson(configPath);
    return ProjectConfigSchema.parse(raw);
  }
  
  // Try default location
  const defaultPath = path.join(workDir, 'project.config.json');
  if (await fs.pathExists(defaultPath)) {
    const raw = await fs.readJson(defaultPath);
    return ProjectConfigSchema.parse(raw);
  }
  
  // Return minimal config
  return ProjectConfigSchema.parse({
    name: path.basename(workDir),
    description: 'Auto-detected project',
    techStack: { language: 'unknown' },
    repository: { url: '', branch: 'main' },
  });
}

program.parse();
