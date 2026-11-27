import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { enforceGitignore } from './gitignore-enforcer.js';

test('gitignore enforcer keeps .arena ephemeral without bootstrap exceptions', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-gitignore-'));
  try {
    await fs.writeFile(path.join(workDir, 'package.json'), '{"name":"demo","version":"1.0.0"}\n');

    const result = await enforceGitignore(workDir);
    assert.ok(!result.entriesAdded.includes('!.arena/start.sh'));

    const gitignore = await fs.readFile(path.join(workDir, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.arena\/\*$/m);
    assert.doesNotMatch(gitignore, /^!\.arena\/start\.sh$/m);
    assert.doesNotMatch(gitignore, /^!\.arena\/progress\.json$/m);
    assert.match(gitignore, /^\*\.sqlite$/m);
    assert.match(gitignore, /^\*\.sqlite-wal$/m);
    assert.match(gitignore, /^\*\.sqlite-shm$/m);
    assert.match(gitignore, /^\*\.db$/m);
    assert.match(gitignore, /^\*\.db-wal$/m);
    assert.match(gitignore, /^\*\.db-shm$/m);
  } finally {
    await fs.remove(workDir);
  }
});

test('gitignore enforcer keeps Ralph plan durable while ignoring other Ralph internals', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-gitignore-plan-'));
  try {
    await fs.writeFile(path.join(workDir, 'package.json'), '{"name":"demo","version":"1.0.0"}\n');

    await enforceGitignore(workDir);

    const gitignore = await fs.readFile(path.join(workDir, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.ralph\/\*$/m);
    assert.match(gitignore, /^!\.ralph\/plan\.json$/m);
    assert.doesNotMatch(gitignore, /^\.ralph\/$/m);
  } finally {
    await fs.remove(workDir);
  }
});

test('gitignore enforcer replaces legacy managed .ralph directory ignore', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-gitignore-legacy-plan-'));
  try {
    await fs.writeFile(
      path.join(workDir, '.gitignore'),
      [
        '# ── ralph: auto-managed (do not edit below) ──',
        '# Detected stack: generic',
        '.ralph/',
        '# ── ralph: end auto-managed ──',
        '',
      ].join('\n'),
    );

    await enforceGitignore(workDir);

    const gitignore = await fs.readFile(path.join(workDir, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.ralph\/\*$/m);
    assert.match(gitignore, /^!\.ralph\/plan\.json$/m);
    assert.doesNotMatch(gitignore, /^\.ralph\/$/m);
  } finally {
    await fs.remove(workDir);
  }
});

test('gitignore enforcer replaces legacy user-owned Ralph and Arena directory ignores', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-gitignore-legacy-user-owned-'));
  try {
    await fs.writeFile(
      path.join(workDir, '.gitignore'),
      [
        '# User-owned app ignore remains intact',
        'custom-output/',
        '.arena/',
        '.ralph/',
        '',
      ].join('\n'),
    );

    await enforceGitignore(workDir);

    const gitignore = await fs.readFile(path.join(workDir, '.gitignore'), 'utf8');
    assert.match(gitignore, /^custom-output\/$/m);
    assert.match(gitignore, /^\.arena\/\*$/m);
    assert.match(gitignore, /^\.ralph\/\*$/m);
    assert.match(gitignore, /^!\.ralph\/plan\.json$/m);
    assert.doesNotMatch(gitignore, /^\.arena\/$/m);
    assert.doesNotMatch(gitignore, /^\.ralph\/$/m);
  } finally {
    await fs.remove(workDir);
  }
});

test('gitignore enforcer recomputes required entries when replacing old managed section', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-gitignore-recompute-'));
  try {
    await fs.writeFile(
      path.join(workDir, '.gitignore'),
      [
        '# User-owned entry stays outside the managed block',
        'custom-output/',
        '',
        '# ── ralph: auto-managed (do not edit below) ──',
        '# Detected stack: generic',
        '.ralph/*',
        '!.ralph/plan.json',
        '*.sqlite',
        '*.sqlite-wal',
        '*.sqlite-shm',
        '*.sqlite3',
        '*.db',
        '*.db-journal',
        '# ── ralph: end auto-managed ──',
        '',
      ].join('\n'),
    );

    await enforceGitignore(workDir);

    const gitignore = await fs.readFile(path.join(workDir, '.gitignore'), 'utf8');
    assert.match(gitignore, /^custom-output\/$/m);
    assert.match(gitignore, /^\.arena\/\*$/m);
    assert.match(gitignore, /^\.ralph\/\*$/m);
    assert.match(gitignore, /^!\.ralph\/plan\.json$/m);
    assert.doesNotMatch(gitignore, /^!\.arena\/progress\.json$/m);
    assert.match(gitignore, /^\*\.sqlite$/m);
    assert.match(gitignore, /^\*\.sqlite-wal$/m);
    assert.match(gitignore, /^\*\.sqlite-shm$/m);
    assert.match(gitignore, /^\*\.db$/m);
    assert.match(gitignore, /^\*\.db-wal$/m);
    assert.match(gitignore, /^\*\.db-shm$/m);
  } finally {
    await fs.remove(workDir);
  }
});
