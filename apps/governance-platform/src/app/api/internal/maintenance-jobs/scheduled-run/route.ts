import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/internal-auth";
import { recordScheduledMaintenanceRun } from "@/lib/maintenance-jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const key = body && typeof body === "object" && "key" in body
    ? (body as { key?: unknown }).key
    : null;
  if (typeof key !== "string" || (!key.startsWith("cron:") && !key.startsWith("maintenance:"))) {
    return NextResponse.json({ success: false, error: "Expected scheduled MaintenanceItem key" }, { status: 400 });
  }
  const minIntervalMs = body && typeof body === "object" && "minIntervalMs" in body
    ? readPositiveInt((body as { minIntervalMs?: unknown }).minIntervalMs)
    : undefined;

  const result = await recordScheduledMaintenanceRun(key, { minIntervalMs });
  return NextResponse.json(serializeScheduledRunResult(result));
}

function serializeScheduledRunResult(result: any) {
  return {
    success: result.success,
    error: result.success ? null : result.error ?? "Scheduled cron run failed",
    runId: result.run?.id ?? null,
    status: result.run?.status ?? null,
    summary: result.run?.summary ?? null,
    skipped: result.skipped ?? false,
    reason: result.reason ?? null,
  };
}

function readPositiveInt(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
