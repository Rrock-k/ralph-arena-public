import chokidar, { type FSWatcher } from "chokidar";
import { getBacklogDir } from "./backlog";

type Listener = () => void;

class BacklogWatcher {
  private listeners = new Set<Listener>();
  private watcher: FSWatcher | null = null;

  start() {
    if (this.watcher) return;

    const dir = getBacklogDir();
    console.log("[BacklogWatcher] Starting watcher on:", dir);
    this.watcher = chokidar.watch(dir, { ignoreInitial: true });

    const isMd = (p: string) => p.endsWith(".md");

    this.watcher.on("ready", () => {
      console.log("[BacklogWatcher] Watcher ready");
    });
    this.watcher.on("change", (p) => {
      if (!isMd(p)) return;
      console.log("[BacklogWatcher] File changed:", p);
      this.notify();
    });
    this.watcher.on("add", (p) => {
      if (!isMd(p)) return;
      console.log("[BacklogWatcher] File added:", p);
      this.notify();
    });
    this.watcher.on("unlink", (p) => {
      if (!isMd(p)) return;
      console.log("[BacklogWatcher] File removed:", p);
      this.notify();
    });
    this.watcher.on("error", (error) => {
      console.error("[BacklogWatcher] Error:", error);
    });
  }

  private notify() {
    console.log(`[BacklogWatcher] Notifying ${this.listeners.size} listeners`);
    this.listeners.forEach((fn) => fn());
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    this.start(); // lazy init on first subscriber
    return () => {
      this.listeners.delete(fn);
    };
  }
}

// Singleton — survives HMR in Next.js dev
const g = globalThis as unknown as { __backlogWatcher?: BacklogWatcher };
if (!g.__backlogWatcher) {
  g.__backlogWatcher = new BacklogWatcher();
}

export const backlogWatcher = g.__backlogWatcher;
