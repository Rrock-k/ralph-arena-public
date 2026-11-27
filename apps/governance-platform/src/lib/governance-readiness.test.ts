import { describe, expect, it, vi } from "vitest";
import {
  GOVERNANCE_READINESS_SCHEMA_VERSION,
  buildGovernanceReadinessReport,
  probePrismaDatabase,
} from "./governance-readiness";

describe("governance readiness", () => {
  it("returns ready only when rollout identity, scheduler role, migration status and DB are explicit", async () => {
    const report = await buildGovernanceReadinessReport({
      now: new Date("2026-06-15T00:00:00.000Z"),
      env: {
        GOVERNANCE_BUILD_ID: "build-123",
        GOVERNANCE_RELEASE_SHA: "abc123",
        GOVERNANCE_SLOT_ID: "blue",
        GOVERNANCE_SCHEDULER_ROLE: "active",
        GOVERNANCE_MIGRATION_STATUS: "compatible",
      },
      dbProbe: async () => {},
    });

    expect(report).toEqual({
      schemaVersion: GOVERNANCE_READINESS_SCHEMA_VERSION,
      status: "ready",
      generatedAt: "2026-06-15T00:00:00.000Z",
      build: {
        id: "build-123",
        sha: "abc123",
        source: "GOVERNANCE_BUILD_ID",
      },
      slot: {
        id: "blue",
      },
      scheduler: {
        role: "active",
        enabled: true,
      },
      database: {
        status: "reachable",
      },
      migration: {
        status: "compatible",
      },
      blockers: [],
    });
  });

  it("fails closed instead of inventing rollout defaults", async () => {
    const report = await buildGovernanceReadinessReport({
      env: {},
      dbProbe: async () => {},
    });

    expect(report.status).toBe("not_ready");
    expect(report.build.id).toBeNull();
    expect(report.slot.id).toBeNull();
    expect(report.scheduler.role).toBeNull();
    expect(report.scheduler.enabled).toBe(false);
    expect(report.blockers).toEqual([
      "missing_build_id",
      "missing_slot_id",
      "missing_or_invalid_scheduler_role",
      "migration_not_reported",
    ]);
  });

  it("treats standby and external scheduler roles as explicit but disabled in-process schedulers", async () => {
    const standby = await buildGovernanceReadinessReport({
      env: {
        GOVERNANCE_RELEASE_SHA: "abc123",
        GOVERNANCE_SLOT_ID: "green",
        GOVERNANCE_SCHEDULER_ROLE: "standby",
        GOVERNANCE_MIGRATION_STATUS: "not_required",
      },
      dbProbe: async () => {},
    });
    const external = await buildGovernanceReadinessReport({
      env: {
        GOVERNANCE_RELEASE_SHA: "abc123",
        GOVERNANCE_SLOT_ID: "blue",
        GOVERNANCE_SCHEDULER_ROLE: "external",
        GOVERNANCE_MIGRATION_STATUS: "not_required",
      },
      dbProbe: async () => {},
    });

    expect(standby.status).toBe("ready");
    expect(standby.scheduler).toEqual({ role: "standby", enabled: false });
    expect(external.status).toBe("ready");
    expect(external.scheduler).toEqual({ role: "external", enabled: false });
  });

  it("blocks readiness when the DB probe fails", async () => {
    const report = await buildGovernanceReadinessReport({
      env: {
        GOVERNANCE_RELEASE_SHA: "abc123",
        GOVERNANCE_SLOT_ID: "blue",
        GOVERNANCE_SCHEDULER_ROLE: "active",
        GOVERNANCE_MIGRATION_STATUS: "compatible",
      },
      dbProbe: async () => {
        throw new Error("connection refused");
      },
    });

    expect(report.status).toBe("not_ready");
    expect(report.database).toEqual({
      status: "unreachable",
      error: "connection refused",
    });
    expect(report.blockers).toContain("database_unreachable");
  });

  it("uses the explicit raw SQL probe expected by the route", async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn(async () => [{ "?column?": 1 }]),
    };

    await probePrismaDatabase(prisma);

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith("SELECT 1");
  });
});
