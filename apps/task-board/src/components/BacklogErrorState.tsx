"use client";

import Link from "next/link";
import type { BacklogUiError } from "@/lib/backlog-errors";
import { ThemeToggle } from "./ThemeToggle";

interface BacklogErrorStateProps {
  error: BacklogUiError;
  fullPage?: boolean;
  projectSlug?: string;
  retryHref?: string;
  onRetry?: () => void;
}

function RetryAction({
  retryHref,
  onRetry,
}: {
  retryHref?: string;
  onRetry?: () => void;
}) {
  if (onRetry) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-200"
      >
        Повторить
      </button>
    );
  }

  if (retryHref) {
    return (
      <Link
        href={retryHref}
        className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-200"
      >
        Повторить
      </Link>
    );
  }

  return null;
}

function ErrorCard({
  error,
  retryHref,
  onRetry,
}: {
  error: BacklogUiError;
  retryHref?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="text-sm font-medium text-red-800 dark:text-red-100">
            {error.title}
          </div>
          <p className="text-sm text-red-700 dark:text-red-200">
            {error.summary}
          </p>
        </div>
        <RetryAction retryHref={retryHref} onRetry={onRetry} />
      </div>

      {error.details.length > 0 && (
        <ul className="mt-4 space-y-2 rounded-lg border border-red-500/20 bg-black/5 p-3 mono text-xs text-red-900 dark:bg-white/5 dark:text-red-100">
          {error.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-red-700/90 dark:text-red-200/90">
        Исправь markdown/backlog и обнови страницу.
      </p>
    </div>
  );
}

export function BacklogErrorState({
  error,
  fullPage = false,
  projectSlug,
  retryHref,
  onRetry,
}: BacklogErrorStateProps) {
  if (!fullPage) {
    return <ErrorCard error={error} retryHref={retryHref} onRetry={onRetry} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--arena-bg)]">
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
                {projectSlug ?? "Проекты"}
              </h1>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[960px] flex-1 items-start px-4 py-8 sm:px-6">
        <div className="w-full">
          <ErrorCard error={error} retryHref={retryHref} onRetry={onRetry} />
        </div>
      </main>
    </div>
  );
}
