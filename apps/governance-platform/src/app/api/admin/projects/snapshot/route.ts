import { NextResponse } from "next/server";

import { getAdminOpsProjectsForViewer } from "@/lib/admin-ops-projects";
import { resolveAdminOpsViewer } from "@/lib/admin-ops-shell";

export const dynamic = "force-dynamic";

function parseIds(rawIds: string | null): string[] | undefined {
  if (!rawIds) return undefined;
  const ids = rawIds
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
}

export async function GET(request: Request) {
  const viewer = await resolveAdminOpsViewer();
  if (!viewer.authorized) {
    return NextResponse.json({ error: viewer.error }, { status: viewer.status });
  }

  const { searchParams } = new URL(request.url);
  const requestedIds = parseIds(searchParams.get("ids"));
  const allowedIds = viewer.visibleProjectIds
    ? requestedIds
      ? requestedIds.filter((id) => viewer.visibleProjectIds?.includes(id))
      : viewer.visibleProjectIds
    : requestedIds;

  const projects = await getAdminOpsProjectsForViewer({
    projectIds: allowedIds,
    session: viewer.session,
    hasBypass: viewer.hasBypass,
  });

  return NextResponse.json({ projects });
}
