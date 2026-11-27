import { describe, expect, it } from "vitest";
import { getOpsLoopMigrationState } from "./ops-loop-migration";

describe("getOpsLoopMigrationState", () => {
  it("hides the CTA for bundled-default rows", () => {
    expect(
      getOpsLoopMigrationState(
        {
          agentImpl: "ralph",
          useRepoHead: true,
          loopVersion: "1.5.0",
        },
        "PAUSED",
      ),
    ).toEqual({ visible: false });
  });

  it("speaks in bundled-default vocabulary for pinned migration candidates", () => {
    expect(
      getOpsLoopMigrationState(
        {
          agentImpl: "ralph",
          useRepoHead: false,
          loopVersion: "1.4.0",
          lastOutcome: "COMPLETED",
        },
        "PAUSED",
      ),
    ).toMatchObject({
      warning: expect.stringContaining("bundled default"),
      confirmMessage: expect.stringContaining("bundled default"),
    });
  });

  it("shows an eligible CTA for pinned parked Ralph rows", () => {
    expect(
      getOpsLoopMigrationState(
        {
          agentImpl: "ralph",
          useRepoHead: false,
          loopVersion: "1.4.0",
          lastOutcome: "COMPLETED",
        },
        "PAUSED",
      ),
    ).toMatchObject({
      visible: true,
      disabled: false,
    });
  });

  it("disables migration for active rows until the app is turned off", () => {
    expect(
      getOpsLoopMigrationState(
        {
          agentImpl: "ralph",
          useRepoHead: false,
          loopVersion: "1.4.0",
          lastOutcome: null,
        },
        "LIVE",
      ),
    ).toMatchObject({
      visible: true,
      disabled: true,
      hint: "Turn App OFF first",
    });
  });

  it("allows failed live rows because relaunch already permits them", () => {
    expect(
      getOpsLoopMigrationState(
        {
          agentImpl: "ralph",
          useRepoHead: false,
          loopVersion: "1.5.0",
          lastOutcome: "FAILED",
        },
        "LIVE",
      ),
    ).toMatchObject({
      visible: true,
      disabled: false,
    });
  });
});
