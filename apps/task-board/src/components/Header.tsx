"use client";

import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

interface HeaderProps {
  onRefresh: () => void;
  projectSlug?: string;
}

export function Header({ onRefresh, projectSlug }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b bg-[var(--arena-surface)]/95 backdrop-blur">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <div className="flex h-12 items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {projectSlug && (
              <>
                <Link href="/" className="text-[var(--arena-muted)] hover:text-[var(--arena-text)]">
                  Проекты
                </Link>
                <span className="text-[var(--arena-muted-soft)]">/</span>
              </>
            )}
            <h1 className="font-medium text-[var(--arena-muted)]">
              {projectSlug ?? "Доска задач"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={onRefresh}
              className="rounded p-1.5 text-[var(--arena-muted)] transition-colors hover:bg-[var(--arena-hover)] hover:text-[var(--arena-text)]"
              aria-label="Обновить"
              title="Обновить"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
