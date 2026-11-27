import type { MetadataRoute } from "next";

const BASE_URL = process.env.GOVERNANCE_PUBLIC_URL || "https://app.arena.example.test";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/my", "/api/", "/auth/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
