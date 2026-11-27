import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";

const ALLOWED_ARENA_ARTIFACTS = new Set([
  "assets-manifest.json",
  "auth.json",
  "events.json",
  "materialized-source.json",
  "outgoing-events.json",
  "platform.md",
  "progress.json",
  "ralph.config.json",
  "result.json",
  "spec-input.json",
  "stop-request.json",
  "visual-evidence-ingest-manifest.json",
]);

export function pruneArenaContractBallast(workspaceDir: string): string[] {
  const arenaDir = join(workspaceDir, ".arena");
  if (!existsSync(arenaDir)) return [];

  const removed: string[] = [];
  for (const entry of readdirSync(arenaDir)) {
    if (ALLOWED_ARENA_ARTIFACTS.has(entry)) continue;
    rmSync(join(arenaDir, entry), { recursive: true, force: true });
    removed.push(entry);
  }
  return removed.sort();
}
