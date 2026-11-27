import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MATERIALIZED_SOURCE_MANIFEST_RELATIVE_PATH,
  writeMaterializedSourceManifest,
} from "./materialized-source.ts";
import { pruneArenaContractBallast } from "./arena-contract.ts";

const roots: string[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "arena-runner-materialized-source-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("writeMaterializedSourceManifest", () => {
  it("declares runner-stamped product source, deduped and sorted", () => {
    const workspace = tempWorkspace();

    const manifest = writeMaterializedSourceManifest(workspace, ["docs/contract.md", "CLAUDE.md", "CLAUDE.md"]);

    expect(manifest).toEqual({ paths: ["CLAUDE.md", "docs/contract.md"] });
    expect(JSON.parse(readFileSync(join(workspace, MATERIALIZED_SOURCE_MANIFEST_RELATIVE_PATH), "utf-8"))).toEqual({
      paths: ["CLAUDE.md", "docs/contract.md"],
    });
  });

  it("survives .arena ballast pruning so the loop can still read the declaration", () => {
    const workspace = tempWorkspace();
    writeMaterializedSourceManifest(workspace, ["CLAUDE.md"]);

    const removed = pruneArenaContractBallast(workspace);

    expect(removed).toEqual([]);
    expect(JSON.parse(readFileSync(join(workspace, MATERIALIZED_SOURCE_MANIFEST_RELATIVE_PATH), "utf-8"))).toEqual({
      paths: ["CLAUDE.md"],
    });
  });

  it("rejects paths that are not workspace-relative product source", () => {
    const workspace = tempWorkspace();

    expect(() => writeMaterializedSourceManifest(workspace, ["/etc/passwd"])).toThrow(/workspace-relative/);
    expect(() => writeMaterializedSourceManifest(workspace, ["../outside.md"])).toThrow(/traverse upwards/);
    expect(() => writeMaterializedSourceManifest(workspace, [".arena/result.json"])).toThrow(/product source/);
    expect(() => writeMaterializedSourceManifest(workspace, [".ralph/plan.json"])).toThrow(/product source/);
    expect(() => writeMaterializedSourceManifest(workspace, [" "])).toThrow(/must not be empty/);
  });
});
