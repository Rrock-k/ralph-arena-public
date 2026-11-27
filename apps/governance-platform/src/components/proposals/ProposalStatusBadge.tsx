const STATUS_STYLES: Record<string, string> = {
  WINNER: "border-emerald-200 bg-emerald-50 text-emerald-700",
  NOT_SELECTED: "border-gray-200 bg-gray-50 text-gray-500",
  PENDING_REVIEW: "border-amber-200 bg-amber-50 text-amber-700",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-700",
};

const STATUS_LABELS: Record<string, string> = {
  WINNER: "Winner",
  NOT_SELECTED: "Not selected",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export function ProposalStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status];
  if (!style) return null;
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${style}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
