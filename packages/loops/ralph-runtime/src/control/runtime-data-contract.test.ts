import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { validateRuntimeDataContract } from './runtime-data-contract.js';

test('runtime data contract rejects sampleapp-style workspace sqlite reset', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-runtime-data-'));
  try {
    await fs.writeFile(
      path.join(workDir, 'server.js'),
      [
        "import { join } from 'node:path';",
        "import Database from 'better-sqlite3';",
        "const db = new Database(join(__dirname, 'data.sqlite'));",
        "const DATA_DIR = process.env.ARENA_DATA_DIR || '/data';",
        'console.log(DATA_DIR, db.open);',
        '',
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(workDir, 'arena-start.sh'),
      ['#!/bin/sh', 'rm -f data.sqlite data.sqlite-shm data.sqlite-wal', 'npm start', ''].join('\n'),
    );
    await fs.writeFile(path.join(workDir, 'data.sqlite'), 'sqlite bytes');

    const result = await validateRuntimeDataContract(workDir);

    assert.equal(result.passed, false);
    assert.deepEqual(
      result.blockingFindings.map((finding) => finding.kind).sort(),
      [
        'destructive_startup_database_cleanup',
        'workspace_runtime_data_file',
      ].sort(),
    );
    assert.deepEqual(result.advisoryFindings.map((finding) => finding.kind), ['workspace_database_path']);
    assert.match(result.findings.map((finding) => finding.message).join('\n'), /idempotent/);
    assert.match(result.findings.map((finding) => finding.message).join('\n'), /ARENA_DATA_DIR/);
  } finally {
    await fs.remove(workDir);
  }
});

test('runtime data contract accepts database paths rooted in ARENA_DATA_DIR', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-runtime-data-ok-'));
  try {
    await fs.writeFile(
      path.join(workDir, 'server.js'),
      [
        "import { join } from 'node:path';",
        "import Database from 'better-sqlite3';",
        "const dataDir = process.env.ARENA_DATA_DIR || '/data';",
        "const db = new Database(join(dataDir, 'sampleapp.sqlite'));",
        'console.log(db.open);',
        '',
      ].join('\n'),
    );
    await fs.writeFile(path.join(workDir, 'arena-start.sh'), ['#!/bin/sh', 'npm start', ''].join('\n'));

    const result = await validateRuntimeDataContract(workDir);

    assert.equal(result.passed, true);
    assert.deepEqual(result.findings, []);
  } finally {
    await fs.remove(workDir);
  }
});

test('runtime data contract rejects destructive database cleanup in package scripts', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-runtime-data-package-'));
  try {
    await fs.writeJSON(path.join(workDir, 'package.json'), {
      scripts: {
        start: 'rm -f app.db && node server.js',
      },
    });

    const result = await validateRuntimeDataContract(workDir);

    assert.equal(result.passed, false);
    assert.equal(result.blockingFindings.length, 1);
    assert.equal(result.blockingFindings[0]?.kind, 'destructive_startup_database_cleanup');
    assert.equal(result.advisoryFindings.length, 0);
  } finally {
    await fs.remove(workDir);
  }
});

test('runtime data contract reports source-relative db paths as advisory findings', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-runtime-data-advisory-'));
  try {
    await fs.writeFile(
      path.join(workDir, 'server.js'),
      [
        "import { join } from 'node:path';",
        "import Database from 'better-sqlite3';",
        "const db = new Database(join(__dirname, 'data.sqlite'));",
        'console.log(db.open);',
        '',
      ].join('\n'),
    );

    const result = await validateRuntimeDataContract(workDir);

    assert.equal(result.passed, true);
    assert.equal(result.blockingFindings.length, 0);
    assert.equal(result.advisoryFindings.length, 1);
    assert.equal(result.advisoryFindings[0]?.kind, 'workspace_database_path');
  } finally {
    await fs.remove(workDir);
  }
});
