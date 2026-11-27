import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ProposalCardOld as ProposalCard } from "@/components/ProposalCardOld";
import { PreviewCard } from "@/components/ui/project-card/PreviewCard";
import {
  hasActiveProject,
  getPreviewStage,
} from "@/components/ui/project-card/types";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";
import Link from "next/link";
import {
  isBudgetVisibilityEnabled,
  isByokProviderKeysEnabled,
  isManagedProviderCreditsEnabled,
} from "@/lib/feature-flags";
import { CreateProjectButton } from "@/components/projects/CreateProjectButton";
import { getUserCreditBalance } from "@/app/actions/credits";
import { getProjectName } from "@/lib/project-identity";
import { listManagedProjectsForUser } from "@/lib/access-control/server";
import { shouldShowMyDashboardLivePill } from "@/lib/my-surfaces";
import { PRIMARY_LIFECYCLE_COMPONENT_SELECT } from "@/lib/project-lifecycle";
import { PROJECT_FACING_AGENT_LOOP_INCLUDE } from "@/lib/project-facing-agent-loops";
import { getPreferredPreviewUrl } from "@/lib/preview-url";
import {
  getAppComponent,
  getOpsDisplayStatus,
  isOpsActiveStatus,
} from "@/lib/operator-display";

function getProjectPreviewUrl(project: {
  components?: Array<Record<string, unknown>> | null;
}): string | null {
  const primaryComponent = getAppComponent(project);
  return getPreferredPreviewUrl({
    previewUrl: primaryComponent?.previewUrl ?? null,
    containerName: primaryComponent?.containerName ?? null,
    previewDomain: process.env.PREVIEW_DOMAIN?.trim() ?? null,
  });
}

