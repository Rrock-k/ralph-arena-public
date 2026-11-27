import { test, expect } from "@playwright/test";
import { a2ePost, expectPreviewStatus, getPreviewResponse, gotoWithRetry, openPreview, waitForProject } from "./helpers/runtime-a2e";
import { withScenarioArtifacts } from "./helpers/a2e-artifacts";

test.describe("E2E: runtime project combinations", () => {
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

  test("community proposal still launches and serves dummy preview", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-004",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "proposal",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const unique = `A2E Community Dummy ${Date.now()}`;
      const proposal = await a2ePost<{ proposalId: string }>(request, {
        action: "create_or_get_proposal",
        title: unique,
        description: "Community dummy launch smoke",
        spec: "Build a healthy preview app and keep it running.",
      });

      const launch = await a2ePost<{ success: boolean; projectId: string }>(request, {
        action: "launch",
        proposalId: proposal.proposalId,
        agent: "codex",
        agentImpl: "dummy",
        runnerBackend: "local",
        model: "gpt-5.1-codex-mini",
        initialBudgetUsd: 10,
      });
      cleanupProjectIds.push(launch.projectId);
      artifacts.setProjectId(launch.projectId);

      const running = await waitForProject(
        request,
        launch.projectId,
        (state) => state.displayStatus === "DEPLOYED" && !!state.previewUrl,
      );
      artifacts.setPreviewUrl(running.previewUrl);

      await gotoWithRetry(page, `/projects/${launch.projectId}`);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: unique }).first()).toBeVisible();
      await expect(main.getByText(/DEPLOYED/i).first()).toBeVisible();

      await expectPreviewStatus(request, new URL("/health", running.previewUrl!).toString(), 200, 60_000);
      await openPreview(page, running.previewUrl!);
      await expect(page.getByRole("heading", { name: "Dummy Agent" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Pipeline smoke test completed successfully/i)).toBeVisible({ timeout: 15_000 });
    });
  });

  test("personal agent project allows adding specs and serves dummy preview", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-005",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "personal_agent",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const created = await a2ePost<{ projectId: string }>(request, {
        action: "create_personal_agent_project",
        name: `A2E Personal Agent ${Date.now()}`,
        spec: "Build a preview-ready dummy app.",
        agent: "codex",
        agentImpl: "dummy",
        model: "gpt-5.1-codex-mini",
        initialBudgetUsd: 15,
        runnerBackend: "local",
      });
      cleanupProjectIds.push(created.projectId);
      artifacts.setProjectId(created.projectId);

      const running = await waitForProject(
        request,
        created.projectId,
        (state) => state.displayStatus === "DEPLOYED" && !!state.previewUrl,
      );
      artifacts.setPreviewUrl(running.previewUrl);

      await gotoWithRetry(page, `/my/projects/${created.projectId}`);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: /A2E Personal Agent/i }).first()).toBeVisible();
      await expect(main.getByText("Specifications")).toBeVisible();

      await a2ePost(request, {
        action: "create_spec",
        projectId: created.projectId,
        title: "Follow-up Spec",
        content: "Add one extra note for the runtime smoke test.",
      });

      const updated = await waitForProject(
        request,
        created.projectId,
        (state) => state.specs.length >= 2,
        60_000,
      );
      expect(updated.specs.some((spec) => spec.title === "Follow-up Spec")).toBeTruthy();

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Follow-up Spec" }).first()).toBeVisible();

      await expectPreviewStatus(request, new URL("/health", running.previewUrl!).toString(), 200, 60_000);
      await openPreview(page, running.previewUrl!);
      await expect(page.getByRole("heading", { name: "Dummy Agent" })).toBeVisible({ timeout: 15_000 });
    });
  });

  test("personal simple_web recipe reaches preview-ready state", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-006",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "recipe_simple_web",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const created = await a2ePost<{ projectId: string }>(request, {
        action: "create_personal_recipe_project",
        recipeId: "simple_web",
        name: `A2E Simple Web ${Date.now()}`,
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

      await gotoWithRetry(page, `/my/projects/${created.projectId}`);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: /A2E Simple Web/i }).first()).toBeVisible();
      await expect(main.getByText("Mode: personal", { exact: true })).toBeVisible();
      await expect(main.getByText("Agent: service/simple_web", { exact: true })).toBeVisible();

      await expectPreviewStatus(request, new URL("/health", running.previewUrl!).toString(), 200, 60_000);
      await openPreview(page, running.previewUrl!);
      await expect(page.getByRole("heading", { name: "Simple Web Template" })).toBeVisible();
      await expect(page.getByText(/recipe runtime path/i)).toBeVisible();

      const healthResponse = await getPreviewResponse(request, new URL("/health", running.previewUrl!).toString());
      expect(healthResponse.ok()).toBeTruthy();
      const health = await healthResponse.json();
      expect(health.ok).toBe(true);
      expect(health.projectId).toBe(created.projectId);
    });
  });

  test("personal OpenClaw template waits for secrets, resumes, and connects", async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    await withScenarioArtifacts({
      scenarioId: "A2E4-L1-007",
      lane: "lane_1",
      environment: "local",
      bootstrapKind: "recipe_openclaw",
      testTitle: testInfo.title,
      testInfo,
      request,
      page,
    }, async (artifacts) => {
      const created = await a2ePost<{ projectId: string }>(request, {
        action: "create_personal_recipe_project",
        recipeId: "openclaw",
        name: `A2E OpenClaw ${Date.now()}`,
        initialBudgetUsd: 20,
        runnerBackend: "local",
      });
      cleanupProjectIds.push(created.projectId);
      artifacts.setProjectId(created.projectId);

      const paused = await waitForProject(
        request,
        created.projectId,
        (state) => state.displayStatus === "PAUSED",
        30_000,
      );
      expect(paused.previewUrl).toBeNull();

      await gotoWithRetry(page, `/my/projects/${created.projectId}`);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: /A2E OpenClaw/i }).first()).toBeVisible();
      await expect(main.getByText("Run waiting for secrets")).toBeVisible();
      await expect(main.getByRole("heading", { name: /Required/i }).first()).toBeVisible();
      await expect(main.getByRole("button", { name: "Provide" })).toHaveCount(3);

      await a2ePost(request, {
        action: "create_secret",
        projectId: created.projectId,
        key: "OPENCLAW_GATEWAY_PASSWORD",
        value: "arena-openclaw-password",
      });
      await a2ePost(request, {
        action: "create_secret",
        projectId: created.projectId,
        key: "OPENAI_API_KEY",
        value: "sk-a2e-openclaw-test-key",
      });

      await page.reload({ waitUntil: "domcontentloaded" });

      const resumeButton = page.getByRole("button", { name: /Resume/i });
      const hasResumeButton = await resumeButton.isVisible().catch(() => false);
      if (hasResumeButton) {
        await resumeButton.click();
        await expect(main.getByText(/Run resumed/i)).toBeVisible();
      }

      const running = await waitForProject(
        request,
        created.projectId,
        (state) => state.displayStatus === "RUNNING" && !!state.previewUrl,
        300_000,
      );
      artifacts.setPreviewUrl(running.previewUrl);

      await expectPreviewStatus(request, new URL("/health", running.previewUrl!).toString(), 200, 120_000);

      const previewPage = await page.context().newPage();
      const consoleErrors: string[] = [];
      previewPage.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });
      previewPage.on("pageerror", (error) => {
        consoleErrors.push(String(error));
      });

      await gotoWithRetry(previewPage, running.previewUrl!);
      await expect.poll(
        async () => await previewPage.locator("body").innerText(),
        { timeout: 120_000 },
      ).toContain("Gateway Dashboard");
      await expect(previewPage.getByRole("button", { name: /connect/i })).toBeVisible({ timeout: 120_000 });
      await previewPage.locator('input[type="password"]').last().fill("arena-openclaw-password");
      await previewPage.getByRole("button", { name: /connect/i }).click();
      await expect(previewPage.getByText("Ready to chat")).toBeVisible({ timeout: 120_000 });
      await expect(previewPage.getByText("OpenClaw › Chat")).toBeVisible();
      expect(consoleErrors).toEqual([]);
      await previewPage.close();
    });
  });
});
