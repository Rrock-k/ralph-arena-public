import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { BacklogTask, Project, TaskStatus } from "./types";
import { parseMarkdownTasks } from "./parser";

// Resolve docs/backlog/ relative to the monorepo root.
// task-board lives at apps/task-board/, so ../../docs/backlog/ is the monorepo's docs/backlog/
const BACKLOG_DIR = path.resolve(process.cwd(), "../../docs/backlog");

const H1_RE = /^# (.+)$/m;

export function getBacklogDir(): string {
  return BACKLOG_DIR;
}

export async function getAllTasks(): Promise<BacklogTask[]> {
  const files = await readdir(BACKLOG_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  const allTasks: BacklogTask[] = [];

  for (const file of mdFiles) {
    const filePath = path.join(BACKLOG_DIR, file);
    const content = await readFile(filePath, "utf-8");
    const tasks = parseMarkdownTasks(content, file);
    allTasks.push(...tasks);
  }

  return allTasks;
}

export async function getProjects(): Promise<Project[]> {
  const files = await readdir(BACKLOG_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  const projects: Project[] = [];

  for (const file of mdFiles) {
    const filePath = path.join(BACKLOG_DIR, file);
    const content = await readFile(filePath, "utf-8");
    const tasks = parseMarkdownTasks(content, file);

    // Skip files with no structured tasks
    if (tasks.length === 0) continue;

    const slug = file.replace(/\.md$/, "");
    const h1Match = content.match(H1_RE);
    const name = h1Match ? h1Match[1].trim() : slug;

    const statusCounts: Partial<Record<TaskStatus, number>> = {};
    for (const t of tasks) {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    }

    projects.push({
      slug,
      name,
      sourceFile: file,
      taskCount: tasks.length,
      statusCounts,
    });
  }

  return projects.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function getTasksByProject(slug: string): Promise<BacklogTask[]> {
  const file = `${slug}.md`;
  const filePath = path.join(BACKLOG_DIR, file);
  const content = await readFile(filePath, "utf-8");
  return parseMarkdownTasks(content, file);
}
