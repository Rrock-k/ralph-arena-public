import { NextResponse } from "next/server";
import { getAllTasks, getTasksByProject } from "@/lib/backlog";
import { getBacklogErrorStatus, normalizeBacklogError, toBacklogErrorResponse } from "@/lib/backlog-errors";
import { appendTask } from "@/lib/writer";
import type { TaskStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const CREATABLE_STATUSES: TaskStatus[] = ["IDEA", "PLANNED"];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get("project");

    const tasks = project
      ? await getTasksByProject(project)
      : await getAllTasks();

    return NextResponse.json(tasks);
  } catch (error) {
    const sourceFile = (() => {
      const { searchParams } = new URL(request.url);
      const project = searchParams.get("project");
      return project ? `${project}.md` : undefined;
    })();
    const normalizedError = normalizeBacklogError(error, sourceFile);
    console.error("Failed to load tasks:", error);
    return NextResponse.json(
      toBacklogErrorResponse(normalizedError),
      { status: getBacklogErrorStatus(normalizedError) }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = body.title?.trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    const status: TaskStatus = CREATABLE_STATUSES.includes(body.status) ? body.status : "IDEA";
    const sourceFile = body.sourceFile;
    const task = await appendTask(title, sourceFile, status);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error("Failed to create task:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
