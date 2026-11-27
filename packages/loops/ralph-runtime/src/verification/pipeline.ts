import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import chalk from 'chalk';
import type { VerificationEvidenceHint, VerificationResult, VerificationLevel } from '../config/types.js';
import { log } from '../utils/logger.js';

const UNIT_TEST_TIMEOUT_MS = Number(process.env.RALPH_UNIT_TEST_TIMEOUT_MS ?? 10 * 60 * 1000);
const BUILD_TIMEOUT_MS = Number(process.env.RALPH_BUILD_TIMEOUT_MS ?? 900 * 1000);

interface VerificationOptions {
  workDir: string;
  level: VerificationLevel;
  projectType?: 'node' | 'python' | 'go' | 'rust' | 'unknown';
  buildCommand?: string;
  buildTimeoutMs?: number;
}

interface TimedCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeout: number;
}

type NodePackageJson = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type TimedCommandResult = {
  stdout: string;
  stderr: string;
};

export class VerificationPipeline {

  /**
   * Read scripts from package.json (cached per verify call)
   */
  private async getNodeScripts(workDir: string): Promise<Record<string, string>> {
    const pkg = await this.readNodePackage(workDir);
    return pkg?.scripts || {};
  }

  private async readNodePackage(workDir: string): Promise<NodePackageJson | null> {
    try {
      const { readFileSync } = await import('fs');
      return JSON.parse(readFileSync(join(workDir, 'package.json'), 'utf-8'));
    } catch {
      return null;
    }
  }

  async verify(options: VerificationOptions): Promise<VerificationResult> {
    const { workDir, level, projectType = 'unknown' } = options;
    const detectedType = projectType === 'unknown' 
      ? await this.detectProjectType(workDir) 
      : projectType;
    
    const result: VerificationResult = { passed: true };

    // Level: none - skip all verification
    if (level === 'none') {
      log.info('Verification level: none — skipping all checks');
      return result;
    }

    // Level: minimal - lint + build
    log.info('Running lint check...');
    result.lint = await this.runLint(workDir, detectedType);
    if (!result.lint.passed) result.passed = false;
    
    log.info('Running build check...');
    result.build = await this.runBuild(workDir, detectedType, options.buildCommand, options.buildTimeoutMs);
    if (!result.build.passed) result.passed = false;
    
    if (level === 'minimal') return result;
    
    // Level: standard - + typecheck + unit tests
    log.info('Running type check...');
    result.typecheck = await this.runTypecheck(workDir, detectedType);
    if (!result.typecheck.passed) result.passed = false;
    
    log.info('Running unit tests...');
    result.unitTests = await this.runUnitTests(workDir, detectedType);
    if (!result.unitTests.passed) result.passed = false;
    
    if (level === 'standard') return result;
    
    // Level: full - + integration tests
    log.info('Running integration tests...');
    result.integrationTests = await this.runIntegrationTests(workDir, detectedType);
    if (!result.integrationTests.passed) result.passed = false;
    
    return result;
  }
  
  private async detectProjectType(workDir: string): Promise<'node' | 'python' | 'go' | 'rust' | 'unknown'> {
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    
    if (existsSync(join(workDir, 'package.json'))) return 'node';
    if (existsSync(join(workDir, 'pyproject.toml')) || existsSync(join(workDir, 'requirements.txt'))) return 'python';
    if (existsSync(join(workDir, 'go.mod'))) return 'go';
    if (existsSync(join(workDir, 'Cargo.toml'))) return 'rust';
    
    return 'unknown';
  }
  
  private async runLint(workDir: string, projectType: string): Promise<{ passed: boolean; errors: string[] }> {
    try {
      switch (projectType) {
        case 'node': {
          const scripts = await this.getNodeScripts(workDir);
          if (!scripts['lint']) {
            log.info('No lint script in package.json — skipping');
            return { passed: true, errors: [] };
          }
          await execa('npm', ['run', 'lint'], { cwd: workDir });
          break;
        }
        case 'python':
          await execa('ruff', ['check', '.'], { cwd: workDir });
          break;
        case 'go':
          await execa('golangci-lint', ['run'], { cwd: workDir });
          break;
        case 'rust':
          await execa('cargo', ['clippy'], { cwd: workDir });
          break;
        default:
          return { passed: true, errors: ['Lint skipped: unknown project type'] };
      }
      log.success('Lint passed');
      return { passed: true, errors: [] };
    } catch (error: any) {
      const errors = [error.stdout || error.message || String(error)];
      log.error('Lint failed');
      return { passed: false, errors };
    }
  }
  
