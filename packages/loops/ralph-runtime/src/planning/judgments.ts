import fs from 'fs-extra';
import path from 'path';
import type { Judgment } from '../config/types.js';
import { JudgmentSchema } from '../config/types.js';
import { log } from '../utils/logger.js';

/**
 * JudgmentLog — append-only audit log for all judgments (суждения).
 * 
 * plan.json contains current judgments. This log keeps the full history
 * including revisions, for auditability and reporting.
 */
export class JudgmentLog {
  private entries: JudgmentEntry[] = [];
  private logPath: string;
  private nextId: number = 1;

  constructor(workDir: string) {
    this.logPath = path.join(workDir, '.ralph', 'decisions-log.json');
  }

  async load(): Promise<void> {
    try {
      if (await fs.pathExists(this.logPath)) {
        this.entries = await fs.readJson(this.logPath);
        // Compute next id from existing entries
        const maxNum = this.entries.reduce((max, e) => {
          const num = parseInt(e.judgment.id.replace('judgment-', ''), 10);
          return isNaN(num) ? max : Math.max(max, num);
        }, 0);
        this.nextId = maxNum + 1;
      }
    } catch {
      this.entries = [];
    }
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.logPath));
    await fs.writeJson(this.logPath, this.entries, { spaces: 2 });
  }

  /**
   * Generate next judgment ID
   */
  generateId(): string {
    return `judgment-${String(this.nextId++).padStart(3, '0')}`;
  }

  /**
   * Record a new judgment (from Planner, Executor, or Controller)
   */
  record(judgment: Judgment): void {
    this.entries.push({
      type: 'created',
      timestamp: new Date().toISOString(),
      judgment,
    });
    log.info(`Judgment ${judgment.id}: "${judgment.ambiguity.slice(0, 60)}…" → option ${judgment.chosen} (by ${judgment.madeBy})`);
  }

  /**
   * Record a revision of an existing judgment
   */
  recordRevision(judgmentId: string, previousChoice: number, newChoice: number, reasoning: string): void {
    this.entries.push({
      type: 'revised',
      timestamp: new Date().toISOString(),
      judgment: {
        id: judgmentId,
        previousChoice,
        newChoice,
        reasoning,
        revisedBy: 'controller',
      } as any,
    });
    log.info(`Judgment ${judgmentId} revised: option ${previousChoice} → ${newChoice}`);
  }

  /**
   * Get all entries (for audit/reporting)
   */
  getAll(): JudgmentEntry[] {
    return [...this.entries];
  }

  /**
   * Generate a summary for reporting
   */
  generateReport(): string {
    const created = this.entries.filter((e): e is JudgmentCreatedEntry => e.type === 'created');
    const revised = this.entries.filter((e): e is JudgmentRevisedEntry => e.type === 'revised');

    const lines = [
      `# Judgment Report`,
      ``,
      `Total judgments: ${created.length}`,
      `Revised: ${revised.length}`,
      ``,
    ];

    for (const entry of created) {
      const j = entry.judgment;
      const chosenText = j.options?.[j.chosen] ?? `option ${j.chosen}`;
      const wasRevised = revised.some(r => r.judgment.id === j.id);
      lines.push(`## ${j.id}${wasRevised ? ' (REVISED)' : ''}`);
      lines.push(`**Ambiguity:** ${j.ambiguity}`);
      lines.push(`**Chosen:** ${chosenText}`);
      lines.push(`**Reasoning:** ${j.reasoning}`);
      lines.push(`**By:** ${j.madeBy}`);
      lines.push(``);
    }

    return lines.join('\n');
  }
}

interface JudgmentCreatedEntry {
  type: 'created';
  timestamp: string;
  judgment: Judgment;
}

interface JudgmentRevisedEntry {
  type: 'revised';
  timestamp: string;
  judgment: { id: string; previousChoice: number; newChoice: number; reasoning: string; revisedBy: string };
}

type JudgmentEntry = JudgmentCreatedEntry | JudgmentRevisedEntry;
