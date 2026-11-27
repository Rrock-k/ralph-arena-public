import { describe, expect, it } from "vitest";

import {
  createRunnerProjectSecret,
  isCronAuthorized,
  isRunnerAuthorized,
  isWorkerAuthorized,
} from "./internal-auth";

describe("internal auth fail-open guard", () => {
  it("does not allow missing secrets on public hosts in dev mode", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRunnerSecret = process.env.RUNNER_WEBHOOK_SECRET;
    const previousWorkerSecret = process.env.WORKER_SECRET;
    const previousCronSecret = process.env.CRON_SECRET;

    process.env.NODE_ENV = "development";
    delete process.env.RUNNER_WEBHOOK_SECRET;
    delete process.env.WORKER_SECRET;
    delete process.env.CRON_SECRET;

    const request = new Request("https://app.arena.example.test/api/internal/runtime-intents/claim", {
      headers: {
        host: "app.arena.example.test",
      },
    });

    expect(isRunnerAuthorized(request)).toBe(false);
    expect(isWorkerAuthorized(request)).toBe(false);
    expect(isCronAuthorized(request)).toBe(false);

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousRunnerSecret === undefined) delete process.env.RUNNER_WEBHOOK_SECRET;
    else process.env.RUNNER_WEBHOOK_SECRET = previousRunnerSecret;
    if (previousWorkerSecret === undefined) delete process.env.WORKER_SECRET;
    else process.env.WORKER_SECRET = previousWorkerSecret;
    if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCronSecret;
  });
});

describe("runner project auth", () => {
  it("authorizes a runner only for the project bound into its token", () => {
    const previousRunnerSecret = process.env.RUNNER_WEBHOOK_SECRET;
    process.env.RUNNER_WEBHOOK_SECRET = "runner-secret";

    const projectToken = createRunnerProjectSecret("project-a");
    const request = new Request("https://app.arena.example.test/api/internal/projects/project-a/init", {
      headers: {
        "x-arena-project-secret": projectToken,
      },
    });

    expect(isRunnerAuthorized(request, { projectId: "project-a" })).toBe(true);
    expect(isRunnerAuthorized(request, { projectId: "project-b" })).toBe(false);

    if (previousRunnerSecret === undefined) delete process.env.RUNNER_WEBHOOK_SECRET;
    else process.env.RUNNER_WEBHOOK_SECRET = previousRunnerSecret;
  });

  it("does not accept the global runner secret on project-scoped routes", () => {
    const previousRunnerSecret = process.env.RUNNER_WEBHOOK_SECRET;
    process.env.RUNNER_WEBHOOK_SECRET = "runner-secret";

    const request = new Request("https://app.arena.example.test/api/internal/projects/project-a/init", {
      headers: {
        "x-arena-project-secret": "runner-secret",
      },
    });

    expect(isRunnerAuthorized(request)).toBe(true);
    expect(isRunnerAuthorized(request, { projectId: "project-a" })).toBe(false);

    if (previousRunnerSecret === undefined) delete process.env.RUNNER_WEBHOOK_SECRET;
    else process.env.RUNNER_WEBHOOK_SECRET = previousRunnerSecret;
  });
});
