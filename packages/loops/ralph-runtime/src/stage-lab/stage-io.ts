import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import fs from 'fs-extra';

export function assertStageFixturePathAllowed(pathToCheck: string, label: string): void {
  assertPathOutsideLoopTruthDirs(pathToCheck, label);
}

export function assertDisposableStageOutPathAllowed(input: {
  stageId: string;
  outPath: string;
  fixturePath?: string | null;
}): void {
  const resolvedPath = resolve(input.outPath);
  const parts = resolvedPath.split(sep);
  const fileName = parts[parts.length - 1] ?? '';
  const existingParent = nearestExistingParent(dirname(resolvedPath));
  const realExistingParent = fs.realpathSync(existingParent);

  if (input.fixturePath && resolvedPath === resolve(input.fixturePath)) {
    throw new Error(`${input.stageId} --out cannot overwrite the input fixture.`);
  }

  if (fs.pathExistsSync(resolvedPath)) {
    throw new Error(`${input.stageId} --out must target a new disposable experiment output file; refusing to overwrite an existing path.`);
  }

  assertPathOutsideLoopTruthDirs(realExistingParent, `${input.stageId} --out parent`);

  if (parts.includes('.ralph') || parts.includes('.arena')) {
    throw new Error(`${input.stageId} --out must be disposable experiment output outside .ralph and .arena source-truth directories.`);
  }

  if (
    fileName === 'plan.json'
    || fileName === 'decisions-log.json'
    || fileName === 'prompt-trace.jsonl'
    || fileName === 'ralph-progress.json'
    || fileName === 'iteration-log.json'
  ) {
    throw new Error(`${input.stageId} --out cannot target loop-owned truth file name: ${fileName}.`);
  }

  if (!isUnderDisposableOutputRoot(resolvedPath) || !isUnderDisposableOutputRoot(realExistingParent)) {
    throw new Error(`${input.stageId} --out must be under a system temp directory for fixture-mode disposable output.`);
  }
}

export function assertPathOutsideLoopTruthDirs(pathToCheck: string, label: string): void {
  const parts = resolve(pathToCheck).split(sep);
  if (parts.includes('.ralph') || parts.includes('.arena')) {
    throw new Error(`${label} must be outside .ralph and .arena source-truth directories.`);
  }
}

export function assertOutputDirOutsideWorkDir(input: {
  stageId: string;
  workDir: string;
  outDir: string;
}): void {
  const resolvedWorkDir = resolve(input.workDir);
  const resolvedOutDir = resolve(input.outDir);
  const lexicalRelative = relative(resolvedWorkDir, resolvedOutDir);
  const outDirParts = resolvedOutDir.split(sep);

  if (outDirParts.includes('.ralph') || outDirParts.includes('.arena')) {
    throw new Error(`${input.stageId} --out-dir must be outside .ralph and .arena source-truth directories.`);
  }

  if (!lexicalRelative || (!lexicalRelative.startsWith('..') && !isAbsolute(lexicalRelative))) {
    throw new Error(`${input.stageId} --out-dir must be outside workDir so experiment artifacts do not mutate project source.`);
  }

  const existingWorkParent = nearestExistingParent(resolvedWorkDir);
  const existingOutParent = nearestExistingParent(dirname(resolvedOutDir));
  const existingOutTarget = fs.pathExistsSync(resolvedOutDir) ? resolvedOutDir : existingOutParent;
  const realWorkDir = fs.realpathSync(existingWorkParent);
  const realOutTarget = fs.realpathSync(existingOutTarget);
  const realRelative = relative(realWorkDir, realOutTarget);

  if (!realRelative || (!realRelative.startsWith('..') && !isAbsolute(realRelative))) {
    throw new Error(`${input.stageId} --out-dir must resolve outside workDir.`);
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function nearestExistingParent(pathToCheck: string): string {
  let current = resolve(pathToCheck);
  while (!fs.pathExistsSync(current)) {
    const next = dirname(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function isUnderDisposableOutputRoot(pathToCheck: string): boolean {
  const resolvedPath = resolve(pathToCheck);
  return disposableOutputRoots().some((root) => {
    const resolvedRoot = resolve(root);
    return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`);
  });
}

function disposableOutputRoots(): string[] {
  const lexicalRoots = [
    tmpdir(),
    '/tmp',
    '/private/tmp',
  ].map((root) => resolve(root));
  const realRoots = lexicalRoots
    .filter((root) => fs.pathExistsSync(root))
    .map((root) => fs.realpathSync(root));
  return Array.from(new Set([...lexicalRoots, ...realRoots]));
}