async function getMyProposals(userId: string): Promise<ProposalWithVotes[]> {
  const proposals = await prisma.proposal.findMany({
    where: { createdById: userId, archivedAt: null },
    include: {
      _count: {
        select: { votes: true },
      },
      votes: {
        where: { userId },
        select: { userId: true },
      },
      projects: {
        orderBy: { createdAt: "desc" },
        take: 1,
        omit: { log: true, specSnapshot: true, progressJson: true },
        include: {
          budget: {
            select: {
              isEnabled: true,
              totalCreditsUsd: true,
              usedCreditsUsd: true,
            },
          },
          components: {
            where: { kind: "app" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: PRIMARY_LIFECYCLE_COMPONENT_SELECT,
          },
        },
      },
    } as any,
    orderBy: { createdAt: "desc" },
  });

  return proposals.map((proposal: any) => ({
    ...proposal,
    projects: proposal.projects.map((project: any) => ({
      ...project,
      previewUrl: getProjectPreviewUrl(project),
    })),
  })) as unknown as ProposalWithVotes[];
}

async function getMyPersonalProjects(userId: string) {
  const projects = await prisma.project.findMany({
    where: {
      mode: "personal",
      ownerScopeType: "user",
      ownerScopeId: userId,
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    omit: { log: true, specSnapshot: true, progressJson: true },
    include: {
      budget: {
        select: {
          isEnabled: true,
          totalCreditsUsd: true,
          usedCreditsUsd: true,
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

  return projects.map((project: any) => ({
    ...project,
    previewUrl: getProjectPreviewUrl(project),
  }));
}

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const userId = session.user.id;
  const [
    proposals,
    personalProjects,
    managedProjects,
    showBudget,
    userProviderCredentialsEnabled,
    managedProviderCreditsEnabled,
    userCreditBalance,
    tools,
    agentLoops,
    allProposals,
  ] = await Promise.all([
    getMyProposals(userId),
    getMyPersonalProjects(userId),
    listManagedProjectsForUser(userId),
    isBudgetVisibilityEnabled(),
    isByokProviderKeysEnabled(),
    isManagedProviderCreditsEnabled(),
    getUserCreditBalance(userId),
    (prisma as any).tool.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    (prisma as any).agentLoop.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: PROJECT_FACING_AGENT_LOOP_INCLUDE,
    }),
    prisma.proposal.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
  ]);

  // ADR-008: filter by project status, not proposal status
  const myProposed = proposals.filter((p) => !hasActiveProject(p));
  const myActive = proposals.filter((p) => hasActiveProject(p));
  const buildingCount = myActive.filter((p) =>
    p.projects?.some((proj) => isOpsActiveStatus(getOpsDisplayStatus(proj))),
  ).length;
  const deployedCount = myActive.filter((p) =>
    p.projects?.some((proj) => getOpsDisplayStatus(proj) === "LIVE"),
  ).length;

  return (
    <main className="min-h-screen bg-white pb-16">
      <section className="border-b border-gray-200 pt-24 pb-10">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
                Dashboard
              </h1>
              <p className="mt-2 text-gray-500">
                Your personal projects, proposals, and builds in Ralph Arena.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <CreateProjectButton
                tools={tools}
                agentLoops={agentLoops}
                proposals={allProposals}
                userProviderCredentialsEnabled={userProviderCredentialsEnabled}
                managedProviderCreditsEnabled={managedProviderCreditsEnabled}
                userCreditBalance={userCreditBalance}
              />
              <Link
                href="/proposals/new"
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 transition-all hover:border-black hover:text-black"
              >
                New Proposal
              </Link>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 px-4 py-4">
              <div className="mono text-xl font-bold text-black sm:text-2xl">
                {myProposed.length}
              </div>
              <div className="mt-1 text-xs text-gray-500 sm:text-sm">
                My Proposals
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 px-4 py-4">
              <div className="mono text-xl font-bold text-black sm:text-2xl">
                {buildingCount}
              </div>
              <div className="mt-1 text-xs text-gray-500 sm:text-sm">
                Building
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 px-4 py-4">
              <div className="mono text-xl font-bold text-black sm:text-2xl">
                {deployedCount}
              </div>
              <div className="mt-1 text-xs text-gray-500 sm:text-sm">Live</div>
            </div>
            <div className="rounded-xl border border-gray-200 px-4 py-4">
              <div className="mono text-xl font-bold text-black sm:text-2xl">
                {proposals.reduce((acc, p) => acc + p._count.votes, 0)}
              </div>
              <div className="mt-1 text-xs text-gray-500 sm:text-sm">
                Total Votes
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                Personal Projects
              </h2>
              <p className="mt-2 text-gray-500">
                Private runtime projects that belong to you.
              </p>
            </div>
          </div>
          {personalProjects.length === 0 ? (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 shadow-sm">
              No personal projects yet. Create one with the button above.
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {personalProjects.map((project: any) => {
                const budget = project.budget;
                return (
                  <Link
                    key={project.id}
                    href={`/my/projects/${project.id}`}
                    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-gray-900">
                          {getProjectName(project)}
                        </h3>
                        <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                          {getOpsDisplayStatus(project)}
                        </p>
                      </div>
                      {shouldShowMyDashboardLivePill(project) && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          live
                        </span>
                      )}
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-gray-500">
                      <p>
                        Agent: {project.agent}/{project.agentImpl}
                      </p>
                      <p>
                        Created{" "}
                        {new Date(project.createdAt).toLocaleDateString(
                          "en-US",
                        )}
                      </p>
                      {showBudget && budget?.isEnabled && (
                        <p>
                          Budget ${budget.usedCreditsUsd.toFixed(2)} / $
                          {budget.totalCreditsUsd.toFixed(2)}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                Managed Projects
              </h2>
              <p className="mt-2 text-gray-500">
                Projects you can operate through ownership or delegated access.
              </p>
            </div>
          </div>
          {managedProjects.length === 0 ? (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 shadow-sm">
              No delegated or community-owned projects yet.
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {managedProjects.map((project: any) => {
                const budget = project.budget;
                return (
                  <Link
                    key={project.id}
                    href={`/my/projects/${project.id}`}
                    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-gray-900">
                          {getProjectName(project)}
                        </h3>
                        <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
                          {getOpsDisplayStatus(project)}
                        </p>
                      </div>
                      {shouldShowMyDashboardLivePill(project) && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          live
                        </span>
                      )}
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-gray-500">
                      <p>
                        Agent: {project.agent}/{project.agentImpl}
                      </p>
                      <p>
                        Created{" "}
                        {new Date(project.createdAt).toLocaleDateString(
                          "en-US",
                        )}
                      </p>
                      {showBudget && budget?.isEnabled && (
                        <p>
                          Budget ${budget.usedCreditsUsd.toFixed(2)} / $
                          {budget.totalCreditsUsd.toFixed(2)}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-[1200px] px-6">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Active Builds
          </h2>
          <p className="mt-2 text-gray-500">
            Proposals being built or already live.
          </p>
          {myActive.length === 0 ? (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm p-8 text-center text-gray-500">
              No active builds yet. Submit a proposal and get it voted in!
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {myActive.map((proposal) => (
                <PreviewCard
                  key={proposal.id}
                  proposal={proposal}
                  showBudget={showBudget}
                  isAuthenticated={true}
                  userId={userId}
                  serverStage={getPreviewStage(proposal)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-[1200px] px-6">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            My Proposals
          </h2>
          <p className="mt-2 text-gray-500">
            Proposals waiting for community votes.
          </p>
          {myProposed.length === 0 ? (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm p-8 text-center text-gray-500">
              No proposals yet.{" "}
              <Link
                href="/proposals/new"
                className="text-gray-900 hover:text-emerald-600 underline"
              >
                Create your first proposal
              </Link>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {myProposed.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  isAuthenticated={true}
                  userId={userId}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-gray-200 py-8">
        <div className="mx-auto max-w-[1200px] px-6 text-center">
          <Link
            href="/settings#notifications"
            className="text-sm text-gray-500 hover:text-gray-900 underline"
          >
            Notification settings
          </Link>
        </div>
      </section>
    </main>
  );
}
