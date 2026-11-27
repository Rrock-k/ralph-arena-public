import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { OG_SIZE, getStatusColor, getStatusLabel } from "@/lib/og-utils";

export const size = OG_SIZE;
export const contentType = "image/png";
export const runtime = "nodejs";

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: {
      title: true,
      description: true,
      status: true,
      _count: { select: { votes: true } },
    },
  });

  if (!proposal) {
    return new ImageResponse(
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#0b0f19", color: "#fff", alignItems: "center", justifyContent: "center", fontSize: 48 }}>
        Proposal not found
      </div>,
      { ...size },
    );
  }

  const status = proposal.status;
  const statusColor = getStatusColor(status);
  const statusLabel = getStatusLabel(status);
  const votes = proposal._count.votes;
  const title = proposal.title.length > 80 ? proposal.title.slice(0, 77) + "..." : proposal.title;
  const desc = proposal.description
    ? proposal.description.length > 150
      ? proposal.description.slice(0, 147) + "..."
      : proposal.description
    : null;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg, #0b0f19 0%, #111827 50%, #0b0f19 100%)",
        padding: "60px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", fontSize: 28, color: "#94a3b8", fontWeight: 600 }}>
            Ralph Arena
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#475569" }}>
            Proposal
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
          <div style={{ display: "flex", width: 10, height: 10, borderRadius: "50%", background: statusColor }} />
          <span style={{ display: "flex", fontSize: 20, color: statusColor, fontWeight: 700, letterSpacing: "0.05em" }}>
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
            fontSize: proposal.title.length > 40 ? 44 : 56,
            fontWeight: 800,
            color: "#f1f5f9",
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>

        {desc ? (
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: "#94a3b8",
              lineHeight: 1.4,
            }}
          >
            {desc}
          </div>
        ) : null}
      </div>

      {/* Footer: votes */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 22, color: "#64748b" }}>
          {votes} {votes === 1 ? "vote" : "votes"}
        </div>
      </div>
    </div>,
    { ...size },
  );
}
