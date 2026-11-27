export type TaskStatus = "IDEA" | "PLANNED" | "IN PROGRESS" | "REVIEW" | "VERIFIED" | "BLOCKED" | "DONE" | "ARCHIVED";

export type Priority = "P0" | "P1" | "P2" | "P3";

export type TaskColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "gray";

export interface SessionLink {
  shortId: string;
  fullId: string;
  label: string;
}

export interface BacklogTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  color?: TaskColor;
  dependsOn: string[];
  sessions: SessionLink[]; // parsed from `> Session:` lines
  description: string;
  acceptanceCriteria: Array<{ text: string; checked: boolean }>;
  sourceFile: string;
  lineStart: number;
  lineEnd: number;
}

export interface Project {
  slug: string;
  name: string;
  sourceFile: string;
  taskCount: number;
  statusCounts: Partial<Record<TaskStatus, number>>;
}

export interface TaskUpdates {
  title?: string;
  status?: TaskStatus;
  priority?: Priority;
  color?: TaskColor | null;
  description?: string;
  acceptanceCriteria?: Array<{ text: string; checked: boolean }>;
}
