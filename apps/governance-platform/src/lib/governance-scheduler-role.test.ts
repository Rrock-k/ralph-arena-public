import { describe, expect, it } from "vitest";
import { resolveGovernanceScheduler } from "./governance-scheduler-role";

describe("governance scheduler role", () => {
  it("enables in-process scheduling only for the active role", () => {
    expect(resolveGovernanceScheduler({ GOVERNANCE_SCHEDULER_ROLE: "active" })).toEqual({
      role: "active",
      enabled: true,
      source: "GOVERNANCE_SCHEDULER_ROLE",
      blocker: null,
    });
  });

  it("disables in-process scheduling for standby and external roles", () => {
    expect(resolveGovernanceScheduler({ GOVERNANCE_SCHEDULER_ROLE: "standby" })).toEqual({
      role: "standby",
      enabled: false,
      source: "GOVERNANCE_SCHEDULER_ROLE",
      blocker: null,
    });
    expect(resolveGovernanceScheduler({ GOVERNANCE_SCHEDULER_ROLE: "external" })).toEqual({
      role: "external",
      enabled: false,
      source: "GOVERNANCE_SCHEDULER_ROLE",
      blocker: null,
    });
  });

  it("fails closed for missing or invalid roles", () => {
    expect(resolveGovernanceScheduler({})).toEqual({
      role: null,
      enabled: false,
      source: "GOVERNANCE_SCHEDULER_ROLE",
      blocker: "missing_scheduler_role",
    });
    expect(resolveGovernanceScheduler({ GOVERNANCE_SCHEDULER_ROLE: "primary" })).toEqual({
      role: null,
      enabled: false,
      source: "GOVERNANCE_SCHEDULER_ROLE",
      blocker: "invalid_scheduler_role",
    });
  });
});
