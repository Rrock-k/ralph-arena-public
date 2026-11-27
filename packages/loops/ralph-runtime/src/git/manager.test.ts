import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { GitManager } from './manager.js';

test('git manager commits durable Ralph plan but not Ralph telemetry', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-git-manager-plan-'));
  try {
    await execa('git', ['init'], { cwd: workDir });
    await execa('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
    await execa('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
    await fs.writeFile(
      path.join(workDir, '.gitignore'),
      [
        '.ralph/*',
        '!.ralph/plan.json',
        '',
      ].join('\n'),
    );
    await fs.ensureDir(path.join(workDir, '.ralph', 'logs'));
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 1 });
    await fs.writeFile(path.join(workDir, '.ralph', 'logs', 'run.log'), 'debug log\n');

    const result = await new GitManager(workDir).commit('test: commit plan');

    assert.equal(result.success, true);
    assert.notEqual(result.hash, 'no-changes');

    const { stdout } = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: workDir });
    assert.match(stdout, /^\.ralph\/plan\.json$/m);
    assert.doesNotMatch(stdout, /^\.ralph\/logs\/run\.log$/m);
  } finally {
    await fs.remove(workDir);
  }
});

test('git manager scoped commit does not sweep product WIP into loop-owned commit', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-git-manager-scoped-'));
  try {
    await execa('git', ['init'], { cwd: workDir });
    await execa('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
    await execa('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
    await fs.ensureDir(path.join(workDir, 'src'));
    await fs.ensureDir(path.join(workDir, '.ralph'));
    await fs.writeFile(path.join(workDir, 'src', 'app.js'), 'export const value = 1;\n');
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 1 });
    await execa('git', ['add', 'src/app.js', '.ralph/plan.json'], { cwd: workDir });
    await execa('git', ['commit', '-m', 'test: baseline'], { cwd: workDir });

    await fs.writeFile(path.join(workDir, 'src', 'app.js'), 'export const value = 2;\n');
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 2 });
    await execa('git', ['add', 'src/app.js'], { cwd: workDir });

    const result = await new GitManager(workDir).commitPaths('test: scoped plan', ['.ralph/plan.json']);

    assert.equal(result.success, true);
    assert.notEqual(result.hash, 'no-changes');

    const { stdout: committedPlan } = await execa(
      'git',
      ['show', 'HEAD:.ralph/plan.json'],
      { cwd: workDir },
    );
    assert.deepEqual(JSON.parse(committedPlan), { version: 2 });

    const { stdout: committedApp } = await execa(
      'git',
      ['show', 'HEAD:src/app.js'],
      { cwd: workDir },
    );
    assert.equal(committedApp, 'export const value = 1;');

    const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: workDir });
    assert.equal(status, ' M src/app.js');
  } finally {
    await fs.remove(workDir);
  }
});

test('git manager scoped commit skips ignored optional loop files while committing tracked plan', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-git-manager-scoped-ignored-'));
  try {
    await execa('git', ['init'], { cwd: workDir });
    await execa('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
    await execa('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
    await fs.writeFile(
      path.join(workDir, '.gitignore'),
      [
        '.ralph/*',
        '!.ralph/plan.json',
        '',
      ].join('\n'),
    );
    await fs.ensureDir(path.join(workDir, '.ralph'));
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 1 });
    await execa('git', ['add', '-f', '.gitignore', '.ralph/plan.json'], { cwd: workDir });
    await execa('git', ['commit', '-m', 'test: baseline'], { cwd: workDir });

    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 2 });
    await fs.writeJson(path.join(workDir, '.ralph', 'decisions-log.json'), { decisions: [] });
    await fs.writeJson(path.join(workDir, '.ralph', 'ralph-progress.json'), { state: 'completed' });
    await fs.writeJson(path.join(workDir, '.ralph', 'iteration-log.json'), { iterations: [] });

    const result = await new GitManager(workDir).commitPaths('test: scoped plan', [
      '.ralph/plan.json',
      '.ralph/decisions-log.json',
      '.ralph/ralph-progress.json',
      '.ralph/iteration-log.json',
    ]);

    assert.equal(result.success, true);
    assert.notEqual(result.hash, 'no-changes');

    const { stdout: committedPlan } = await execa('git', ['show', 'HEAD:.ralph/plan.json'], { cwd: workDir });
    assert.deepEqual(JSON.parse(committedPlan), { version: 2 });

    const { stdout: trackedFiles } = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: workDir });
    assert.doesNotMatch(trackedFiles, /^\.ralph\/decisions-log\.json$/m);
    assert.doesNotMatch(trackedFiles, /^\.ralph\/ralph-progress\.json$/m);
    assert.doesNotMatch(trackedFiles, /^\.ralph\/iteration-log\.json$/m);
  } finally {
    await fs.remove(workDir);
  }
});

