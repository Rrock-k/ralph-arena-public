import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import {
  isBudgetVisibilityEnabled,
  isCommunityQaEnabled,
} from "@/lib/feature-flags";
import { getStatusClasses } from "@/lib/status-classes";
import { ProjectTabs, type TabDef } from "@/components/project/ProjectTabs";
import { TestsTab } from "@/components/project/TestsTab";
import { ProgressTab } from "@/components/project/ProgressTab";
import { getProjectDescription, getProjectName } from "@/lib/project-identity";
import { buildProjectPageMetadata } from "@/lib/project-share-metadata";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { resolveProjectAccess } from "@/lib/project-access";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { PRIMARY_LIFECYCLE_COMPONENT_SELECT } from "@/lib/project-lifecycle";
import { VisibilitySelector } from "@/components/admin/VisibilitySelector";
import { PreviewIframe } from "@/components/preview/PreviewIframe";
import { getPreferredPreviewUrl } from "@/lib/preview-url";
import { getProjectOperatorSnapshotForViewer } from "@/lib/admin-ops-projects";
import { getAppComponent, getOpsDisplayStatus } from "@/lib/operator-display";

interface ProjectDetailProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: ProjectDetailProps): Promise<Metadata> {
  const { id } = await params;
  const [session, hasBypass, project] = await Promise.all([
    auth(),
    hasE2EAdminBypass(),
    (prisma as any).project.findUnique({
      where: { id },
      include: { proposal: { select: { title: true, description: true } } },
    }),
  ]);
  if (!project) return { title: "Project not found" };

  const access = await resolveProjectAccess(project, session, hasBypass);
  return buildProjectPageMetadata(project, access.canView);
}

