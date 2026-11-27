import type { Metadata } from "next";
import Script from "next/script";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ralph Arena Architecture Lab",
  description: "Visual architecture projections for Ralph Arena",
};

const loopkitMeta = {
  artifact_id: "agents-arena-architecture-lab",
  artifact_version: "v4",
  project_id: "agents-arena",
  title: "Ralph Arena Architecture Lab",
};

const loopkitDecisions = `DECISIONS:
- Architecture Lab is a visual projection, not a source of runtime, lifecycle, product, or operator truth.
- Stories are alternate views of the same docs/project-structure-map.md projection, not separate truth.
- Keep the network map, but prefer planes, runtime flow, or ownership views for first-read clarity.
- Spec motion is an explanatory animation of the accepted-spec path, not a new lifecycle or runtime contract.
- Important UI and graph elements keep stable semantic data-loop-id anchors.
- Feedback bundles are single-use for the current artifact_version.`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <script
          type="application/loopkit+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(loopkitMeta) }}
        />
        <script
          id="loopkit-decisions"
          type="text/plain"
          dangerouslySetInnerHTML={{ __html: loopkitDecisions }}
        />
        {children}
        <Script src="/vendor/loopkit.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