test('git manager scoped commit handles legacy directory-level Ralph ignore for tracked durable state', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-git-manager-scoped-root-ignore-'));
  try {
    await execa('git', ['init'], { cwd: workDir });
    await execa('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
    await execa('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
    await fs.writeFile(path.join(workDir, '.gitignore'), '.ralph/\n');
    await fs.ensureDir(path.join(workDir, '.ralph'));
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 1 });
    await fs.writeJson(path.join(workDir, '.ralph', 'decisions-log.json'), { decisions: [] });
    await execa('git', ['add', '-f', '.gitignore', '.ralph/plan.json', '.ralph/decisions-log.json'], { cwd: workDir });
    await execa('git', ['commit', '-m', 'test: baseline'], { cwd: workDir });

    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 2 });
    await fs.writeJson(path.join(workDir, '.ralph', 'decisions-log.json'), { decisions: [{ id: 'j-1' }] });
    await fs.writeJson(path.join(workDir, '.ralph', 'ralph-progress.json'), { state: 'running' });

    const result = await new GitManager(workDir).commitPaths('test: scoped plan', [
      '.ralph/plan.json',
      '.ralph/decisions-log.json',
      '.ralph/ralph-progress.json',
    ]);

    assert.equal(result.success, true);
    assert.notEqual(result.hash, 'no-changes');

    const { stdout: committedPlan } = await execa('git', ['show', 'HEAD:.ralph/plan.json'], { cwd: workDir });
    assert.deepEqual(JSON.parse(committedPlan), { version: 2 });

    const { stdout: committedDecisions } = await execa('git', ['show', 'HEAD:.ralph/decisions-log.json'], { cwd: workDir });
    assert.deepEqual(JSON.parse(committedDecisions), { decisions: [{ id: 'j-1' }] });

    const { stdout: trackedFiles } = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: workDir });
    assert.doesNotMatch(trackedFiles, /^\.ralph\/ralph-progress\.json$/m);
  } finally {
    await fs.remove(workDir);
  }
});

test('git manager scoped commit fails closed when git add cannot acquire the index lock', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-git-manager-scoped-lock-'));
  try {
    await execa('git', ['init'], { cwd: workDir });
    await execa('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
    await execa('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
    await fs.ensureDir(path.join(workDir, '.ralph'));
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 1 });
    await execa('git', ['add', '.ralph/plan.json'], { cwd: workDir });
    await execa('git', ['commit', '-m', 'test: baseline'], { cwd: workDir });

    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 2 });
    await fs.writeFile(path.join(workDir, '.git', 'index.lock'), '');

    const result = await new GitManager(workDir).commitPaths('test: scoped plan', ['.ralph/plan.json']);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /index\.lock|Unable to create/i);
  } finally {
    await fs.remove(workDir);
  }
});

