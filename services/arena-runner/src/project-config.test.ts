import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRalphConfigFlagToCommand,
  materializeRalphProjectConfig,
  materializeRalphRuntimeConfig,
} from "./project-config.ts";

const roots: string[] = [];

function tempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "arena-runner-project-config-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("materializeRalphProjectConfig", () => {
  it("writes explicit Ralph project config from package.json and keeps it out of git commits", () => {
    const workspace = tempWorkspace();
    mkdirSync(join(workspace, ".git", "info"), { recursive: true });
    writeFileSync(join(workspace, "package.json"), JSON.stringify({
      name: "example-app",
      scripts: { start: "node src/server.js", test: "node --test" },
      dependencies: {
        express: "^4.19.2",
        abcjs: "^6.6.3",
      },
      devDependencies: {
        "puppeteer-core": "^22.15.0",
      },
    }));

    const result = materializeRalphProjectConfig(workspace, {
      project: { id: "proj-1", name: "example-app" },
      proposal: { title: "Example App", description: "Rhythm practice app" },
      repo: {
        url: "https://x-access-token:placeholder-token@github.com/example-owner/arena-example-app",
        baseBranch: "main",
        projectBranch: "arena/project-proj-1",
      },
    });

    expect(result).toMatchObject({
      status: "written",
      techStack: {
        language: "javascript",
        framework: "express",
        runtime: "node",
      },
    });
    const projectConfig = JSON.parse(readFileSync(join(workspace, "project.config.json"), "utf-8"));
    expect(projectConfig).toMatchObject({
      xArenaGeneratedBy: "arena-runner",
      name: "example-app",
      description: "Rhythm practice app",
      techStack: {
        language: "javascript",
        framework: "express",
        runtime: "node",
      },
      repository: {
        url: "https://github.com/example-owner/arena-example-app",
        branch: "main",
        deployBranch: "arena/project-proj-1",
      },
    });
    expect(readFileSync(join(workspace, ".git", "info", "exclude"), "utf-8")).toContain("/project.config.json");
  });

  it("preserves user-owned project config", () => {
    const workspace = tempWorkspace();
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ dependencies: { express: "^4.19.2" } }));
    writeFileSync(join(workspace, "project.config.json"), JSON.stringify({
      name: "custom",
      description: "User owned",
      techStack: { language: "typescript", framework: "three", runtime: "webgl" },
      repository: { url: "", branch: "main" },
    }));

    const result = materializeRalphProjectConfig(workspace, {
      project: { id: "proj-1", name: "example-app" },
    });

    expect(result).toEqual({
      status: "preserved",
      path: join(workspace, "project.config.json"),
    });
    const projectConfig = JSON.parse(readFileSync(join(workspace, "project.config.json"), "utf-8"));
    expect(projectConfig.techStack).toEqual({ language: "typescript", framework: "three", runtime: "webgl" });
  });

  it("preserves existing unreadable project config instead of replacing it", () => {
    const workspace = tempWorkspace();
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ dependencies: { express: "^4.19.2" } }));
    writeFileSync(join(workspace, "project.config.json"), "{not json");

    const result = materializeRalphProjectConfig(workspace, {
      project: { id: "proj-1", name: "example-app" },
    });

    expect(result).toEqual({
      status: "preserved",
      path: join(workspace, "project.config.json"),
    });
    expect(readFileSync(join(workspace, "project.config.json"), "utf-8")).toBe("{not json");
  });

  it("carries non-ordinary UI dependencies into tech stack tokens", () => {
    const workspace = tempWorkspace();
    writeFileSync(join(workspace, "package.json"), JSON.stringify({
      dependencies: {
        react: "^19.0.0",
        three: "^0.170.0",
        "@react-three/fiber": "^9.0.0",
      },
    }));

    const result = materializeRalphProjectConfig(workspace, {
      project: { id: "proj-1", name: "canvas app" },
    });

    expect(result).toMatchObject({
      status: "written",
      techStack: {
        language: "javascript",
        framework: "react three",
        runtime: "browser webgl",
      },
    });
  });
});

describe("materializeRalphRuntimeConfig", () => {
  it("skips runner-owned Ralph config when init does not explicitly provide one", () => {
    const workspace = tempWorkspace();

    const result = materializeRalphRuntimeConfig(workspace, {});

    expect(result).toEqual({
      status: "skipped",
      path: join(workspace, ".arena", "ralph.config.json"),
      reason: "not_configured",
    });
  });

  it("writes runner-owned Ralph config under .arena and keeps it out of git commits", () => {
    const workspace = tempWorkspace();
    mkdirSync(join(workspace, ".git", "info"), { recursive: true });

    const result = materializeRalphRuntimeConfig(workspace, {
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

    expect(result).toEqual({
      status: "written",
      path: join(workspace, ".arena", "ralph.config.json"),
    });
    expect(JSON.parse(readFileSync(join(workspace, ".arena", "ralph.config.json"), "utf-8"))).toMatchObject({
      visualWorkbench: {
        visualEvidenceMode: "required",
        executorCaptureShell: {
          mode: "allowlisted",
          allowedServeCommands: ["npm run visual-workbench"],
          allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
        },
      },
    });
    expect(readFileSync(join(workspace, ".git", "info", "exclude"), "utf-8")).toContain(
      "/.arena/ralph.config.json",
    );
  });

  it("rejects runner-owned Ralph config outside the shared strict contract", () => {
    const workspace = tempWorkspace();

    expect(() =>
      materializeRalphRuntimeConfig(workspace, {
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
  });

  it("appends explicit --config and refuses competing command config", () => {
    expect(appendRalphConfigFlagToCommand("node ralph.js run --work-dir /workspace", "/workspace/.arena/ralph.config.json")).toBe(
      "node ralph.js run --work-dir /workspace --config '/workspace/.arena/ralph.config.json'",
    );
    expect(() =>
      appendRalphConfigFlagToCommand("node ralph.js run --config ./ralph.config.json", "/workspace/.arena/ralph.config.json"),
    ).toThrow(/already contains --config/);
  });
});