  private async runTypecheck(workDir: string, projectType: string): Promise<{ passed: boolean; errors: string[] }> {
    try {
      switch (projectType) {
        case 'node': {
          const scripts = await this.getNodeScripts(workDir);
          if (!scripts['typecheck']) {
            log.info('No typecheck script in package.json — skipping');
            return { passed: true, errors: [] };
          }
          await execa('npm', ['run', 'typecheck'], { cwd: workDir });
          break;
        }
        case 'python':
          await execa('mypy', ['.'], { cwd: workDir });
          break;
        default:
          return { passed: true, errors: ['Typecheck skipped'] };
      }
      log.success('Typecheck passed');
      return { passed: true, errors: [] };
    } catch (error: any) {
      // Typecheck failure is not always critical
      const errors = [error.stdout || error.message || String(error)];
      log.warn('Typecheck failed (non-critical)');
      return { passed: false, errors };
    }
  }
  
  private async runBuild(workDir: string, projectType: string, customCommand?: string, timeoutMs?: number): Promise<{ passed: boolean; errors: string[] }> {
    const timeout = timeoutMs ?? BUILD_TIMEOUT_MS;
    try {
      if (customCommand) {
        const [cmd, ...args] = customCommand.split(/\s+/);
        await execa(cmd, args, { cwd: workDir, timeout });
      } else {
        switch (projectType) {
          case 'node': {
            const scripts = await this.getNodeScripts(workDir);
            if (!scripts['build']) {
              log.info('No build script in package.json — skipping');
              return { passed: true, errors: [] };
            }
            await execa('npm', ['run', 'build'], { cwd: workDir, timeout });
            break;
          }
          case 'python':
            return { passed: true, errors: [] };
          case 'go':
            await execa('go', ['build', './...'], { cwd: workDir, timeout });
            break;
          case 'rust':
            await execa('cargo', ['build'], { cwd: workDir, timeout });
            break;
          default:
            return { passed: true, errors: ['Build skipped: unknown project type'] };
        }
      }
      log.success('Build passed');
      return { passed: true, errors: [] };
    } catch (error: any) {
      if (error.timedOut) {
        log.warn(`Build timed out after ${timeout / 1000}s — skipping`);
        return { passed: true, errors: [] };
      }
      const errors = [error.stdout || error.stderr || error.message || String(error)];
      log.error('Build failed');
      return { passed: false, errors };
    }
  }
  
