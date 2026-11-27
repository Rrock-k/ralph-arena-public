import type { Priority } from "@/lib/types";
import { PRIORITY_COLORS } from "@/lib/constants";

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`mono inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_COLORS[priority]}`}>
      {priority}
    </span>
  );
}
