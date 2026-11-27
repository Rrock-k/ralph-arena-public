import type { Meta, StoryObj } from "@storybook/nextjs";
import { PreviewCard } from "./PreviewCard";
import {
  buildingProposal,
  deployedProposal,
  exhaustedBudgetProposal,
  failedProposal,
  highBudgetUsageProposal,
  lowBudgetProposal,
  noBudgetProposal,
  startingProposal,
} from "./mock-data";

const meta: Meta<typeof PreviewCard> = {
  title: "PreviewCard",
  component: PreviewCard,
  parameters: { layout: "centered", backgrounds: { default: "arena" } },
  decorators: [
    (Story) => (
      <div style={{ width: 380, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    isAuthenticated: true,
    userId: "user-1",
    isAdmin: false,
    showBudget: true,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = { args: { proposal: startingProposal } };
export const Building: Story = { args: { proposal: buildingProposal } };
export const Deployed: Story = { args: { proposal: deployedProposal } };
export const Failed: Story = { args: { proposal: failedProposal } };
export const NoBudget: Story = { args: { proposal: noBudgetProposal } };
export const LowUsage: Story = { args: { proposal: lowBudgetProposal } };
export const HighUsage: Story = { args: { proposal: highBudgetUsageProposal } };
export const Exhausted: Story = { args: { proposal: exhaustedBudgetProposal } };
export const BudgetHidden: Story = {
  args: { proposal: buildingProposal, showBudget: false },
};
