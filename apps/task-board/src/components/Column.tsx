"use client";

import { useState, useRef, useEffect } from "react";
import { Droppable } from "@hello-pangea/dnd";
import type { BacklogTask, TaskColor, TaskStatus, TaskUpdates } from "@/lib/types";
import { STATUS_LABELS, STATUS_COLUMN_COLORS } from "@/lib/constants";
import { TaskCard } from "./TaskCard";

interface ColumnProps {
  status: TaskStatus;
  tasks: BacklogTask[];
  allTasks: BacklogTask[];
  selectedIds: Set<string>;
  selectionMode: boolean;
  onTaskClick: (task: BacklogTask) => void;
  onToggleSelect: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, updates: TaskUpdates) => Promise<void>;
  onStartBatch?: () => void;
  onEndBatch?: () => void;
  onCreate?: (title: string) => Promise<void>;
}

export function Column({ status, tasks, allTasks, selectedIds, selectionMode, onTaskClick, onToggleSelect, onDeleteTask, onUpdateTask, onStartBatch, onEndBatch, onCreate }: ColumnProps) {
  const [inputOpen, setInputOpen] = useState(false);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  // When true, skip the closing transition (instant swap on submit)
  const instantCloseRef = useRef(false);

  useEffect(() => {
    if (inputOpen) {
      submittedRef.current = false;
      const id = setTimeout(() => {
        setShowPlaceholder(true);
        inputRef.current?.focus();
      }, 200);
      return () => clearTimeout(id);
    }
    setShowPlaceholder(false);
  }, [inputOpen]);

  // DnD drag handles call preventDefault() on mousedown, which blocks
  // the browser's default focus-change → onBlur never fires on the input.
  // Work around by manually blurring when clicking outside the input.
  useEffect(() => {
    if (!inputOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        inputRef.current.blur();
      }
    }
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => document.removeEventListener("mousedown", handleMouseDown, true);
  }, [inputOpen]);

  function submit() {
    if (submittedRef.current) return;
    const title = value.trim();
    if (!title || !onCreate) return;
    submittedRef.current = true;
    instantCloseRef.current = true;
    setValue("");
    setInputOpen(false);
    onCreate(title);
  }

  return (
    <div className="flex min-w-[230px] flex-1 flex-col">
      <div className="mb-3 flex items-center gap-2 px-1">
        <h3 className={`text-xs font-medium ${STATUS_COLUMN_COLORS[status]}`}>
          {STATUS_LABELS[status]}
        </h3>
        <span className="mono text-[11px] text-[var(--arena-muted)]">
          {tasks.length}
        </span>
        {onCreate && (
          <button
            onClick={() => {
              instantCloseRef.current = false;
              setInputOpen((o) => !o);
            }}
            className={`ml-auto flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--arena-hover)] ${
              inputOpen ? "text-[var(--arena-text)]" : "text-[var(--arena-muted)] hover:text-[var(--arena-text)]"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 1v10M1 6h10" />
            </svg>
          </button>
        )}
      </div>

      <div
        className={`grid ${
          instantCloseRef.current
            ? ""
            : "transition-[grid-template-rows,opacity] duration-200 ease-out"
        }`}
        style={{
          gridTemplateRows: inputOpen ? "1fr" : "0fr",
          opacity: inputOpen ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          {/* Wrapper mirrors TaskCard outer div exactly */}
          <div className="task-card px-2 py-1">
            <input
              ref={inputRef}
              type="text"
              placeholder={showPlaceholder ? (status === "IDEA" ? "Новая идея..." : "Новая задача...") : ""}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  instantCloseRef.current = false;
                  setValue("");
                  setInputOpen(false);
                  return;
                }
                if (e.key === "Enter") {
                  submit();
                }
              }}
              onBlur={() => {
                if (value.trim()) {
                  submit();
                } else {
                  instantCloseRef.current = false;
                  setInputOpen(false);
                }
              }}
              className="h-auto w-full border-none bg-transparent p-0 text-sm leading-snug text-[var(--arena-text)] placeholder-[var(--arena-muted-soft)] outline-none focus:outline-none"
            />
          </div>
        </div>
      </div>

      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex min-h-[200px] flex-1 flex-col gap-0 rounded p-0 ${
              snapshot.isDraggingOver ? "bg-[var(--arena-hover)]" : ""
            }`}
          >
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                selected={selectedIds.has(task.id)}
                selectedIds={selectedIds}
                selectionMode={selectionMode}
                allTasks={allTasks}
                onClick={() => onTaskClick(task)}
                onToggleSelect={() => onToggleSelect(task.id)}
                onDelete={() => onDeleteTask(task.id)}
                onColorChange={async (color) => {
                  const ids = selectionMode && selectedIds.has(task.id)
                    ? Array.from(selectedIds)
                    : [task.id];
                  if (ids.length > 1) onStartBatch?.();
                  for (const id of ids) {
                    await onUpdateTask(id, { color });
                  }
                  if (ids.length > 1) onEndBatch?.();
                }}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
