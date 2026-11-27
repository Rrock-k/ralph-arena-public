import { describe, expect, it } from "vitest";
import {
  buildWorkerParity,
  getActionableWorkerParityReasons,
  hasActionableWorkerParityDrift,
} from "./worker-parity";

describe("buildWorkerParity", () => {
  it("marks local worker and runner drift as mismatch", () => {
    expect(buildWorkerParity({
      environment: "local",
      expectedCommitSha: "594c39ea677b",
      expectedWorkerImage: "arena-public-worker:local",
      workerMeta: {
        worker: {
          gitSha: "cb36fb16fa4c",
          image: "arena-public-worker:local",
        },
        runner: {
          gitSha: "cb36fb16fa4c",
        },
      },
    })).toEqual({
      environment: "local",
      expectedCommitSha: "594c39ea677b",
      expectedWorkerImage: "arena-public-worker:local",
      actualWorkerGitSha: "cb36fb16fa4c",
      actualRunnerGitSha: "cb36fb16fa4c",
      actualWorkerImage: "arena-public-worker:local",
      status: "mismatch",
      reasons: [
        "worker_sha_mismatch:cb36fb16fa4c",
        "runner_sha_mismatch:cb36fb16fa4c",
      ],
    });
  });

  it("marks matching parity as clean", () => {
    expect(buildWorkerParity({
      environment: "vps",
      expectedCommitSha: "594c39ea677b",
      expectedWorkerImage: "arena-public-worker:local",
      workerMeta: {
        worker: {
          gitSha: "594c39ea677b",
          image: "arena-public-worker:local",
        },
        runner: {
          gitSha: "594c39ea677b",
        },
      },
    }).status).toBe("clean");
  });

  it("flags missing parity metadata as mismatch", () => {
    expect(buildWorkerParity({
      environment: "local",
      expectedCommitSha: "594c39ea677b",
      expectedWorkerImage: "arena-public-worker:local",
      workerMeta: null,
    })).toEqual(expect.objectContaining({
      status: "mismatch",
      reasons: [
        "worker_meta_missing",
        "worker_git_sha_missing",
        "runner_git_sha_missing",
      ],
    }));
  });

  it("keeps incomplete parity truth out of actionable drift", () => {
    const parity = buildWorkerParity({
      environment: "local",
      expectedCommitSha: null,
      expectedWorkerImage: "arena-public-worker:local",
      workerMeta: {
        worker: {
          gitSha: "594c39ea677b",
          image: "arena-public-worker:local",
        },
        runner: {
          gitSha: "594c39ea677b",
        },
      },
    });

    expect(parity.reasons).toEqual(["expected_commit_missing"]);
    expect(getActionableWorkerParityReasons(parity)).toEqual([]);
    expect(hasActionableWorkerParityDrift(parity)).toBe(false);
  });
});
