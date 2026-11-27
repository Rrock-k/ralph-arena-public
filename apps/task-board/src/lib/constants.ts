import type { TaskStatus, Priority, TaskColor } from "./types";

export const BOARD_COLUMNS: TaskStatus[] = ["IDEA", "PLANNED", "IN PROGRESS", "REVIEW", "VERIFIED", "DONE"];

export const ALL_STATUSES: TaskStatus[] = ["IDEA", "PLANNED", "IN PROGRESS", "REVIEW", "VERIFIED", "BLOCKED", "DONE", "ARCHIVED"];

export const STATUS_COLORS: Record<TaskStatus, string> = {
  IDEA: "border-cyan-600/20 bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300",
  PLANNED: "border-purple-600/20 bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300",
  "IN PROGRESS": "border-amber-600/20 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  REVIEW: "border-indigo-600/20 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  VERIFIED: "border-teal-600/20 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300",
  BLOCKED: "border-rose-600/20 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  DONE: "border-emerald-600/20 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  ARCHIVED: "border-slate-400/20 bg-slate-50 text-slate-500 dark:bg-slate-500/10 dark:text-slate-300",
};

export const STATUS_COLUMN_COLORS: Record<TaskStatus, string> = {
  IDEA: "text-cyan-600 dark:text-cyan-300",
  PLANNED: "text-purple-600 dark:text-purple-300",
  "IN PROGRESS": "text-amber-600 dark:text-amber-300",
  REVIEW: "text-indigo-600 dark:text-indigo-300",
  VERIFIED: "text-teal-600 dark:text-teal-300",
  BLOCKED: "text-rose-600 dark:text-rose-300",
  DONE: "text-emerald-600 dark:text-emerald-300",
  ARCHIVED: "text-slate-400 dark:text-slate-300",
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  P0: "border-rose-600/20 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  P1: "border-amber-600/20 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  P2: "border-blue-600/20 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  P3: "border-slate-400/20 bg-slate-50 text-slate-500 dark:bg-slate-500/10 dark:text-slate-300",
};

export const TASK_COLORS: TaskColor[] = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"];

export const TASK_COLOR_DOT: Record<TaskColor, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  gray: "bg-gray-400",
};

export const TASK_COLOR_LABELS: Record<TaskColor, string> = {
  red: "Красный",
  orange: "Оранжевый",
  yellow: "Жёлтый",
  green: "Зелёный",
  blue: "Синий",
  purple: "Фиолетовый",
  pink: "Розовый",
  gray: "Серый",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  IDEA: "Идея",
  PLANNED: "План",
  "IN PROGRESS": "В работе",
  REVIEW: "Ревью",
  VERIFIED: "Проверено",
  BLOCKED: "Блок",
  DONE: "Готово",
  ARCHIVED: "Архив",
};
