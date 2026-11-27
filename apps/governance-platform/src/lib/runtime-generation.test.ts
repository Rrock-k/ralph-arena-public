import { describe, expect, it } from "vitest";
import {
  buildRuntimeGeneration,
  getActionableRuntimeGenerationReasons,
  hasActionableRuntimeGenerationDrift,
} from "./runtime-generation";

describe("buildRuntimeGeneration", () => {
  it("marks stale project runtime runner version as actionable mismatch", () => {
    const parity = buildRuntimeGeneration({
      workerMeta: {
        runner: { gitSha: "9c4daa7aca9d" },
      },
      containerInspect: {
        runnerVersion: "671fac8a7691",
      },
    });

    expect(parity).toEqual({
      currentRunnerGitSha: "9c4daa7aca9d",
      actualRuntimeRunnerVersion: "671fac8a7691",
      status: "mismatch",
      reasons: ["runtime_runner_version_mismatch:671fac8a7691"],
    });
    expect(getActionableRuntimeGenerationReasons(parity)).toEqual([
      "runtime_runner_version_mismatch:671fac8a7691",
    ]);
    expect(hasActionableRuntimeGenerationDrift(parity)).toBe(true);
  });

  it("marks matching project runtime generation as clean", () => {
    expect(buildRuntimeGeneration({
      workerMeta: {
        runner: { gitSha: "9c4daa7aca9d" },
      },
      containerInspect: {
        runnerVersion: "9c4daa7aca9d",
      },
    })).toEqual({
      currentRunnerGitSha: "9c4daa7aca9d",
      actualRuntimeRunnerVersion: "9c4daa7aca9d",
      status: "clean",
      reasons: [],
    });
  });

  it("keeps incomplete runtime generation truth out of actionable drift", () => {
    const parity = buildRuntimeGeneration({
      workerMeta: {
        runner: { gitSha: "9c4daa7aca9d" },
      },
      containerInspect: {},
    });

    expect(parity.reasons).toEqual(["runtime_runner_version_missing"]);
    expect(getActionableRuntimeGenerationReasons(parity)).toEqual([]);
    expect(hasActionableRuntimeGenerationDrift(parity)).toBe(false);
  });
});
