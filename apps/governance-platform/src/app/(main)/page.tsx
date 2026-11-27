import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { preloadAgentLabels } from "@/lib/agent-labels";
import { getCurrentPhase } from "@/lib/seasons";
import {
  hasActiveProject,
  getPreviewStage,
} from "@/components/ui/project-card/types";
import {
  SeasonBannerChips,
  type SeasonBannerData,
} from "@/components/seasons/SeasonBanner";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";
import Link from "next/link";
import { PreviewCard } from "@/components/ui/project-card/PreviewCard";
import { ProposalList } from "@/components/proposals/ProposalList";
import { SuggestIdeaDialog } from "@/components/proposals/SuggestIdeaDialog";
import { NewsletterSubscribe } from "@/components/newsletter/NewsletterSubscribe";
import { isBudgetVisibilityEnabled } from "@/lib/feature-flags";
import {
  getExploreVisibilityList,
  isProjectVisibleInExplore,
  sortExploreProjects,
} from "@/lib/explore-projects";
import { PRIMARY_LIFECYCLE_COMPONENT_SELECT } from "@/lib/project-lifecycle";
import { getAppComponent } from "@/lib/operator-display";
import { getPreferredPreviewUrl } from "@/lib/preview-url";

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

async function getProposals(userId?: string): Promise<ProposalWithVotes[]> {
  const proposals = await prisma.proposal.findMany({
    where: { archivedAt: null },
    include: {
      _count: { select: { votes: true } },
      votes: userId ? { where: { userId }, select: { userId: true } } : false,
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
      projects: {
        orderBy: { createdAt: "desc" },
        omit: { log: true, specSnapshot: true, progressJson: true },
        include: {
          budget: {
            select: {
              isEnabled: true,
              totalCreditsUsd: true,
              usedCreditsUsd: true,
            },
          },
          // RA-220: needed for canonical preview/status helpers in project cards
          components: {
            where: { kind: "app" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: PRIMARY_LIFECYCLE_COMPONENT_SELECT,
          },
        },
      },
    } as any,
    orderBy: [{ votes: { _count: "desc" } }, { createdAt: "desc" }] as any,
  });
  return proposals.map((proposal: any) => ({
    ...proposal,
    projects: proposal.projects.map((project: any) => ({
      ...project,
      previewUrl: getProjectPreviewUrl(project),
    })),
  })) as unknown as ProposalWithVotes[];
}

type ActiveProjectCard = {
  proposal: ProposalWithVotes;
  project: ProposalWithVotes["projects"][number];
};

async function getExploreProjects(
  isAuthenticated: boolean,
): Promise<ActiveProjectCard[]> {
  // RA-192: Query by component state instead of Project.status
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
  )
    .slice(0, 9)
    .map((project: any) => {
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

const PROPOSALS_PER_SEASON = 7;

function formatDeadline(date: Date | string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  if (diffMs < 0) return dateStr;
  if (diffHours < 1) return "< 1 hour";
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 7) return `in ${diffDays} days`;
  return dateStr;
}

interface SeasonGroup {
  seasonId: string;
  title: string;
  phase: string | null;
  deadlineText: string | null;
  proposals: ProposalWithVotes[];
}

function groupBySeasons(items: ProposalWithVotes[]): {
  seasonGroups: SeasonGroup[];
  unseasoned: ProposalWithVotes[];
} {
  const map = new Map<string, SeasonGroup>();
  const unseasoned: ProposalWithVotes[] = [];

  for (const p of items) {
    if (p.season?.id) {
      let group = map.get(p.season.id);
      if (!group) {
        const phase = getCurrentPhase({
          status: p.season.status,
          submissionStart: p.season.submissionStart,
          buildStart: p.season.buildStart,
          buildDeadline: p.season.buildDeadline,
        });
        const deadlineText =
          phase === "Open" && p.season.buildStart
            ? `ideas until ${formatDeadline(p.season.buildStart)}`
            : phase === "Build" && p.season.buildDeadline
              ? `building until ${formatDeadline(p.season.buildDeadline)}`
              : null;
        group = {
          seasonId: p.season.id,
          title: p.season.title,
          phase,
          deadlineText,
          proposals: [],
        };
        map.set(p.season.id, group);
      }
      group.proposals.push(p);
    } else {
      unseasoned.push(p);
    }
  }

  // Sort groups: Open seasons first, then Build
  const seasonGroups = Array.from(map.values()).sort((a, b) => {
    const pa = a.phase === "Open" ? 0 : a.phase === "Build" ? 1 : 2;
    const pb = b.phase === "Open" ? 0 : b.phase === "Build" ? 1 : 2;
    return pa - pb;
  });

  return { seasonGroups, unseasoned };
}

export default async function Home() {
  const session = await auth();
  const isAuth = !!session?.user;
  const [proposals, exploreCards, showBudget] = await Promise.all([
    getProposals(session?.user?.id),
    getExploreProjects(isAuth),
    isBudgetVisibilityEnabled(),
    preloadAgentLabels(),
  ]);

  const proposedItems = proposals.filter((p) => !hasActiveProject(p));

  // RA-005: Fetch all active seasons for homepage banner
  const activeSeasons: SeasonBannerData[] = await prisma.season.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      submissionStart: true,
      buildStart: true,
      buildDeadline: true,
      _count: { select: { proposals: true } },
    },
    orderBy: { submissionStart: "desc" },
  });

  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/* ================================================================ */}
      {/* HERO                                                             */}
      {/* ================================================================ */}
      <section className="pt-20 pb-16 text-center">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          {/* Badge */}
          <a
            href={exploreCards.length > 0 ? "#explore" : "#proposals"}
            className="fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-100 px-4 py-1.5 text-sm font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-200"
          >
            {exploreCards.length > 0 ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {exploreCards.length} project
                {exploreCards.length !== 1 ? "s" : ""} to explore
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                {proposals.length} idea{proposals.length !== 1 ? "s" : ""}{" "}
                proposed
              </>
            )}
          </a>

          {/* Headline */}
          <h1 className="fade-up fade-up-d1 mx-auto mb-5 text-5xl font-black leading-[1.1] tracking-tight text-gray-950 sm:text-6xl">
            Community ideas,
            <br />
            <span className="gradient-text">AI builds</span>
          </h1>

          {/* Subtitle */}
          <p className="fade-up fade-up-d2 mx-auto mb-9 max-w-xl text-lg text-gray-500 sm:text-xl">
            Propose ideas, vote on what matters, and watch AI agents build real
            applications &mdash; from spec to deployed preview.
          </p>

          {/* Actions */}
          <div className="fade-up fade-up-d3 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <SuggestIdeaDialog isAuthenticated={isAuth}>
              <button className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-7 py-3.5 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-gray-800 hover:shadow-lg">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Suggest Idea
              </button>
            </SuggestIdeaDialog>
            <a
              href={exploreCards.length > 0 ? "#explore" : "#proposals"}
              className="inline-flex items-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white px-7 py-3.5 text-base font-bold text-gray-950 transition hover:border-gray-950 hover:shadow"
            >
              Explore Projects
            </a>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* CURRENT SEASON BANNER                                            */}
      {/* ================================================================ */}
      <SeasonBannerChips seasons={activeSeasons} />

      {/* ================================================================ */}
      {/* EXPLORE                                                          */}
      {/* ================================================================ */}
      {exploreCards.length > 0 && (
        <section className="py-20" id="explore">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
            {/* Header */}
            <div className="mb-12">
              <div className="mono mb-3 text-xs font-semibold uppercase tracking-[1.5px] text-gray-400">
                {isAuth ? "Featured + public" : "Featured projects"}
              </div>
              <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">
                Explore
              </h2>
              <p className="max-w-lg text-base text-gray-500">
                {isAuth
                  ? "Featured projects are open to everyone; public projects appear after sign-in."
                  : "Featured projects with previews, built by AI agents and open for everyone."}
              </p>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {exploreCards.map(({ proposal, project }) => (
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

            <div className="mt-8 text-center">
              <a
                href="/explore"
                className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 transition-colors hover:text-gray-950"
              >
                View all projects
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </a>
            </div>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/* PIPELINE                                                         */}
      {/* ================================================================ */}
      <section className="py-20" id="pipeline">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          {/* Header */}
          <div className="mb-12 text-center">
            <div className="mono mb-3 text-xs font-semibold uppercase tracking-[1.5px] text-gray-400">
              How it works
            </div>
            <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">
              From idea to live app in 4 steps
            </h2>
            <p className="mx-auto max-w-lg text-base text-gray-500">
              The community drives what gets built. AI agents handle the
              implementation.
            </p>
          </div>

          {/* Pipeline Steps */}
          <div className="pipeline-line relative grid grid-cols-2 gap-6 sm:grid-cols-4">
            {/* Step 1 */}
            <div className="fade-up relative z-10 text-center">
              <div className="mono mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-100 text-lg font-bold text-cyan-500">
                01
              </div>
              <div className="mb-1.5 text-base font-extrabold text-gray-950">
                Idea
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                Describe the app you want built. A title, a brief description,
                and a markdown spec.
              </div>
            </div>
            {/* Step 2 */}
            <div className="fade-up fade-up-d1 relative z-10 text-center">
              <div className="mono mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-purple-100 text-lg font-bold text-purple-500">
                02
              </div>
              <div className="mb-1.5 text-base font-extrabold text-gray-950">
                Vote
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                Community votes on ideas. Top-voted ones get picked for
                building.
              </div>
            </div>
            {/* Step 3 */}
            <div className="fade-up fade-up-d2 relative z-10 text-center">
              <div className="mono mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-500">
                03
              </div>
              <div className="mb-1.5 text-base font-extrabold text-gray-950">
                Build
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                An AI agent picks up the spec and builds the app inside an
                isolated container.
              </div>
            </div>
            {/* Step 4 */}
            <div className="fade-up fade-up-d3 relative z-10 text-center">
              <div className="mono mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-pink-100 text-lg font-bold text-pink-500">
                04
              </div>
              <div className="mb-1.5 text-base font-extrabold text-gray-950">
                Refine
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                Community proposes spec additions &mdash; vote on features, then
                the agent rebuilds.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* PROPOSALS                                                        */}
      {/* ================================================================ */}
      <section className="bg-gray-50 py-20" id="proposals">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          {/* Header */}
          <div className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mono mb-3 text-xs font-semibold uppercase tracking-[1.5px] text-gray-400">
                Open Proposals
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">
                Vote on what gets built next
              </h2>
            </div>
            <SuggestIdeaDialog isAuthenticated={isAuth}>
              <button className="mb-3.5 inline-flex items-center gap-2 rounded-lg bg-gray-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-gray-800">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Suggest Idea
              </button>
            </SuggestIdeaDialog>
          </div>

          {/* Proposals grouped by season */}
          {(() => {
            if (proposedItems.length === 0) {
              return (
                <p className="italic text-gray-400">
                  No proposals yet.{" "}
                  {session
                    ? "Create the first one!"
                    : "Sign in to suggest an idea."}
                </p>
              );
            }

            const { seasonGroups, unseasoned } = groupBySeasons(proposedItems);
            const hasSeasons = seasonGroups.length > 0;

            // If no seasons — render flat list (backward-compatible)
            if (!hasSeasons) {
              return (
                <ProposalList
                  proposals={proposedItems}
                  isAuthenticated={isAuth}
                  showSeasonBadge
                />
              );
            }

            // Render grouped by season
            return (
              <div className="space-y-10">
                {seasonGroups.map((group) => {
                  const total = group.proposals.length;
                  const visible = group.proposals.slice(
                    0,
                    PROPOSALS_PER_SEASON,
                  );
                  const hasMore = total > PROPOSALS_PER_SEASON;

                  return (
                    <div
                      key={group.seasonId}
                      id={`season-${group.seasonId}`}
                      className="scroll-mt-24"
                    >
                      <div className="mb-4 flex items-center gap-3">
                        <h3 className="text-lg font-bold text-gray-950">
                          {group.title}
                        </h3>
                        {group.phase && (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                              group.phase === "Open"
                                ? "text-cyan-700 border-cyan-200 bg-cyan-50"
                                : "text-amber-700 border-amber-200 bg-amber-50"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${group.phase === "Open" ? "bg-cyan-500" : "bg-amber-500"} animate-pulse`}
                            />
                            {group.phase}
                          </span>
                        )}
                        {group.deadlineText && (
                          <span className="text-sm text-gray-400">
                            {group.deadlineText}
                          </span>
                        )}
                        <span className="mono text-xs text-gray-400">
                          {total} proposal{total !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <ProposalList
                        proposals={visible}
                        isAuthenticated={isAuth}
                      />
                      {hasMore && (
                        <div className="mt-3 text-center">
                          <Link
                            href={`/seasons/${group.seasonId}`}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 transition-colors hover:text-gray-900"
                          >
                            View all {total} ideas
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5 12h14" />
                              <path d="m12 5 7 7-7 7" />
                            </svg>
                          </Link>
                        </div>
                      )}
                    </div>
                  );
                })}

                {unseasoned.length > 0 && (
                  <div>
                    <div className="mb-4">
                      <h3 className="text-lg font-bold text-gray-950">
                        Other proposals
                      </h3>
                    </div>
                    <ProposalList
                      proposals={unseasoned}
                      isAuthenticated={isAuth}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </section>

      {/* ================================================================ */}
      {/* FEATURES GRID                                                    */}
      {/* ================================================================ */}
      <section className="py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          {/* Header */}
          <div className="mb-12 text-center">
            <div className="mono mb-3 text-xs font-semibold uppercase tracking-[1.5px] text-gray-400">
              Platform
            </div>
            <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">
              Everything you need to ship
            </h2>
            <p className="mx-auto max-w-lg text-base text-gray-500">
              From proposal to deployed app &mdash; the full pipeline is
              automated.
            </p>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-8 transition hover:border-gray-300 hover:shadow">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-emerald-100 text-xl">
                &#9997;&#65039;
              </div>
              <div className="mb-2 text-base font-extrabold text-gray-950">
                Markdown Specs
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                Write your app spec in Markdown. Describe features, UI, tech
                stack &mdash; agents interpret it all.
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-8 transition hover:border-gray-300 hover:shadow">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-cyan-100 text-xl">
                &#11014;&#65039;
              </div>
              <div className="mb-2 text-base font-extrabold text-gray-950">
                Community Voting
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                One vote per user per proposal. The community decides what gets
                priority.
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-8 transition hover:border-gray-300 hover:shadow">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-purple-100 text-xl">
                &#129302;
              </div>
              <div className="mb-2 text-base font-extrabold text-gray-950">
                Multi-Agent Support
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                Choose between Claude Code, Codex, or bring your own agent. Each
                has different strengths.
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-8 transition hover:border-gray-300 hover:shadow">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-amber-100 text-xl">
                &#128274;
              </div>
              <div className="mb-2 text-base font-extrabold text-gray-950">
                Sandboxed Execution
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                Each build runs in an isolated Docker container. No Docker
                socket, no published ports.
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-8 transition hover:border-gray-300 hover:shadow">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-rose-100 text-xl">
                &#128260;
              </div>
              <div className="mb-2 text-base font-extrabold text-gray-950">
                Auto-Recovery
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                Stuck detection, git revert on failures, automatic task
                decomposition when things go wrong.
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-8 transition hover:border-gray-300 hover:shadow">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-blue-100 text-xl">
                &#127760;
              </div>
              <div className="mb-2 text-base font-extrabold text-gray-950">
                Instant Preview
              </div>
              <div className="text-sm leading-relaxed text-gray-500">
                Every build gets a unique preview URL via Caddy. See the result
                as soon as it deploys.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* AGENTS COMPARISON                                                */}
      {/* ================================================================ */}
      <section className="bg-gray-50 py-20" id="agents">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          {/* Header */}
          <div className="mb-12 text-center">
            <div className="mono mb-3 text-xs font-semibold uppercase tracking-[1.5px] text-gray-400">
              Choose your agent
            </div>
            <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">
              Two engines, one pipeline
            </h2>
            <p className="mx-auto max-w-lg text-base text-gray-500">
              Pick the right agent for the job. Both integrate with the same
              build and verification system.
            </p>
          </div>

          {/* Agent Cards */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Claude Code */}
            <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-8">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-emerald-500 to-cyan-500" />
              <div className="mb-1 text-xl font-extrabold text-gray-950">
                Claude Code
              </div>
              <div className="mono mb-4 text-xs text-gray-400">
                @anthropic-ai/claude-code
              </div>
              <p className="mb-5 text-sm leading-relaxed text-gray-500">
                Anthropic&apos;s coding agent with deep reasoning capabilities.
                Excels at complex full-stack development, debugging tricky
                issues, and understanding nuanced specifications.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  Complex reasoning
                </span>
                <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  Full-stack
                </span>
                <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  Debugging
                </span>
                <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  Opus 4.6 / Sonnet 4.5
                </span>
              </div>
            </div>

            {/* Codex */}
            <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-8">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-purple-500 to-blue-500" />
              <div className="mb-1 text-xl font-extrabold text-gray-950">
                Codex
              </div>
              <div className="mono mb-4 text-xs text-gray-400">
                @openai/codex
              </div>
              <p className="mb-5 text-sm leading-relaxed text-gray-500">
                OpenAI&apos;s code generation engine. Strong at boilerplate
                generation, pattern-following tasks, and providing alternative
                implementation approaches.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  Fast generation
                </span>
                <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  Code patterns
                </span>
                <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  Second opinions
                </span>
                <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500">
                  GPT-5.3
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* CTA SECTION                                                      */}
      {/* ================================================================ */}
      <section className="bg-gray-950 px-4 py-24 text-center text-white sm:px-6 sm:py-28">
        <h2 className="mb-4 text-3xl font-black tracking-tight sm:text-[40px]">
          Ready to build something?
        </h2>
        <p className="mx-auto mb-8 max-w-md text-lg text-gray-400">
          Suggest an idea and let the community decide. If it wins &mdash; an AI
          agent will build it.
        </p>
        <SuggestIdeaDialog isAuthenticated={isAuth}>
          <button className="inline-flex items-center rounded-xl bg-white px-8 py-3.5 text-base font-bold text-gray-950 transition hover:-translate-y-0.5 hover:bg-gray-200 hover:shadow-[0_8px_24px_rgba(255,255,255,0.1)]">
            Suggest Your First Idea
          </button>
        </SuggestIdeaDialog>

        <div className="mx-auto mt-16 max-w-lg">
          <p className="mb-4 text-sm font-medium text-gray-400">
            Or subscribe for updates — new projects, features, community
            highlights.
          </p>
          <NewsletterSubscribe source="landing" />
        </div>
      </section>
    </main>
  );
}
