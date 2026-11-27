import { describe, expect, it } from "vitest";
import { parseAcceptedSpecArtifact } from "@arena/contracts";
import { PROJECT_ADDONS } from "@/lib/project-addons";
import {
  buildProjectAddonAcceptedArtifact,
  buildProjectAddonArtifactMetadataHash,
  buildProjectAddonSpecVersionCreate,
} from "@/lib/project-addon-artifacts";

describe("project add-on accepted artifacts", () => {
  it("turns the Telegram Mini App add-on into mandatory loop work without secret values", () => {
    const telegramAddon = PROJECT_ADDONS.find((addon) => addon.id === "telegram_mini_app");
    expect(telegramAddon).toBeTruthy();

    const artifact = buildProjectAddonAcceptedArtifact(telegramAddon!, {
      acceptedAt: new Date("2026-05-29T00:00:00.000Z"),
    });
    const parsed = parseAcceptedSpecArtifact(artifact);

    expect(parsed.source.sourceSystem).toBe("arena");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("setChatMenuButton");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("ARENA_TELEGRAM_PREVIEW_URL");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("expand()");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("disableVerticalSwipes()");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("expanded sheet rather than forcing fullscreen");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("do not call `requestFullscreen()` by default");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("do not drive root, feed, carousel, or tab-shell height");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("viewportStableHeight");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("raw `ARENA_PREVIEW_URL`");
    expect(parsed.acceptedSpec.renderedMarkdown).not.toContain('isVersionAtLeast("8.0")');
    expect(parsed.acceptedDiff.items).toEqual([
      expect.objectContaining({
        targetType: "spec",
        workImpact: "requires_loop_work",
        summary: expect.stringContaining("TELEGRAM_BOT_TOKEN"),
      }),
    ]);
    expect(parsed.secretRequirements).toEqual([
      expect.objectContaining({
        key: "TELEGRAM_BOT_TOKEN",
        required: true,
        blocking: true,
      }),
    ]);
    expect(JSON.stringify(parsed)).not.toContain("123456:token");
  });

  it("builds SpecVersion create data with metadata hash and accepted artifact", () => {
    const telegramAddon = PROJECT_ADDONS.find((addon) => addon.id === "telegram_mini_app");
    expect(telegramAddon).toBeTruthy();

    const versionCreate = buildProjectAddonSpecVersionCreate(telegramAddon!, {
      acceptedAt: new Date("2026-05-29T00:00:00.000Z"),
    });

    expect(versionCreate).toEqual(expect.objectContaining({
      version: 1,
      content: expect.stringContaining("setChatMenuButton"),
      externalSourceSystem: "arena",
      externalSourceVersion: 1,
      externalMetadataHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      acceptedArtifact: expect.objectContaining({
        artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
      }),
    }));
    expect(versionCreate.externalMetadataHash).toBe(
      buildProjectAddonArtifactMetadataHash(versionCreate.acceptedArtifact as any),
    );
  });

  it("turns the Mac Electron add-on into loop work without synthetic secrets", () => {
    const macAddon = PROJECT_ADDONS.find((addon) => addon.id === "mac_electron_app");
    expect(macAddon).toBeTruthy();

    const artifact = buildProjectAddonAcceptedArtifact(macAddon!, {
      acceptedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    const parsed = parseAcceptedSpecArtifact(artifact);

    expect(parsed.acceptedSpec.renderedMarkdown).toContain("Electron desktop app");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("normal Arena web preview");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("npm run dist:mac");
    expect(parsed.acceptedSpec.renderedMarkdown).toContain("sha256 verification");
    expect(parsed.acceptedDiff.summary).toBe(
      "Project add-on selected: Mac Electron App. Implement the add-on requirements.",
    );
    expect(parsed.secretRequirements).toEqual([]);
    expect(JSON.stringify(parsed)).not.toContain("required secret key(s):");
  });
});
