#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLocalTopologyReport,
  dockerLocalStackInspectIsEarly,
  writeLocalTopologyReport,
} from "./governance-rollout-local-topology.mjs";

test("builds a non-intervention local topology report from docker inspect JSON", () => {
  const report = buildLocalTopologyReport({
    generatedAt: "2026-06-15T00:00:00.000Z",
    projectName: "agents-arena",
    composeFile: "/repo/docker-compose.local.yml",
    inspect: [
      container({
        name: "/agents-arena-governance-platform-1",
        service: "governance-platform",
        env: [
          "NODE_ENV=production",
          "PORT=3000",
          "GOVERNANCE_INTERNAL_URL=http://governance-platform:3000",
          "GOVERNANCE_SCHEDULER_ROLE=active",
          "GOVERNANCE_SLOT_ID=blue",
          "GOVERNANCE_BUILD_ID=build-123",
          "GOVERNANCE_MIGRATION_STATUS=compatible",
          "AUTH_SECRET=do-not-leak",
          "DATABASE_URL=postgres://do-not-leak",
        ],
      }),
      container({
        name: "/agents-arena-api-proxy-1",
        service: "api-proxy",
        env: [
          "PORT=3002",
          "API_PROXY_SECRET=do-not-leak",
        ],
        pid: 42,
      }),
      runtimeContainer({
        name: "/preview-demo",
        project: "preview-runtime",
        env: [
          "ARENA_PROJECT_ID=proj_1",
          "ARENA_GOVERNANCE_URL=https://app.arena.example.test",
          "ARENA_GOVERNANCE_PUBLIC_URL=https://app.arena.example.test",
          "ARENA_RUNNER_VERSION=abc123",
          "RUNNER_WEBHOOK_SECRET=do-not-leak",
        ],
      }),
    ],
  });

  assert.equal(report.taskId, "RA-344");
  assert.equal(report.mode, "local-topology-inspector");
  assert.equal(report.nonIntervention, true);
  assert.equal(report.decision, "captured");
  assert.equal(report.counts.composeProjectContainers, 2);
  assert.equal(report.counts.arenaRuntimeContainers, 1);
  assert.equal(report.scheduler.owners[0].schedulerRole, "active");
  assert.equal(report.apiProxy.services[0].pid, 42);
  assert.equal(report.runtimeContainers[0].governanceUrlOrigin, "https://app.arena.example.test");
  assert.deepEqual(report.blockedReasons, []);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("do-not-leak"), false);
  assert.equal(serialized.includes("DATABASE_URL"), false);
  assert.equal(serialized.includes("AUTH_SECRET"), false);
  assert.equal(serialized.includes("API_PROXY_SECRET"), false);
});

test("captures an empty stopped stack without fabricating runtime truth", () => {
  const report = buildLocalTopologyReport({
    projectName: "agents-arena",
    inspect: [],
  });

  assert.equal(report.decision, "captured");
  assert.equal(report.counts.inspectedContainers, 0);
  assert.deepEqual(report.compose.services, []);
  assert.deepEqual(report.runtimeContainers, []);
});

test("records docker read command failures as partial evidence", () => {
  const report = buildLocalTopologyReport({
    projectName: "agents-arena",
    inspect: [],
    commandErrors: [
      {
        command: "docker ps -a",
        status: 1,
        stderr: "permission denied",
      },
    ],
  });

  assert.equal(report.decision, "partial");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("docker-read-commands")));
});

test("writes local topology report artifact", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-local-topology-"));
  const reportPath = path.join(tempDir, "local-topology.json");
  const report = buildLocalTopologyReport({
    generatedAt: "2026-06-15T00:00:00.000Z",
    inspect: [],
  });

  const written = writeLocalTopologyReport(report, reportPath);
  const parsed = JSON.parse(fs.readFileSync(written, "utf8"));

  assert.equal(parsed.taskId, "RA-344");
  assert.equal(parsed.mode, "local-topology-inspector");
});

test("docker-local-stack inspect topology is routed before side-effecting setup", () => {
  const script = fs.readFileSync(path.resolve("scripts/docker-local-stack.sh"), "utf8");

  assert.equal(dockerLocalStackInspectIsEarly(script), true);
});

function container(options = {}) {
  return {
    Id: options.id ?? `${options.name ?? "container"}-id-1234567890`,
    Name: options.name,
    State: {
      Running: options.running ?? true,
      Status: options.running === false ? "exited" : "running",
      Pid: options.pid ?? 123,
      StartedAt: "2026-06-15T00:00:00Z",
      Health: {
        Status: options.health ?? "healthy",
      },
    },
    Config: {
      Image: options.image ?? "test-image:local",
      Env: options.env ?? [],
      Labels: {
        "com.docker.compose.project": options.project ?? "agents-arena",
        "com.docker.compose.service": options.service ?? "unknown",
        ...(options.labels ?? {}),
      },
      Hostname: "fallback-hostname",
    },
  };
}

function runtimeContainer(options = {}) {
  return container({
    ...options,
    labels: {
      "arena.project.id": "proj_1",
      "arena.project.slug": "demo",
      "arena.agent": "codex",
      ...(options.labels ?? {}),
    },
  });
}