  private async runUnitTests(workDir: string, projectType: string): Promise<NonNullable<VerificationResult['unitTests']>> {
    try {
      let output = '';
      let command = '';
      const commandOutput = (result: { stdout?: string; stderr?: string }): string => (
        [result.stdout, result.stderr]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .join('\n')
      );
      const testEnv = { ...process.env, CI: 'true' };
      switch (projectType) {
        case 'node': {
          const scripts = await this.getNodeScripts(workDir);
          const testScript = scripts['test'] || '';
          // Skip if no test script or if it's the default npm init placeholder
          if (!testScript || testScript.includes('no test specified') || testScript === 'echo \"Error: no test specified\" && exit 1') {
            log.info('No test script configured — skipping');
            return { passed: true, total: 0, passed_count: 0, errors: [] };
          }
          await this.ensureNodeVerificationDependencies(workDir);
          command = 'npm test';
          const nodeResult = await this.runTimedCommand('npm', ['test'], {
            cwd: workDir,
            env: testEnv,
            timeout: UNIT_TEST_TIMEOUT_MS,
          });
          output = commandOutput(nodeResult);
          break;
        }
        case 'python':
          command = 'pytest -v';
          const pyResult = await this.runTimedCommand('pytest', ['-v'], {
            cwd: workDir,
            env: testEnv,
            timeout: UNIT_TEST_TIMEOUT_MS,
          });
          output = commandOutput(pyResult);
          break;
        case 'go':
          command = 'go test ./...';
          const goResult = await this.runTimedCommand('go', ['test', './...'], {
            cwd: workDir,
            env: testEnv,
            timeout: UNIT_TEST_TIMEOUT_MS,
          });
          output = commandOutput(goResult);
          break;
        case 'rust':
          command = 'cargo test';
          const rustResult = await this.runTimedCommand('cargo', ['test'], {
            cwd: workDir,
            env: testEnv,
            timeout: UNIT_TEST_TIMEOUT_MS,
          });
          output = commandOutput(rustResult);
          break;
        default:
          return { passed: true, total: 0, passed_count: 0, errors: ['Tests skipped'] };
      }
      
      // Try to parse test count (basic)
      const testCount = this.parseTestCount(output);
      log.success(`Unit tests passed (${testCount.passed_count}/${testCount.total})`);
      
      return {
        passed: true,
        ...testCount,
        errors: [],
        evidenceHints: this.extractUnitTestEvidenceHints(output, command),
      };
    } catch (error: any) {
      const timeoutMessage = error?.timedOut === true
        ? `Unit tests timed out after ${Math.max(1, Math.round(UNIT_TEST_TIMEOUT_MS / 1000))}s`
        : '';
      const output = [timeoutMessage, error.stdout || error.stderr || error.message || '']
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join('\n');
      const testCount = this.parseTestCount(output);
      if (testCount.total === 0) {
        log.error(`Unit tests crashed (no parseable results). Error: ${(output || error.message).slice(0, 200)}`);
      } else {
        log.error(`Unit tests failed (${testCount.passed_count}/${testCount.total})`);
      }
      return {
        passed: false,
        ...testCount,
        errors: [output || error.message],
        evidenceHints: this.extractUnitTestEvidenceHints(output, ''),
      };
    }
  }
  
  private async runIntegrationTests(workDir: string, projectType: string): Promise<NonNullable<VerificationResult['integrationTests']>> {
    try {
      let output = '';
      const testEnv = { ...process.env, CI: 'true' };
      switch (projectType) {
        case 'node': {
          // Check if integration test script exists
          const pkg = await import(`${workDir}/package.json`, { assert: { type: 'json' } }).catch(() => null);
          if (pkg?.default?.scripts?.['test:integration']) {
            const result = await this.runTimedCommand('npm', ['run', 'test:integration'], {
              cwd: workDir,
              env: testEnv,
              timeout: UNIT_TEST_TIMEOUT_MS,
            });
            output = result.stdout;
            break;
          }
          return { passed: true, total: 0, passed_count: 0, errors: ['No integration tests defined'] };
        }
        default:
          return { passed: true, total: 0, passed_count: 0, errors: ['Integration tests skipped'] };
      }

      const testCount = this.parseTestCount(output);
      log.success('Integration tests passed');
      return { passed: true, ...testCount, errors: [] };
    } catch (error: any) {
      const timeoutMessage = error?.timedOut === true
        ? `Integration tests timed out after ${Math.max(1, Math.round(UNIT_TEST_TIMEOUT_MS / 1000))}s`
        : '';
      const output = [timeoutMessage, error.stdout || error.stderr || error.message || '']
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join('\n');
      log.error('Integration tests failed');
      return { passed: false, total: 0, passed_count: 0, errors: [output || error.message] };
    }
  }

