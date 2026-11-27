"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { BacklogErrorState } from "@/components/BacklogErrorState";
import type { BacklogTask, TaskStatus, Priority, TaskUpdates } from "@/lib/types";
import { normalizeBacklogError, parseBacklogErrorPayload, type BacklogUiError } from "@/lib/backlog-errors";
import { BOARD_COLUMNS } from "@/lib/constants";
import { useHistory } from "@/hooks/useHistory";
import { Header } from "./Header";
import { FilterBar } from "./FilterBar";
import { Column } from "./Column";
import { TaskDetailPanel } from "./TaskDetailPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BoardProps {
  initialTasks: BacklogTask[];
  projectSlug?: string;
}

export function Board({ initialTasks, projectSlug }: BoardProps) {
  const [tasks, setTasks] = useState<BacklogTask[]>(initialTasks);
  const [loadError, setLoadError] = useState<BacklogUiError | null>(null);
  const [selectedTask, setSelectedTask] = useState<BacklogTask | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Pending single delete from context menu (needs confirmation)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Undo / redo
  const history = useHistory();
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const updateTaskRef = useRef<(id: string, u: TaskUpdates) => Promise<void>>(null!);
  const reorderInFileRef = useRef<(id: string, order: BacklogTask[]) => Promise<void>>(null!);

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Filters
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "ALL">("ALL");
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !t.id.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (priorityFilter !== "ALL" && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, search, priorityFilter]);

  const columnTasks = useMemo(() => {
    const grouped: Record<TaskStatus, BacklogTask[]> = {} as Record<TaskStatus, BacklogTask[]>;
    for (const col of BOARD_COLUMNS) {
      grouped[col] = filteredTasks.filter((t) => t.status === col);
    }
    return grouped;
  }, [filteredTasks]);

  const refresh = useCallback(async () => {
    try {
      const url = projectSlug
        ? `/api/tasks?project=${encodeURIComponent(projectSlug)}`
        : "/api/tasks";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
        setLoadError(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setLoadError(
        parseBacklogErrorPayload(payload) ?? {
          kind: "BACKLOG_READ_FAILED",
          title: "Ошибка обновления доски",
          summary: `Сервер вернул HTTP ${res.status}.`,
          details: [],
          rawMessage: `HTTP ${res.status}`,
          sourceFile: projectSlug ? `${projectSlug}.md` : undefined,
        }
      );
    } catch {
      setLoadError(
        normalizeBacklogError(
          new Error("Не удалось связаться с task-board API."),
          projectSlug ? `${projectSlug}.md` : undefined
        )
      );
    }
  }, [projectSlug]);

  // SSE: instant refresh when markdown files change on disk
  useEffect(() => {
    console.log("[Board] Setting up EventSource");
    const es = new EventSource("/api/tasks/events");

    es.onopen = () => {
      console.log("[Board] EventSource connected");
    };

    es.onmessage = (e) => {
      console.log("[Board] Received SSE message:", e.data);
      if (e.data === "changed") {
        console.log("[Board] Refreshing tasks...");
        refresh();
      }
    };

    es.onerror = (err) => {
      console.error("[Board] EventSource error:", err);
    };

    return () => {
      console.log("[Board] Closing EventSource");
      es.close();
    };
  }, [refresh]);

  const createTask = useCallback(
    async (title: string, status: "IDEA" | "PLANNED") => {
      const sourceFile = projectSlug ? `${projectSlug}.md` : "ralph-arena.md";

      // Synchronous optimistic insert — same render batch as input close
      const tempId = `_new_${Date.now()}`;
      const tempTask: BacklogTask = {
        id: tempId,
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
      const firstSibling = tasks.find(
        (t) => t.status === status && t.sourceFile === sourceFile
      );
      setTasks((prev) => [tempTask, ...prev]);

      // Persist
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, status, sourceFile }),
        });
        if (res.ok) {
          const realTask = await res.json();
          setTasks((prev) => prev.map((t) => (t.id === tempId ? realTask : t)));

          if (firstSibling) {
            await fetch("/api/tasks/reorder", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ taskId: realTask.id, beforeTaskId: firstSibling.id }),
            });
          }
        } else {
          setTasks((prev) => prev.filter((t) => t.id !== tempId));
        }
      } catch {
        setTasks((prev) => prev.filter((t) => t.id !== tempId));
      }
    },
    [projectSlug, tasks]
  );

  const updateTask = useCallback(
    async (taskId: string, updates: TaskUpdates) => {
      // Record undo info before applying
      if (!history.isUndoRedoRef.current) {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (task) {
          const undoUpdates: TaskUpdates = {};
          if (updates.title !== undefined) undoUpdates.title = task.title;
          if (updates.status !== undefined) undoUpdates.status = task.status;
          if (updates.priority !== undefined) undoUpdates.priority = task.priority;
          if (updates.color !== undefined) undoUpdates.color = task.color ?? null;
          if (updates.description !== undefined) undoUpdates.description = task.description;
          if (updates.acceptanceCriteria !== undefined) undoUpdates.acceptanceCriteria = [...task.acceptanceCriteria];

          const redoUpdates = { ...updates };
          history.push({
            undo: async () => { await updateTaskRef.current(taskId, undoUpdates); },
            redo: async () => { await updateTaskRef.current(taskId, redoUpdates); },
          });
        }
      }

      // Optimistic update
      const colorPatch = updates.color !== undefined
        ? { color: updates.color === null ? undefined : updates.color }
        : {};

      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            ...(updates.title !== undefined && { title: updates.title }),
            ...(updates.status !== undefined && { status: updates.status }),
            ...(updates.priority !== undefined && { priority: updates.priority }),
            ...(updates.description !== undefined && { description: updates.description }),
            ...(updates.acceptanceCriteria !== undefined && { acceptanceCriteria: updates.acceptanceCriteria }),
            ...colorPatch,
          };
        })
      );

      // Also update selectedTask if it matches
      setSelectedTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        return {
          ...prev,
          ...(updates.title !== undefined && { title: updates.title }),
          ...(updates.status !== undefined && { status: updates.status }),
          ...(updates.priority !== undefined && { priority: updates.priority }),
          ...(updates.description !== undefined && { description: updates.description }),
          ...(updates.acceptanceCriteria !== undefined && { acceptanceCriteria: updates.acceptanceCriteria }),
          ...colorPatch,
        };
      });

      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          await refresh();
        }
      } catch {
        await refresh();
      }
    },
    [refresh, history]
  );
  updateTaskRef.current = updateTask;

  // Keyboard: Esc clears selection, Cmd+Z undo, Cmd+Shift+Z redo
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedIds.size > 0) {
        clearSelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          history.performRedo();
        } else {
          history.performUndo();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds.size, clearSelection, history]);

  const deleteTask = useCallback(
    async (taskId: string) => {
      // Optimistic: remove from list and close panel
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setSelectedTask(null);
      setSelectedIds((prev) => {
        if (!prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });

      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          await refresh();
        }
      } catch {
        await refresh();
      }
    },
    [refresh]
  );

  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    // Optimistic
    setTasks((prev) => prev.filter((t) => !selectedIds.has(t.id)));
    if (selectedTask && selectedIds.has(selectedTask.id)) setSelectedTask(null);
    setSelectedIds(new Set());

    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" })
        )
      );
    } catch {
      await refresh();
    }
  }, [selectedIds, selectedTask, refresh]);

  const reorderInFile = useCallback(
    async (taskId: string, newOrder: BacklogTask[]) => {
      const moved = newOrder.find((t) => t.id === taskId);
      if (!moved) return;
      const idx = newOrder.indexOf(moved);

      // Find an adjacent same-file task to anchor the move
      if (idx > 0) {
        const prev = newOrder[idx - 1];
        if (prev.sourceFile === moved.sourceFile) {
          await fetch("/api/tasks/reorder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId, afterTaskId: prev.id }),
          });
          return;
        }
      }
      if (idx < newOrder.length - 1) {
        const next = newOrder[idx + 1];
        if (next.sourceFile === moved.sourceFile) {
          await fetch("/api/tasks/reorder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId, beforeTaskId: next.id }),
          });
          return;
        }
      }
      // No same-file neighbor — skip file reorder
    },
    []
  );
  reorderInFileRef.current = reorderInFile;

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId, destination, source } = result;
      if (!destination) return;
      if (destination.droppableId === source.droppableId && destination.index === source.index) return;

      const sameColumn = source.droppableId === destination.droppableId;
      const newStatus = destination.droppableId as TaskStatus;
      const prevStatus = source.droppableId as TaskStatus;

      // Snapshot for undo
      const prevTasks = [...tasksRef.current];

      // Build the new column order after the drop
      const colTasks = [...columnTasks[newStatus]];

      if (sameColumn) {
        const [moved] = colTasks.splice(source.index, 1);
        colTasks.splice(destination.index, 0, moved);
      } else {
        // Cross-column: insert at destination index
        const movedTask = tasks.find((t) => t.id === draggableId);
        if (movedTask) {
          colTasks.splice(destination.index, 0, { ...movedTask, status: newStatus });
        }
      }

      // Compute afterTasks (same logic as setTasks callback below)
      const afterTasks = (() => {
        const colIds = new Set(colTasks.map((t) => t.id));
        const out: BacklogTask[] = [];
        let ci = 0;
        for (const t of prevTasks) {
          if (colIds.has(t.id)) {
            out.push(colTasks[ci++]);
          } else if (t.id === draggableId && !sameColumn) {
            // moved to another column — skip old position
          } else {
            out.push(t);
          }
        }
        while (ci < colTasks.length) out.push(colTasks[ci++]);
        return out;
      })();

      // Optimistic UI
      setTasks(afterTasks);

      // Suppress undo recording from updateTask during drag persistence
      history.isUndoRedoRef.current = true;

      // Persist
      if (!sameColumn) {
        await updateTask(draggableId, { status: newStatus });
      }
      await reorderInFile(draggableId, colTasks);

      history.isUndoRedoRef.current = false;

      // Record undo entry for the whole drag
      const prevColTasks = prevTasks.filter((t) => t.status === prevStatus);
      history.push({
        undo: async () => {
          setTasks(prevTasks);
          if (!sameColumn) {
            await updateTaskRef.current(draggableId, { status: prevStatus });
          }
          await reorderInFileRef.current(draggableId, prevColTasks);
        },
        redo: async () => {
          setTasks(afterTasks);
          if (!sameColumn) {
            await updateTaskRef.current(draggableId, { status: newStatus });
          }
          await reorderInFileRef.current(draggableId, colTasks);
        },
      });
    },
    [columnTasks, tasks, updateTask, reorderInFile, history]
  );

  return (
    <div className="flex min-h-screen flex-col bg-[var(--arena-bg)]">
      <Header onRefresh={refresh} projectSlug={projectSlug} />

      <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
        {loadError && (
          <div className="mb-4">
            <BacklogErrorState
              error={loadError}
              onRetry={refresh}
            />
          </div>
        )}
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          priorityFilter={priorityFilter}
          onPriorityChange={setPriorityFilter}
        />
      </div>

      {/* Selection action bar */}
      {selectedIds.size > 0 && (
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 pb-3 sm:px-6">
          <span className="text-xs text-[var(--arena-muted)]">
            Выбрано: {selectedIds.size}
          </span>
          <button
            onClick={() => setBulkDeleteOpen(true)}
            className="rounded px-2 py-1 text-xs text-rose-500 transition-colors hover:bg-rose-500/10"
          >
            Удалить выбранные
          </button>
          <button
            onClick={clearSelection}
            className="rounded px-2 py-1 text-xs text-[var(--arena-muted)] transition-colors hover:bg-[var(--arena-hover)] hover:text-[var(--arena-text)]"
          >
            Снять выделение
          </button>
        </div>
      )}

      <div className="flex-1 overflow-x-auto px-4 pb-6 sm:px-6">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3">
            {BOARD_COLUMNS.map((col) => (
              <Column
                key={col}
                status={col}
                tasks={columnTasks[col]}
                allTasks={tasks}
                selectedIds={selectedIds}
                selectionMode={selectedIds.size > 0}
                onTaskClick={setSelectedTask}
                onToggleSelect={toggleSelect}
                onDeleteTask={(id) => setPendingDeleteId(id)}
                onUpdateTask={updateTask}
                onStartBatch={history.startBatch}
                onEndBatch={history.endBatch}
                onCreate={
                  col === "IDEA" || col === "PLANNED"
                    ? (title) => createTask(title, col)
                    : undefined
                }
              />
            ))}
          </div>
        </DragDropContext>
      </div>

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={updateTask}
          onDelete={deleteTask}
        />
      )}

      {/* Single delete from context menu */}
      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {pendingDeleteId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие необратимо. Задача будет удалена из файла.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (pendingDeleteId) deleteTask(pendingDeleteId); setPendingDeleteId(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {selectedIds.size} задач?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие необратимо. Все выбранные задачи будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить {selectedIds.size}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