test('git manager removes tracked runtime files while keeping durable plan truth', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-git-manager-secrets-'));
  try {
    await execa('git', ['init'], { cwd: workDir });
    await execa('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
    await execa('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
    await fs.writeFile(
      path.join(workDir, '.gitignore'),
      [
        '.env.*',
        '.arena/*',
        '.ralph/*',
        '!.ralph/plan.json',
        '*.sqlite',
        '*.sqlite-wal',
        '*.sqlite-shm',
        '',
      ].join('\n'),
    );
    await fs.ensureDir(path.join(workDir, '.arena'));
    await fs.ensureDir(path.join(workDir, '.ralph'));
    await fs.ensureDir(path.join(workDir, 'data'));
    await fs.writeJson(path.join(workDir, '.arena', 'auth.json'), { token: 'secret-v1' });
    await fs.writeFile(path.join(workDir, '.env.arena-secrets'), 'TOKEN=secret-v1\n');
    await fs.writeJson(path.join(workDir, '.arena', 'platform.md'), { platform: 'runtime-v1' });
    await fs.writeJson(path.join(workDir, '.arena', 'progress.json'), { state: 'completed' });
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 1 });
    await fs.writeJson(path.join(workDir, '.ralph', 'provider-call-checkpoint.json'), { calls: [{ sessionId: 'call-session-v1' }] });
    await fs.writeJson(path.join(workDir, '.ralph', 'provider-session-checkpoint.json'), { sessionId: 'session-v1' });
    await fs.writeFile(path.join(workDir, 'data', 'runtime.sqlite'), 'runtime-v1\n');
    await fs.writeFile(path.join(workDir, 'data', 'runtime.sqlite-wal'), 'runtime-wal-v1\n');
    await fs.writeFile(path.join(workDir, 'data', 'runtime.sqlite-shm'), 'runtime-shm-v1\n');
    await execa(
      'git',
      ['add', '-f', '.gitignore', '.arena/auth.json', '.env.arena-secrets', '.arena/platform.md', '.arena/progress.json', '.ralph/plan.json', '.ralph/provider-call-checkpoint.json', '.ralph/provider-session-checkpoint.json', 'data/runtime.sqlite', 'data/runtime.sqlite-wal', 'data/runtime.sqlite-shm'],
      { cwd: workDir },
    );
    await execa('git', ['commit', '-m', 'test: legacy tracked runtime files'], { cwd: workDir });

    await fs.writeJson(path.join(workDir, '.arena', 'auth.json'), { token: 'secret-v2' });
    await fs.writeFile(path.join(workDir, '.env.arena-secrets'), 'TOKEN=secret-v2\n');
    await fs.writeJson(path.join(workDir, '.arena', 'platform.md'), { platform: 'runtime-v2' });
    await fs.writeJson(path.join(workDir, '.arena', 'progress.json'), { state: 'running' });
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 2 });
    await fs.writeJson(path.join(workDir, '.ralph', 'provider-call-checkpoint.json'), { calls: [{ sessionId: 'call-session-v2' }] });
    await fs.writeJson(path.join(workDir, '.ralph', 'provider-session-checkpoint.json'), { sessionId: 'session-v2' });
    await fs.writeFile(path.join(workDir, 'data', 'runtime.sqlite'), 'runtime-v2\n');
    await fs.writeFile(path.join(workDir, 'data', 'runtime.sqlite-wal'), 'runtime-wal-v2\n');
    await fs.writeFile(path.join(workDir, 'data', 'runtime.sqlite-shm'), 'runtime-shm-v2\n');

    const result = await new GitManager(workDir).commit('test: prune runtime secrets');

    assert.equal(result.success, true);
    assert.notEqual(result.hash, 'no-changes');

    const { stdout } = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: workDir });
    assert.doesNotMatch(stdout, /^\.arena\/auth\.json$/m);
    assert.doesNotMatch(stdout, /^\.env\.arena-secrets$/m);
    assert.doesNotMatch(stdout, /^\.arena\/platform\.md$/m);
    assert.doesNotMatch(stdout, /^\.arena\/progress\.json$/m);
    assert.doesNotMatch(stdout, /^\.ralph\/provider-call-checkpoint\.json$/m);
    assert.doesNotMatch(stdout, /^\.ralph\/provider-session-checkpoint\.json$/m);
    assert.doesNotMatch(stdout, /^data\/runtime\.sqlite$/m);
    assert.doesNotMatch(stdout, /^data\/runtime\.sqlite-wal$/m);
    assert.doesNotMatch(stdout, /^data\/runtime\.sqlite-shm$/m);
    assert.match(stdout, /^\.ralph\/plan\.json$/m);
    assert.equal(await fs.pathExists(path.join(workDir, '.arena', 'auth.json')), true);
    assert.equal(await fs.pathExists(path.join(workDir, '.env.arena-secrets')), true);
    assert.equal(await fs.pathExists(path.join(workDir, '.arena', 'progress.json')), true);
    assert.equal(await fs.pathExists(path.join(workDir, '.ralph', 'provider-call-checkpoint.json')), true);
    assert.equal(await fs.pathExists(path.join(workDir, '.ralph', 'provider-session-checkpoint.json')), true);
    assert.equal(await fs.pathExists(path.join(workDir, 'data', 'runtime.sqlite')), true);
    assert.equal(await fs.pathExists(path.join(workDir, 'data', 'runtime.sqlite-wal')), true);
    assert.equal(await fs.pathExists(path.join(workDir, 'data', 'runtime.sqlite-shm')), true);
  } finally {
    await fs.remove(workDir);
  }
});

