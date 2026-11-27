"use client";

import { Draggable } from "@hello-pangea/dnd";
import type { BacklogTask, TaskColor } from "@/lib/types";
import { TASK_COLORS, TASK_COLOR_DOT, TASK_COLOR_LABELS } from "@/lib/constants";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface TaskCardProps {
  task: BacklogTask;
  index: number;
  selected?: boolean;
  selectedIds: Set<string>;
  selectionMode: boolean;
  allTasks: BacklogTask[];
  onClick: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
  onColorChange: (color: TaskColor | null) => void;
}

export function TaskCard({ task, index, selected, selectedIds, selectionMode, allTasks, onClick, onToggleSelect, onDelete, onColorChange }: TaskCardProps) {
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={provided.innerRef}
              {...provided.draggableProps}
              {...provided.dragHandleProps}
              onClick={(e) => {
                if (selectionMode || e.shiftKey) {
                  e.preventDefault();
                  onToggleSelect();
                } else {
                  onClick();
                }
              }}
              className={`task-card flex select-none !cursor-pointer items-center gap-2 px-2 py-1 ${
                snapshot.isDragging ? "opacity-80" : ""
              } ${selected ? "bg-[var(--arena-selection)]" : ""}`}
            >
              {/* Color dot */}
              {task.color && (
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${TASK_COLOR_DOT[task.color]}`} />
              )}
              {/* Checkbox — only visible in selection mode */}
              {selectionMode && (
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleSelect();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 flex-shrink-0 rounded border-[var(--arena-selection-border)] bg-transparent text-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
                />
              )}
              {/* Title */}
              <span className="flex-1 text-sm leading-snug text-[var(--arena-text)]">
                {task.title}
              </span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => {
                navigator.clipboard.writeText(task.id);
                toast("Скопировано", { description: task.id });
              }}
            >
              Копировать {task.id}
            </ContextMenuItem>
            {selectionMode && selectedIds.size > 1 && selected && (
              <ContextMenuItem
                onClick={() => {
                  const ids = allTasks
                    .filter((t) => selectedIds.has(t.id))
                    .map((t) => t.id)
                    .join(", ");
                  navigator.clipboard.writeText(ids);
                  toast("Скопировано", { description: `${selectedIds.size} номеров` });
                }}
              >
                Копировать все номера ({selectedIds.size})
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onClick={(e) => {
                e.preventDefault();
                onToggleSelect();
              }}
            >
              {selected ? "Снять выделение" : "Выделить"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <span className="flex items-center gap-2">
                  {task.color && (
                    <span className={`h-2.5 w-2.5 rounded-full ${TASK_COLOR_DOT[task.color]}`} />
                  )}
                  Цвет
                </span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={() => onColorChange(null)}>
                  <span className="flex items-center gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border">
                      <svg className="h-2.5 w-2.5 text-[var(--arena-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6" />
                      </svg>
                    </span>
                    Без цвета
                  </span>
                </ContextMenuItem>
                <ContextMenuSeparator />
                {TASK_COLORS.map((c) => (
                  <ContextMenuItem key={c} onClick={() => onColorChange(c)}>
                    <span className="flex items-center gap-2">
                      <span className={`h-4 w-4 rounded-full ${TASK_COLOR_DOT[c]} ${c === task.color ? "ring-2 ring-[var(--arena-selection-border)] ring-offset-1 ring-offset-background" : ""}`} />
                      {TASK_COLOR_LABELS[c]}
                    </span>
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={(e) => {
                e.preventDefault();
                // Close context menu first, then show delete dialog
                setTimeout(() => onDelete(), 0);
              }}
              className="text-destructive focus:text-destructive"
            >
              Удалить
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
    </Draggable>
  );
}
