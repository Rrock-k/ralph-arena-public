import type { Meta, StoryObj } from "@storybook/nextjs";
import { SpecBadge } from "./SpecBadge";
import { SpecVoteButtons } from "./SpecVoteButtons";
import { SpecProposalCard } from "./SpecProposalCard";
import { SpecWindowBanner } from "./SpecWindowBanner";
import { SubmitSpecForm } from "./SubmitSpecForm";
import { CommunitySpecsSection } from "./CommunitySpecsSection";
import { VoteBudgetPill } from "./VoteBudgetPill";
import {
  mockProposals,
  mockAcceptedProposals,
  mockSpecs,
  windowOpen,
  windowScheduled,
  windowClosed,
  windowClosedFinal,
  budgetFresh,
  budgetPartial,
  budgetExhausted,
} from "./mock-data";

// ─── SpecBadge ──────────────────────────────────────────────

const badgeMeta: Meta<typeof SpecBadge> = {
  title: "Community Specs/SpecBadge",
  component: SpecBadge,
  parameters: { layout: "centered", backgrounds: { default: "arena" } },
};
export default badgeMeta;

export const Initial: StoryObj<typeof SpecBadge> = {
  args: { addedBy: "initial" },
};
export const Admin: StoryObj<typeof SpecBadge> = {
  args: { addedBy: "admin" },
};
export const Community: StoryObj<typeof SpecBadge> = {
  args: { addedBy: "community", author: "Alice" },
};
export const CommunityNoAuthor: StoryObj<typeof SpecBadge> = {
  args: { addedBy: "community" },
};

// ─── SpecVoteButtons ────────────────────────────────────────

export const VoteNeutral: StoryObj<typeof SpecVoteButtons> = {
  render: () => <SpecVoteButtons netVotes={4} userVote={0} />,
  name: "Vote — Neutral",
};
export const VoteUpvoted: StoryObj<typeof SpecVoteButtons> = {
  render: () => <SpecVoteButtons netVotes={7} userVote={1} />,
  name: "Vote — Upvoted",
};
export const VoteDownvoted: StoryObj<typeof SpecVoteButtons> = {
  render: () => <SpecVoteButtons netVotes={-1} userVote={-1} />,
  name: "Vote — Downvoted",
};

// ─── VoteBudgetPill ─────────────────────────────────────────

export const BudgetFresh: StoryObj<typeof VoteBudgetPill> = {
  render: () => <VoteBudgetPill budget={budgetFresh} />,
  name: "Budget — 5/5 remaining",
};
export const BudgetPartial: StoryObj<typeof VoteBudgetPill> = {
  render: () => <VoteBudgetPill budget={budgetPartial} />,
  name: "Budget — 2/5 remaining",
};
export const BudgetExhausted: StoryObj<typeof VoteBudgetPill> = {
  render: () => <VoteBudgetPill budget={budgetExhausted} />,
  name: "Budget — 0/5 exhausted",
};

// ─── SpecProposalCard ───────────────────────────────────────

export const ProposalPopular: StoryObj<typeof SpecProposalCard> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SpecProposalCard proposal={mockProposals[0]} threshold={2} />
    </div>
  ),
  name: "Proposal — Popular",
};
export const ProposalNeutral: StoryObj<typeof SpecProposalCard> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SpecProposalCard proposal={mockProposals[1]} threshold={2} />
    </div>
  ),
  name: "Proposal — Neutral",
};
export const ProposalNegative: StoryObj<typeof SpecProposalCard> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SpecProposalCard proposal={mockProposals[3]} threshold={2} />
    </div>
  ),
  name: "Proposal — Negative",
};
export const ProposalRejected: StoryObj<typeof SpecProposalCard> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SpecProposalCard proposal={mockProposals[4]} threshold={2} />
    </div>
  ),
  name: "Proposal — Rejected",
};

// ─── SpecWindowBanner ───────────────────────────────────────

export const WindowOpen: StoryObj<typeof SpecWindowBanner> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SpecWindowBanner window={windowOpen} />
    </div>
  ),
  name: "Window — Open",
};
export const WindowScheduled: StoryObj<typeof SpecWindowBanner> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SpecWindowBanner window={windowScheduled} />
    </div>
  ),
  name: "Window — Scheduled",
};
export const WindowClosedRound: StoryObj<typeof SpecWindowBanner> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SpecWindowBanner window={windowClosed} />
    </div>
  ),
  name: "Window — Closed (more rounds)",
};
export const WindowClosedFinalState: StoryObj<typeof SpecWindowBanner> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SpecWindowBanner window={windowClosedFinal} />
    </div>
  ),
  name: "Window — Closed (final)",
};

// ─── SubmitSpecForm ─────────────────────────────────────────

export const FormCollapsed: StoryObj<typeof SubmitSpecForm> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SubmitSpecForm />
    </div>
  ),
  name: "Form — Collapsed",
};
export const FormDisabled: StoryObj<typeof SubmitSpecForm> = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <SubmitSpecForm disabled />
    </div>
  ),
  name: "Form — Disabled",
};
