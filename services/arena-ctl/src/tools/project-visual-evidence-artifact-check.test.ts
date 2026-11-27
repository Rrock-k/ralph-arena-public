import assert from "node:assert/strict";
import test from "node:test";
import { registerProjectVisualEvidenceArtifactCheckTool } from "./project-visual-evidence-artifact-check.js";

test("registerProjectVisualEvidenceArtifactCheckTool exposes sanitized governance artifact checks", async () => {
  const registered = new Map<string, {
    config: unknown;
    handler: (input: { projectId: string }) => Promise<unknown>;
  }>();
  const server = {
    registerTool(name: string, config: unknown, handler: (input: { projectId: string }) => Promise<unknown>) {
      registered.set(name, { config, handler });
    },
  };
  const ctx = {
    governance: {
      getProjectVisualEvidenceArtifactCheck: async (projectId: string) => ({
        project: { id: projectId },
        artifactCheck: {
          status: "available",
          reviewCount: 1,
          downloadableCount: 1,
          notDownloadableCount: 0,
        },
      }),
    },
  };

  registerProjectVisualEvidenceArtifactCheckTool(server as any, ctx as any);

  const tool = registered.get("project_visual_evidence_artifact_check");
  assert.ok(tool);
  assert.match(JSON.stringify(tool.config), /without raw bytes/);
  const result = await tool.handler({ projectId: "project-1" }) as {
    content: Array<{ text: string }>;
  };
  assert.deepEqual(JSON.parse(result.content[0].text), {
    project: { id: "project-1" },
    artifactCheck: {
      status: "available",
      reviewCount: 1,
      downloadableCount: 1,
      notDownloadableCount: 0,
    },
  });
});
