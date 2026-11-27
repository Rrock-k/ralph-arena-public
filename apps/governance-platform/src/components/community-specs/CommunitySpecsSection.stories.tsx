import type { Meta, StoryObj } from "@storybook/nextjs";
import { CommunitySpecsSection } from "./CommunitySpecsSection";
import {
  mockProposals,
  mockAcceptedProposals,
  mockSpecs,
  windowOpen,
  windowScheduled,
  windowClosed,
  windowClosedFinal,
  budgetPartial,
  budgetExhausted,
} from "./mock-data";

const meta: Meta<typeof CommunitySpecsSection> = {
  title: "Community Specs/Full Section",
  component: CommunitySpecsSection,
  parameters: { layout: "padded", backgrounds: { default: "arena" } },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Window is open, proposals are being voted on, submit form is available.
 * User has 2 of 5 votes remaining.
 */
export const WindowOpenWithProposals: Story = {
  args: {
    specs: mockSpecs,
    proposals: mockProposals,
    window: windowOpen,
    voteBudget: budgetPartial,
    isAuthenticated: true,
  },
};

/**
 * User has used all 5 votes today — can't cast new votes, but can remove existing.
 */
export const BudgetExhaustedState: Story = {
  args: {
    specs: mockSpecs,
    proposals: mockProposals,
    window: windowOpen,
    voteBudget: budgetExhausted,
    isAuthenticated: true,
  },
  name: "Budget Exhausted",
};

/**
 * Window is scheduled to open. Users see a countdown but can't submit yet.
 */
export const WindowScheduledState: Story = {
  args: {
    specs: mockSpecs.filter((s) => s.addedBy !== "community"),
    proposals: [],
    window: windowScheduled,
    isAuthenticated: true,
  },
  name: "Scheduled (no proposals yet)",
};

/**
 * After a round closes: accepted proposals became specs, window closed.
 * More rounds are available.
 */
export const AfterRoundClosed: Story = {
  args: {
    specs: mockSpecs,
    proposals: [...mockAcceptedProposals, mockProposals[4]],
    window: windowClosed,
    isAuthenticated: true,
  },
  name: "After Round (accepted + rejected)",
};

/**
 * All rounds finished. Final state showing accepted community specs.
 */
export const AllRoundsComplete: Story = {
  args: {
    specs: mockSpecs,
    proposals: mockAcceptedProposals,
    window: windowClosedFinal,
    isAuthenticated: true,
  },
};

/**
 * Not logged in — voting and submit disabled, no budget shown.
 */
export const UnauthenticatedUser: Story = {
  args: {
    specs: mockSpecs,
    proposals: mockProposals,
    window: windowOpen,
    isAuthenticated: false,
  },
  name: "Unauthenticated",
};

/**
 * Empty state — no community spec activity yet, window closed.
 */
export const EmptyState: Story = {
  args: {
    specs: mockSpecs.filter((s) => s.addedBy !== "community"),
    proposals: [],
    window: { ...windowClosed, currentRound: 0 },
    isAuthenticated: true,
  },
  name: "Empty (no activity)",
};
