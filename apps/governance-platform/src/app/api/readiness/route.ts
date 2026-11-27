import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildGovernanceReadinessReport,
  probePrismaDatabase,
} from "@/lib/governance-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await buildGovernanceReadinessReport({
    dbProbe: () => probePrismaDatabase(prisma),
  });

  return NextResponse.json(report, {
    status: report.status === "ready" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
    },
  });
}
