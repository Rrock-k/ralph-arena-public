import { NextResponse } from "next/server";
import { getAdminApiAuthResult } from "@/lib/admin-api-auth";
import { runMaintenanceItemNow } from "@/lib/maintenance-jobs";

export const runtime = "nodejs";

const RUNTIME_MANAGE_CAPABILITY = "platform.runtime.manage";
const ADMIN_API_ACTOR_ID = "arena-admin-api";

export async function POST(request: Request) {
  const auth = getAdminApiAuthResult(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const key = readMaintenanceItemKey(body);
  if (!key) {
    return NextResponse.json({ success: false, error: "Expected MaintenanceItem key" }, { status: 400 });
  }

  const result = await runMaintenanceItemNow(key, {
    actorType: "system",
    actorId: ADMIN_API_ACTOR_ID,
    actorCapability: RUNTIME_MANAGE_CAPABILITY,
  });

  return NextResponse.json(serializeManualRunResult(result));
}

function readMaintenanceItemKey(body: unknown) {
  const key = body && typeof body === "object" && "key" in body
    ? (body as { key?: unknown }).key
    : null;
  if (typeof key !== "string") return null;
  if (!key.startsWith("cron:") && !key.startsWith("maintenance:")) return null;
  return key;
}

function serializeManualRunResult(result: any) {
  return {
    success: result.success,
    error: result.success ? null : result.error ?? "Manual maintenance run failed",
    run: serializeRun(result.run),
    activeRun: serializeActiveRun(result.activeRun),
  };
}

function serializeRun(run: any) {
  if (!run) return null;
  return {
    id: run.id ?? null,
    status: run.status ?? null,
    summary: run.summary ?? null,
    result: run.result ?? null,
    startedAt: serializeDateLike(run.startedAt),
    finishedAt: serializeDateLike(run.finishedAt),
    durationMs: run.durationMs ?? null,
  };
}

function serializeActiveRun(run: any) {
  if (!run) return null;
  return {
    id: run.id ?? null,
    startedAt: serializeDateLike(run.startedAt),
    trigger: run.trigger ?? null,
    actorType: run.actorType ?? null,
    actorId: run.actorId ?? null,
  };
}

function serializeDateLike(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}
