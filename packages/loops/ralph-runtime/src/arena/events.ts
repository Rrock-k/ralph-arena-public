import fs from 'fs-extra';
import path from 'path';
import { log } from '../utils/logger.js';

interface TestStep {
  question: string;
}

interface TestRequest {
  type: 'test_request';
  payload: {
    title: string;
    steps: TestStep[];
    url?: string;
  };
}

interface TestStepResult {
  stepIndex: number;
  passed: boolean;
  comment?: string;
}

interface IncomingEvent {
  id: string;
  type: string;
  payload: {
    testRequestEventId?: string;
    results?: TestStepResult[];
    [key: string]: unknown;
  };
  createdAt: string;
}

export class ArenaEventManager {
  private outgoingPath: string;
  private incomingPath: string;

  constructor(workDir: string) {
    const arenaDir = path.join(workDir, '.arena');
    this.outgoingPath = path.join(arenaDir, 'outgoing-events.json');
    this.incomingPath = path.join(arenaDir, 'events.json');
  }

  /**
   * Write test requests to outgoing-events.json.
   * Appends to existing events (runner tracks push index).
   */
  async writeTestRequests(tests: Array<{ title: string; steps: Array<{ question: string }>; url?: string }>): Promise<void> {
    const existing = await this.readOutgoing();
    for (const test of tests) {
      existing.push({
        type: 'test_request',
        payload: {
          title: test.title,
          steps: test.steps,
          ...(test.url ? { url: test.url } : {}),
        },
      });
    }
    // Atomic write: tmp file + rename
    const tmp = this.outgoingPath + '.tmp';
    await fs.writeJson(tmp, existing, { spaces: 2 });
    await fs.rename(tmp, this.outgoingPath);
  }

  /**
   * Read test results from events.json (written by runner).
   */
  async readTestResults(): Promise<IncomingEvent[]> {
    try {
      if (!await fs.pathExists(this.incomingPath)) return [];
      const events: IncomingEvent[] = await fs.readJson(this.incomingPath);
      return events.filter(e => e.type === 'test_result');
    } catch {
      return [];
    }
  }

  /**
   * Read batched QA feedback from events.json (written by governance cron).
   */
  async readQAFeedbackBatches(): Promise<IncomingEvent[]> {
    try {
      if (!await fs.pathExists(this.incomingPath)) return [];
      const events: IncomingEvent[] = await fs.readJson(this.incomingPath);
      return events.filter(e => e.type === 'qa_feedback_batch');
    } catch {
      return [];
    }
  }

  /**
   * Format test feedback for inclusion in agent context.
   * Prefers qa_feedback_batch (pre-aggregated by governance) over individual test_result events.
   * Returns null if no feedback exists.
   */
  async formatTestFeedback(): Promise<string | null> {
    // Prefer batched feedback (already aggregated by governance cron)
    const batches = await this.readQAFeedbackBatches();
    if (batches.length > 0) {
      return this.formatBatchedFeedback(batches);
    }

    // Fallback to individual test_result events
    const results = await this.readTestResults();
    if (results.length === 0) return null;

    const lines: string[] = ['# QA Feedback from Community Testing', ''];

    for (const event of results.slice(-10)) {
      const r = event.payload.results ?? [];
      const passed = r.filter(s => s.passed).length;
      const failed = r.filter(s => !s.passed).length;
      lines.push(`**Test ${event.id}**: ${passed} passed, ${failed} failed`);

      for (const step of r) {
        if (!step.passed) {
          lines.push(`  - FAILED step ${step.stepIndex}: ${step.comment ?? '(no comment)'}`);
        }
      }
    }

    lines.push('', 'Fix the failing QA checks in your current iteration if they relate to your task.');
    return lines.join('\n');
  }

  /**
   * Format qa_feedback_batch events into agent-readable context.
   */
  private formatBatchedFeedback(batches: IncomingEvent[]): string {
    const lines: string[] = ['# QA Feedback from Community Testing', ''];

    // Use the most recent batch (last one wins)
    const latest = batches[batches.length - 1];
    const payload = latest.payload as {
      summary?: string;
      tests?: Array<{
        testTitle: string;
        steps: Array<{ question: string; passed: boolean; comment?: string }>;
      }>;
      totalPassed?: number;
      totalFailed?: number;
    };

    if (payload.summary) {
      lines.push(payload.summary, '');
    }

    if (payload.tests) {
      for (const test of payload.tests) {
        const failedSteps = test.steps.filter(s => !s.passed);
        if (failedSteps.length === 0) {
          lines.push(`**${test.testTitle}**: all steps passed`);
        } else {
          lines.push(`**${test.testTitle}**: ${failedSteps.length} step(s) FAILED`);
          for (const step of failedSteps) {
            lines.push(`  - FAILED: "${step.question}"`);
            if (step.comment) {
              lines.push(`    User comment: ${step.comment}`);
            }
          }
        }
      }
    }

    if (payload.totalFailed && payload.totalFailed > 0) {
      lines.push('', 'Fix the failing QA checks above if they relate to your current task.');
    }

    return lines.join('\n');
  }

  private async readOutgoing(): Promise<TestRequest[]> {
    try {
      if (!await fs.pathExists(this.outgoingPath)) return [];
      return await fs.readJson(this.outgoingPath);
    } catch {
      return [];
    }
  }
}
