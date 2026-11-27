import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TELEGRAM_AUTH_PROVIDER_ID } from "@/lib/telegram-oidc-provider";
import {
  TELEGRAM_WEBAPP_INIT_DATA_HEADER,
  resolveTelegramWebAppSessionFromInitData,
} from "@/lib/telegram-webapp-auth";
import { createTelegramWebAppLinkToken } from "@/lib/telegram-webapp-link-token";

export const dynamic = "force-dynamic";

const JSON_RESPONSE_INIT = {
  headers: {
    "Cache-Control": "no-store",
  },
};

function getAppBaseUrl(request: Request) {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configured?.trim()) return configured.trim().replace(/\/+$/, "");
  return new URL(request.url).origin;
}

function buildLinkHref(request: Request, telegramUserId?: string) {
  if (!telegramUserId) return undefined;
  const token = createTelegramWebAppLinkToken(telegramUserId);
  if (!token) return undefined;

  const url = new URL("/api/telegram/webapp-link", getAppBaseUrl(request));
  url.searchParams.set("token", token);
  return url.toString();
}

async function getUnlinkedReason(): Promise<"telegram_account_required" | "raw_id_repair_required"> {
  const session = await auth();
  if (!session?.user?.id) return "telegram_account_required";

  const linkedTelegramAccounts = await prisma.account.count({
    where: {
      userId: session.user.id,
      provider: TELEGRAM_AUTH_PROVIDER_ID,
    },
  });

  return linkedTelegramAccounts > 0 ? "raw_id_repair_required" : "telegram_account_required";
}

export async function GET(request: Request) {
  const result = await resolveTelegramWebAppSessionFromInitData(
    request.headers.get(TELEGRAM_WEBAPP_INIT_DATA_HEADER),
  );

  if (result.status === "ok") {
    return NextResponse.json(
      {
        status: "linked",
        telegramUserId: result.telegramUserId,
        user: {
          id: result.session.user.id,
          email: result.session.user.email ?? null,
          name: result.session.user.name ?? null,
          image: result.session.user.image ?? null,
          role: result.session.user.role ?? null,
        },
      },
      JSON_RESPONSE_INIT,
    );
  }

  if (result.status === "unlinked") {
    const reason = await getUnlinkedReason();
    return NextResponse.json(
      {
        status: "unlinked",
        reason,
        telegramUserId: result.telegramUserId,
        linkHref: buildLinkHref(request, result.telegramUserId),
      },
      JSON_RESPONSE_INIT,
    );
  }

  return NextResponse.json(
    {
      status: result.status,
      error: "Telegram WebApp handoff rejected",
    },
    { ...JSON_RESPONSE_INIT, status: 401 },
  );
}
