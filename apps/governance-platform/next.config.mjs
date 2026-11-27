import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "app.arena.example.test",
    "*.arena.example.test",
  ],
  // Monorepo root — multiple package-lock.json confuse Turbopack auto-detection.
  // Must point to monorepo root so @arena/contracts (../../packages/contracts) resolves.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  experimental: {
    staleTimes: {
      dynamic: 30,   // client-side router cache: 30s for dynamic pages
      static: 300,   // client-side router cache: 5min for static pages
    },
  },
  async redirects() {
    return [
      // RA-226: Navigation restructure — permanent redirects from old URLs
      { source: "/dashboard/admin/ops", destination: "/admin", permanent: true },
      { source: "/dashboard/admin/logs", destination: "/admin/logs", permanent: true },
      { source: "/dashboard/admin/projects/:id", destination: "/admin/projects/:id", permanent: true },
      { source: "/dashboard/admin", destination: "/admin", permanent: true },
      { source: "/dashboard/projects/:id", destination: "/my/projects/:id", permanent: true },
      { source: "/dashboard", destination: "/my", permanent: true },
    ];
  },
  async headers() {
    const headers = [
      {
        // public assets (images, fonts, etc.) — long cache
        source: "/images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];

    if (isProduction) {
      headers.push({
        // Dev mode rotates chunk/server-action ids across restarts, so immutable
        // caching here causes stale client bundles after reboot/redeploy.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      });
    }

    return headers;
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: process.env.SENTRY_ORG,

  project: process.env.SENTRY_PROJECT,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
