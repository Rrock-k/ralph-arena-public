import { ImageResponse } from "next/og";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProjectDisplayStatus } from "@/components/ui/project-card/types";
import { OG_SIZE, getStatusColor, getStatusLabel } from "@/lib/og-utils";
import { PRIMARY_LIFECYCLE_COMPONENT_SELECT } from "@/lib/project-lifecycle";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { resolveProjectAccess } from "@/lib/project-access";
import { buildProjectOgCopy } from "@/lib/project-share-metadata";

export const size = OG_SIZE;
export const contentType = "image/png";
export const runtime = "nodejs";

export default async function OGImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [session, hasBypass, project] = await Promise.all([
    auth(),
    hasE2EAdminBypass(),
    (prisma as any).project.findUnique({
      where: { id },
      include: {
        proposal: { select: { title: true, description: true } },
        components: {
          where: { kind: "app" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: PRIMARY_LIFECYCLE_COMPONENT_SELECT,
        },
      },
    }),
  ]);

  if (!project) {
    return new ImageResponse(
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "#0b0f19",
          color: "#fff",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
        }}
      >
        Project not found
      </div>,
      { ...size },
    );
  }

  const access = await resolveProjectAccess(project, session, hasBypass);
  const copy = buildProjectOgCopy(project, access.canView);
  if (!copy.canShareDetails) {
    return new ImageResponse(
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "#0b0f19",
          color: "#fff",
          alignItems: "center",
          justifyContent: "center",
          gap: "18px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 48, fontWeight: 800 }}>
          {copy.title}
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#94a3b8" }}>
          {copy.description}
        </div>
      </div>,
      { ...size },
    );
  }

  const status = getProjectDisplayStatus(project) ?? "PAUSED";
  const statusColor = getStatusColor(status);
  const statusLabel = getStatusLabel(status);
  const agent = [project.agent, project.model].filter(Boolean).join(" · ");

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background:
          "linear-gradient(135deg, #0b0f19 0%, #111827 50%, #0b0f19 100%)",
        padding: "60px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Top bar: logo + status */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: "#94a3b8",
              fontWeight: 600,
            }}
          >
            Ralph Arena
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: `${statusColor}18`,
            border: `2px solid ${statusColor}50`,
            borderRadius: "9999px",
            padding: "8px 20px",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: statusColor,
            }}
          />
          <span
            style={{
              display: "flex",
              fontSize: 20,
              color: statusColor,
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Title + description */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          gap: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: copy.title.length > 40 ? 44 : 56,
            fontWeight: 800,
            color: "#f1f5f9",
            lineHeight: 1.15,
          }}
        >
          {copy.title}
        </div>

        {copy.description ? (
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: "#94a3b8",
              lineHeight: 1.4,
            }}
          >
            {copy.description}
          </div>
        ) : null}
      </div>

      {/* Footer: agent info */}
      {agent ? (
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 20, color: "#64748b" }}>
            {agent}
          </div>
        </div>
      ) : null}
    </div>,
    { ...size },
  );
}
