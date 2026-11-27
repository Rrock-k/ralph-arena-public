import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TELEGRAM_AUTH_PROVIDER_ID } from "@/lib/telegram-oidc-provider";
import { verifyTelegramWebAppLinkToken } from "@/lib/telegram-webapp-link-token";

export const dynamic = "force-dynamic";

function getAppBaseUrl(request: Request) {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configured?.trim()) return configured.trim().replace(/\/+$/, "");
  return new URL(request.url).origin;
}

function settingsRedirect(request: Request, params: Record<string, string>) {
  const url = new URL("/settings", getAppBaseUrl(request));
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  url.hash = "profile";
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function signInRedirect(request: Request) {
  const url = new URL("/auth/signin", getAppBaseUrl(request));
  url.searchParams.set("callbackUrl", request.url);
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = verifyTelegramWebAppLinkToken(url.searchParams.get("token"));
  if (!token.ok) {
    return settingsRedirect(request, { authError: "TelegramWebAppLinkInvalid" });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return signInRedirect(request);
  }

  const existingAccount = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: TELEGRAM_AUTH_PROVIDER_ID,
        providerAccountId: token.payload.telegramUserId,
      },
    },
    select: {
      userId: true,
    },
  });

  if (existingAccount && existingAccount.userId !== session.user.id) {
    return settingsRedirect(request, { authError: "TelegramWebAppLinkConflict" });
  }

  if (!existingAccount) {
    await prisma.account.create({
      data: {
        userId: session.user.id,
        type: "oidc",
        provider: TELEGRAM_AUTH_PROVIDER_ID,
        providerAccountId: token.payload.telegramUserId,
      },
    });
  }

  return settingsRedirect(request, { connected: "telegram-webapp" });
}
