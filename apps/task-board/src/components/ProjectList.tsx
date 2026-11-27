"use client";

import Link from "next/link";
import type { Project } from "@/lib/types";
import { BOARD_COLUMNS, STATUS_LABELS, STATUS_COLUMN_COLORS } from "@/lib/constants";
import { ThemeToggle } from "./ThemeToggle";

function pluralTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} задача`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} задачи`;
  return `${n} задач`;
}

export function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--arena-bg)]">
      <header className="sticky top-0 z-50 border-b bg-[var(--arena-surface)]/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="flex h-12 items-center justify-between gap-3">
            <h1 className="text-sm font-medium text-[var(--arena-muted)]">Проекты</h1>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[800px] px-4 py-8 sm:px-6">
        <div className="space-y-3">
          {projects.map((project) => (
            <Link
              key={project.slug}
              href={`/project/${project.slug}`}
              className="block rounded border p-4 transition-colors hover:bg-[var(--arena-hover)]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium text-[var(--arena-text)]">
                    {project.name}
                  </h2>
                  <span className="mono text-xs text-[var(--arena-muted)]">
                    {project.sourceFile}
                  </span>
                </div>
                <span className="mono text-xs text-[var(--arena-muted)]">
                  {pluralTasks(project.taskCount)}
                </span>
              </div>
              <div className="mt-3 flex gap-3 text-[11px]">
                {BOARD_COLUMNS.map((status) => {
                  const count = project.statusCounts[status] || 0;
                  if (count === 0) return null;
                  return (
                    <span key={status} className={`mono ${STATUS_COLUMN_COLORS[status]}`}>
                      {STATUS_LABELS[status]} {count}
                    </span>
                  );
                })}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
