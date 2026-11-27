import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PreviewCard } from "@/components/ui/project-card/PreviewCard";
import { getPreviewStage } from "@/components/ui/project-card/types";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";
import { isBudgetVisibilityEnabled } from "@/lib/feature-flags";
import {
  getExploreVisibilityList,
  isProjectVisibleInExplore,
  sortExploreProjects,
} from "@/lib/explore-projects";
import { PRIMARY_LIFECYCLE_COMPONENT_SELECT } from "@/lib/project-lifecycle";
import { getAppComponent } from "@/lib/operator-display";
import { getPreferredPreviewUrl } from "@/lib/preview-url";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore — Ralph Arena",
  description:
    "Browse AI-built projects. Each one started as a community idea and was implemented by autonomous agents.",
};

type ActiveProjectCard = {
  proposal: ProposalWithVotes;
  project: ProposalWithVotes["projects"][number];
};

const PAGE_SIZE = 9;

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

async function getExploreProjects(
  isAuthenticated: boolean,
): Promise<ActiveProjectCard[]> {
  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      visibility: { in: [...getExploreVisibilityList(isAuthenticated)] },
    },
    omit: { log: true, specSnapshot: true, progressJson: true },
    include: {
      budget: {
        select: {
          isEnabled: true,
          totalCreditsUsd: true,
          usedCreditsUsd: true,
        },
      },
      proposal: {
        include: {
          _count: { select: { votes: true } },
          votes: false,
          season: {
            select: {
              id: true,
              title: true,
              status: true,
              submissionStart: true,
              buildStart: true,
              buildDeadline: true,
            },
          },
        },
      },
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: PRIMARY_LIFECYCLE_COMPONENT_SELECT,
      },
    } as any,
    orderBy: { createdAt: "desc" },
  });

  return sortExploreProjects(
    projects.filter((project) =>
      isProjectVisibleInExplore(project, { isAuthenticated }),
    ),
  ).map((project: any) => {
    const previewUrl = getProjectPreviewUrl(project);
    const normalizedProject = {
      ...project,
      previewUrl,
    };
    const proposal = normalizedProject.proposal
      ? { ...normalizedProject.proposal, projects: [normalizedProject] }
      : {
          id: normalizedProject.id,
          title: normalizedProject.name || normalizedProject.id,
          description: null,
          season: null,
          _count: { votes: 0 },
          votes: [],
          projects: [normalizedProject],
        };
    return {
      proposal: proposal as ProposalWithVotes,
      project: normalizedProject,
    } as ActiveProjectCard;
  });
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const isAuth = !!session?.user;
  const params = await searchParams;
  const page = Math.max(
    1,
    parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1,
  );

  const [allCards, showBudget] = await Promise.all([
    getExploreProjects(isAuth),
    isBudgetVisibilityEnabled(),
  ]);

  const totalPages = Math.ceil(allCards.length / PAGE_SIZE);
  const pageCards = allCards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <section className="py-16">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="mb-10">
            <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">
              Explore
            </h1>
            <p className="max-w-lg text-base text-gray-500">
              Projects built by AI agents from community ideas. Each one has a
              live preview you can interact with.
            </p>
          </div>

          {allCards.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-gray-500">
              No deployed projects yet. Be the first to suggest an idea!
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {pageCards.map(({ proposal, project }) => (
                  <PreviewCard
                    key={project.id}
                    proposal={proposal}
                    project={project}
                    showBudget={showBudget}
                    isAuthenticated={isAuth}
                    userId={session?.user?.id}
                    serverStage={getPreviewStage(proposal, project)}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="mt-10 flex items-center justify-center gap-2">
                  {page > 1 && (
                    <Link
                      href={`/explore?page=${page - 1}`}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-950"
                    >
                      ← Previous
                    </Link>
                  )}

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (p) => (
                      <Link
                        key={p}
                        href={`/explore?page=${p}`}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                          p === page
                            ? "bg-gray-950 text-white"
                            : "border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-950"
                        }`}
                      >
                        {p}
                      </Link>
                    ),
                  )}

                  {page < totalPages && (
                    <Link
                      href={`/explore?page=${page + 1}`}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-950"
                    >
                      Next →
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