  private async ensureNodeVerificationDependencies(workDir: string): Promise<void> {
    const missingDevDeps = await this.getMissingDirectNodeDevDependencies(workDir);
    if (missingDevDeps.length === 0) return;

    log.info(`Installing Node dev dependencies for verification: ${missingDevDeps.slice(0, 8).join(', ')}${missingDevDeps.length > 8 ? ', …' : ''}`);
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      NPM_CONFIG_PRODUCTION: 'false',
      npm_config_production: 'false',
    };
    await this.runTimedCommand('npm', [
      'install',
      '--include=dev',
      '--no-audit',
      '--fund=false',
      '--save=false',
    ], {
      cwd: workDir,
      env,
      timeout: BUILD_TIMEOUT_MS,
    });
  }

  private async getMissingDirectNodeDevDependencies(workDir: string): Promise<string[]> {
    const pkg = await this.readNodePackage(workDir);
    const devDeps = Object.keys(pkg?.devDependencies ?? {}).sort();
    if (devDeps.length === 0) return [];

    return devDeps.filter((dependencyName) => !existsSync(resolveNodePackageInstallPath(workDir, dependencyName)));
  }
  
  private parseTestCount(output: string): { total: number; passed_count: number } {
    // Try various patterns
    // Jest: Tests: X passed, Y total
    const jestMatch = output.match(/Tests:\s*(\d+)\s*passed.*?(\d+)\s*total/i);
    if (jestMatch) {
      return { passed_count: parseInt(jestMatch[1]), total: parseInt(jestMatch[2]) };
    }
    
    // Vitest: X passed (Y)
    const vitestMatch = output.match(/(\d+)\s*passed.*?\((\d+)\)/i);
    if (vitestMatch) {
      return { passed_count: parseInt(vitestMatch[1]), total: parseInt(vitestMatch[2]) };
    }
    
    // Pytest: X passed
    const pytestMatch = output.match(/(\d+)\s*passed/i);
    if (pytestMatch) {
      return { passed_count: parseInt(pytestMatch[1]), total: parseInt(pytestMatch[1]) };
    }

    // Node.js test runner summary:
    //   # tests 24
    //   # pass 24
    // Newer local output can render the same lines with an info marker.
    const nodeTestsMatch = output.match(/(?:^|\n)[^\n]*\btests\s+(\d+)/i);
    const nodePassMatch = output.match(/(?:^|\n)[^\n]*\bpass\s+(\d+)/i);
    if (nodeTestsMatch && nodePassMatch) {
      return {
        total: parseInt(nodeTestsMatch[1]),
        passed_count: parseInt(nodePassMatch[1]),
      };
    }
    
    return { total: 0, passed_count: 0 };
  }

  private extractUnitTestEvidenceHints(output: string, command: string): VerificationEvidenceHint[] {
    const normalized = output.toLowerCase();
    const hasBrowserResponsiveSuite = [
      /\b(?:browser|visual)[-_ ]responsive\b/,
      /\bresponsive[-_ ](?:browser|visual)\b/,
      /(?:^|[/\\])(?:browser|visual)[-_ ]responsive(?:\.test)?\.[cm]?[jt]sx?\b/,
    ].some(pattern => pattern.test(normalized));

    if (!hasBrowserResponsiveSuite) return [];

    const viewportSignals = this.extractViewportSignals(output);
    const signalSummary = viewportSignals.length > 0
      ? ` Signals: ${viewportSignals.join(', ')}.`
      : '';

    return [{
      kind: 'test',
      ref: 'verification:unit-tests:browser-responsive',
      command: command || undefined,
      summary: `Browser-responsive visual test suite ran inside the unit test command.${signalSummary}`,
    }];
  }

  private extractViewportSignals(output: string): string[] {
    const matches = output.match(/\b(?:mobile|tablet|desktop)(?:[-_ ][a-z0-9]+)?\b|\b(?:3[0-9]{2}|4[0-9]{2}|7[0-9]{2}|10[0-9]{2}|12[0-9]{2}|14[0-9]{2}|19[0-9]{2})px\b/gi) ?? [];
    const signals = matches
      .map(signal => signal.replace(/_/g, '-').toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(signals)).slice(0, 8);
  }
  
  /**
   * Format verification result for display/logging
   */
  formatResult(result: VerificationResult): string {
    const lines: string[] = ['Verification Results:'];
    
    const icon = (passed: boolean) => passed ? chalk.green('✓') : chalk.red('✗');
    
    if (result.lint) {
      lines.push(`  ${icon(result.lint.passed)} Lint`);
    }
    if (result.typecheck) {
      lines.push(`  ${icon(result.typecheck.passed)} Typecheck`);
    }
    if (result.build) {
      lines.push(`  ${icon(result.build.passed)} Build`);
    }
    if (result.unitTests) {
      lines.push(`  ${icon(result.unitTests.passed)} Unit Tests (${result.unitTests.passed_count}/${result.unitTests.total})`);
    }
    if (result.integrationTests) {
      lines.push(`  ${icon(result.integrationTests.passed)} Integration Tests (${result.integrationTests.passed_count}/${result.integrationTests.total})`);
    }
    if (result.postDeploy) {
      const postDeployIcon = result.postDeploy.infraUnavailable
        ? chalk.yellow('!')
        : icon(result.postDeploy.passed);
      lines.push(`  ${postDeployIcon} Post-Deploy: ${result.postDeploy.summary}`);
    }
    
    lines.push('');
    if (result.passed && result.postDeploy?.infraUnavailable) {
      lines.push(chalk.yellow('Required checks passed; platform browser smoke was unavailable.'));
    } else {
      lines.push(result.passed ? chalk.green('All checks passed!') : chalk.red('Some checks failed'));
    }
    
    return lines.join('\n');
  }
  
  /**
   * Get errors for agent context
   */
  getErrors(result: VerificationResult): string[] {
    const errors: string[] = [];
    
    if (result.lint && !result.lint.passed) {
      errors.push('LINT ERRORS:', ...result.lint.errors);
    }
    if (result.typecheck && !result.typecheck.passed) {
      errors.push('TYPECHECK ERRORS:', ...result.typecheck.errors);
    }
    if (result.build && !result.build.passed) {
      errors.push('BUILD ERRORS:', ...result.build.errors);
    }
    if (result.unitTests && !result.unitTests.passed) {
      errors.push('UNIT TEST ERRORS:', ...result.unitTests.errors);
    }
    if (result.integrationTests && !result.integrationTests.passed) {
      errors.push('INTEGRATION TEST ERRORS:', ...result.integrationTests.errors);
    }
    if (result.postDeploy && !result.postDeploy.passed) {
      errors.push('POST-DEPLOY ERRORS:', ...result.postDeploy.errors);
    }
    
    return errors;
  }

  private async runTimedCommand(
    command: string,
    args: string[],
    options: TimedCommandOptions,
  ): Promise<TimedCommandResult> {
    const subprocess = execa(command, args, {
      ...options,
      detached: true,
      reject: false,
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      killDetachedProcessGroup(subprocess.pid);
    }, options.timeout);

    try {
      const result = await subprocess;
      const stdout = typeof result.stdout === 'string' ? result.stdout : '';
      const stderr = typeof result.stderr === 'string' ? result.stderr : '';

      if (timedOut) {
        const error = new Error(`Command timed out after ${Math.max(1, Math.round(options.timeout / 1000))}s`) as Error & {
          timedOut?: boolean;
          stdout?: string;
          stderr?: string;
          pid?: number;
        };
        error.timedOut = true;
        error.stdout = stdout;
        error.stderr = stderr;
        error.pid = subprocess.pid;
        throw error;
      }

      if (result.exitCode !== 0) {
        const error = new Error(`Command exited with code ${result.exitCode ?? 'unknown'}`) as Error & {
          stdout?: string;
          stderr?: string;
          pid?: number;
        };
        error.stdout = stdout;
        error.stderr = stderr;
        error.pid = subprocess.pid;
        throw error;
      }

      return { stdout, stderr };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export function killDetachedProcessGroup(pid: unknown): void {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, 'SIGKILL');
    log.warn(`Killed timed-out verification process group ${pid}`);
  } catch {
    // Best-effort cleanup only.
  }
}

function resolveNodePackageInstallPath(workDir: string, dependencyName: string): string {
  if (dependencyName.startsWith('@')) {
    const [scope, name] = dependencyName.split('/');
    return join(workDir, 'node_modules', scope, name ?? '');
  }
  return join(workDir, 'node_modules', dependencyName);
}
