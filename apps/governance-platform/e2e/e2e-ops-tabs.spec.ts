import { test, expect } from "@playwright/test";
import { getJsonWithRetry } from "./helpers/runtime-a2e";

/**
 * E2E: Ops dashboard shell loads correctly (no permanent "Loading...").
 *
 * The admin shell now owns navigation through the collapsible left sidebar.
 * Uses API endpoints to verify that lazy ops-data tabs still resolve.
 */
test.describe("E2E: ops dashboard tabs", () => {
  test.beforeEach(async ({ context }) => {
    const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
    await context.addCookies([
      { name: "e2e_admin_bypass", value: "1", url: base },
    ]);
  });

  test("all tabs resolve content without permanent Loading spinner", async ({ page, request }) => {
    test.setTimeout(90_000);

    // 1. Verify admin shell loads in full-admin mode.
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    const sidebar = page.locator("aside").first();
    await expect(sidebar.getByRole("button", { name: /Projects/ })).toBeVisible({ timeout: 15_000 });

    // 2. Verify Projects is an explicit drill-in view with a way back to full admin.
    await sidebar.getByRole("button", { name: /Projects/ }).click();
    await expect(sidebar.getByRole("button", { name: "Back to full admin sidebar" })).toBeVisible({ timeout: 5_000 });
    await expect(sidebar.getByRole("button", { name: "Status" })).toBeVisible({ timeout: 5_000 });
    await sidebar.getByRole("button", { name: "Back to full admin sidebar" }).click();
    await expect(sidebar.getByRole("button", { name: "Status" })).not.toBeVisible({ timeout: 5_000 });
    await expect(sidebar.getByRole("button", { name: "Lab" })).toBeVisible({ timeout: 5_000 });
    await sidebar.getByRole("button", { name: "Lab" }).click();
    await expect(page.getByRole("heading", { name: "Laboratory" })).toBeVisible({ timeout: 5_000 });

    // 3. Verify collapse and expand are separate from entering/exiting Projects.
    await page.getByRole("button", { name: "Collapse admin sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand admin sidebar" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Expand admin sidebar" }).click();
    await expect(page.getByRole("button", { name: "Collapse admin sidebar" })).toBeVisible({ timeout: 5_000 });

    // Verify no stuck loading for the initial shell content.
    const loadingText = page.locator("div").filter({ hasText: /^Loading\.\.\.$/ });
    await expect(loadingText).not.toBeVisible({ timeout: 15_000 });

    // 4. Verify lazy-loaded tabs via API.
    // "config" and "quota" are SSR-rendered, not lazy-loaded via this API
    const lazyTabs = ["proposals", "seasons", "registry", "jobs", "vps", "notifications"];
    for (const tab of lazyTabs) {
      const body = await getJsonWithRetry<Record<string, unknown>>(request, `/api/admin/ops-data?tab=${tab}`, {
        headers: { cookie: "e2e_admin_bypass=1" },
      });
      expect(body).toBeTruthy();
    }
  });
});
