"use client";

type AddedBy = "initial" | "admin" | "community";

const styles: Record<AddedBy, string> = {
  initial: "border-slate-400/30 bg-slate-500/10 text-slate-400",
  admin: "border-cyan-400/30 bg-cyan-500/10 text-cyan-300",
  community: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
};

const labels: Record<AddedBy, string> = {
  initial: "Initial",
  admin: "Admin",
  community: "Community",
};

interface SpecBadgeProps {
  addedBy: AddedBy;
  author?: string;
}

export function SpecBadge({ addedBy, author }: SpecBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles[addedBy]}`}
      >
        {labels[addedBy]}
      </span>
      {author && addedBy === "community" && (
        <span className="text-[10px] text-slate-500">by {author}</span>
      )}
    </span>
  );
}
