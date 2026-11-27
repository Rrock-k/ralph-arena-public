import type { Meta, StoryObj } from "@storybook/nextjs";
import {
  TokenBar,
  TokenBarLabeled,
  TokenPill,
  TokenRing,
  TokenTerminal,
  TokenGauge,
} from "./TokenUsage";

/* ── Wrapper to show all variants side by side ── */
function AllVariants({ used, total }: { used: number; total: number }) {
  return (
    <div className="flex flex-col gap-6 w-[340px]">
      <div>
        <p className="mono text-[9px] text-slate-600 uppercase tracking-wider mb-2">1 — Thin Bar</p>
        <TokenBar used={used} total={total} />
      </div>
      <div>
        <p className="mono text-[9px] text-slate-600 uppercase tracking-wider mb-2">2 — Labeled Bar</p>
        <TokenBarLabeled used={used} total={total} />
      </div>
      <div>
        <p className="mono text-[9px] text-slate-600 uppercase tracking-wider mb-2">3 — Pill</p>
        <TokenPill used={used} total={total} />
      </div>
      <div>
        <p className="mono text-[9px] text-slate-600 uppercase tracking-wider mb-2">4 — Ring</p>
        <TokenRing used={used} total={total} />
      </div>
      <div>
        <p className="mono text-[9px] text-slate-600 uppercase tracking-wider mb-2">5 — Terminal Counter</p>
        <TokenTerminal used={used} total={total} />
      </div>
      <div>
        <p className="mono text-[9px] text-slate-600 uppercase tracking-wider mb-2">6 — Segmented Gauge</p>
        <TokenGauge used={used} total={total} />
      </div>
    </div>
  );
}

const meta: Meta<typeof AllVariants> = {
  title: "Token Usage",
  component: AllVariants,
  parameters: { layout: "centered", backgrounds: { default: "arena" } },
  args: { used: 12_400, total: 50_000 },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Low: Story = {
  args: { used: 8_200, total: 50_000 },
};

export const Medium: Story = {
  args: { used: 35_000, total: 50_000 },
};

export const High: Story = {
  args: { used: 47_500, total: 50_000 },
};

export const Exhausted: Story = {
  args: { used: 50_000, total: 50_000 },
};

export const LargeScale: Story = {
  args: { used: 1_240_000, total: 2_000_000 },
};
