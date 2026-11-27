import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { getProjectInteractionSnapshotForViewer } from "@/lib/project-interaction";
import {
  TELEGRAM_WEBAPP_INIT_DATA_HEADER,
  resolveTelegramWebAppSessionFromInitData,
} from "@/lib/telegram-webapp-auth";
import { syncTgSpecProjectAccessForTelegramViewer } from "@/lib/tg-spec-project-access";

export const dynamic = "force-dynamic";
const JSON_RESPONSE_INIT = {
  headers: {
    "Cache-Control": "no-store",
  },
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
) {
  const { id: projectId } = await context.params;
  const surfaceParam = new URL(request.url).searchParams.get("surface");
  const surface = surfaceParam === null || surfaceParam === "arena"
    ? "arena"
    : surfaceParam === "telegram"
      ? "telegram"
      : null;
  if (!surface) {
    return NextResponse.json(
      { error: "Unsupported interaction surface" },
      { ...JSON_RESPONSE_INIT, status: 400 },
    );
  }

  const [session, hasBypass] = await Promise.all([
    auth(),
    hasE2EAdminBypass(),
  ]);
  const telegramInitData = surface === "telegram"
    ? request.headers.get(TELEGRAM_WEBAPP_INIT_DATA_HEADER)
    : null;
  const telegramSession = telegramInitData
    ? await resolveTelegramWebAppSessionFromInitData(telegramInitData)
    : null;
  const effectiveSession = telegramSession?.status === "ok"
    ? telegramSession.session
    : session;

  if (
    surface === "telegram"
    && telegramSession?.status === "ok"
    && effectiveSession?.user?.id
  ) {
    try {
      await syncTgSpecProjectAccessForTelegramViewer({
        projectId,
        arenaUserId: effectiveSession.user.id,
        telegramUserId: telegramSession.telegramUserId,
      });
    } catch (error) {
      console.warn("Failed to sync tg-spec project access", {
        projectId,
        arenaUserId: effectiveSession.user.id,
        telegramUserId: telegramSession.telegramUserId,
        error,
      });
    }
  }

  const result = await getProjectInteractionSnapshotForViewer({
    projectId,
    session: effectiveSession,
    hasBypass,
    surface,
  });

  switch (result.status) {
    case "ok":
      return NextResponse.json(result.snapshot, JSON_RESPONSE_INIT);
    case "unauthorized":
      return NextResponse.json({ error: "Unauthorized" }, { ...JSON_RESPONSE_INIT, status: 401 });
    case "forbidden":
      return NextResponse.json({ error: "Project access denied" }, { ...JSON_RESPONSE_INIT, status: 403 });
    case "not_found":
      return NextResponse.json({ error: "Project not found" }, { ...JSON_RESPONSE_INIT, status: 404 });
  }
}
