import { NextRequest, NextResponse } from "next/server";
import { getTokenManager, type Provider } from "@/lib/token-manager";
import { headers } from "next/headers";

const VALID_PROVIDERS: Provider[] = ["claude-api", "claude-sub", "openai-api", "openai-sub", "opencode-api", "github"];

/**
 * GET /api/internal/tokens/:provider
 * Returns current tokens for a provider.
 * Auth: x-runner-webhook-secret header.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  // Auth check
  const hdrs = await headers();
  const secret = hdrs.get("x-runner-webhook-secret");
  const expected = process.env.RUNNER_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider } = await params;

  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json(
      { error: `Invalid provider. Valid: ${VALID_PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }

  const tm = getTokenManager();
  const tokens = tm.getTokens(provider as Provider);
  const meta = tm.getTokenMeta(provider as Provider);

  return NextResponse.json({
    provider,
    tokens,
    updatedAt: meta.updatedAt,
    hasToken: meta.hasToken,
  });
}

/**
 * POST /api/internal/tokens/:provider
 * Force refresh tokens (calls refresh-tokens.sh).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const hdrs = await headers();
  const secret = hdrs.get("x-runner-webhook-secret");
  const expected = process.env.RUNNER_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { provider } = await params;

  const tm = getTokenManager();
  tm.triggerRefreshAsync();
  // Wait a moment for refresh to complete, then reload
  await new Promise((r) => setTimeout(r, 2_000));
  tm.forceReload();

  const tokens = tm.getTokens(provider as Provider);
  const meta = tm.getTokenMeta(provider as Provider);

  return NextResponse.json({
    provider,
    tokens,
    updatedAt: meta.updatedAt,
    refreshed: true,
  });
}
