"use client";

export function Marquee({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ overflow: "hidden", whiteSpace: "nowrap", width: "100%" }}>
      <div
        style={{
          display: "inline-block",
          animation: "brutalist-marquee 25s linear infinite",
          whiteSpace: "nowrap",
        }}
      >
        {children}
        <span style={{ display: "inline-block", width: 80 }} />
        {children}
      </div>
      <style>{`
        @keyframes brutalist-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