test('git manager removes tracked OS metadata during scoped loop-owned commits', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-git-manager-os-junk-'));
  try {
    await execa('git', ['init'], { cwd: workDir });
    await execa('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
    await execa('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
    await fs.ensureDir(path.join(workDir, '.ralph'));
    await fs.writeFile(path.join(workDir, '.gitignore'), '.DS_Store\n');
    await fs.writeFile(path.join(workDir, '.DS_Store'), 'metadata-v1\n');
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 1 });
    await execa('git', ['add', '-f', '.gitignore', '.DS_Store', '.ralph/plan.json'], { cwd: workDir });
    await execa('git', ['commit', '-m', 'test: baseline'], { cwd: workDir });

    await fs.writeFile(path.join(workDir, '.DS_Store'), 'metadata-v2\n');
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), { version: 2 });

    const result = await new GitManager(workDir).commitPaths('test: scoped plan', ['.ralph/plan.json']);

    assert.equal(result.success, true);
    assert.notEqual(result.hash, 'no-changes');

    const { stdout: trackedFiles } = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: workDir });
    assert.doesNotMatch(trackedFiles, /^\.DS_Store$/m);
    assert.match(trackedFiles, /^\.ralph\/plan\.json$/m);
    assert.equal(await fs.pathExists(path.join(workDir, '.DS_Store')), true);

    const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: workDir });
    assert.equal(status.trim(), '');
  } finally {
    await fs.remove(workDir);
  }
});

test('git manager cleans verifier-generated visual snapshots after excluding them from commit', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-git-manager-visual-snapshots-'));
  try {
    await execa('git', ['init'], { cwd: workDir });
    await execa('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
    await execa('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
    await fs.ensureDir(path.join(workDir, 'src'));
    await fs.ensureDir(path.join(workDir, 'generated', 'visual-responsive-snapshots'));
    await fs.writeFile(path.join(workDir, 'src', 'app.js'), 'export const value = 0;\n');
    await fs.writeFile(
      path.join(workDir, 'generated', 'visual-responsive-snapshots', 'mobile.png'),
      'snapshot-v1\n',
    );
    await execa('git', ['add', 'src/app.js', 'generated/visual-responsive-snapshots/mobile.png'], { cwd: workDir });
    await execa('git', ['commit', '-m', 'test: baseline'], { cwd: workDir });

    await fs.writeFile(path.join(workDir, 'src', 'app.js'), 'export const value = 1;\n');
    await fs.writeFile(
      path.join(workDir, 'generated', 'visual-responsive-snapshots', 'mobile.png'),
      'snapshot-v2\n',
    );
    await fs.writeFile(
      path.join(workDir, 'generated', 'visual-responsive-snapshots', 'new-mobile.png'),
      'snapshot-new\n',
    );

    const result = await new GitManager(workDir).commit('test: skip verifier snapshots');

    assert.equal(result.success, true);
    assert.notEqual(result.hash, 'no-changes');

    const { stdout } = await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: workDir });
    assert.match(stdout, /^src\/app\.js$/m);
    assert.match(stdout, /^generated\/visual-responsive-snapshots\/mobile\.png$/m);
    const { stdout: committedSnapshot } = await execa(
      'git',
      ['show', 'HEAD:generated/visual-responsive-snapshots/mobile.png'],
      { cwd: workDir },
    );
    assert.equal(committedSnapshot, 'snapshot-v1');
    assert.equal(
      await fs.readFile(path.join(workDir, 'generated', 'visual-responsive-snapshots', 'mobile.png'), 'utf-8'),
      'snapshot-v1\n',
    );
    assert.equal(
      await fs.pathExists(path.join(workDir, 'generated', 'visual-responsive-snapshots', 'new-mobile.png')),
      false,
    );
    const { stdout: status } = await execa('git', ['status', '--porcelain'], { cwd: workDir });
    assert.equal(status.trim(), '');
  } finally {
    await fs.remove(workDir);
  }
});
