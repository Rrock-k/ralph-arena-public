import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentPhase } from "@/lib/seasons";
import { ProposalList } from "@/components/proposals/ProposalList";
import { SuggestIdeaDialog } from "@/components/proposals/SuggestIdeaDialog";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";

function formatDeadline(date: Date | string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (diffMs < 0) return dateStr;
  if (diffHours < 1) return "< 1 hour";
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 7) return `in ${diffDays} days`;
  return dateStr;
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SeasonPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  const isAuth = !!session?.user;

  const season = await prisma.season.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      submissionStart: true,
      buildStart: true,
      buildDeadline: true,
    },
  });

  if (!season) notFound();

  const proposals = await prisma.proposal.findMany({
    where: { seasonId: id, archivedAt: null },
    include: {
      _count: { select: { votes: true } },
      votes: session?.user?.id
        ? { where: { userId: session.user.id }, select: { userId: true } }
        : false,
      season: { select: { id: true, title: true, status: true, submissionStart: true, buildStart: true, buildDeadline: true } },
      projects: {
        orderBy: { createdAt: "desc" },
        include: {
        },
      },
    } as any,
    orderBy: [{ votes: { _count: "desc" } }, { createdAt: "desc" }] as any,
  }) as unknown as ProposalWithVotes[];

  const phase = getCurrentPhase({
    status: season.status,
    submissionStart: season.submissionStart,
    buildStart: season.buildStart,
    buildDeadline: season.buildDeadline,
  });

  // In Build phase: sort winners first, then approved, then pending, then not selected
  const STATUS_ORDER: Record<string, number> = { WINNER: 0, APPROVED: 1, PENDING_REVIEW: 2, PROPOSED: 3, NOT_SELECTED: 4, REJECTED: 5 };
  if (phase === "Build") {
    proposals.sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));
  }

  const deadlineText = phase === "Open" && season.buildStart
    ? `Ideas accepted until ${formatDeadline(season.buildStart)}`
    : phase === "Build" && season.buildDeadline
      ? `Building until ${formatDeadline(season.buildDeadline)}`
      : null;

  return (
    <main className="min-h-screen bg-white">
      <section className="bg-gray-50 py-16">
        <div className="mx-auto max-w-[1200px] px-6">

          {/* Back link */}
          <Link
            href="/#proposals"
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-900"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
            </svg>
            Back to all proposals
          </Link>

          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-3">
                <h1 className="text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">
                  {season.title}
                </h1>
                {phase && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                    phase === "Open"
                      ? "text-cyan-700 border-cyan-200 bg-cyan-50"
                      : "text-amber-700 border-amber-200 bg-amber-50"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${phase === "Open" ? "bg-cyan-500" : "bg-amber-500"} animate-pulse`} />
                    {phase}
                  </span>
                )}
              </div>
              {deadlineText && (
                <p className="text-sm text-gray-500">{deadlineText}</p>
              )}
              {season.description && (
                <p className="mt-2 max-w-2xl text-base text-gray-500">{season.description}</p>
              )}
              <p className="mono mt-2 text-xs text-gray-400">
                {proposals.length} proposal{proposals.length !== 1 ? "s" : ""}
              </p>
            </div>

            {phase === "Open" && (
              <SuggestIdeaDialog isAuthenticated={isAuth}>
                <button className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-gray-800">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Suggest Idea
                </button>
              </SuggestIdeaDialog>
            )}
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-[1200px] px-6">
          {proposals.length === 0 ? (
            <p className="italic text-gray-400">
              No proposals in this season yet.{" "}
              {isAuth ? "Be the first to suggest an idea!" : "Sign in to suggest an idea."}
            </p>
          ) : (
            <ProposalList proposals={proposals} isAuthenticated={isAuth} />
          )}
        </div>
      </section>
    </main>
  );
}
