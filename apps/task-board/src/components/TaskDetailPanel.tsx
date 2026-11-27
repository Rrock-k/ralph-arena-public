"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { BacklogTask, TaskStatus, Priority, TaskColor, TaskUpdates } from "@/lib/types";
import { ALL_STATUSES, STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, TASK_COLORS, TASK_COLOR_DOT, TASK_COLOR_LABELS } from "@/lib/constants";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

interface TaskDetailPanelProps {
  task: BacklogTask;
  onClose: () => void;
  onUpdate: (taskId: string, updates: TaskUpdates) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}

export function TaskDetailPanel({ task, onClose, onUpdate, onDelete }: TaskDetailPanelProps) {
  // Local state for editable fields
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [criteria, setCriteria] = useState(task.acceptanceCriteria);
  const [newCriterion, setNewCriterion] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const descRef = useRef<HTMLTextAreaElement>(null);

  // Sync when task prop changes (e.g. after external update)
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setCriteria(task.acceptanceCriteria);
  }, [task.id, task.title, task.description, task.acceptanceCriteria]);

  // Esc to close (but not when delete dialog is open)
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleteOpen) onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose, deleteOpen]);

  // Auto-resize textarea
  useEffect(() => {
    if (descRef.current) {
      descRef.current.style.height = "auto";
      descRef.current.style.height = descRef.current.scrollHeight + "px";
    }
  }, [description]);

  // --- Save handlers ---

  const saveTitle = useCallback(() => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      onUpdate(task.id, { title: trimmed });
    } else {
      setTitle(task.title);
    }
  }, [title, task.id, task.title, onUpdate]);

  const saveDescription = useCallback(() => {
    if (description !== task.description) {
      onUpdate(task.id, { description });
    }
  }, [description, task.id, task.description, onUpdate]);

  const saveStatus = useCallback(
    (status: TaskStatus) => {
      if (status !== task.status) {
        onUpdate(task.id, { status });
      }
    },
    [task.id, task.status, onUpdate]
  );

  const savePriority = useCallback(
    (priority: Priority) => {
      if (priority !== task.priority) {
        onUpdate(task.id, { priority });
      }
    },
    [task.id, task.priority, onUpdate]
  );

  const saveColor = useCallback(
    (color: TaskColor | null) => {
      const current = task.color ?? null;
      if (color !== current) {
        onUpdate(task.id, { color });
      }
    },
    [task.id, task.color, onUpdate]
  );

  const toggleCriterion = useCallback(
    (index: number) => {
      const updated = criteria.map((c, i) =>
        i === index ? { ...c, checked: !c.checked } : c
      );
      setCriteria(updated);
      onUpdate(task.id, { acceptanceCriteria: updated });
    },
    [criteria, task.id, onUpdate]
  );

  const updateCriterionText = useCallback(
    (index: number, text: string) => {
      const updated = criteria.map((c, i) =>
        i === index ? { ...c, text } : c
      );
      setCriteria(updated);
    },
    [criteria]
  );

  const saveCriterionText = useCallback(
    (index: number) => {
      const text = criteria[index]?.text.trim();
      if (!text) {
        // Remove empty criterion
        const updated = criteria.filter((_, i) => i !== index);
        setCriteria(updated);
        onUpdate(task.id, { acceptanceCriteria: updated });
      } else if (criteria[index]?.text !== task.acceptanceCriteria[index]?.text) {
        onUpdate(task.id, { acceptanceCriteria: criteria });
      }
    },
    [criteria, task.id, task.acceptanceCriteria, onUpdate]
  );

  const removeCriterion = useCallback(
    (index: number) => {
      const updated = criteria.filter((_, i) => i !== index);
      setCriteria(updated);
      onUpdate(task.id, { acceptanceCriteria: updated });
    },
    [criteria, task.id, onUpdate]
  );

  const addCriterion = useCallback(() => {
    const text = newCriterion.trim();
    if (!text) return;
    const updated = [...criteria, { text, checked: false }];
    setCriteria(updated);
    setNewCriterion("");
    onUpdate(task.id, { acceptanceCriteria: updated });
  }, [newCriterion, criteria, task.id, onUpdate]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 dark:bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l bg-[var(--arena-surface)] p-6 sm:max-w-xl">
        {/* Close button */}
        <div className="mb-4 flex justify-between">
          <button
            onClick={() => {
              navigator.clipboard.writeText(task.id);
              toast("Скопировано", { description: task.id });
            }}
            className="group/copy flex items-center gap-1 text-xs text-[var(--arena-muted)] transition-colors hover:text-[var(--arena-text)]"
          >
            <span className="mono">{task.id}</span>
            <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover/copy:opacity-100" />
          </button>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded p-1.5 text-[var(--arena-muted)] transition-colors hover:bg-[var(--arena-hover)] hover:text-[var(--arena-text)]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Title — editable input */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="mb-4 w-full bg-transparent text-lg font-medium text-[var(--arena-text)] outline-none placeholder-[var(--arena-muted-soft)] focus:border-b focus:border-[var(--arena-selection-border)]"
          placeholder="Название задачи..."
        />

        {/* Status buttons */}
        <div className="mb-4">
          <div className="mb-1.5 text-xs text-[var(--arena-muted)]">Статус</div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => saveStatus(s)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-all ${
                  s === task.status
                    ? STATUS_COLORS[s] + " font-medium"
                    : "border-border text-[var(--arena-muted)] hover:border-[var(--arena-selection-border)] hover:text-[var(--arena-text)]"
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Priority buttons */}
        <div className="mb-4">
          <div className="mb-1.5 text-xs text-[var(--arena-muted)]">Приоритет</div>
          <div className="flex gap-1.5">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => savePriority(p)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-all ${
                  p === task.priority
                    ? PRIORITY_COLORS[p] + " font-medium"
                    : "border-border text-[var(--arena-muted)] hover:border-[var(--arena-selection-border)] hover:text-[var(--arena-text)]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Color picker */}
        <div className="mb-4">
          <div className="mb-1.5 text-xs text-[var(--arena-muted)]">Цвет</div>
          <div className="flex items-center gap-1.5">
            {/* No color button */}
            <button
              onClick={() => saveColor(null)}
              title="Без цвета"
              className={`flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
                !task.color
                  ? "border-[var(--arena-selection-border)] bg-[var(--arena-hover)]"
                  : "border-border hover:border-[var(--arena-selection-border)]"
              }`}
            >
              <svg className="h-3 w-3 text-[var(--arena-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6" />
              </svg>
            </button>
            {TASK_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => saveColor(c)}
                title={TASK_COLOR_LABELS[c]}
                className={`h-6 w-6 rounded-full border-2 transition-all ${TASK_COLOR_DOT[c]} ${
                  c === task.color
                    ? "border-[var(--arena-text)] scale-110"
                    : "border-transparent hover:scale-110"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Metadata — read-only */}
        <div className="mb-4 flex flex-wrap gap-3 text-xs text-[var(--arena-muted)]">
          <span className="mono">Файл: {task.sourceFile}</span>
          {task.dependsOn.length > 0 && (
            <span className="mono">Зависит от: {task.dependsOn.join(", ")}</span>
          )}
        </div>

        {/* Session links */}
        {task.sessions.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 text-xs text-[var(--arena-muted)]">Сессии</div>
            <div className="flex flex-wrap gap-1.5">
              {task.sessions.map((s) => (
                <a
                  key={s.fullId}
                  href={`vscode://ralph-arena.ralph-session-link/${s.fullId}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-[var(--arena-muted)] transition-colors hover:border-violet-400/60 hover:text-violet-500"
                  title={s.label || "Open in Claude Code"}
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="mono">{s.shortId}</span>
                  {s.label && <span className="text-[var(--arena-muted-soft)]"> - {s.label}</span>}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Description — editable textarea */}
        <div className="mb-4">
          <div className="mb-1.5 text-xs text-[var(--arena-muted)]">Описание</div>
          <textarea
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={2}
            className="w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--arena-text)] outline-none placeholder-[var(--arena-muted-soft)]"
            placeholder="Добавить описание..."
          />
        </div>

        {/* Acceptance Criteria — editable */}
        <div>
          <div className="mb-2 text-xs text-[var(--arena-muted)]">Критерии приёмки</div>
          <ul className="space-y-1">
            {criteria.map((criterion, i) => (
              <li key={i} className="group flex items-start gap-2 text-sm">
                {/* Checkbox */}
                <button
                  onClick={() => toggleCriterion(i)}
                  className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                    criterion.checked
                      ? "border-[var(--arena-selection-border)] bg-[var(--arena-hover)] text-[var(--arena-muted)]"
                      : "border-border text-transparent hover:border-[var(--arena-selection-border)]"
                  }`}
                >
                  {criterion.checked && (
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>

                {/* Editable text */}
                <input
                  type="text"
                  value={criterion.text}
                  onChange={(e) => updateCriterionText(i, e.target.value)}
                  onBlur={() => saveCriterionText(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className={`flex-1 bg-transparent outline-none ${
                    criterion.checked ? "text-[var(--arena-muted)] line-through" : "text-[var(--arena-text)]"
                  }`}
                />

                {/* Remove button */}
                <button
                  onClick={() => removeCriterion(i)}
                  className="mt-0.5 flex-shrink-0 text-[var(--arena-muted-soft)] opacity-0 transition-opacity hover:text-[var(--arena-text)] group-hover:opacity-100"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>

          {/* Add new criterion */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[var(--arena-muted-soft)]">+</span>
            <input
              type="text"
              value={newCriterion}
              onChange={(e) => setNewCriterion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCriterion();
              }}
              placeholder="Новый критерий..."
              className="flex-1 bg-transparent text-sm text-[var(--arena-text)] outline-none placeholder-[var(--arena-muted-soft)]"
            />
          </div>
        </div>

        {/* Delete */}
        <div className="mt-8 border-t border-border pt-4">
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger asChild>
              <button className="text-xs text-[var(--arena-muted)] transition-colors hover:text-rose-500">
                Удалить задачу
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Удалить {task.id}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Это действие необратимо. Задача будет удалена из файла.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(task.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Удалить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </>
  );
}
