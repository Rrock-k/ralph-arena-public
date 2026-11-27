import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { preloadAgentLabels, parseModels as parseToolModels } from "@/lib/agent-labels";
import { getFeatureFlagsSnapshot } from "@/lib/feature-flags";
import { getTokenManager, type Provider } from "@/lib/token-manager";
import { redirect } from "next/navigation";
import { OpsDashboard } from "@/components/admin/ops/OpsDashboard";
import {
  listAccessAdminData,
  listManagedProjectsForUser,
  listProjectAccessPanelStates,
} from "@/lib/access-control/server";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { getAdminOpsRawProjects, buildAdminOpsProjects } from "@/lib/admin-ops-projects";
import { computeOpsMetrics } from "@/components/admin/ops/ops-metrics";
import { getLocalConfigReadiness } from "@/lib/local-config-readiness";
import { getTelegramAccountAudit } from "@/lib/telegram-account-audit";
import { toProjectFacingAgentLoops } from "@/lib/project-facing-agent-loops";
import { getWorkspaceRoot } from "@/lib/control-plane";

export default async function AdminOpsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, hasBypass] = await Promise.all([auth(), hasE2EAdminBypass(), preloadAgentLabels()]);
  const platformAccess = await resolvePlatformAccess(session, hasBypass);
  const managedProjects = session?.user?.id
    ? await listManagedProjectsForUser(session.user.id)
    : [];

  if (!session?.user && !hasBypass) {
    redirect("/");
  }

  const canAccessOpsShell = platformAccess.canOpenOps || managedProjects.length > 0;
  if (!canAccessOpsShell) {
    redirect("/");
  }

  const visibleProjectIds = platformAccess.canOpenOps
    ? undefined
    : managedProjects.map((project) => project.id);
  const canViewConfig = platformAccess.hasCapability("platform.flags.manage");

  // RA-157: Load essential data in SSR (projects + registry + flags).
  // Heavy secondary data (proposals, seasons, vps, jobs) loads lazily per tab.
  const [
    rawProjects,
    featureFlags,
    tools,
    agentLoops,
    proposalOptions,
    accessAdminData,
    telegramAccountAudit,
  ] = await Promise.all([
    getAdminOpsRawProjects(visibleProjectIds),
    getFeatureFlagsSnapshot(),
    (prisma as any).tool.findMany({ orderBy: { name: "asc" } }).then((rows: any[]) =>
      rows.map((t: any) => ({
        ...t,
        models: parseToolModels(t.models),
      })),
    ),
    (prisma as any).agentLoop.findMany({
      orderBy: { name: "asc" },
      include: {
        currentVersion: true,
        versions: { orderBy: { createdAt: "desc" } },
        owner: { select: { id: true, name: true, email: true } },
        loopTools: { select: { toolId: true, models: true, isDefault: true } },
      },
    }),
    prisma.proposal.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
    platformAccess.hasCapability("platform.access.manage")
      ? listAccessAdminData()
      : Promise.resolve({ subjects: [], peopleRows: [], grants: [], auditEntries: [] }),
    canViewConfig ? getTelegramAccountAudit() : Promise.resolve(null),
  ]);

  const projects = await buildAdminOpsProjects(rawProjects, session, hasBypass);
  const metrics = computeOpsMetrics(projects as any);
  const projectAccessPanels = await listProjectAccessPanelStates(
    projects.map((project) => project.id),
    { includeInheritedSources: platformAccess.hasCapability("platform.access.manage") },
  );
  const projectAgentLoops = toProjectFacingAgentLoops(agentLoops);

  // RA-168 / RA-162: token availability is platform-runtime staff only.
  const tokenStatus = platformAccess.hasCapability("platform.runtime.manage")
    ? (() => {
      const tm = getTokenManager();
      const providers: Provider[] = ["claude-api", "claude-sub", "openai-api", "openai-sub", "opencode-api"];
      return Object.fromEntries(
        providers.map((p) => {
          const meta = tm.getTokenMeta(p);
          return [p, { hasToken: meta.hasToken, updatedAt: meta.updatedAt }];
        }),
      ) as Record<Provider, { hasToken: boolean; updatedAt: number }>;
    })()
    : undefined;

  const workspaceRoot = getWorkspaceRoot();
  const localConfigReadiness = getLocalConfigReadiness();

  return (
    <OpsDashboard
      projects={projects as any}
      accessAdminData={accessAdminData}
      projectAccessPanels={projectAccessPanels}
      shellAccess={{
        allowedGlobalTabs: [
          "projects",
          ...(platformAccess.hasCapability("platform.governance.manage") ? ["proposals" as const, "seasons" as const] : []),
          ...(platformAccess.hasCapability("platform.access.manage") ? ["access" as const] : []),
          ...(platformAccess.hasCapability("platform.finance.manage") ? ["finance" as const, "quota" as const] : []),
          ...(platformAccess.hasCapability("platform.registry.manage") ? ["registry" as const] : []),
          ...(canViewConfig ? ["config" as const] : []),
          ...(platformAccess.hasCapability("platform.runtime.manage") ? ["lab" as const, "jobs" as const, "vps" as const] : []),
          ...(platformAccess.hasCapability("platform.ops.view") ? ["notifications" as const] : []),
        ],
        canCreateProjects: platformAccess.hasCapability("platform.projects.manage"),
        canManagePlatformProjects: platformAccess.hasCapability("platform.projects.manage"),
        canRunGlobalRuntimeActions: platformAccess.hasCapability("platform.runtime.manage"),
        canManagePlatformFinance: platformAccess.hasCapability("platform.finance.manage"),
      }}
      tools={tools}
      agentLoops={agentLoops}
      projectAgentLoops={projectAgentLoops}
      proposals={proposalOptions}
      featureFlags={featureFlags}
      metrics={metrics}
      workspaceRoot={workspaceRoot}
      tokenStatus={tokenStatus}
      localConfigReadiness={localConfigReadiness}
      telegramAccountAudit={telegramAccountAudit}
    />
  );
}
