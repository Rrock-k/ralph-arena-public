import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { VoteButton } from "@/components/voting/VoteButton";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import { ProposalStatusBadge } from "@/components/proposals/ProposalStatusBadge";
import { getProjectDisplayStatus } from "@/components/ui/project-card/types";
import { getStatusClasses } from "@/lib/status-classes";
import { PRIMARY_LIFECYCLE_COMPONENT_SELECT } from "@/lib/project-lifecycle";

interface ProposalDetailProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({
  params,
}: ProposalDetailProps): Promise<Metadata> {
  const { id } = await params;
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { title: true, description: true },
  });
  if (!proposal) return { title: "Proposal not found" };

  const description =
    proposal.description || `Community proposal on Ralph Arena`;

  return {
    title: `${proposal.title} — Ralph Arena`,
    description,
    openGraph: {
      title: proposal.title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: proposal.title,
      description,
    },
  };
}

async function getProposal(id: string, userId?: string) {
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

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      ...baseInclude,
      season: { select: { id: true, title: true, status: true } },
      projects: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          agent: true,
          agentImpl: true,
          model: true,
          repoUrl: true,
          createdAt: true,
          components: {
            where: { kind: "app" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: PRIMARY_LIFECYCLE_COMPONENT_SELECT,
          },
        },
      },
    } as any,
  });

  if (!proposal) {
    return null;
  }

  return {
    ...proposal,
    votes: Array.isArray(proposal.votes) ? proposal.votes : [],
  } as any;
}

export default async function ProposalDetailPage({
  params,
}: ProposalDetailProps) {
  const { id } = await params;
  const session = await auth();
  const proposal = await getProposal(id, session?.user?.id);

  if (!proposal) {
    notFound();
  }

  const hasVoted = session?.user?.id
    ? proposal.votes.some(
        (v: { userId: string }) => v.userId === session.user.id,
      )
    : false;
  const voteCount = proposal._count.votes;
  const project = proposal.projects?.[0] ?? null;
  const displayStatus = getProjectDisplayStatus(project);
  const isArchived = !!proposal.archivedAt;
  const canVote = !project || displayStatus !== "LIVE";

  return (
    <main className="min-h-screen bg-gray-50 py-8 sm:py-12">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {/* Back */}
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-900"
        >
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back
        </Link>

        {/* ── Title + Meta ─────────────────────────────── */}
        <div className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {project && displayStatus ? (
              <span
                className={`mono rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getStatusClasses(displayStatus)}`}
              >
                {displayStatus}
              </span>
            ) : (
              <span className="mono rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-700">
                PROPOSED
              </span>
            )}
            {isArchived && (
              <span className="mono rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500">
                ARCHIVED
              </span>
            )}
            {proposal.season && (
              <span className="mono rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-[11px] font-semibold text-purple-700">
                {proposal.season.title}
              </span>
            )}
            {proposal.status && proposal.status !== "PROPOSED" && (
              <ProposalStatusBadge status={proposal.status} />
            )}
          </div>

          <h1 className="mb-4 text-3xl font-black tracking-tight text-gray-950 sm:text-4xl">
            {proposal.title}
          </h1>

          <div className="flex flex-wrap items-center gap-4">
            {canVote ? (
              <VoteButton
                proposalId={proposal.id}
                initialVoteCount={voteCount}
                initialHasVoted={hasVoted}
                isAuthenticated={!!session}
              />
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5">
                <div className="mono text-base font-semibold text-gray-900">
                  {voteCount}
                </div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">
                  Votes locked
                </div>
              </div>
            )}
            <span className="mono text-xs text-gray-400">
              {new Date(proposal.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>

        {/* ── Description ──────────────────────────────── */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-base leading-relaxed text-gray-600 sm:text-lg">
            {proposal.description}
          </p>
        </div>

        {/* ── Spec ─────────────────────────────────────── */}
        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3 sm:px-6">
            <svg
              className="h-4 w-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-sm font-semibold text-gray-500">
              Specification
            </span>
          </div>
          <div className="p-6">
            <MarkdownRenderer content={proposal.spec} />
          </div>
        </div>

        {/* ── Project Link ─────────────────────────────── */}
        {project && (
          <Link
            href={`/projects/${project.id}`}
            className="group mb-6 block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
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
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                </span>
                <div>
                  <div className="text-sm font-bold text-gray-900">Project</div>
                  <div className="mono text-xs text-gray-400">
                    {project.agent}/{project.agentImpl}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`mono rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getStatusClasses(displayStatus!)}`}
                >
                  {displayStatus}
                </span>
                <svg
                  className="h-4 w-4 text-gray-300 transition-colors group-hover:text-gray-900"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </div>
          </Link>
        )}
      </div>
    </main>
  );
}
