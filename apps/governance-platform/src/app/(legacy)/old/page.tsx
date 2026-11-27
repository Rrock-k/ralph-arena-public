import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProposalCardDark as ProposalCard } from "@/components/legacy/ProposalCardDark";
import { PreviewCardDark as PreviewCard } from "@/components/legacy/PreviewCardDark";
import { hasActiveProject } from "@/components/ui/project-card/types";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";
import Link from "next/link";

async function getProposals(userId?: string, showArchived = false): Promise<ProposalWithVotes[]> {
  const baseInclude = {
    _count: {
      select: { votes: true },
    },
    votes: userId
      ? {
          where: { userId },
          select: { userId: true },
        }
      : false,
  };

  const baseOrderBy = [
    {
      votes: {
        _count: "desc",
      },
    },
    {
      createdAt: "desc",
    },
  ];

  const where = showArchived ? {} : { archivedAt: null };

  const proposals = await prisma.proposal.findMany({
    where,
    include: {
      ...baseInclude,
      projects: {
        orderBy: { createdAt: "desc" },
        include: {
        },
      },
    } as any,
    orderBy: baseOrderBy as any,
  });

  return proposals as unknown as ProposalWithVotes[];
}

export default async function OldHome() {
  const session = await auth();
  const proposals = await getProposals(session?.user?.id);

  // ADR-008: filter by project status, not proposal status
  const proposedItems = proposals.filter((p) => !hasActiveProject(p));

  // Flatten: one card per project (a proposal can spawn multiple projects)
  const activeProjectCards = proposals.flatMap((p) =>
    (p.projects ?? []).map((proj) => ({ proposal: p, project: proj }))
  );

  const totalVotes = proposals.reduce((acc, p) => acc + p._count.votes, 0);
  const buildingCount = activeProjectCards.filter((c) => !c.project.components?.[0]?.lastOutcome && c.project.components?.[0]?.powerIntent === "ON").length;
  const deployedCount = activeProjectCards.filter((c) => c.project.components?.[0]?.lastOutcome === "COMPLETED").length;

  return (
    <main className="min-h-screen pb-16">
      <section className="hero-bg relative overflow-hidden border-b border-white/10 pt-20">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0b0f19]/80" />
        <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 lg:px-8 lg:pt-14">
          <div className="mx-auto max-w-4xl text-center">
            <div className="reveal inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 badge-pulse" />
              <span className="text-sm text-slate-300">Community-Driven AI Development</span>
            </div>

            <h1 className="reveal reveal-delay-1 mt-8 text-4xl font-black tracking-tight text-slate-100 sm:text-6xl lg:text-7xl">
              Ralph
              <span className="gradient-text mt-2 block">Arena</span>
            </h1>
            <p className="reveal reveal-delay-2 mx-auto mt-6 max-w-2xl text-base text-slate-300 sm:text-lg">
              Propose ideas, vote on the best proposals, and watch autonomous AI agents build them live in a
              transparent public pipeline.
            </p>

            <div className="reveal reveal-delay-3 mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="#proposals"
                className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-7 py-3 text-center text-base font-bold text-black transition-all hover:shadow-lg hover:shadow-emerald-500/30 sm:w-auto"
              >
                Explore Proposals
              </a>
              <a
                href="#active"
                className="w-full rounded-xl border border-white/15 bg-white/[0.03] px-7 py-3 text-center text-base font-semibold text-slate-100 transition-all hover:bg-white/[0.08] sm:w-auto"
              >
                Watch Active Arena
              </a>
              {session && (
                <Link
                  href="/proposals/new"
                  className="w-full rounded-xl border border-purple-400/30 bg-purple-500/10 px-7 py-3 text-center text-base font-semibold text-purple-200 transition-all hover:bg-purple-500/20 sm:w-auto"
                >
                  New Proposal
                </Link>
              )}
            </div>

            <div className="reveal reveal-delay-4 mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="glow-card rounded-xl px-4 py-4">
                <div className="mono text-xl font-bold text-emerald-300 sm:text-2xl">{proposals.length}</div>
                <div className="mt-1 text-xs text-slate-400 sm:text-sm">Proposals</div>
              </div>
              <div className="glow-card rounded-xl px-4 py-4">
                <div className="mono text-xl font-bold text-cyan-300 sm:text-2xl">{totalVotes}</div>
                <div className="mt-1 text-xs text-slate-400 sm:text-sm">Votes Cast</div>
              </div>
              <div className="glow-card rounded-xl px-4 py-4">
                <div className="mono text-xl font-bold text-amber-300 sm:text-2xl">
                  {buildingCount}
                </div>
                <div className="mt-1 text-xs text-slate-400 sm:text-sm">Building</div>
              </div>
              <div className="glow-card rounded-xl px-4 py-4">
                <div className="mono text-xl font-bold text-purple-300 sm:text-2xl">
                  {deployedCount}
                </div>
                <div className="mt-1 text-xs text-slate-400 sm:text-sm">Live</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="stages" className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="reveal text-3xl font-bold text-slate-100 sm:text-4xl">The Pipeline</h2>
            <p className="reveal reveal-delay-1 mx-auto mt-3 max-w-2xl text-slate-400">
              Proposal lifecycle stays community-governed from idea to shipping.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                number: "01",
                title: "Submit",
                description: "Community members submit ideas with scope and technical constraints.",
                color: "text-emerald-300 border-emerald-400/20 bg-emerald-500/10",
              },
              {
                number: "02",
                title: "Vote",
                description: "Token holders rank proposals to determine execution priority.",
                color: "text-cyan-300 border-cyan-400/20 bg-cyan-500/10",
              },
              {
                number: "03",
                title: "Build",
                description: "Selected proposals move into autonomous implementation.",
                color: "text-purple-300 border-purple-400/20 bg-purple-500/10",
              },
              {
                number: "04",
                title: "Ship",
                description: "Finished builds go live with preview links and transparent build history.",
                color: "text-amber-300 border-amber-400/20 bg-amber-500/10",
              },
            ].map((stage, index) => (
              <div
                key={stage.number}
                className={`glow-card reveal rounded-2xl p-6 ${index === 1 ? "pulse-active" : ""} reveal-delay-${Math.min(
                  index + 1,
                  4
                )}`}
              >
                <div className={`inline-flex rounded-lg border px-3 py-1.5 mono text-xs font-bold ${stage.color}`}>
                  {stage.number}
                </div>
                <h3 className="mt-4 text-xl font-bold text-slate-100">{stage.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{stage.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="active" className="py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-100 sm:text-3xl">Active Builds</h2>
              <p className="mt-2 text-slate-400">Proposals currently being built or already live in the arena.</p>
            </div>
          </div>
          {activeProjectCards.length === 0 ? (
            <div className="glow-card mt-6 rounded-2xl p-8 text-center text-slate-400">
              No active builds yet. Launch the first one through community voting.
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {activeProjectCards.map(({ proposal, project }) => (
                <PreviewCard
                  key={project.id}
                  proposal={proposal}
                  project={project}
                  isAuthenticated={!!session}
                  userId={session?.user?.id}
                  isAdmin={false}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="proposals" className="py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-slate-100 sm:text-3xl">Proposals</h2>
          <p className="mt-2 text-slate-400">Vote for what agents should build next.</p>
          {proposedItems.length === 0 ? (
            <div className="glow-card mt-6 rounded-2xl p-8 text-center text-slate-400">
              No proposals yet. {session ? "Create the first one!" : "Sign in to create a proposal."}
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {proposedItems.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  isAuthenticated={!!session}
                  userId={session?.user?.id}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
