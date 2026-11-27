import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const BASE_URL = process.env.GOVERNANCE_PUBLIC_URL || "https://app.arena.example.test";
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [proposals, projects] = await Promise.all([
    prisma.proposal.findMany({
      where: { archivedAt: null },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      where: {
        visibility: { in: ["featured", "public"] },
        archivedAt: null,
      },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE_URL}/credits`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const proposalPages: MetadataRoute.Sitemap = proposals.map((p) => ({
    url: `${BASE_URL}/proposals/${p.id}`,
    lastModified: p.createdAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const projectPages: MetadataRoute.Sitemap = projects.map((p: { id: string; updatedAt: Date }) => ({
    url: `${BASE_URL}/projects/${p.id}`,
    lastModified: p.updatedAt,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...projectPages, ...proposalPages];
}
