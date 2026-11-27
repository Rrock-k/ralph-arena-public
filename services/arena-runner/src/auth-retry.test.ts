import { describe, expect, it } from "vitest";
import { decideAuthFailureAction } from "./auth-retry.js";

describe("decideAuthFailureAction", () => {
  it("retries immediately when a newer auth version is available", () => {
    expect(
      decideAuthFailureAction({
        attemptAuthVersion: "authv_old",
        refreshedAuthVersion: "authv_new",
        hasRelevantFreshAuth: true,
        attemptedAuthVersions: ["authv_old"],
      }),
    ).toEqual({
      action: "retry_now",
      authVersion: "authv_new",
      reasonMessage: "Auth token expired but a newer auth snapshot is available. Restarting agent immediately.",
    });
  });

  it("pauses when no fresh auth exists yet", () => {
    expect(
      decideAuthFailureAction({
        attemptAuthVersion: "authv_old",
        refreshedAuthVersion: "",
        hasRelevantFreshAuth: false,
      }),
    ).toEqual({
      action: "pause",
      reasonCode: "auth_expired",
      reasonMessage: "Auth token expired. Waiting for token refresh.",
    });
  });

  it("pauses when the refreshed auth version is unchanged", () => {
    expect(
      decideAuthFailureAction({
        attemptAuthVersion: "authv_same",
        refreshedAuthVersion: "authv_same",
        hasRelevantFreshAuth: true,
      }),
    ).toEqual({
      action: "pause",
      reasonCode: "auth_expired",
      reasonMessage: "Auth token expired and no newer auth snapshot is available yet.",
    });
  });

  it("pauses when the newest auth version already failed before", () => {
    expect(
      decideAuthFailureAction({
        attemptAuthVersion: "authv_old",
        refreshedAuthVersion: "authv_new",
        hasRelevantFreshAuth: true,
        attemptedAuthVersions: ["authv_old", "authv_new"],
      }),
    ).toEqual({
      action: "pause",
      reasonCode: "auth_expired",
      reasonMessage: "Auth token expired and the newest auth snapshot already failed. Waiting for another refresh.",
    });
  });
});
