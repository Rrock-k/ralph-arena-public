import type { BacklogTask, TaskStatus, Priority, TaskColor, SessionLink } from "./types";
import { ALL_STATUSES, TASK_COLORS } from "./constants";

const TASK_HEADING_RE = /^### \[([^\]]+)\]\s+([A-Z]+-\d+):\s+(.+)$/;
const PRIORITY_RE = /^>\s*Priority:\s*(P[0-3])/;
const COLOR_RE = /^>\s*Color:\s*(\w+)/;
const DEPENDS_RE = /^>\s*Depends on:\s*(.+)/;
const SESSION_RE = /^>\s*Session:\s*\[`([^`]+)`\]\(claude-session:\/\/([0-9a-f-]{36})\)\s*(?:—\s*(.+))?$/;
const CRITERIA_ITEM_RE = /^- \[([ x])\] (.+)$/;

function isValidStatus(s: string): s is TaskStatus {
  return ALL_STATUSES.includes(s as TaskStatus);
}

export class DuplicateTaskIdError extends Error {
  constructor(public readonly duplicateIds: string[]) {
    super(`Duplicate task IDs found: ${duplicateIds.join(", ")}`);
    this.name = "DuplicateTaskIdError";
  }
}

export class InvalidTaskStatusError extends Error {
  constructor(
    public readonly invalidStatuses: string[],
    public readonly sourceFile: string
  ) {
    super(`Invalid task statuses found: ${invalidStatuses.join(", ")}`);
    this.name = "InvalidTaskStatusError";
  }
}

function findInvalidTaskStatuses(lines: string[], sourceFile: string): string[] {
  const invalidStatuses: string[] = [];
  const allowedStatuses = ALL_STATUSES.join(", ");

  lines.forEach((line, index) => {
    const headingMatch = line.match(TASK_HEADING_RE);
    if (!headingMatch) return;

    const rawStatus = headingMatch[1].trim();
    if (isValidStatus(rawStatus)) return;

    invalidStatuses.push(
      `${headingMatch[2]} has unsupported status "${rawStatus}" at line ${index + 1} in ${sourceFile}. Allowed statuses: ${allowedStatuses}`
    );
  });

  return invalidStatuses;
}

export function parseMarkdownTasks(content: string, sourceFile: string): BacklogTask[] {
  const lines = content.split("\n");
  const invalidStatuses = findInvalidTaskStatuses(lines, sourceFile);
  if (invalidStatuses.length > 0) {
    throw new InvalidTaskStatusError(invalidStatuses, sourceFile);
  }

  const tasks: BacklogTask[] = [];
  const seenIds = new Map<string, number>(); // id → lineStart

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Try to match a task heading
    const headingMatch = line.match(TASK_HEADING_RE);
    if (!headingMatch) {
      i++;
      continue;
    }

    const rawStatus = headingMatch[1].trim();
    if (!isValidStatus(rawStatus)) {
      i++;
      continue;
    }

    const lineStart = i;
    const id = headingMatch[2];
    const title = headingMatch[3].trim();
    const status = rawStatus;
    let priority: Priority = "P2"; // default
    let color: TaskColor | undefined;
    const dependsOn: string[] = [];
    const sessions: SessionLink[] = [];
    const descriptionLines: string[] = [];
    const acceptanceCriteria: Array<{ text: string; checked: boolean }> = [];
    let inCriteria = false;

    // Check for duplicate ID
    if (seenIds.has(id)) {
      const firstLine = seenIds.get(id)!;
      throw new DuplicateTaskIdError([
        `${id} at line ${firstLine + 1} and line ${lineStart + 1} in ${sourceFile}`,
      ]);
    }
    seenIds.set(id, lineStart);

    // Advance past the heading
    i++;

    // Parse body lines until next task heading or EOF
    while (i < lines.length) {
      const bodyLine = lines[i];

      // Stop if we hit next task heading
      if (TASK_HEADING_RE.test(bodyLine)) {
        break;
      }

      // Priority
      const prioMatch = bodyLine.match(PRIORITY_RE);
      if (prioMatch) {
        priority = prioMatch[1] as Priority;
        i++;
        continue;
      }

      // Color
      const colorMatch = bodyLine.match(COLOR_RE);
      if (colorMatch) {
        const val = colorMatch[1].toLowerCase() as TaskColor;
        if (TASK_COLORS.includes(val)) {
          color = val;
        }
        i++;
        continue;
      }

      // Dependencies
      const depMatch = bodyLine.match(DEPENDS_RE);
      if (depMatch) {
        const deps = depMatch[1].split(",").map((d) => d.trim().replace(/^#/, ""));
        dependsOn.push(...deps);
        i++;
        continue;
      }

      // Session links
      const sessionMatch = bodyLine.match(SESSION_RE);
      if (sessionMatch) {
        sessions.push({
          shortId: sessionMatch[1],
          fullId: sessionMatch[2],
          label: sessionMatch[3]?.trim() || "",
        });
        i++;
        continue;
      }

      // Acceptance criteria section
      if (bodyLine.includes("**Acceptance criteria:**") || bodyLine.includes("**Acceptance Criteria:**")) {
        inCriteria = true;
        i++;
        continue;
      }

      if (inCriteria) {
        const criteriaMatch = bodyLine.match(CRITERIA_ITEM_RE);
        if (criteriaMatch) {
          acceptanceCriteria.push({
            checked: criteriaMatch[1] === "x",
            text: criteriaMatch[2].trim(),
          });
          i++;
          continue;
        }
        // Blank line or non-criteria line ends criteria section
        if (bodyLine.trim() !== "" && !criteriaMatch) {
          inCriteria = false;
        }
      }

      descriptionLines.push(bodyLine);
      i++;
    }

    const lineEnd = i - 1;

    // Clean up description — remove leading/trailing blank lines and blockquote metadata
    const description = descriptionLines
      .filter((l) => !PRIORITY_RE.test(l) && !COLOR_RE.test(l) && !DEPENDS_RE.test(l) && !SESSION_RE.test(l))
      .join("\n")
      .trim();

    tasks.push({
      id,
      title,
      status,
      priority,
      ...(color ? { color } : {}),
      dependsOn,
      sessions,
      description,
      acceptanceCriteria,
      sourceFile,
      lineStart,
      lineEnd,
    });
  }

  return tasks;
}
