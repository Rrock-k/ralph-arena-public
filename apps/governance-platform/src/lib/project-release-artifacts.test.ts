import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  projectReleaseArtifactCreate: vi.fn(),
  projectReleaseArtifactFindFirst: vi.fn(),
  saveProjectReleaseBytes: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: mocks.projectFindUnique,
    },
    projectReleaseArtifact: {
      create: mocks.projectReleaseArtifactCreate,
      findFirst: mocks.projectReleaseArtifactFindFirst,
    },
  },
}));

vi.mock("@/lib/project-release-storage", () => ({
  saveProjectReleaseBytes: mocks.saveProjectReleaseBytes,
  readProjectReleaseBytes: vi.fn(),
}));

import {
  normalizeProjectReleaseSha256,
  normalizeProjectReleaseTag,
  publishProjectReleaseArtifact,
  sanitizeProjectReleaseFilename,
} from "./project-release-artifacts";

beforeEach(() => {
  mocks.projectFindUnique.mockReset();
  mocks.projectFindUnique.mockResolvedValue({
    id: "project-1",
    specs: [{
      title: "Addon: Mac Electron App",
      versions: [{ externalSourceSystem: "arena" }],
    }],
    components: [],
  });
  mocks.projectReleaseArtifactCreate.mockReset();
  mocks.projectReleaseArtifactCreate.mockImplementation(async ({ data }) => ({
    ...data,
    createdAt: new Date("2026-06-22T10:00:00.000Z"),
    updatedAt: new Date("2026-06-22T10:00:00.000Z"),
  }));
  mocks.projectReleaseArtifactFindFirst.mockReset();
  mocks.projectReleaseArtifactFindFirst.mockResolvedValue(null);
  mocks.saveProjectReleaseBytes.mockReset();
  mocks.saveProjectReleaseBytes.mockResolvedValue("release-1/Petsik-0.1.0-mac.zip");
});

describe("project release artifacts", () => {
  it("normalizes safe tag, sha256 and filename values", () => {
    expect(normalizeProjectReleaseTag(" mac-build/petsik-v0.1.0 ")).toBe("mac-build/petsik-v0.1.0");
    expect(normalizeProjectReleaseSha256("A".repeat(64))).toBe(`sha256:${"a".repeat(64)}`);
    expect(sanitizeProjectReleaseFilename("../Petsik 0.1.0 mac.zip")).toBe("Petsik-0.1.0-mac.zip");
  });

  it("rejects unsafe tags and unsupported release extensions", () => {
    expect(() => normalizeProjectReleaseTag("mac-build/../petsik")).toThrow("Invalid release artifact tag");
    expect(() => sanitizeProjectReleaseFilename("Petsik.app")).toThrow("Unsupported release artifact extension");
  });

  it("rejects non-Petsik Mac release tags", async () => {
    await expect(publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/other-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      buffer: Buffer.from("petsik-build"),
    })).rejects.toThrow("Invalid Mac Electron release artifact tag");
    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();
  });

  it("rejects projects without the Mac Electron add-on allowlist", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce({
      id: "project-1",
      specs: [],
      components: [{ sourceConfig: { addonIds: ["telegram_mini_app"] } }],
    });

    await expect(publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      buffer: Buffer.from("petsik-build"),
    })).rejects.toThrow("Project is not allowlisted for Mac Electron release artifacts");
    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();
  });

  it("publishes an available Mac artifact only when sha256 matches", async () => {
    const buffer = Buffer.from("petsik-build");
    const sha256 = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;

    const artifact = await publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik 0.1.0 mac.zip",
      contentType: "application/zip",
      sha256,
      buffer,
      builderLabel: "sample-machine",
    });

    expect(mocks.saveProjectReleaseBytes).toHaveBeenCalledWith(
      expect.any(String),
      "Petsik-0.1.0-mac.zip",
      buffer,
    );
    expect(artifact).toMatchObject({
      projectId: "project-1",
      platform: "macos",
      appKind: "electron",
      status: "available",
      filename: "Petsik-0.1.0-mac.zip",
      sha256,
      sizeBytes: buffer.byteLength,
      builderLabel: "sample-machine",
    });
  });

  it("rejects available artifacts with a mismatched sha256", async () => {
    await expect(publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      sha256: `sha256:${"b".repeat(64)}`,
      buffer: Buffer.from("petsik-build"),
    })).rejects.toThrow("Release artifact sha256 mismatch");
    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();
  });

  it("rejects version and content-type metadata mismatches", async () => {
    await expect(publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "available",
      version: "0.2.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      buffer: Buffer.from("petsik-build"),
    })).rejects.toThrow("Release artifact version must match Mac build tag");
    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();

    await expect(publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      contentType: "application/x-apple-diskimage",
      buffer: Buffer.from("petsik-build"),
    })).rejects.toThrow("Release artifact content type does not match filename");
    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();
  });

  it("rejects non-existing project targets without publishing bytes", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(null);

    await expect(publishProjectReleaseArtifact({
      projectId: "project-other",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      buffer: Buffer.from("petsik-build"),
    })).rejects.toThrow("Project not found");
    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();
  });

  it("returns an existing artifact for an idempotent same tag publish", async () => {
    const buffer = Buffer.from("petsik-build");
    const sha256 = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    const existing = {
      id: "release-existing",
      projectId: "project-1",
      platform: "macos",
      appKind: "electron",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      contentType: "application/zip",
      sizeBytes: buffer.byteLength,
      sha256,
      storageKey: "release-existing/Petsik.zip",
      builderLabel: "sample-machine",
      failureSummary: null,
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
      updatedAt: new Date("2026-06-22T10:00:00.000Z"),
    };
    mocks.projectReleaseArtifactFindFirst.mockResolvedValue(existing);

    await expect(publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      sha256,
      buffer,
    })).resolves.toBe(existing);
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();
  });

  it("rejects the same tag when it points to a different commit", async () => {
    mocks.projectReleaseArtifactFindFirst.mockResolvedValue({
      status: "build_failed",
      commitSha: "abc1234",
    });

    await expect(publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "build_failed",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "def5678",
    })).rejects.toThrow("Release artifact tag already points to a different commit SHA");
    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();
  });

  it("rejects the same tag when artifact metadata differs from the published download", async () => {
    const buffer = Buffer.from("petsik-build-v2");
    const sha256 = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    mocks.projectReleaseArtifactFindFirst.mockResolvedValue({
      status: "available",
      commitSha: "abc1234",
      sha256: `sha256:${"a".repeat(64)}`,
      sizeBytes: 10,
      filename: "Petsik.zip",
    });

    await expect(publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      sha256,
      buffer,
    })).rejects.toThrow("Release artifact tag already has a different published artifact");
    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(mocks.projectReleaseArtifactCreate).not.toHaveBeenCalled();
  });

  it("allows build_failed status without bytes and without a download payload", async () => {
    const artifact = await publishProjectReleaseArtifact({
      projectId: "project-1",
      status: "build_failed",
      tag: "mac-build/petsik-v0.1.1",
      commitSha: "def5678",
      failureSummary: "Electron packaging failed.",
    });

    expect(mocks.saveProjectReleaseBytes).not.toHaveBeenCalled();
    expect(artifact).toMatchObject({
      status: "build_failed",
      failureSummary: "Electron packaging failed.",
    });
    expect(artifact).not.toHaveProperty("filename");
    expect(artifact).not.toHaveProperty("storageKey");
  });
});
