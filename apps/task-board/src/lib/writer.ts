import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { BacklogTask, TaskStatus, TaskUpdates } from "./types";
import { ALL_STATUSES } from "./constants";
import { getAllTasks, getBacklogDir } from "./backlog";

const TASK_HEADING_RE = /^### \[([A-Z ]+)\]\s+([A-Z]+-\d+):\s+(.+)$/;

export async function moveTask(
  taskId: string,
  ref: { afterTaskId?: string; beforeTaskId?: string }
): Promise<void> {
  const refId = ref.afterTaskId ?? ref.beforeTaskId;
  const mode = ref.afterTaskId ? "after" : "before";
  if (!refId) throw new Error("afterTaskId or beforeTaskId required");

  const allTasks = await getAllTasks();
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const refTask = allTasks.find((t) => t.id === refId);
  if (!refTask) throw new Error(`Reference task ${refId} not found`);
  if (refTask.sourceFile !== task.sourceFile) {
    throw new Error("Cannot reorder tasks across different files");
  }
  if (refTask.id === taskId) return;

  const filePath = path.join(getBacklogDir(), task.sourceFile);
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  // Extract task block, strip trailing blank lines (we add our own spacing)
  const block = lines.slice(task.lineStart, task.lineEnd + 1);
  while (block.length > 0 && block[block.length - 1].trim() === "") block.pop();

  // Remove the original block
  const removeCount = task.lineEnd - task.lineStart + 1;
  lines.splice(task.lineStart, removeCount);

  // Recalculate reference position after removal
  let refStart = refTask.lineStart;
  let refEnd = refTask.lineEnd;
  if (task.lineStart < refTask.lineStart) {
    refStart -= removeCount;
    refEnd -= removeCount;
  }

  // Determine insert position
  const insertAt = mode === "after" ? refEnd + 1 : refStart;

  // Build insert block with proper blank-line spacing
  const insert = [...block, ""];

  // Avoid double blank lines above
  if (insertAt > 0 && lines[insertAt - 1]?.trim() === "") {
    // already a blank line above — no need for extra
  } else if (insertAt > 0) {
    insert.unshift("");
  }

  // Avoid double blank lines below
  if (insertAt < lines.length && lines[insertAt]?.trim() === "") {
    insert.pop();
  }

  lines.splice(insertAt, 0, ...insert);
  await writeFile(filePath, lines.join("\n"), "utf-8");
}

export async function updateTaskStatus(taskId: string, newStatus: TaskStatus): Promise<void> {
  if (!ALL_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }

  // Re-parse to get fresh line numbers
  const allTasks = await getAllTasks();
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const filePath = path.join(getBacklogDir(), task.sourceFile);
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  // Verify the heading line still matches
  const headingLine = lines[task.lineStart];
  const match = headingLine?.match(TASK_HEADING_RE);
  if (!match || match[2] !== taskId) {
    throw new Error(
      `Task ${taskId} heading not found at expected line ${task.lineStart}. File may have been modified externally.`
    );
  }

  // Surgical replacement: only change the status in brackets
  lines[task.lineStart] = headingLine.replace(/\[([A-Z ]+)\]/, `[${newStatus}]`);

  await writeFile(filePath, lines.join("\n"), "utf-8");
}

export async function updateTask(taskId: string, updates: TaskUpdates): Promise<void> {
  // Re-parse to get fresh line numbers
  const allTasks = await getAllTasks();
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const filePath = path.join(getBacklogDir(), task.sourceFile);
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  // Verify heading
  const headingLine = lines[task.lineStart];
  const match = headingLine?.match(TASK_HEADING_RE);
  if (!match || match[2] !== taskId) {
    throw new Error(`Task ${taskId} heading not found at expected line.`);
  }

  // Merge updates with current task
  const status = updates.status ?? task.status;
  const title = updates.title ?? task.title;
  const priority = updates.priority ?? task.priority;
  const color = updates.color === null ? undefined : (updates.color ?? task.color);
  const description = updates.description ?? task.description;
  const criteria = updates.acceptanceCriteria ?? task.acceptanceCriteria;

  // Reconstruct task block
  const newBlock: string[] = [];
  newBlock.push(`### [${status}] ${taskId}: ${title}`);
  newBlock.push(`> Priority: ${priority}`);
  if (color) {
    newBlock.push(`> Color: ${color}`);
  }
  if (task.dependsOn.length > 0) {
    newBlock.push(`> Depends on: ${task.dependsOn.join(", ")}`);
  }

  if (description) {
    newBlock.push("");
    newBlock.push(description);
  }

  if (criteria.length > 0) {
    newBlock.push("");
    newBlock.push("**Acceptance criteria:**");
    for (const c of criteria) {
      newBlock.push(`- [${c.checked ? "x" : " "}] ${c.text}`);
    }
  }

  // Replace lines[lineStart..lineEnd] with new block
  lines.splice(task.lineStart, task.lineEnd - task.lineStart + 1, ...newBlock);

  await writeFile(filePath, lines.join("\n"), "utf-8");
}

export async function deleteTask(taskId: string): Promise<void> {
  const allTasks = await getAllTasks();
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const filePath = path.join(getBacklogDir(), task.sourceFile);
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  // Verify heading
  const headingLine = lines[task.lineStart];
  const match = headingLine?.match(TASK_HEADING_RE);
  if (!match || match[2] !== taskId) {
    throw new Error(`Task ${taskId} heading not found at expected line.`);
  }

  // Remove block + trailing blank line if present
  let removeEnd = task.lineEnd;
  if (removeEnd + 1 < lines.length && lines[removeEnd + 1].trim() === "") {
    removeEnd++;
  }
  lines.splice(task.lineStart, removeEnd - task.lineStart + 1);

  await writeFile(filePath, lines.join("\n"), "utf-8");
}

const FILE_PREFIXES: Record<string, string> = {
  "ralph-arena.md": "RA",
  "task-manager.md": "TM",
};

export async function appendTask(
  title: string,
  sourceFile = "ralph-arena.md",
  status: TaskStatus = "IDEA"
): Promise<BacklogTask> {
  const prefix = FILE_PREFIXES[sourceFile] ?? "RA";

  // Find max ID with this prefix across all tasks
  const allTasks = await getAllTasks();
  let maxNum = 0;
  for (const t of allTasks) {
    if (t.id.startsWith(prefix + "-")) {
      const num = parseInt(t.id.slice(prefix.length + 1), 10);
      if (num > maxNum) maxNum = num;
    }
  }

  const nextId = `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
  const block = `\n### [${status}] ${nextId}: ${title}\n> Priority: P2\n`;

  const filePath = path.join(getBacklogDir(), sourceFile);
  await appendFile(filePath, block, "utf-8");

  return {
    id: nextId,
    title,
    status,
    priority: "P2",
    dependsOn: [],
    sessions: [],
    description: "",
    acceptanceCriteria: [],
    sourceFile,
    lineStart: -1,
    lineEnd: -1,
  };
}
