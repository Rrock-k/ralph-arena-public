/**
 * RA-033: In-memory pub/sub for real-time "data changed" events.
 * Server actions and the dispatcher webhook call notifyChanged(),
 * while project-scoped runtime transitions use notifyProjectEvent().
 * Both push SSE events to connected clients.
 * Uses globalThis singleton pattern (same as prisma.ts) to survive HMR.
 */

type ProgressEvent = {
  type: string;
  at: number;
  projectId?: string;
  status?: string;
  budgetDebitedUsd?: number;
  estimatedCostUsd?: number;
  text?: string;
};
type Listener = (event: ProgressEvent) => void;
type ProjectScopedProgressEvent = Omit<ProgressEvent, "at" | "projectId">;

class ProgressBus {
  private listeners = new Set<Listener>();

  onDataChanged(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  notifyChanged(event?: Omit<ProgressEvent, "at">): void {
    const payload: ProgressEvent = {
      type: event?.type ?? "changed",
      at: Date.now(),
      ...event,
    };
    this.listeners.forEach((listener) => {
      try { listener(payload); } catch { /* ignore */ }
    });
  }
}

export function notifyProjectEvent(
  projectId: string,
  event: ProjectScopedProgressEvent,
): void {
  progressBus.notifyChanged({
    ...event,
    projectId,
  });
}

export function notifyProjectChanged(projectId: string): void {
  progressBus.notifyChanged({
    type: "changed",
    projectId,
  });
}

const globalForBus = globalThis as unknown as {
  progressBus: ProgressBus | undefined;
};

export const progressBus =
  globalForBus.progressBus ?? new ProgressBus();

if (process.env.NODE_ENV !== "production") {
  globalForBus.progressBus = progressBus;
}
