import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'node:path';
import { log } from '../utils/logger.js';

export interface CommitResult {
  success: boolean;
  hash?: string;
  error?: string;
}

export interface PushResult {
  success: boolean;
  error?: string;
}

export class GitManager {
  constructor(private workDir: string) {}

  private readonly defaultExcludedPaths = [
    'node_modules',
    '.ralph/logs',
    '.ralph/agent-logs',
    '.ralph/controller-reports',
    '.next',
    'dist',
    'build',
    'out',
    'coverage',
    'generated/visual-responsive-snapshots',
    'logs',
    '.cache',
    '.tmp'
  ];

  private readonly cleanupExcludedGeneratedPaths = [
    'generated/visual-responsive-snapshots',
  ];

  private readonly protectedTrackedPaths = [
    '.DS_Store',
    'Thumbs.db',
    '.arena/auth.json',
    '.arena/events.json',
    '.arena/outgoing-events.json',
    '.arena/platform.md',
    '.arena/assets-manifest.json',
    '.arena/spec-input.json',
    '.arena/stop-request.json',
    '.arena/progress.json',
    '.arena/result.json',
    '.env.arena-secrets',
    '.ralph/provider-call-checkpoint.json',
    '.ralph/provider-session-checkpoint.json',
  ];

  private readonly protectedTrackedPathspecs = [
    ':(glob)*.sqlite',
    ':(glob)**/*.sqlite',
    ':(glob)*.sqlite-journal',
    ':(glob)**/*.sqlite-journal',
    ':(glob)*.sqlite-wal',
    ':(glob)**/*.sqlite-wal',
    ':(glob)*.sqlite-shm',
    ':(glob)**/*.sqlite-shm',
    ':(glob)*.sqlite3',
    ':(glob)**/*.sqlite3',
    ':(glob)*.sqlite3-journal',
    ':(glob)**/*.sqlite3-journal',
    ':(glob)*.sqlite3-wal',
    ':(glob)**/*.sqlite3-wal',
    ':(glob)*.sqlite3-shm',
    ':(glob)**/*.sqlite3-shm',
    ':(glob)*.db',
    ':(glob)**/*.db',
    ':(glob)*.db-journal',
    ':(glob)**/*.db-journal',
    ':(glob)*.db-wal',
    ':(glob)**/*.db-wal',
    ':(glob)*.db-shm',
    ':(glob)**/*.db-shm',
  ];

  private isExcludedPath(file: string): boolean {
    return this.defaultExcludedPaths.some(path => file === path || file.startsWith(`${path}/`));
  }

  private isProtectedPath(file: string): boolean {
    return this.protectedTrackedPaths.includes(file)
      || /\.(sqlite3?|db)$/.test(file)
      || /\.(sqlite3?|db)-(journal|wal|shm)$/.test(file);
  }

  private resolveWorkspacePath(file: string): string | null {
    const root = path.resolve(this.workDir);
    const absolute = path.resolve(root, file);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return null;
    return absolute;
  }

  private async isTrackedPath(file: string): Promise<boolean> {
    const result = await execa('git', ['ls-files', '--error-unmatch', '--', file], {
      cwd: this.workDir,
      reject: false,
    });
    return result.exitCode === 0;
  }

  private async isIgnoredPath(file: string): Promise<boolean> {
    const result = await execa('git', ['check-ignore', '-q', '--', file], {
      cwd: this.workDir,
      reject: false,
    });
    return result.exitCode === 0;
  }

  private async cleanupExcludedGeneratedOutputs(): Promise<void> {
    for (const p of this.cleanupExcludedGeneratedPaths) {
      await execa('git', ['restore', '--worktree', '--', p], {
        cwd: this.workDir,
        reject: false,
      });
      await execa('git', ['clean', '-fd', '--', p], {
        cwd: this.workDir,
        reject: false,
      });
    }
  }

