import type { TaskStatus } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/constants";

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`mono inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
