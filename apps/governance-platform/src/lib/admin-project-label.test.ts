import { describe, expect, it } from "vitest";
import { getAdminProjectIdentitySuffix, getAdminProjectLabel } from "./admin-project-label";

describe("admin project label helpers", () => {
  it("uses the immutable slug suffix when available", () => {
    expect(getAdminProjectIdentitySuffix({
      id: "proj-123456",
      name: "Ant Dream",
      slug: "ant-dream-hea20y",
    })).toBe("hea20y");
  });

  it("falls back to the last 6 chars of the project id when slug is missing", () => {
    expect(getAdminProjectLabel({
      id: "cmmuax7b3000449php4705v2t",
      name: "Catan",
      slug: null,
    })).toBe("Catan · 705v2t");
  });

  it("still derives the display name when the title is missing", () => {
    expect(getAdminProjectLabel({
      id: "proj-abcdef",
      name: "",
      slug: "project-alpha-abcdef",
      proposalId: null,
    })).toBe("Project abcdef · abcdef");
  });
});
