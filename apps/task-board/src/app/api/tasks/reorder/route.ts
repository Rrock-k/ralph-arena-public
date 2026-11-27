import { NextResponse } from "next/server";
import { moveTask } from "@/lib/writer";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, afterTaskId, beforeTaskId } = body;

    if (!taskId || typeof taskId !== "string") {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }
    if (!afterTaskId && !beforeTaskId) {
      return NextResponse.json(
        { error: "afterTaskId or beforeTaskId is required" },
        { status: 400 }
      );
    }

    await moveTask(taskId, { afterTaskId, beforeTaskId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to reorder task:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
