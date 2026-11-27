import { describe, expect, it } from "vitest";
import { getAdminLoopIdentity } from "./admin-loop-identity";

describe("getAdminLoopIdentity", () => {
  it("formats bundled-default rows explicitly", () => {
    expect(getAdminLoopIdentity({
      agentImpl: "ralph",
      useRepoHead: true,
      loopVersion: "1.5.0",
      loopName: "ralph",
    })).toBe("ralph Bundled default");
  });

  it("formats pinned loop rows with their resolved version", () => {
    expect(getAdminLoopIdentity({
      agentImpl: "ralph",
      useRepoHead: false,
      loopVersion: "1.4.0",
      loopName: "ralph",
    })).toBe("ralph Pinned v1.4.0");
  });

  it("falls back to agentImpl when resolved loop metadata is missing", () => {
    expect(getAdminLoopIdentity({
      agentImpl: "direct",
      useRepoHead: false,
      loopVersion: null,
      loopName: null,
    })).toBe("direct");
  });
});
