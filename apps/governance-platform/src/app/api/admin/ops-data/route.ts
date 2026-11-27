import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVpsFleet } from "@/app/actions/runtime-maintenance";
import { requirePlatformCapability } from "@/lib/platform-access";
import { getAdminJobsData } from "@/lib/maintenance-jobs";
import { listAdminCreditAccounts } from "@/app/actions/admin-credits";

/**
 * GET /api/admin/ops-data?tab=proposals|seasons|registry|vps|jobs|finance
 *
 * RA-157: Lazy-loads tab-specific data for Ops dashboard.
 * Only fetches data for the requested tab to avoid loading everything upfront.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get("tab");

  switch (tab) {
    case "proposals": {
      const access = await requirePlatformCapability("platform.governance.manage");
      if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 401 });
      const [proposals, archivedProposals] = await Promise.all([
        prisma.proposal.findMany({
          where: { archivedAt: null },
          orderBy: { createdAt: "desc" },
          include: {
            _count: { select: { votes: true, projects: true } },
            projects: { select: { id: true }, orderBy: { createdAt: "desc" as const }, take: 1 },
          },
        }),
        prisma.proposal.findMany({
          where: { archivedAt: { not: null } },
          orderBy: { createdAt: "desc" },
          include: {
            _count: { select: { votes: true } },
            projects: { select: { id: true } },
          },
        }),
      ]);
      return NextResponse.json({ proposals, archivedProposals });
    }

    case "seasons": {
      const access = await requirePlatformCapability("platform.governance.manage");
      if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 401 });
      const seasons = await prisma.season.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { proposals: true } },
          buildConfigs: { orderBy: { order: "asc" } },
          proposals: {
            where: { archivedAt: null },
            orderBy: { createdAt: "desc" },
            include: {
              _count: { select: { votes: true, projects: true } },
            },
          },
        },
      });
      return NextResponse.json({ seasons });
    }

    case "registry": {
      const access = await requirePlatformCapability("platform.registry.manage");
      if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 401 });
      const [tools, agentLoops] = await Promise.all([
        (prisma as any).tool.findMany({ orderBy: { name: "asc" } }),
        (prisma as any).agentLoop.findMany({
          orderBy: { name: "asc" },
          include: {
            currentVersion: {
              select: {
                id: true,
                version: true,
                commandTemplate: true,
                capabilities: true,
                supportTier: true,
                changelog: true,
                createdAt: true,
                complianceStatus: true,
                complianceResult: true,
                complianceCheckedAt: true,
              },
            },
            versions: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                version: true,
                commandTemplate: true,
                capabilities: true,
                supportTier: true,
                changelog: true,
                createdAt: true,
                complianceStatus: true,
                complianceResult: true,
                complianceCheckedAt: true,
              },
            },
            owner: { select: { id: true, name: true, email: true } },
            loopTools: { select: { toolId: true, models: true, isDefault: true } },
          },
        }),
      ]);
      return NextResponse.json({ tools, agentLoops });
    }

    case "vps": {
      const access = await requirePlatformCapability("platform.runtime.manage");
      if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 401 });
      const result = await getVpsFleet().catch(() => ({ entries: [] as any[] }));
      return NextResponse.json({ entries: result.entries });
    }

    case "jobs": {
      const access = await requirePlatformCapability("platform.runtime.manage");
      if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 401 });
      return NextResponse.json(await getAdminJobsData());
    }

    case "finance": {
      const access = await requirePlatformCapability("platform.finance.manage");
      if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 401 });
      return NextResponse.json(await listAdminCreditAccounts());
    }

    case "notifications": {
      const access = await requirePlatformCapability("platform.ops.view");
      if (!access.authorized) return NextResponse.json({ error: access.error }, { status: 401 });

      const [logs, subscriberStats, analytics, subscribers, userPreferences] = await Promise.all([
        // Recent notification logs
        prisma.notificationLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 200,
          include: { user: { select: { email: true, name: true } } },
        }),
        // Newsletter subscriber stats
        prisma.$queryRaw`
          SELECT status, COUNT(*)::int as count
          FROM "NewsletterSubscriber"
          GROUP BY status
        ` as Promise<{ status: string; count: number }[]>,
        // Analytics summary (last 30 days)
        prisma.$queryRaw`
          SELECT
            status,
            "eventType",
            COUNT(*)::int as count
          FROM "NotificationLog"
          WHERE "createdAt" > NOW() - INTERVAL '30 days'
          GROUP BY status, "eventType"
          ORDER BY count DESC
        ` as Promise<{ status: string; eventType: string; count: number }[]>,
        // Newsletter subscribers list
        prisma.newsletterSubscriber.findMany({
          orderBy: { createdAt: "desc" },
          take: 500,
          select: {
            id: true,
            email: true,
            source: true,
            status: true,
            createdAt: true,
            unsubscribedAt: true,
          },
        }),
        // User notification preferences (opt-outs)
        prisma.notificationPreference.findMany({
          where: { enabled: false },
          orderBy: { updatedAt: "desc" },
          include: { user: { select: { email: true, name: true } } },
        }),
      ]);

      return NextResponse.json({ logs, subscriberStats, analytics, subscribers, userPreferences });
    }

    default:
      return NextResponse.json({ error: "Unknown tab" }, { status: 400 });
  }
}
