import { test, expect } from "@playwright/test";
import { a2ePost, expectPreviewStatus, getProjectState, gotoWithRetry, openPreview, waitForProject } from "./helpers/runtime-a2e";
import { withScenarioArtifacts } from "./helpers/a2e-artifacts";

function getProjectIdFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const projectId = pathname.split("/").filter(Boolean).pop();
  if (!projectId) {
    throw new Error(`Could not extract project id from URL: ${url}`);
  }
  return projectId;
}

async function openCreateProjectDialog(page: import("@playwright/test").Page) {
  // Wait for hydration — networkidle never fires due to admin dashboard polling
  await page.waitForLoadState("domcontentloaded");
  const projectsTab = page.getByRole("button", { name: "Projects", exact: true });
  await projectsTab.waitFor({ state: "visible", timeout: 15_000 });
  await projectsTab.click();
  // Wait longer for React state update after tab click
  await page.waitForTimeout(1_500);

  const trigger = page.getByRole("button", { name: "+ Project" });
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await trigger.click();
    const isOpen = (await page.locator('[role="dialog"]').count()) > 0;
    if (isOpen) return;
    await page.waitForTimeout(500);
  }
  throw new Error("Create Project dialog did not open");
}

test.describe("E2E: platform regression combinations", () => {
  test.describe.configure({ mode: "serial" });

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

      await request
        .post("/api/test/a2e", {
          data: {
            action: "delete_project",
            projectId,
            removeDocker: true,
            removeWorkspace: true,
          },
        })
        .catch(() => undefined);
    }
  });

  test("admin create dialog launches a personal simple_web runtime project", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-008",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "admin_personal_recipe",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const projectName = `A2E Admin Simple Web ${Date.now()}`;

      await gotoWithRetry(page, "/admin?tab=projects");
      await openCreateProjectDialog(page);
      await expect(page.getByRole("heading", { name: "Create Project" })).toBeVisible();

      await page.getByRole("button", { name: "Simple Web Template" }).click();
      // Wait for dialog content to stabilize after recipe switch
      await page.getByText("no required secrets").waitFor({ state: "visible", timeout: 5_000 });
      await page.getByPlaceholder("My private agent project").fill(projectName);
      await page.locator('input[type="number"]').fill("13");
      await page.getByRole("button", { name: "Create Project" }).click();

      await page.waitForURL(/\/my\/projects\/[^/]+$/, { timeout: 60_000 });
      const projectId = getProjectIdFromUrl(page.url());
      cleanupProjectIds.push(projectId);
      artifacts.setProjectId(projectId);

      const running = await waitForProject(
        request,
        projectId,
        (state) => state.displayStatus === "RUNNING" && !!state.previewUrl,
      );
      artifacts.setPreviewUrl(running.previewUrl);

      await expect(page.locator("h1", { hasText: projectName })).toBeVisible();
      await expect(page.getByText("Mode: personal")).toBeVisible();
      await expect(page.getByText("Agent: service/simple_web")).toBeVisible();

      await expectPreviewStatus(request, new URL("/health", running.previewUrl!).toString(), 200, 60_000);
      await openPreview(page, running.previewUrl!);
      await expect(page.getByRole("heading", { name: "Simple Web Template" })).toBeVisible();
      await expect(page.getByText(/recipe runtime path/i)).toBeVisible();
    });
  });

  test("admin create dialog launches OpenClaw template and surfaces blocking secrets", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-009",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "admin_personal_recipe",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const projectName = `A2E Admin OpenClaw ${Date.now()}`;

      await gotoWithRetry(page, "/admin?tab=projects");
      await openCreateProjectDialog(page);
      await expect(page.getByRole("heading", { name: "Create Project" })).toBeVisible();

      await page.getByRole("button", { name: "OpenClaw Template" }).click();
      // Wait for dialog content to stabilize after recipe switch
      await page.getByText("requires password").waitFor({ state: "visible", timeout: 5_000 });
      await page.getByPlaceholder("My private agent project").fill(projectName);
      await page.locator('input[type="number"]').fill("21");
      await page.getByRole("button", { name: "Create Project" }).click();

      await page.waitForURL(/\/my\/projects\/[^/]+$/, { timeout: 60_000 });
      const projectId = getProjectIdFromUrl(page.url());
      cleanupProjectIds.push(projectId);
      artifacts.setProjectId(projectId);

      await waitForProject(
        request,
        projectId,
        (state) => state.displayStatus === "PAUSED",
        30_000,
      );

      await expect(page.locator("h1", { hasText: projectName })).toBeVisible();
      await expect(page.getByText("Run waiting for secrets")).toBeVisible();
      await expect(page.getByRole("heading", { name: /Required/i })).toBeVisible();
      await expect(page.getByText("OPENCLAW_GATEWAY_PASSWORD", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("OPENAI_API_KEY", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Provide" })).toHaveCount(3);
      await expect(page.getByRole("link", { name: "Open Preview" })).toHaveCount(0);
    });
  });

  test("admin ops shows container, workspace and overview panels for personal runtime project", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-010",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "ops_surface",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const projectName = `A2E Ops Simple Web ${Date.now()}`;

      const created = await a2ePost<{ projectId: string }>(request, {
        action: "create_personal_recipe_project",
        recipeId: "simple_web",
        name: projectName,
        initialBudgetUsd: 12,
        runnerBackend: "local",
      });
      cleanupProjectIds.push(created.projectId);
      artifacts.setProjectId(created.projectId);

      const running = await waitForProject(
        request,
        created.projectId,
        (state) => state.displayStatus === "RUNNING" && !!state.previewUrl,
      );
      artifacts.setPreviewUrl(running.previewUrl);

      await gotoWithRetry(page, `/admin?project=${created.projectId}&tab=overview`);
      const rightSidebar = page.locator("aside").nth(1);
      await expect(page.getByRole("heading", { level: 2, name: projectName })).toBeVisible();
      await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
      await expect(page.getByText("Usage")).toBeVisible();
      await expect(page.getByText("Recent Events")).toBeVisible();
      await expect(rightSidebar).toContainText("Container");
      await expect(rightSidebar).toContainText("Workspace");
      await expect(rightSidebar).toContainText("Secrets");
      await expect(rightSidebar).toContainText("Status");
      await expect(rightSidebar).toContainText("Host");
      await expect(rightSidebar).toContainText("No secrets configured");

      await expectPreviewStatus(request, new URL("/health", running.previewUrl!).toString(), 200, 60_000);
    });
  });

  test("admin ops surfaces waiting secrets state for OpenClaw project", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-011",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "ops_surface",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const projectName = `A2E Ops OpenClaw ${Date.now()}`;

      const created = await a2ePost<{ projectId: string }>(request, {
        action: "create_personal_recipe_project",
        recipeId: "openclaw",
        name: projectName,
        initialBudgetUsd: 20,
        runnerBackend: "local",
      });
      cleanupProjectIds.push(created.projectId);
      artifacts.setProjectId(created.projectId);

      await waitForProject(
        request,
        created.projectId,
        (state) => state.displayStatus === "PAUSED",
        30_000,
      );

      await gotoWithRetry(page, `/admin?project=${created.projectId}&tab=overview`);
      const rightSidebar = page.locator("aside").nth(1);
      await expect(page.getByRole("heading", { level: 2, name: projectName })).toBeVisible();
      await expect(rightSidebar).toContainText("Waiting for secrets");
      await expect(rightSidebar).toContainText("Missing required");
      await expect(rightSidebar).toContainText("OPENCLAW_GATEWAY_PASSWORD");
      await expect(rightSidebar).toContainText("OPENAI_API_KEY");
    });
  });

  test("community deployed project survives gallery power cycle, archive, restore, and relaunch", async ({ page, request }, testInfo) => {
    test.setTimeout(240_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-012",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "community_lifecycle",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const title = `A2E Gallery Dummy ${Date.now()}`;

      const proposal = await a2ePost<{ proposalId: string }>(request, {
        action: "create_or_get_proposal",
        title,
        description: "Community lifecycle regression around gallery/runtime controls",
        spec: "Build a healthy preview app and keep it running.",
      });

      const launch = await a2ePost<{ success: boolean; projectId: string }>(request, {
        action: "launch",
        proposalId: proposal.proposalId,
        agent: "codex",
        agentImpl: "dummy",
        runnerBackend: "local",
        model: "gpt-5.1-codex-mini",
        initialBudgetUsd: 15,
      });
      cleanupProjectIds.push(launch.projectId);
      artifacts.setProjectId(launch.projectId);

      const deployed = await waitForProject(
        request,
        launch.projectId,
        (state) => state.displayStatus === "DEPLOYED" && !!state.previewUrl,
      );
      const previewUrl = deployed.previewUrl!;
      artifacts.setPreviewUrl(previewUrl);

      await a2ePost(request, {
        action: "save_to_gallery",
        projectId: launch.projectId,
      });
      const savedToGallery = await getProjectState(request, launch.projectId);
      expect(savedToGallery.galleryFeatured).toBe(true);

      await gotoWithRetry(page, "/admin?tab=gallery");
      await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible({ timeout: 30_000 });

      await a2ePost(request, {
        action: "power_off",
        projectId: launch.projectId,
      });
      await waitForProject(
        request,
        launch.projectId,
        (state) => state.displayStatus === "SLEEPING",
        60_000,
      );
      await gotoWithRetry(page, "/admin?tab=gallery");

      await a2ePost(request, {
        action: "power_on",
        projectId: launch.projectId,
      });
      await waitForProject(
        request,
        launch.projectId,
        (state) => state.displayStatus === "DEPLOYED",
        60_000,
      );
      await expectPreviewStatus(request, previewUrl, 200, 120_000);

      await a2ePost(request, {
        action: "archive_gallery_project",
        projectId: launch.projectId,
      });
      await waitForProject(
        request,
        launch.projectId,
        (state) => state.displayStatus === "ARCHIVED",
        60_000,
      );
      await gotoWithRetry(page, "/admin?tab=gallery");

      await a2ePost(request, {
        action: "unarchive_then_power_on",
        projectId: launch.projectId,
      });

      await waitForProject(
        request,
        launch.projectId,
        (state) => state.displayStatus === "DEPLOYED",
        120_000,
      );
      await expectPreviewStatus(request, previewUrl, 200, 120_000);

      await gotoWithRetry(page, `/admin/projects/${launch.projectId}`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByText("DEPLOYED").first()).toBeVisible();

      await a2ePost(request, {
        action: "relaunch_project",
        projectId: launch.projectId,
      });
      await waitForProject(
        request,
        launch.projectId,
        (state) => state.displayStatus === "PROVISIONING",
        30_000,
      );

      const redeployed = await waitForProject(
        request,
        launch.projectId,
        (state) => state.displayStatus === "DEPLOYED" && !!state.previewUrl,
        180_000,
      );
      artifacts.setPreviewUrl(redeployed.previewUrl);
      expect(redeployed.runLogs?.some((entry) => entry.event === "LAUNCHED")).toBeTruthy();

      await expectPreviewStatus(request, new URL("/health", redeployed.previewUrl!).toString(), 200, 120_000);
      await openPreview(page, redeployed.previewUrl!);
      await expect(page.getByRole("heading", { name: "Dummy Agent" })).toBeVisible({ timeout: 15_000 });

      const finalState = await getProjectState(request, launch.projectId);
      expect(finalState.galleryFeatured).toBe(true);
      expect(finalState.projectState).toBe("ACTIVE");
      expect(finalState.displayStatus).toBe("DEPLOYED");
    });
  });
});
