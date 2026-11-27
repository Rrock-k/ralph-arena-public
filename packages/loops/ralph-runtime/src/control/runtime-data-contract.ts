import fs from 'fs-extra';
import path from 'node:path';

export type RuntimeDataContractFindingKind =
  | 'workspace_runtime_data_file'
  | 'workspace_database_path'
  | 'destructive_startup_database_cleanup';

export type RuntimeDataContractFindingSeverity = 'blocking' | 'advisory';

export interface RuntimeDataContractFinding {
  kind: RuntimeDataContractFindingKind;
  severity: RuntimeDataContractFindingSeverity;
  path: string;
  line?: number;
  excerpt?: string;
  message: string;
}

export interface RuntimeDataContractResult {
  passed: boolean;
  findings: RuntimeDataContractFinding[];
  blockingFindings: RuntimeDataContractFinding[];
  advisoryFindings: RuntimeDataContractFinding[];
}

const DB_FILE_RE = /\.(?:sqlite3?|db)(?:-(?:journal|wal|shm))?$/i;
const DB_REFERENCE_RE = /\.(?:sqlite3?|db)(?:-(?:journal|wal|shm))?\b/i;
const DB_API_RE = /\b(?:new\s+Database|sqlite3\.Database|better-sqlite3|sqlite3|SQLITE|DATABASE_URL|DB_PATH|SQLITE_PATH)\b/i;
const WORKSPACE_PATH_RE = /\b(?:__dirname|process\.cwd\s*\(|import\.meta\.url|file:\.\/|file:\/workspace|\/workspace|\.\/|join\s*\()/i;
const ARENA_DATA_RE = /\bARENA_DATA_DIR\b|\/data\b|process\.env\.[A-Z0-9_]*DATA[A-Z0-9_]*/i;
const RM_DB_RE = /\brm\s+(?:-[A-Za-z]+\s+)*(?:[^#\n;&|]*\.(?:sqlite3?|db)(?:-(?:journal|wal|shm))?\*?|[^#\n;&|]*\*\.(?:sqlite3?|db)\*?)/i;

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.json',
  '.env',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.arena',
  '.ralph',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  'playwright-report',
  'test-results',
  '.cache',
  '.tmp',
]);

const FIXTURE_OR_TEST_SEGMENT_RE = /(?:^|\/)(?:e2e|tests?|__tests__|fixtures?|mocks?)(?:\/|$)/i;

export async function validateRuntimeDataContract(workDir: string): Promise<RuntimeDataContractResult> {
  const findings: RuntimeDataContractFinding[] = [];
  await scanDirectory(workDir, '', findings);
  const blockingFindings = findings.filter((finding) => finding.severity === 'blocking');
  const advisoryFindings = findings.filter((finding) => finding.severity === 'advisory');
  return {
    passed: blockingFindings.length === 0,
    findings,
    blockingFindings,
    advisoryFindings,
  };
}

async function scanDirectory(
  rootDir: string,
  relativeDir: string,
  findings: RuntimeDataContractFinding[],
): Promise<void> {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    const normalizedPath = toPosix(relativePath);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await scanDirectory(rootDir, relativePath, findings);
      continue;
    }
    if (!entry.isFile()) continue;

    if (isWorkspaceRuntimeDatabaseFile(normalizedPath)) {
      findings.push({
        kind: 'workspace_runtime_data_file',
        severity: 'blocking',
        path: normalizedPath,
        message: 'Runtime DB files must not live under /workspace; move app data to process.env.ARENA_DATA_DIR.',
      });
    }

    if (shouldScanTextFile(normalizedPath)) {
      const content = await fs.readFile(path.join(rootDir, relativePath), 'utf-8');
      scanTextFile(normalizedPath, content, findings);
    }
  }
}

function isWorkspaceRuntimeDatabaseFile(relativePath: string): boolean {
  if (FIXTURE_OR_TEST_SEGMENT_RE.test(relativePath)) return false;
  return DB_FILE_RE.test(path.basename(relativePath));
}

function shouldScanTextFile(relativePath: string): boolean {
  const basename = path.basename(relativePath);
  if (basename === 'arena-start.sh') return true;
  if (basename.endsWith('.sh')) return true;
  if (basename === 'package.json') return true;
  return SOURCE_EXTENSIONS.has(path.extname(basename));
}

function scanTextFile(
  relativePath: string,
  content: string,
  findings: RuntimeDataContractFinding[],
): void {
  const lines = content.split(/\r?\n/);
  const arenaDataAliases = new Set<string>();
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

    const arenaDataAlias = trimmed.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=.*\bARENA_DATA_DIR\b/);
    if (arenaDataAlias?.[1]) {
      arenaDataAliases.add(arenaDataAlias[1]);
    }

    const isDestructiveDbCleanup = isStartupSurface(relativePath) && RM_DB_RE.test(trimmed);
    if (isDestructiveDbCleanup) {
      findings.push({
        kind: 'destructive_startup_database_cleanup',
        severity: 'blocking',
        path: relativePath,
        line: index + 1,
        excerpt: trimmed,
        message: 'Startup scripts must not delete SQLite/DB files; fix seed logic to be idempotent instead.',
      });
      return;
    }

    if (FIXTURE_OR_TEST_SEGMENT_RE.test(relativePath)) return;
    if (!DB_REFERENCE_RE.test(trimmed)) return;
    if (referencesArenaData(trimmed, arenaDataAliases)) return;
    if (!DB_API_RE.test(trimmed) && !WORKSPACE_PATH_RE.test(trimmed)) return;

    findings.push({
      kind: 'workspace_database_path',
      severity: 'advisory',
      path: relativePath,
      line: index + 1,
      excerpt: trimmed,
      message: 'Potential source-relative SQLite/DB runtime path. Review through the contract audit layer; use process.env.ARENA_DATA_DIR for persisted app data.',
    });
  });
}

function referencesArenaData(line: string, aliases: Set<string>): boolean {
  if (ARENA_DATA_RE.test(line)) return true;
  for (const alias of aliases) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(line)) return true;
  }
  return false;
}

function isStartupSurface(relativePath: string): boolean {
  const basename = path.basename(relativePath);
  return basename === 'arena-start.sh' || basename === 'package.json' || basename.endsWith('.sh');
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
