export const CREDIT_PLANS: Record<
  string,
  { credits: number; title: string; priceUsd: number }
> = {
  "45019": { credits: 5, title: "Starter", priceUsd: 4.99 },
  "45020": { credits: 25, title: "Builder", priceUsd: 19.99 },
  "45021": { credits: 70, title: "Pro", priceUsd: 49.99 },
  "45022": { credits: 150, title: "Team", priceUsd: 99.99 },
};

export function creditsForPlan(planId: string) {
  return CREDIT_PLANS[planId] ?? null;
}
