import { describe, expect, it } from "vitest";
import { buildProjectWorkspaceLabel, getProjectName } from "./project-identity";

describe("project identity helpers", () => {
  it("prefers the immutable slug for workspace labels", () => {
    expect(buildProjectWorkspaceLabel({
      id: "proj-123456",
      name: "Renamed project title",
      slug: "canonical-label",
    })).toBe("canonical-label");
  });

  it("falls back to the display name for legacy projects without a slug", () => {
    expect(buildProjectWorkspaceLabel({
      id: "proj-123456",
      name: "Crème Brûlée",
      slug: null,
    })).toBe("creme-brulee-123456");
  });

  it("still derives a readable project name when the title is missing", () => {
    expect(getProjectName({ id: "proj-abcdef", name: "", proposalId: null })).toBe("Project abcdef");
  });
});