  private async stageProtectedTrackedRemovals(): Promise<void> {
    // Secrets, runner-owned platform files and OS/runtime junk must never remain
    // tracked. If a legacy branch already tracks them, stage their removal but
    // keep workspace files.
    for (const p of this.protectedTrackedPaths) {
      await execa('git', ['rm', '--cached', '--ignore-unmatch', '--', p], {
        cwd: this.workDir,
        reject: false,
      });
    }
    for (const p of this.protectedTrackedPathspecs) {
      await execa('git', ['rm', '--cached', '--ignore-unmatch', '--', p], {
        cwd: this.workDir,
        reject: false,
      });
    }
  }
  
  /**
   * Initialize git repo if not exists
   */
  async init(): Promise<void> {
    try {
      await execa('git', ['status'], { cwd: this.workDir });
    } catch {
      log.info('Initializing git repository...');
      await execa('git', ['init'], { cwd: this.workDir });
    }
  }
  
  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    const { stdout } = await execa('git', ['branch', '--show-current'], { cwd: this.workDir });
    return stdout.trim();
  }
  
  /**
   * Get list of changed files
   */
  async getChangedFiles(): Promise<string[]> {
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: this.workDir });
    return stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.slice(3).trim());
  }
  
  /**
   * Stage all changes, excluding default paths (node_modules, .arena, etc.)
   *
   * We use a two-step approach:
   *   1. `git add -A` — stage everything git knows about
   *   2. `git reset` — unstage excluded dirs that slipped in
   *
   * This avoids the "ignored file" error that `:(exclude)` triggers when
   * the path is already listed in .gitignore.
   */
  async stageAll(): Promise<void> {
    await execa('git', ['add', '-A'], { cwd: this.workDir });

    // Unstage any excluded paths that were accidentally staged
    for (const p of this.defaultExcludedPaths) {
      try {
        await execa('git', ['reset', 'HEAD', '--', p], {
          cwd: this.workDir,
          reject: false,          // don't throw if path doesn't exist in index
        });
      } catch {
        // path not in index — nothing to reset
      }
    }

    await this.stageProtectedTrackedRemovals();
  }

  /**
   * Stage only explicit durable owner paths.
   *
   * This is intentionally narrower than commit(): controller/planner style
   * stages must not accidentally sweep product WIP from a failed executor
   * attempt into a loop-owned commit.
   */
  async stagePaths(paths: string[]): Promise<void> {
    const normalizedPaths = Array.from(new Set(paths
      .map(path => path.trim())
      .filter(Boolean)))
      .filter(path => !this.isExcludedPath(path) && !this.isProtectedPath(path));

    const trackedStageablePaths: string[] = [];
    const untrackedStageablePaths: string[] = [];
    for (const p of normalizedPaths) {
      if (await this.isTrackedPath(p)) {
        trackedStageablePaths.push(p);
        continue;
      }

      const absolute = this.resolveWorkspacePath(p);
      if (!absolute || !await fs.pathExists(absolute)) continue;

      // Optional loop-owned files like .ralph/ralph-progress.json can exist
      // while intentionally ignored. Do not let them make the scoped add fail.
      if (!await this.isIgnoredPath(p)) untrackedStageablePaths.push(p);
    }

    if (untrackedStageablePaths.length > 0) {
      await execa('git', ['add', '-A', '--', ...untrackedStageablePaths], {
        cwd: this.workDir,
      });
    }

    if (trackedStageablePaths.length > 0) {
      // Legacy project .gitignore files may still contain directory-level
      // ignores like `.ralph/`. Force-add only paths already tracked by git;
      // ignored untracked telemetry was filtered above and remains untracked.
      await execa('git', ['add', '-f', '-A', '--', ...trackedStageablePaths], {
        cwd: this.workDir,
      });
    }

    await this.stageProtectedTrackedRemovals();
  }

  async commitPaths(message: string, paths: string[]): Promise<CommitResult> {
    try {
      await execa('git', ['reset', 'HEAD', '--'], {
        cwd: this.workDir,
        reject: false,
      });

      await this.stagePaths(paths);

      const { stdout: staged } = await execa(
        'git',
        ['diff', '--cached', '--name-only'],
        { cwd: this.workDir },
      );
      if (!staged.trim()) {
        log.info('Nothing staged for scoped commit — skipping commit');
        return { success: true, hash: 'no-changes' };
      }

      await execa('git', ['commit', '-m', message], { cwd: this.workDir });

      const { stdout: hash } = await execa('git', ['rev-parse', 'HEAD'], { cwd: this.workDir });

      log.success(`Committed: ${hash.slice(0, 7)}`);
      return { success: true, hash: hash.trim() };
    } catch (error: any) {
      log.error(`Scoped commit failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Commit changes
   */
  async commit(message: string): Promise<CommitResult> {
    try {
      // Check if there are changes to commit
      const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: this.workDir });
      if (!status.trim()) {
        return { success: true, hash: 'no-changes' };
      }

      const changedFiles = await this.getChangedFiles();
      if (changedFiles.length) {
        const preview = changedFiles.slice(0, 50);
        const suffix = changedFiles.length > 50 ? ` …and ${changedFiles.length - 50} more` : '';
        log.info(`Files to commit (${changedFiles.length}): ${preview.join(', ')}${suffix}`);

        const excludedHits = changedFiles.filter(file => this.isExcludedPath(file));
        if (excludedHits.length) {
          log.warn(`Skipping excluded paths: ${excludedHits.slice(0, 20).join(', ')}${excludedHits.length > 20 ? ' …and more' : ''}`);
        }
        const protectedHits = changedFiles.filter(file => this.isProtectedPath(file));
        if (protectedHits.length) {
          log.warn(`Removing protected runtime files from git index: ${protectedHits.slice(0, 20).join(', ')}${protectedHits.length > 20 ? ' …and more' : ''}`);
        }
      }
      
      await this.stageAll();

      // Check if anything is actually staged after excluding paths
      const { stdout: staged } = await execa(
        'git', ['diff', '--cached', '--name-only'],
        { cwd: this.workDir },
      );
      if (!staged.trim()) {
        log.info('Nothing staged after excluding paths — skipping commit');
        await this.cleanupExcludedGeneratedOutputs();
        return { success: true, hash: 'no-changes' };
      }

      await execa('git', ['commit', '-m', message], { cwd: this.workDir });
      await this.cleanupExcludedGeneratedOutputs();
      
      const { stdout: hash } = await execa('git', ['rev-parse', 'HEAD'], { cwd: this.workDir });
      
      log.success(`Committed: ${hash.slice(0, 7)}`);
      return { success: true, hash: hash.trim() };
    } catch (error: any) {
      log.error(`Commit failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Push to remote
   */
  async push(branch?: string): Promise<PushResult> {
    try {
      const currentBranch = branch || await this.getCurrentBranch();
      await execa('git', ['push', 'origin', currentBranch], { cwd: this.workDir });
      
      log.success(`Pushed to origin/${currentBranch}`);
      return { success: true };
    } catch (error: any) {
      log.error(`Push failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Get recent commits log
   */
  async getRecentCommits(count: number = 10): Promise<string> {
    const { stdout } = await execa('git', ['log', '--oneline', `-${count}`], { cwd: this.workDir });
    return stdout;
  }
  
  /**
   * Get diff of unstaged changes
   */
  async getDiff(): Promise<string> {
    const { stdout } = await execa('git', ['diff'], { cwd: this.workDir });
    return stdout;
  }
  
  /**
   * Revert to specific commit
   */
  async revertTo(commitHash: string): Promise<void> {
    await execa('git', ['reset', '--hard', commitHash], { cwd: this.workDir });
    log.info(`Reverted to ${commitHash}`);
  }
  
  /**
   * Get last commit hash where all tests passed (from commit messages)
   */
  async getLastGoodCommit(): Promise<string | null> {
    try {
      const { stdout } = await execa('git', [
        'log', 
        '--oneline', 
        '--grep=verification: passed',
        '-1'
      ], { cwd: this.workDir });
      
      if (stdout.trim()) {
        return stdout.split(' ')[0];
      }
      return null;
    } catch {
      return null;
    }
  }
  
}
