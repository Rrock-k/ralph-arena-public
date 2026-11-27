import { NextRequest, NextResponse } from "next/server";
import { updateTask, deleteTask } from "@/lib/writer";
import type { TaskStatus, Priority, TaskUpdates } from "@/lib/types";
import { ALL_STATUSES, TASK_COLORS } from "@/lib/constants";

const VALID_PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

type TaskRouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: TaskRouteContext) {
  const { id } = await params;

  try {
    const body = await request.json();
    const updates: TaskUpdates = {};

    if (body.status !== undefined) {
      if (!ALL_STATUSES.includes(body.status as TaskStatus)) {
        return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 });
      }
      updates.status = body.status;
    }

    if (body.priority !== undefined) {
      if (!VALID_PRIORITIES.includes(body.priority as Priority)) {
        return NextResponse.json({ error: `Invalid priority: ${body.priority}` }, { status: 400 });
      }
      updates.priority = body.priority;
    }

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) {
        return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
      }
      updates.title = title;
    }

    if (body.description !== undefined) {
      updates.description = String(body.description);
    }

    if (body.color !== undefined) {
      if (body.color !== null && !TASK_COLORS.includes(body.color)) {
        return NextResponse.json({ error: `Invalid color: ${body.color}` }, { status: 400 });
      }
      updates.color = body.color;
    }

    if (body.acceptanceCriteria !== undefined) {
      if (!Array.isArray(body.acceptanceCriteria)) {
        return NextResponse.json({ error: "acceptanceCriteria must be an array" }, { status: 400 });
      }
      updates.acceptanceCriteria = body.acceptanceCriteria;
    }

    await updateTask(id, updates);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to update task ${id}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: TaskRouteContext) {
  const { id } = await params;

  try {
    await deleteTask(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to delete task ${id}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
