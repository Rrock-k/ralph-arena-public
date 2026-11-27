import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const OPS_COMPONENT_ROOT = fileURLToPath(new URL("./", import.meta.url));

function readOpsComponent(relativePath: string): string {
  return readFileSync(`${OPS_COMPONENT_ROOT}/${relativePath}`, "utf8");
}

describe("ProjectSidebar access panel wiring", () => {
  it("keeps Ops project access mutations on the project-scoped action path", () => {
    const contents = readOpsComponent("ProjectSidebar.tsx");

    expect(contents).toContain("projectScopedProjectId={project.id}");
  });
});
