import { NextResponse } from "next/server";

import { inspectContainerInternal } from "@/app/actions/container-ops";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { requireProjectCapability } from "@/lib/project-access";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await context.params;
  const access = await requireProjectCapability(id, "project.view");
  if (!access.authorized) {
    return NextResponse.json(
      { status: "error", error: access.error },
      { status: access.error === "Unauthorized" ? 401 : 403 },
    );
  }

  const info = await inspectContainerInternal(id, INTERNAL_ACTION_TOKEN);
  return NextResponse.json(info, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
