import { NextResponse } from "next/server";

import { fetchProviderQuotaSnapshot } from "@/lib/provider-quotas";
import { requirePlatformCapability } from "@/lib/platform-access";

export const runtime = "nodejs";

export async function GET() {
  const access = await requirePlatformCapability("platform.finance.manage");
  if (!access.authorized) {
    return NextResponse.json({ error: access.error }, { status: 401 });
  }

  const snapshot = await fetchProviderQuotaSnapshot();
  return NextResponse.json(snapshot);
}
