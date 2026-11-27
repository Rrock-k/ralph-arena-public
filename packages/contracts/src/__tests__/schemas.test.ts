import { describe, it, expect } from "vitest";
import {
  // Statuses
  TerminalStatusSchema,
  isTerminalStatus,
  isActiveStatus,
  // Common
  SpecItemSchema,
  ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
  SPEC_DOCUMENT_SCHEMA_VERSION,
  RuntimeIntentClaimRequestSchema,
  RuntimeIntentClaimResponseSchema,
  RuntimeIntentCompleteRequestSchema,
  // Runner → Governance
  InitResponseSchema,
  StatusResponseSchema,
  SpecsResponseSchema,
  LogChunkSchema,
  LogsRequestSchema,
  ProgressRequestSchema,
  PollEventsResponseSchema,
  PreviewRefreshRequestPayloadSchema,
  RequestedSecretEntrySchema,
  RequestSecretsRequestSchema,
  RequestSecretsResponseSchema,
  WorkspaceIncomingEventBatchSchema,
  WorkspaceOutgoingEventBatchSchema,
  TerminalRequestSchema,
} from "../index.js";

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------
describe("TerminalStatusSchema", () => {
  const validStatuses = [
    "DEPLOYED",
    "FAILED",
    "CANCELED",
  ];

  it.each(validStatuses)("accepts %s", (s) => {
    expect(TerminalStatusSchema.parse(s)).toBe(s);
  });

  it("rejects non-terminal statuses", () => {
    expect(() => TerminalStatusSchema.parse("RUNNING")).toThrow();
    expect(() => TerminalStatusSchema.parse("QUEUED")).toThrow();
    expect(() => TerminalStatusSchema.parse("CREATED")).toThrow();
  });

  it("rejects arbitrary strings", () => {
    expect(() => TerminalStatusSchema.parse("UNKNOWN")).toThrow();
    expect(() => TerminalStatusSchema.parse("")).toThrow();
  });

  it("safeParse returns success for valid", () => {
    const result = TerminalStatusSchema.safeParse("DEPLOYED");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("DEPLOYED");
  });

  it("safeParse returns error for invalid", () => {
    const result = TerminalStatusSchema.safeParse("RUNNING");
    expect(result.success).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("returns true for all terminal statuses", () => {
    expect(isTerminalStatus("DEPLOYED")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("CANCELED")).toBe(true);
  });

  it("returns false for non-terminal statuses", () => {
    expect(isTerminalStatus("CREATED")).toBe(false);
    expect(isTerminalStatus("PROVISIONING")).toBe(false);
    expect(isTerminalStatus("QUEUED")).toBe(false);
    expect(isTerminalStatus("RUNNING")).toBe(false);
    expect(isTerminalStatus("PAUSING")).toBe(false);
  });

  it("returns false for arbitrary strings", () => {
    expect(isTerminalStatus("UNKNOWN")).toBe(false);
    expect(isTerminalStatus("")).toBe(false);
  });
});

describe("isActiveStatus", () => {
  it("returns true for active statuses", () => {
    expect(isActiveStatus("PROVISIONING")).toBe(true);
    expect(isActiveStatus("QUEUED")).toBe(true);
    expect(isActiveStatus("RUNNING")).toBe(true);
    expect(isActiveStatus("PAUSING")).toBe(true);
  });

  it("returns false for non-active statuses", () => {
    expect(isActiveStatus("CREATED")).toBe(false);
    expect(isActiveStatus("DEPLOYED")).toBe(false);
    expect(isActiveStatus("FAILED")).toBe(false);
    expect(isActiveStatus("CANCELED")).toBe(false);
    expect(isActiveStatus("PAUSED_BUDGET")).toBe(false);
    expect(isActiveStatus("UNKNOWN")).toBe(false);
    expect(isActiveStatus("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Common — SpecItemSchema
// ---------------------------------------------------------------------------
describe("SpecItemSchema", () => {
  const valid = { id: "s1", slug: "my-spec", content: "Do X", hash: "abc123" };

  it("parses valid input", () => {
    expect(SpecItemSchema.parse(valid)).toEqual(valid);
  });

  it("rejects missing fields", () => {
    expect(() => SpecItemSchema.parse({ id: "s1" })).toThrow();
    expect(() => SpecItemSchema.parse({})).toThrow();
    expect(() => SpecItemSchema.parse({ id: "s1", slug: "x", content: "y" })).toThrow(); // missing hash
  });

  it("rejects wrong types", () => {
    expect(() => SpecItemSchema.parse({ ...valid, id: 123 })).toThrow();
    expect(() => SpecItemSchema.parse({ ...valid, hash: null })).toThrow();
  });

  it("safeParse works", () => {
    expect(SpecItemSchema.safeParse(valid).success).toBe(true);
    expect(SpecItemSchema.safeParse({}).success).toBe(false);
  });

  it("accepts optional runner metadata for accepted spec artifact provenance", () => {
    const result = SpecItemSchema.parse({
      ...valid,
      inputHash: "input-hash",
      currentVersion: {
        id: "spec-version-1",
        version: 1,
        message: "Imported from tg-spec v8",
        createdAt: "2026-05-15T09:00:00.000Z",
      },
      source: {
        system: "tg-spec",
        projectId: "tg-proj-1",
        version: 8,
        url: "https://tg-spec.example/projects/tg-proj-1/specs/8",
        acceptedAt: "2026-05-15T08:59:00.000Z",
      },
      acceptedArtifact: {
        artifactSchemaVersion: ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
        artifactId: "SPEC-008",
        acceptedAt: "2026-05-15T08:59:00.000Z",
        source: {
          id: "SRC-008",
          sourceSystem: "tg-spec",
          sourceProjectId: "tg-proj-1",
          sourceVersion: 8,
          sourceRefType: "accepted_spec",
          sourceId: "tg-spec-version-8",
        },
        acceptedSpec: {
          id: "SPEC-008",
          version: 8,
          document: {
            specSchemaVersion: SPEC_DOCUMENT_SCHEMA_VERSION,
            title: "Imported spec",
            sections: [],
            requirements: [],
            extensionBlocks: [],
          },
          renderedMarkdown: valid.content,
          contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sourceRefs: ["SRC-008"],
        },
        acceptedDiff: {
          id: "DIFF-008",
          targetSpecVersion: 8,
          summary: "Imported accepted artifact.",
          items: [],
        },
        feedback: [],
        assumptions: [],
        secretRequirements: [],
        assets: [],
      },
      metadataHash: "sha256:metadata",
    });

    expect(result.inputHash).toBe("input-hash");
    expect(result.source?.projectId).toBe("tg-proj-1");
    expect(result.acceptedArtifact?.artifactSchemaVersion).toBe(ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// RuntimeIntent schemas
// ---------------------------------------------------------------------------
describe("RuntimeIntentClaimRequestSchema", () => {
  it("defaults host to local", () => {
    expect(RuntimeIntentClaimRequestSchema.parse({})).toEqual({ host: "local" });
  });

  it("accepts explicit host and capacity", () => {
    expect(RuntimeIntentClaimRequestSchema.parse({ host: "vps-1", capacity: 2 })).toEqual({
      host: "vps-1",
      capacity: 2,
    });
  });

  it("accepts worker-reported active preview containers as transient capacity evidence", () => {
    expect(RuntimeIntentClaimRequestSchema.parse({
      host: "local",
      capacity: 0,
      activePreviewContainers: ["preview-project-1"],
    })).toEqual({
      host: "local",
      capacity: 0,
      activePreviewContainers: ["preview-project-1"],
    });
  });

  it("accepts worker resource pressure as transient capacity evidence", () => {
    expect(RuntimeIntentClaimRequestSchema.parse({
      host: "local",
      capacity: 0,
      resourcePressure: {
        capturedAt: "2026-06-06T00:00:00.000Z",
        constrained: true,
        reasons: ["memory_pressure"],
        memory: {
          usageBytes: 900,
          limitBytes: 1000,
          usageRatio: 0.9,
          thresholdRatio: 0.9,
        },
        pids: {
          current: 950,
          threshold: 900,
        },
        containers: {
          sampled: 3,
          running: 4,
        },
      },
    })).toEqual({
      host: "local",
      capacity: 0,
      resourcePressure: {
        capturedAt: "2026-06-06T00:00:00.000Z",
        constrained: true,
        reasons: ["memory_pressure"],
        memory: {
          usageBytes: 900,
          limitBytes: 1000,
          usageRatio: 0.9,
          thresholdRatio: 0.9,
        },
        pids: {
          current: 950,
          threshold: 900,
        },
        containers: {
          sampled: 3,
          running: 4,
        },
      },
    });
  });
});

describe("RuntimeIntentClaimResponseSchema", () => {
  it("accepts no intent", () => {
    expect(RuntimeIntentClaimResponseSchema.parse(null)).toBeNull();
  });

  it("accepts preview-only ensure_running intent", () => {
    const parsed = RuntimeIntentClaimResponseSchema.parse({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "preview_only",
      containerName: "preview-project-1",
      workspaceLabel: "project-1",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      env: {
        ARENA_PROJECT_ID: "project-1",
      },
    });

    expect(parsed?.runnerMode).toBe("preview_only");
  });

  it("accepts agent-run ensure_running intent with env", () => {
    const parsed = RuntimeIntentClaimResponseSchema.parse({
      intentId: "intent-2",
      projectId: "project-2",
      action: "ensure_running",
      runnerMode: "agent_run",
      containerName: "preview-project-2",
      workspaceLabel: "project-2",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      env: {
        ARENA_PROJECT_ID: "project-2",
        ARENA_AGENT: "codex",
      },
    });

    expect(parsed?.runnerMode).toBe("agent_run");
    if (!parsed || parsed.runnerMode !== "agent_run") {
      throw new Error("Expected agent_run intent");
    }
    expect(parsed.env.ARENA_PROJECT_ID).toBe("project-2");
  });
});

describe("RuntimeIntentCompleteRequestSchema", () => {
  it("accepts success completion", () => {
    expect(RuntimeIntentCompleteRequestSchema.parse({
      ok: true,
      actualRuntime: "RUNNING",
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
    })).toEqual({
      ok: true,
      actualRuntime: "RUNNING",
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
    });
  });

  it("defaults failure completion to retryable", () => {
    expect(RuntimeIntentCompleteRequestSchema.parse({
      ok: false,
      error: "docker unavailable",
    })).toEqual({
      ok: false,
      error: "docker unavailable",
      retryable: true,
    });
  });
});

// ---------------------------------------------------------------------------
// InitResponseSchema
// ---------------------------------------------------------------------------
describe("InitResponseSchema", () => {
  const validInit = {
    repo: {
      url: "https://github.com/org/repo.git",
      baseBranch: "main",
      projectBranch: "feat/x",
    },
    specs: [{ id: "s1", slug: "spec-1", content: "Do it", hash: "h1" }],
    specsHash: "combined-hash",
    secrets: { API_KEY: "secret" },
    project: {
      id: "proj-1",
      status: "RUNNING",
      state: "ACTIVE",
      runtime: {
        desiredRuntime: "RUNNING",
        actualRuntime: "ABSENT",
        implState: "IDLE",
        pauseReason: null,
      },
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-4",
    },
    commandTemplate: "codex run",
  };

  it("parses valid input", () => {
    const result = InitResponseSchema.parse(validInit);
    expect(result.repo).not.toBeNull();
    if (!result.repo) throw new Error("Expected repo to be present");
    expect(result.repo.url).toBe("https://github.com/org/repo.git");
    expect(result.specs).toHaveLength(1);
    expect(result.project.agent).toBe("codex");
  });

  it("accepts null model and null commandTemplate", () => {
    const result = InitResponseSchema.parse({
      ...validInit,
      project: {
        ...validInit.project,
        model: null,
        hasPendingLoopWork: true,
      },
      commandTemplate: null,
    });
    expect(result.project.model).toBeNull();
    expect(result.project.hasPendingLoopWork).toBe(true);
    expect(result.commandTemplate).toBeNull();
  });

  it("accepts explicit runner-owned Ralph config for allowlisted Workbench automation", () => {
    const result = InitResponseSchema.parse({
      ...validInit,
      ralphConfig: {
        visualWorkbench: {
          visualEvidenceMode: "required",
          executorCaptureShell: {
            mode: "allowlisted",
            allowedServeCommands: ["npm run visual-workbench"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        },
      },
    });

    expect(result.ralphConfig?.visualWorkbench.executorCaptureShell).toEqual({
      mode: "allowlisted",
      allowedServeCommands: ["npm run visual-workbench"],
      allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
    });
    expect(result.ralphConfig?.visualWorkbench.visualEvidenceMode).toBe("required");
  });

  it("rejects disabled or loose runner-owned Ralph config in init payloads", () => {
    expect(() =>
      InitResponseSchema.parse({
        ...validInit,
        ralphConfig: {
          visualWorkbench: {
            visualEvidenceMode: "required",
            executorCaptureShell: {
              mode: "disabled",
              allowedServeCommands: [],
              allowedBaseUrlEnv: [],
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      InitResponseSchema.parse({
        ...validInit,
        ralphConfig: {
          visualWorkbench: {
            visualEvidenceMode: "required",
            executorCaptureShell: {
              mode: "allowlisted",
              allowedServeCommands: ["npm run dev"],
              allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      InitResponseSchema.parse({
        ...validInit,
        ralphConfig: {
          visualWorkbench: {
            visualEvidenceMode: "required",
            executorCaptureShell: {
              mode: "allowlisted",
              allowedServeCommands: ["npm run visual-workbench"],
              allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
              extra: true,
            },
          },
        },
      }),
    ).toThrow();
  });

  it("repo.runBranch is optional", () => {
    const result = InitResponseSchema.parse(validInit);
    expect(result.repo).not.toBeNull();
    if (!result.repo) throw new Error("Expected repo to be present");
    expect(result.repo.runBranch).toBeUndefined();

    const withRun = InitResponseSchema.parse({
      ...validInit,
      repo: { ...validInit.repo, runBranch: "run/123" },
    });
    expect(withRun.repo).not.toBeNull();
    if (!withRun.repo) throw new Error("Expected repo to be present");
    expect(withRun.repo.runBranch).toBe("run/123");
  });

  it("accepts null repo for direct-command bootstrap", () => {
    const result = InitResponseSchema.parse({
      ...validInit,
      repo: null,
    });
    expect(result.repo).toBeNull();
  });

  it("rejects missing repo fields", () => {
    expect(() =>
      InitResponseSchema.parse({ ...validInit, repo: { url: "x" } }),
    ).toThrow();
  });

  it("rejects missing top-level fields", () => {
    expect(() => InitResponseSchema.parse({})).toThrow();
    expect(() =>
      InitResponseSchema.parse({ repo: validInit.repo }),
    ).toThrow();
  });

  it("rejects wrong types in secrets", () => {
    expect(() =>
      InitResponseSchema.parse({ ...validInit, secrets: { k: 123 } }),
    ).toThrow();
  });

  it("safeParse works correctly", () => {
    expect(InitResponseSchema.safeParse(validInit).success).toBe(true);
    expect(InitResponseSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StatusResponseSchema
// ---------------------------------------------------------------------------
describe("StatusResponseSchema", () => {
  it("parses minimal valid input", () => {
    const result = StatusResponseSchema.parse({ shouldStop: false });
    expect(result.shouldStop).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.agentIntent).toBeUndefined();
    expect(result.auth).toBeUndefined();
    expect(result.authVersion).toBeUndefined();
  });

  it("parses full input", () => {
    const result = StatusResponseSchema.parse({
      shouldStop: true,
      reason: "budget_exceeded",
      agentIntent: "OFF",
      pendingLoopWork: true,
      auth: { token: "abc" },
      authVersion: "authv_123",
    });
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe("budget_exceeded");
    expect(result.agentIntent).toBe("OFF");
    expect(result.pendingLoopWork).toBe(true);
    expect(result.auth).toEqual({ token: "abc" });
    expect(result.authVersion).toBe("authv_123");
  });

  it("rejects missing shouldStop", () => {
    expect(() => StatusResponseSchema.parse({})).toThrow();
  });

  it("rejects wrong type for shouldStop", () => {
    expect(() =>
      StatusResponseSchema.parse({ shouldStop: "yes" }),
    ).toThrow();
  });

  it("rejects wrong type for auth", () => {
    expect(() =>
      StatusResponseSchema.parse({ shouldStop: false, auth: "str" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SpecsResponseSchema
// ---------------------------------------------------------------------------
describe("SpecsResponseSchema", () => {
  it("parses valid input", () => {
    const result = SpecsResponseSchema.parse({
      specs: [{
        id: "s1",
        slug: "a",
        content: "b",
        hash: "c",
        inputHash: "input-c",
        acceptedArtifactBacklog: [{
          currentVersion: {
            id: "sv1",
            version: 1,
            createdAt: "2026-05-22T15:08:07.069Z",
          },
          source: {
            system: "tg-spec",
            projectId: "tg-proj-1",
            version: 1,
          },
          metadataHash: "sha256:metadata-1",
          acceptedArtifact: {
            artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
            artifactId: "SPEC-001",
            acceptedAt: "2026-05-22T15:08:07.069Z",
            source: {
              id: "SRC-001",
              sourceSystem: "tg-spec",
              sourceProjectId: "tg-proj-1",
              sourceVersion: 1,
              sourceRefType: "accepted_spec",
              sourceId: "tg-spec-version-1",
            },
            acceptedSpec: {
              id: "SPEC-001",
              version: 1,
              document: {
                specSchemaVersion: "ra-287.spec-document.v1",
                title: "Spec",
                sections: [],
                requirements: [],
                extensionBlocks: [],
              },
              contentHash: `sha256:${"a".repeat(64)}`,
              sourceRefs: ["SRC-001"],
            },
            acceptedDiff: {
              id: "DIFF-001",
              targetSpecVersion: 1,
              summary: "Accepted update.",
              items: [{
                id: "DIFF-001-001",
                targetType: "spec",
                targetId: "REQ-001",
                changeType: "created",
                workImpact: "requires_loop_work",
                summary: "Build the feature.",
                sourceRefs: ["SRC-001"],
              }],
            },
            feedback: [],
            assumptions: [],
            secretRequirements: [],
            assets: [],
          },
        }],
      }],
      hash: "combined",
    });
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0].inputHash).toBe("input-c");
    expect(result.specs[0].acceptedArtifactBacklog?.[0].source?.version).toBe(1);
    expect(result.hash).toBe("combined");
  });

  it("accepts empty specs array", () => {
    const result = SpecsResponseSchema.parse({ specs: [], hash: "empty" });
    expect(result.specs).toEqual([]);
  });

  it("rejects missing hash", () => {
    expect(() => SpecsResponseSchema.parse({ specs: [] })).toThrow();
  });

  it("rejects invalid spec items", () => {
    expect(() =>
      SpecsResponseSchema.parse({
        specs: [{ id: "s1" }], // missing slug, content, hash
        hash: "x",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LogChunkSchema / LogsRequestSchema
// ---------------------------------------------------------------------------
describe("LogChunkSchema", () => {
  it("parses valid chunk", () => {
    const result = LogChunkSchema.parse({
      ts: 1700000000,
      stream: "stdout",
      text: "hello",
    });
    expect(result.stream).toBe("stdout");
  });

  it("accepts stderr", () => {
    expect(
      LogChunkSchema.parse({ ts: 1, stream: "stderr", text: "" }).stream,
    ).toBe("stderr");
  });

  it("rejects invalid stream", () => {
    expect(() =>
      LogChunkSchema.parse({ ts: 1, stream: "stdin", text: "" }),
    ).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() => LogChunkSchema.parse({})).toThrow();
    expect(() => LogChunkSchema.parse({ ts: 1, stream: "stdout" })).toThrow();
  });

  it("rejects wrong types", () => {
    expect(() =>
      LogChunkSchema.parse({ ts: "not-a-number", stream: "stdout", text: "x" }),
    ).toThrow();
  });
});

describe("LogsRequestSchema", () => {
  const validChunk = { ts: 1, stream: "stdout" as const, text: "line" };

  it("parses valid request with one chunk", () => {
    const result = LogsRequestSchema.parse({ chunks: [validChunk] });
    expect(result.chunks).toHaveLength(1);
  });

  it("parses request with multiple chunks", () => {
    const result = LogsRequestSchema.parse({
      chunks: [validChunk, { ...validChunk, stream: "stderr" }],
    });
    expect(result.chunks).toHaveLength(2);
  });

  it("rejects empty chunks array (min 1)", () => {
    expect(() => LogsRequestSchema.parse({ chunks: [] })).toThrow();
  });

  it("rejects missing chunks", () => {
    expect(() => LogsRequestSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ProgressRequestSchema
// ---------------------------------------------------------------------------
describe("ProgressRequestSchema", () => {
  it("parses empty object (all optional)", () => {
    const result = ProgressRequestSchema.parse({});
    expect(result.projectId).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.eventType).toBeUndefined();
    expect(result.budgetDebitedUsd).toBeUndefined();
    expect(result.estimatedCostUsd).toBeUndefined();
    expect(result.progressJson).toBeUndefined();
    expect(result.previewActual).toBeUndefined();
    expect(result.telegramMiniAppUrl).toBeUndefined();
  });

  it("parses full input", () => {
    const result = ProgressRequestSchema.parse({
      projectId: "p1",
      status: "RUNNING",
      eventType: "iteration",
      budgetDebitedUsd: 0.05,
      estimatedCostUsd: 1.5,
      progressJson: '{"step":1}',
      previewActual: "SERVING",
      telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=done",
    });
    expect(result.projectId).toBe("p1");
    expect(result.budgetDebitedUsd).toBe(0.05);
    expect(result.previewActual).toBe("SERVING");
    expect(result.telegramMiniAppUrl).toBe("https://t.me/sample_bot/sampleapp?startapp=done");
  });

  it("allows explicit null progressJson to clear stale runtime progress", () => {
    const result = ProgressRequestSchema.parse({
      eventType: "project_progress",
      progressJson: null,
    });
    expect(result.progressJson).toBeNull();
  });

  it("rejects wrong types", () => {
    expect(() =>
      ProgressRequestSchema.parse({ budgetDebitedUsd: "five" }),
    ).toThrow();
    expect(() =>
      ProgressRequestSchema.parse({ estimatedCostUsd: true }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Event transport schemas
// ---------------------------------------------------------------------------
describe("PreviewRefreshRequestPayloadSchema", () => {
  it("defaults source to admin", () => {
    const result = PreviewRefreshRequestPayloadSchema.parse({});
    expect(result).toEqual({ source: "admin" });
  });

  it("accepts explicit source and reason", () => {
    const result = PreviewRefreshRequestPayloadSchema.parse({
      source: "admin",
      reason: "manual_refresh",
    });
    expect(result.reason).toBe("manual_refresh");
  });
});

describe("WorkspaceOutgoingEventBatchSchema", () => {
  it("normalizes legacy outgoing events with version default", () => {
    const result = WorkspaceOutgoingEventBatchSchema.parse([
      {
        type: "test_request",
        payload: {
          title: "Homepage",
          steps: [{ question: "Loads?" }],
        },
      },
      {
        type: "preview_refresh_requested",
        payload: {
          reason: "manual_refresh",
        },
      },
    ]);

    expect(result[0]?.version).toBe(1);
    expect(result[1]?.version).toBe(1);
    expect(result[1]?.payload).toEqual({
      reason: "manual_refresh",
    });
  });

  it("rejects invalid payloads for known event types", () => {
    expect(() =>
      WorkspaceOutgoingEventBatchSchema.parse([
        {
          type: "preview_refresh_requested",
          payload: {
            source: "invalid",
          },
        },
      ]),
    ).toThrow();
  });
});

describe("PollEventsResponseSchema", () => {
  it("keeps unsupported events isolated for per-event validation", () => {
    const result = PollEventsResponseSchema.parse({
      events: [
        {
          id: "evt-unknown",
          projectId: "project-1",
          direction: "in",
          type: "context_question",
          payload: {},
          createdAt: "2026-08-03T10:00:00.000Z",
        },
      ],
    });

    expect(result.events).toHaveLength(1);
  });
});

describe("WorkspaceIncomingEventBatchSchema", () => {
  it("accepts governance-shaped incoming events with metadata", () => {
    const result = WorkspaceIncomingEventBatchSchema.parse([
      {
        id: "evt-1",
        projectId: "project-1",
        direction: "in",
        type: "qa_feedback_batch",
        payload: {
          summary: "Fix the broken flow",
          tests: [],
          totalPassed: 0,
          totalFailed: 1,
        },
        createdAt: "2026-04-23T00:00:00.000Z",
      },
    ]);

    expect(result[0]?.version).toBe(1);
    expect(result[0]?.id).toBe("evt-1");
  });
});

// ---------------------------------------------------------------------------
// RequestedSecretEntrySchema / RequestSecretsRequestSchema / ResponseSchema
// ---------------------------------------------------------------------------
describe("RequestedSecretEntrySchema", () => {
  it("parses minimal entry (only key required)", () => {
    const result = RequestedSecretEntrySchema.parse({ key: "DB_URL" });
    expect(result.key).toBe("DB_URL");
    expect(result.description).toBeUndefined();
    expect(result.blocking).toBeUndefined();
  });

  it("parses full entry", () => {
    const result = RequestedSecretEntrySchema.parse({
      key: "DB_URL",
      description: "Database connection string",
      blocking: true,
    });
    expect(result.blocking).toBe(true);
  });

  it("rejects missing key", () => {
    expect(() => RequestedSecretEntrySchema.parse({})).toThrow();
  });
});

describe("RequestSecretsRequestSchema", () => {
  it("is an array schema", () => {
    const result = RequestSecretsRequestSchema.parse([
      { key: "A" },
      { key: "B", blocking: false },
    ]);
    expect(result).toHaveLength(2);
  });

  it("accepts empty array", () => {
    const result = RequestSecretsRequestSchema.parse([]);
    expect(result).toEqual([]);
  });

  it("rejects non-array", () => {
    expect(() =>
      RequestSecretsRequestSchema.parse({ key: "A" }),
    ).toThrow();
  });

  it("rejects invalid entries", () => {
    expect(() =>
      RequestSecretsRequestSchema.parse([{ notKey: "x" }]),
    ).toThrow();
  });
});

describe("RequestSecretsResponseSchema", () => {
  const valid = {
    provided: { API_KEY: "val" },
    missing: [{ key: "DB_URL", blocking: true }],
    paused: false,
  };

  it("parses valid response", () => {
    const result = RequestSecretsResponseSchema.parse(valid);
    expect(result.provided).toEqual({ API_KEY: "val" });
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].blocking).toBe(true);
    expect(result.paused).toBe(false);
  });

  it("missing entry description is optional", () => {
    const result = RequestSecretsResponseSchema.parse(valid);
    expect(result.missing[0].description).toBeUndefined();
  });

  it("accepts missing entry with description", () => {
    const result = RequestSecretsResponseSchema.parse({
      ...valid,
      missing: [{ key: "X", blocking: false, description: "desc" }],
    });
    expect(result.missing[0].description).toBe("desc");
  });

  it("rejects missing required fields", () => {
    expect(() => RequestSecretsResponseSchema.parse({})).toThrow();
    expect(() =>
      RequestSecretsResponseSchema.parse({ provided: {}, missing: [] }),
    ).toThrow(); // missing paused
  });

  it("rejects missing.blocking as required (not optional in response)", () => {
    expect(() =>
      RequestSecretsResponseSchema.parse({
        provided: {},
        missing: [{ key: "X" }], // blocking is required in response schema
        paused: false,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// TerminalRequestSchema
// ---------------------------------------------------------------------------
describe("TerminalRequestSchema", () => {
  it("parses minimal valid input", () => {
    const result = TerminalRequestSchema.parse({ terminalState: "DEPLOYED" });
    expect(result.terminalState).toBe("DEPLOYED");
    expect(result.reasonCode).toBeUndefined();
    expect(result.commitSha).toBeUndefined();
    expect(result.log).toBeUndefined();
    expect(result.previewUrl).toBeUndefined();
    expect(result.telegramMiniAppUrl).toBeUndefined();
    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
    expect(result.estimatedCostUsd).toBeUndefined();
  });

  it("parses full input", () => {
    const result = TerminalRequestSchema.parse({
      terminalState: "FAILED",
      pauseReason: "API",
      retryAt: "2026-04-19T08:00:00.000Z",
      reasonCode: "agent_error",
      reasonMessage: "Segfault",
      commitSha: "abc123",
      log: "some log output",
      containerName: "preview-123",
      previewUrl: "https://preview.test",
      telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=done",
      workerHost: "local",
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 0.02,
      forensics: {
        exitCode: 137,
        signal: "SIGKILL",
        lastProgressState: "coding",
        cgroupMemoryEvents: {
          oom: 1,
          oom_kill: 1,
        },
        resourcePressure: {
          constrained: true,
          reasons: ["cgroup_oom_kill"],
          memory: {
            usageBytes: 1000,
            limitBytes: 1000,
            usageRatio: 1,
          },
        },
      },
    });
    expect(result.terminalState).toBe("FAILED");
    expect(result.pauseReason).toBe("API");
    expect(result.retryAt).toBe("2026-04-19T08:00:00.000Z");
    expect(result.reasonCode).toBe("agent_error");
    expect(result.reasonMessage).toBe("Segfault");
    expect(result.containerName).toBe("preview-123");
    expect(result.telegramMiniAppUrl).toBe("https://t.me/sample_bot/sampleapp?startapp=done");
    expect(result.workerHost).toBe("local");
    expect(result.inputTokens).toBe(1000);
    expect(result.forensics?.exitCode).toBe(137);
    expect(result.forensics?.resourcePressure?.reasons).toEqual(["cgroup_oom_kill"]);
  });

  it("accepts manual pauses for human-required evidence gates", () => {
    const result = TerminalRequestSchema.parse({
      terminalState: "CANCELED",
      pauseReason: "MANUAL",
      reasonMessage: "Controller escalation requires user production evidence.",
    });

    expect(result.pauseReason).toBe("MANUAL");
  });

  it("accepts explicit null workerHost when runtime identity is being cleared", () => {
    const result = TerminalRequestSchema.parse({
      terminalState: "CANCELED",
      reasonCode: "paused_runtime_shutdown",
      containerName: null,
      workerHost: null,
    });

    expect(result.containerName).toBeNull();
    expect(result.workerHost).toBeNull();
  });

  it("accepts all terminal statuses", () => {
    for (const s of ["DEPLOYED", "FAILED", "CANCELED"]) {
      expect(TerminalRequestSchema.parse({ terminalState: s }).terminalState).toBe(s);
    }
  });

  it("rejects non-terminal status", () => {
    expect(() =>
      TerminalRequestSchema.parse({ terminalState: "RUNNING" }),
    ).toThrow();
    expect(() =>
      TerminalRequestSchema.parse({ terminalState: "QUEUED" }),
    ).toThrow();
  });

  it("rejects missing terminalState", () => {
    expect(() => TerminalRequestSchema.parse({})).toThrow();
  });

  it("rejects wrong token types", () => {
    expect(() =>
      TerminalRequestSchema.parse({
        terminalState: "DEPLOYED",
        inputTokens: "many",
      }),
    ).toThrow();
  });

  it("safeParse works", () => {
    expect(
      TerminalRequestSchema.safeParse({ terminalState: "DEPLOYED" }).success,
    ).toBe(true);
    expect(TerminalRequestSchema.safeParse({}).success).toBe(false);
    expect(
      TerminalRequestSchema.safeParse({ terminalState: "RUNNING" }).success,
    ).toBe(false);
  });
});
