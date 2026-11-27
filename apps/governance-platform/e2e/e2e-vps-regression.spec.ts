import { expect, test } from "@playwright/test";
import {
  a2ePost,
  expectPreviewStatus,
  expectWorkerParityClean,
  gotoWithRetry,
  openPreview,
  waitForProject,
} from "./helpers/runtime-a2e";
import { withScenarioArtifacts } from "./helpers/a2e-artifacts";

const VPS_ENABLED = process.env.A2E_ENABLE_VPS === "1";
const VPS_SERVER_TYPE = process.env.A2E_VPS_SERVER_TYPE || undefined;

test.describe("E2E: VPS regression baseline", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!VPS_ENABLED, "Set A2E_ENABLE_VPS=1 to run VPS baseline.");

  const cleanupProjectIds: string[] = [];

  test.beforeEach(async ({ context }) => {
    const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
    await context.addCookies([
      {
        name: "e2e_admin_bypass",
        value: "1",
        url: base,
      },
      {
        name: "e2e_relaunch_autoconfirm",
        value: "1",
        url: base,
      },
    ]);
  });

  test.afterEach(async ({ request }) => {
    while (cleanupProjectIds.length > 0) {
      const projectId = cleanupProjectIds.pop();
      if (!projectId) continue;

      await request.post("/api/test/a2e", {
        data: {
          action: "delete_project",
          projectId,
          removeDocker: true,
          removeWorkspace: true,
        },
      }).catch(() => undefined);
    }
  });

  test("personal simple_web on VPS reaches parity-clean preview-ready state", async ({ page, request }, testInfo) => {
    test.setTimeout(12 * 60_000);

    await withScenarioArtifacts({
      scenarioId: "A2E4-L2-001",
      lane: "lane_2",
      environment: "vps",
      bootstrapKind: "recipe_simple_web",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const created = await a2ePost<{ projectId: string }>(request, {
        action: "create_personal_recipe_project",
        recipeId: "simple_web",
        name: `A2E VPS Simple Web ${Date.now()}`,
        initialBudgetUsd: 15,
        runnerBackend: "vps",
        vpsServerType: VPS_SERVER_TYPE ?? null,
      });
      cleanupProjectIds.push(created.projectId);
      artifacts.setProjectId(created.projectId);

      const running = await waitForProject(
        request,
        created.projectId,
        (state) =>
          state.displayStatus === "RUNNING"
          && !!state.previewUrl
          && !!state.vpsHost?.ip
          && state.workerHost !== "local",
        10 * 60_000,
      );
      artifacts.setPreviewUrl(running.previewUrl);

      await expectWorkerParityClean(request, created.projectId, 120_000);
      await expectPreviewStatus(request, new URL("/health", running.previewUrl!).toString(), 200, 180_000);

      await gotoWithRetry(page, `/my/projects/${created.projectId}`);
      await expect(page.getByRole("heading", { name: /A2E VPS Simple Web/i })).toBeVisible();
      await expect(page.getByText("Mode: personal")).toBeVisible();

      await openPreview(page, running.previewUrl!);
      await expect(page.getByRole("heading", { name: "Simple Web Template" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/recipe runtime path/i)).toBeVisible();
    });
  });
});
