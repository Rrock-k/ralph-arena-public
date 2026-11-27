import type { Meta, StoryObj } from "@storybook/nextjs";
import { ProposalCardOld } from "./ProposalCardOld";
import type { ProposalWithVotes } from "./ProposalCardOld";

const baseProposal: ProposalWithVotes = {
  id: "demo-1",
  title: "AI-Powered Task Manager",
  description:
    "A smart task manager that uses AI to automatically prioritize, categorize, and suggest deadlines for your tasks. Built with React and a lightweight ML model.",
  status: "PROPOSED",
  createdAt: new Date("2025-01-15"),
  archivedAt: null,
  projects: [],
  _count: { votes: 12 },
  votes: [],
};

const meta: Meta<typeof ProposalCardOld> = {
  title: "Old/ProposalCardOld",
  component: ProposalCardOld,
  parameters: {
    layout: "centered",
    backgrounds: { default: "arena" },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    isAuthenticated: true,
    userId: "user-1",
    isAdmin: false,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Proposed: Story = {
  args: { proposal: baseProposal },
};

export const Deployed: Story = {
  args: {
    proposal: {
      ...baseProposal,
      id: "demo-4",
      title: "Real-Time Crypto Dashboard",
      _count: { votes: 42 },
      projects: [
        {
          id: "proj-3",
          components: [{ powerIntent: "ON", runtimeState: "RUNNING", agentState: "IDLE", blockers: [], lastOutcome: "COMPLETED" }],
          agent: "codex",
          agentImpl: "direct",
          model: null,
          repoUrl: "https://github.com/ralph-arena/crypto-dashboard",
          repoBranch: "main",
          previewUrl: "https://preview-demo.arena.example.test",
          createdAt: new Date("2025-01-10"),
        },
      ],
    },
  },
};
