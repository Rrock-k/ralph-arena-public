import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

async function importPipelineWithTimeout(timeoutMs: number) {
  const previous = process.env.RALPH_UNIT_TEST_TIMEOUT_MS;
  process.env.RALPH_UNIT_TEST_TIMEOUT_MS = String(timeoutMs);
  const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src/verification/pipeline.ts')).href}?t=${Date.now()}-${Math.random()}`;
  const mod = await import(moduleUrl);
  return {
    VerificationPipeline: mod.VerificationPipeline as typeof import('./pipeline.js').VerificationPipeline,
    restore() {
      if (previous === undefined) {
        delete process.env.RALPH_UNIT_TEST_TIMEOUT_MS;
      } else {
        process.env.RALPH_UNIT_TEST_TIMEOUT_MS = previous;
      }
    },
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('node test runner summary is parsed into unit test counts', async () => {
  const { VerificationPipeline, restore } = await importPipelineWithTimeout(5000);

  try {
    const pipeline = new VerificationPipeline();
    const parsed = (pipeline as any).parseTestCount([
      '✔ one (0.55825ms)',
      '✔ two (0.067583ms)',
      'ℹ tests 2',
      'ℹ suites 0',
      'ℹ pass 2',
      'ℹ fail 0',
    ].join('\n'));

    assert.deepEqual(parsed, { total: 2, passed_count: 2 });
  } finally {
    restore();
  }
});

test('browser-responsive unit test output is retained as evidence hint', async () => {
  const { VerificationPipeline, restore } = await importPipelineWithTimeout(5000);

  try {
    const pipeline = new VerificationPipeline();
    const hints = (pipeline as any).extractUnitTestEvidenceHints([
      '✔ tests/visual-responsive.test.js > mobile-390 keeps modal fullscreen',
      '✔ tests/visual-responsive.test.js > desktop-1440 keeps active tab readable',
      'ℹ tests 2',
      'ℹ pass 2',
    ].join('\n'), 'npm test');

    assert.equal(hints.length, 1);
    assert.equal(hints[0].kind, 'test');
    assert.equal(hints[0].ref, 'verification:unit-tests:browser-responsive');
    assert.equal(hints[0].command, 'npm test');
    assert.match(hints[0].summary, /mobile-390/);
    assert.match(hints[0].summary, /desktop-1440/);
  } finally {
    restore();
  }
});

test('ordinary unit test output does not create evidence hints', async () => {
  const { VerificationPipeline, restore } = await importPipelineWithTimeout(5000);

  try {
    const pipeline = new VerificationPipeline();
    const hints = (pipeline as any).extractUnitTestEvidenceHints([
      '✔ src/math.test.js > adds numbers',
      'ℹ tests 1',
      'ℹ pass 1',
    ].join('\n'), 'npm test');

    assert.deepEqual(hints, []);
  } finally {
    restore();
  }
});

test('node verification detects missing direct dev dependencies before npm test', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-verification-devdeps-'));
  writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({
    name: 'devdeps-fixture',
    private: true,
    scripts: {
      test: 'jest',
    },
    devDependencies: {
      '@scope/present': '1.0.0',
      jest: '^30.0.0',
    },
  }, null, 2));
  mkdirSync(path.join(workDir, 'node_modules', '@scope', 'present'), { recursive: true });

  const { VerificationPipeline, restore } = await importPipelineWithTimeout(5000);

  try {
    const pipeline = new VerificationPipeline();
    const missing = await (pipeline as any).getMissingDirectNodeDevDependencies(workDir);
    assert.deepEqual(missing, ['jest']);
  } finally {
    restore();
  }
});

test('unit test timeout kills descendant test process tree', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-verification-timeout-'));
  const childPidPath = path.join(workDir, 'child-pid.txt');

  writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({
    name: 'timeout-fixture',
    private: true,
    type: 'module',
    scripts: {
      test: 'node hang.js',
    },
  }, null, 2));

  writeFileSync(path.join(workDir, 'hang.js'), `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});

writeFileSync('child-pid.txt', String(child.pid));
setInterval(() => {}, 1000);
`);

  const { VerificationPipeline, restore } = await importPipelineWithTimeout(800);

  try {
    const pipeline = new VerificationPipeline();
    const result = await pipeline.verify({
      workDir,
      level: 'standard',
      projectType: 'node',
    });

    assert.equal(result.passed, false);
    assert.equal(result.unitTests?.passed, false);
    assert.match(result.unitTests?.errors[0] ?? '', /timed out/i);
    assert.equal(existsSync(childPidPath), true);

    const childPid = Number(readFileSync(childPidPath, 'utf-8').trim());
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(processExists(childPid), false);
  } finally {
    restore();
  }
});

test('integration test timeout kills descendant test process tree', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-integration-timeout-'));
  const childPidPath = path.join(workDir, 'integration-child-pid.txt');

  writeFileSync(path.join(workDir, 'package.json'), JSON.stringify({
    name: 'integration-timeout-fixture',
    private: true,
    type: 'module',
    scripts: {
      'test:integration': 'node integration-hang.js',
    },
  }, null, 2));

  writeFileSync(path.join(workDir, 'integration-hang.js'), `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});

writeFileSync('integration-child-pid.txt', String(child.pid));
setInterval(() => {}, 1000);
`);

  const { VerificationPipeline, restore } = await importPipelineWithTimeout(800);

  try {
    const pipeline = new VerificationPipeline();
    const result = await pipeline.verify({
      workDir,
      level: 'full',
      projectType: 'node',
    });

    assert.equal(result.passed, false);
    assert.equal(result.integrationTests?.passed, false);
    assert.match(result.integrationTests?.errors[0] ?? '', /timed out/i);
    assert.equal(existsSync(childPidPath), true);

    const childPid = Number(readFileSync(childPidPath, 'utf-8').trim());
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(processExists(childPid), false);
  } finally {
    restore();
  }
});
