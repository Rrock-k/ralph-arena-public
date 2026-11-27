import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneArenaContractBallast } from "./arena-contract.ts";

const roots: string[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "arena-runner-arena-contract-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("pruneArenaContractBallast", () => {
  it("keeps runner-owned Ralph runtime config while removing non-contract ballast", () => {
    const workspace = tempWorkspace();
    const arenaDir = join(workspace, ".arena");
    mkdirSync(arenaDir, { recursive: true });
    writeFileSync(join(arenaDir, "ralph.config.json"), JSON.stringify({ visualWorkbench: {} }));
    writeFileSync(join(arenaDir, "progress.json"), "{}");
    writeFileSync(join(arenaDir, "visual-evidence-ingest-manifest.json"), JSON.stringify({ items: [] }));
    writeFileSync(join(arenaDir, "old-debug.json"), "{}");

    expect(pruneArenaContractBallast(workspace)).toEqual(["old-debug.json"]);
    expect(readFileSync(join(arenaDir, "ralph.config.json"), "utf-8")).toContain("visualWorkbench");
    expect(readFileSync(join(arenaDir, "progress.json"), "utf-8")).toBe("{}");
    expect(readFileSync(join(arenaDir, "visual-evidence-ingest-manifest.json"), "utf-8")).toContain("items");
  });
});