async function getProject(id: string) {
  const project = await (prisma as any).project.findUnique({
    where: { id },
    include: {
      proposal: {
        select: { id: true, title: true, description: true },
      },
      budget: true,
      specs: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { version: true, createdAt: true },
          },
        },
      },
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: PRIMARY_LIFECYCLE_COMPONENT_SELECT,
      },
    },
  });

  return project;
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailProps) {
  const { id } = await params;
  const [session, hasBypass, project, showBudget, qaEnabled] =
    await Promise.all([
      auth(),
      hasE2EAdminBypass(),
      getProject(id),
      isBudgetVisibilityEnabled(),
      isCommunityQaEnabled(),
    ]);

  if (!project) {
    notFound();
  }

  const access = await resolveProjectAccess(project, session, hasBypass);
  const platformAccess = await resolvePlatformAccess(session, hasBypass);
  if (!access.canView) {
    notFound();
  }

  const operatorSnapshot = await getProjectOperatorSnapshotForViewer({
    projectId: project.id,
    session,
    hasBypass,
  });

  const displayStatus = getOpsDisplayStatus(operatorSnapshot ?? project);
  const primaryComponent = getAppComponent(operatorSnapshot ?? project);
  const previewUrl = getPreferredPreviewUrl({
    previewUrl: primaryComponent?.previewUrl ?? null,
    containerName: primaryComponent?.containerName ?? null,
    previewDomain: process.env.PREVIEW_DOMAIN?.trim() ?? null,
  });
  const projectTitle = getProjectName(project);
  const projectDescription = getProjectDescription(project);
  const budget = project.budget;
  const used = budget?.usedCreditsUsd ?? 0;
  const total = budget?.totalCreditsUsd ?? 0;
  const remaining = total - used;
  const usagePct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const isWarning = usagePct > 80 && usagePct < 100;
  const isExhausted = budget?.isEnabled && remaining <= 0.1;

  // RA-089: Fetch events for QA tab
  let events: any[] = [];
  let pendingTestCount = 0;
  if (qaEnabled) {
    events = await (prisma as any).projectEvent.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
    });
    events = events.map((e: any) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    }));
    const testRequests = events.filter(
      (e: any) => e.type === "test_request" && e.direction === "out",
    );
    const testResults = events.filter(
      (e: any) => e.type === "test_result" && e.direction === "in",
    );
    const answeredIds = new Set(
      testResults.map((r: any) => r.payload?.testRequestEventId),
    );
    pendingTestCount = testRequests.filter(
      (t: any) => !answeredIds.has(t.id),
    ).length;
  }

  const overviewContent = (
    <>
      {/* Live Preview */}
      {previewUrl && (
        <div className="mb-6 flex justify-center">
          <a
            href={`/api/auth/preview-redirect?projectId=${project.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group/preview block w-[600px] max-w-full rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-slate-700 shadow-sm cursor-pointer"
          >
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-slate-600" />
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-slate-600" />
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-slate-600" />
              </div>
              <div className="flex-1 h-3.5 rounded bg-gray-100 dark:bg-slate-700" />
            </div>
            <div className="relative aspect-[16/10] overflow-hidden">
              <PreviewIframe
                previewUrl={previewUrl}
                proposalTitle={projectTitle}
                projectId={project.id}
                visibility={
                  project.visibility as
                    | "featured"
                    | "public"
                    | "private"
                    | undefined
                }
                iframeClassName="border-0 pointer-events-none origin-top-left w-[1280px] h-[800px]"
                iframeStyle={{ transform: `scale(${600 / 1280})` }}
                fallbackClassName="flex h-full w-full flex-col items-center justify-center gap-3 bg-gray-50 px-6 text-center text-gray-500 dark:bg-slate-900 dark:text-slate-300"
                loading="lazy"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-200 group-hover/preview:bg-black/40">
                <span className="flex items-center gap-2 rounded-lg bg-white/90 px-4 py-2 text-sm font-semibold text-gray-900 shadow-lg opacity-0 translate-y-1 transition-all duration-200 group-hover/preview:opacity-100 group-hover/preview:translate-y-0">
                  Open preview
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </span>
              </div>
            </div>
          </a>
        </div>
      )}

      {/* Budget (public, read-only) */}
      {showBudget && budget?.isEnabled && (
        <div
          data-testid="project-budget-card"
          className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 lg:p-8 mb-6 dark:border-slate-700 dark:bg-slate-900"
        >
          <h2 className="mb-3 text-xl font-semibold text-gray-900 sm:text-2xl dark:text-slate-100">
            Budget
          </h2>
          <div
            data-testid="project-budget-progress-track"
            className="mb-3 h-2 w-full rounded-full bg-gray-200 dark:bg-slate-700"
          >
            <div
              data-testid="project-budget-progress-fill"
              className={`h-2 rounded-full transition-all ${
                isExhausted
                  ? "bg-rose-500"
                  : isWarning
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div
              data-testid="project-budget-total"
              className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 sm:px-3 sm:py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              <div className="mono text-sm font-semibold text-gray-900 dark:text-slate-100">
                ${total.toFixed(2)}
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400">
                Total
              </div>
            </div>
            <div
              data-testid="project-budget-used"
              className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 sm:px-3 sm:py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              <div className="mono text-sm font-semibold text-violet-600">
                ${used.toFixed(2)}
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400">
                Used
              </div>
            </div>
            <div
              data-testid="project-budget-remaining"
              className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 sm:px-3 sm:py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              <div
                className={`mono text-sm font-semibold ${isExhausted ? "text-rose-600" : "text-emerald-600"}`}
              >
                ${Math.max(0, remaining).toFixed(2)}
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400">
                Remaining
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Specs (read-only) */}
      {project.specs.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 lg:p-8 mb-6 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-3 text-xl font-semibold text-gray-900 sm:text-2xl dark:text-slate-100">
            Specifications
          </h2>
          <div className="space-y-3">
            {project.specs.map((spec: any) => (
              <div
                key={spec.id}
                className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-slate-600 dark:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  {spec.title && (
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                      {spec.title}
                    </h4>
                  )}
                  <span className="shrink-0 text-xs text-gray-500 mono dark:text-slate-400">
                    {new Date(spec.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="prose prose-sm max-w-none text-gray-600 dark:text-slate-300">
                  <MarkdownRenderer content={spec.content} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const isActive = ["PROVISIONING", "QUEUED", "RUNNING", "STARTING"].includes(
    displayStatus,
  );
  const hasProgress = !!(project as any).progressJson;

  const tabs: TabDef[] = [
    { id: "overview", label: "Overview", content: overviewContent },
  ];

  if (hasProgress) {
    tabs.push({
      id: "progress",
      label: "Progress",
      content: (
        <ProgressTab
          progressJson={(project as any).progressJson}
          isActive={isActive}
        />
      ),
    });
  }

  if (qaEnabled) {
    tabs.push({
      id: "tests",
      label: "Tests",
      badge: pendingTestCount > 0 ? pendingTestCount : undefined,
      content: (
        <TestsTab
          projectId={project.id}
          previewUrl={previewUrl}
          initialEvents={events}
        />
      ),
    });
  }

  return (
    <main className="min-h-screen bg-white py-8 dark:bg-[#0b0f19]">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        {/* Header Card */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 lg:p-8 mb-6 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
            <h1 className="flex-1 text-2xl font-bold text-gray-900 sm:text-3xl dark:text-slate-100">
              {projectTitle}
            </h1>
            <div className="flex items-center gap-2 self-start">
              {access.canManage && (
                <VisibilitySelector
                  projectId={project.id}
                  initialValue={
                    project.visibility as "featured" | "public" | "private"
                  }
                  showFeatured={platformAccess.hasCapability(
                    "platform.projects.manage",
                  )}
                />
              )}
              <span
                className={`mono inline-block rounded-full border px-3 py-1 text-xs font-semibold ${getStatusClasses(displayStatus)}`}
              >
                {displayStatus}
              </span>
            </div>
          </div>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mono mb-4 dark:text-slate-400">
            <span>
              Agent: {project.agent}/{project.agentImpl}
            </span>
            <span>
              Created {new Date(project.createdAt).toLocaleDateString()}
            </span>
          </div>

          {/* Description */}
          {projectDescription && (
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-300">
              {projectDescription}
            </p>
          )}
        </div>

        <ProjectTabs tabs={tabs} />
      </div>
    </main>
  );
}
