import fs from 'fs-extra';
import path from 'path';
import {
  RALPH_GITIGNORE_MANAGED_SECTION_END,
  RALPH_GITIGNORE_MANAGED_SECTION_START,
  stripRalphManagedGitignoreSection,
} from '@arena/contracts';
import { log } from '../utils/logger.js';

/**
 * Gitignore Enforcer
 * 
 * Deterministic (no LLM) module that ensures the project .gitignore
 * contains essential entries to prevent committing build artifacts,
 * dependencies, secrets, and framework-specific output.
 * 
 * Runs at initialization and after each commit. Fully idempotent.
 * 
 * Logic:
 * 1. Read existing .gitignore (or create if missing)
 * 2. Detect project type from files present (Next.js, Vite, Express, etc.)
 * 3. Compute required entries based on detected stack
 * 4. Append any missing entries under a managed section
 * 5. Stage the updated .gitignore
 */

export interface EnforcerResult {
  entriesAdded: string[];
  alreadyPresent: number;
  created: boolean;
}

// ── Core entries that EVERY project must have ────────────────────────────
const CORE_ENTRIES = [
  'node_modules/',
  '.env',
  '.env.*',
  '!.env.example',
  '.arena/*',
  '.ralph/*',
  '!.ralph/plan.json',
  '!.ralph/plan-archive.jsonl',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  '*.sqlite',
  '*.sqlite-journal',
  '*.sqlite-wal',
  '*.sqlite-shm',
  '*.sqlite3',
  '*.sqlite3-journal',
  '*.sqlite3-wal',
  '*.sqlite3-shm',
  '*.db',
  '*.db-journal',
  '*.db-wal',
  '*.db-shm',
  'logs/',
  '*.log',
  '.cache/',
  '.tmp/',
  '.DS_Store',
  'Thumbs.db',
];

// ── Stack-specific entries, keyed by detection file/dir ──────────────────
interface StackRule {
  /** Files whose existence triggers this rule */
  detect: string[];
  /** Gitignore entries to add */
  entries: string[];
  /** Human-readable label for the log */
  label: string;
}

const STACK_RULES: StackRule[] = [
  {
    detect: ['next.config.js', 'next.config.ts', 'next.config.mjs'],
    entries: ['.next/', '.vercel/'],
    label: 'Next.js',
  },
  {
    detect: ['vite.config.ts', 'vite.config.js'],
    entries: ['.vite/'],
    label: 'Vite',
  },
  {
    detect: ['nuxt.config.ts', 'nuxt.config.js'],
    entries: ['.nuxt/', '.output/'],
    label: 'Nuxt',
  },
  {
    detect: ['prisma/schema.prisma'],
    entries: ['prisma/*.db', 'prisma/*.db-journal', 'prisma/*.db-wal', 'prisma/*.db-shm'],
    label: 'Prisma',
  },
  {
    detect: ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile'],
    entries: ['.docker-data/'],
    label: 'Docker',
  },
  {
    detect: ['tsconfig.json'],
    entries: ['*.tsbuildinfo'],
    label: 'TypeScript',
  },
  {
    detect: ['vitest.config.ts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js'],
    entries: ['coverage/'],
    label: 'Test runner',
  },
  {
    detect: ['playwright.config.ts', 'playwright.config.js'],
    entries: ['test-results/', 'playwright-report/', 'playwright/.cache/'],
    label: 'Playwright',
  },
];

// Managed section markers
const SECTION_START = RALPH_GITIGNORE_MANAGED_SECTION_START;
const SECTION_END = RALPH_GITIGNORE_MANAGED_SECTION_END;

function parseGitignoreEntries(content: string): Set<string> {
  return new Set(
    content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
  );
}

function removeManagedSection(content: string): { content: string; removed: boolean } {
  const result = stripRalphManagedGitignoreSection(content);
  return {
    content: result.content.trimEnd(),
    removed: result.removed,
  };
}

function normalizeLegacyDirectoryIgnores(content: string): { content: string; removed: boolean } {
  const lines = content.split('\n');
  const normalized = lines.filter(line => {
    const trimmed = line.trim();
    return trimmed !== '.arena/' && trimmed !== '.ralph/';
  });

  return {
    content: normalized.join('\n').trimEnd(),
    removed: normalized.length !== lines.length,
  };
}

/**
 * Ensure .gitignore in `workDir` contains all essential entries.
 * Fully idempotent — safe to call on every iteration.
 */
export async function enforceGitignore(workDir: string): Promise<EnforcerResult> {
  const gitignorePath = path.join(workDir, '.gitignore');
  let created = false;

  // 1. Read existing content (or start fresh)
  let existing = '';
  if (await fs.pathExists(gitignorePath)) {
    existing = await fs.readFile(gitignorePath, 'utf-8');
  } else {
    created = true;
  }

  // 2. Remove the previous managed section before computing missing entries.
  // Otherwise stale managed entries look "already present" and get lost when
  // the old block is replaced.
  const withoutManagedSection = removeManagedSection(existing);
  const withoutLegacyDirectoryIgnores = normalizeLegacyDirectoryIgnores(withoutManagedSection.content);
  const preserved = {
    content: withoutLegacyDirectoryIgnores.content,
    removed: withoutManagedSection.removed || withoutLegacyDirectoryIgnores.removed,
  };
  const existingEntries = parseGitignoreEntries(preserved.content);

  // 3. Detect stack
  const detected: string[] = [];
  const requiredEntries = [...CORE_ENTRIES];

  for (const rule of STACK_RULES) {
    const found = await Promise.all(
      rule.detect.map(f => fs.pathExists(path.join(workDir, f)))
    );
    if (found.some(Boolean)) {
      detected.push(rule.label);
      requiredEntries.push(...rule.entries);
    }
  }

  // 4. Find missing entries
  const missing = requiredEntries.filter(entry => !existingEntries.has(entry));

  if (missing.length === 0) {
    if (preserved.removed) {
      await fs.writeFile(gitignorePath, preserved.content.trimEnd() + '\n', 'utf-8');
      try {
        const { execa } = await import('execa');
        await execa('git', ['add', '.gitignore'], { cwd: workDir });
      } catch {
        // Non-fatal — git might not be initialised yet
      }
    }
    log.info(`Gitignore Enforcer: all ${requiredEntries.length} entries present (stack: ${detected.join(', ') || 'generic'})`);
    return { entriesAdded: [], alreadyPresent: existingEntries.size, created: false };
  }

  // 5. Build the managed section
  const managedBlock = [
    '',
    SECTION_START,
    `# Detected stack: ${detected.join(', ') || 'generic'}`,
    ...missing,
    SECTION_END,
  ].join('\n');

  // 6. Append a fresh managed section to the preserved user-owned content.
  let content = preserved.content;

  // Ensure trailing newline before appending
  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }
  content += managedBlock + '\n';

  await fs.writeFile(gitignorePath, content, 'utf-8');

  // 7. Stage the .gitignore so it's included in the next commit
  try {
    const { execa } = await import('execa');
    await execa('git', ['add', '.gitignore'], { cwd: workDir });
  } catch {
    // Non-fatal — git might not be initialised yet
  }

  log.info(
    `Gitignore Enforcer: added ${missing.length} entries (stack: ${detected.join(', ') || 'generic'}): ${missing.join(', ')}`
  );

  return { entriesAdded: missing, alreadyPresent: existingEntries.size, created };
}
