import { test, expect } from '@playwright/test';
import { postJsonWithRetry } from './helpers/runtime-a2e';

type BudgetScenarioResponse = {
  projectId: string;
  scenario: 'public_exhausted' | 'public_warning';
  totalCreditsUsd: number;
  usedCreditsUsd: number;
  remainingUsd: number;
};

type PausedResumeSetupResponse = {
  projectId: string;
  expectedInitialRunStatus: 'PAUSED';
};

async function createScenario(
  request: any,
  scenario: 'public_exhausted' | 'public_warning',
  budgetVisibilityEnabled = true,
): Promise<BudgetScenarioResponse> {
  return postJsonWithRetry<BudgetScenarioResponse>(request, '/api/test/budget-scenarios', {
    data: { scenario, budgetVisibilityEnabled },
  });
}

test.describe('E2E: admin budget flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
    await context.addCookies([
      {
        name: 'e2e_admin_bypass',
        value: '1',
        url: base,
      },
      {
        name: 'e2e_relaunch_autoconfirm',
        value: '1',
        url: base,
      },
    ]);
  });

  test('public project page shows exhausted budget indicators', async ({ page, request }) => {
    const setup = await createScenario(request, 'public_exhausted');

    await page.goto(`/projects/${setup.projectId}`, { waitUntil: 'domcontentloaded' });
    const main = page.getByRole('main');

    await expect(main.getByTestId('project-budget-card').first()).toBeVisible();
    await expect(main.getByTestId('project-budget-total').first()).toContainText(`$${setup.totalCreditsUsd.toFixed(2)}`);
    await expect(main.getByTestId('project-budget-used').first()).toContainText(`$${setup.usedCreditsUsd.toFixed(2)}`);
    await expect(main.getByTestId('project-budget-remaining').first()).toContainText(`$${setup.remainingUsd.toFixed(2)}`);
    await expect(main.getByTestId('project-budget-progress-fill').first()).toHaveClass(/bg-rose-500/);
  });

  test('public project page shows warning budget indicators', async ({ page, request }) => {
    const setup = await createScenario(request, 'public_warning');

    await page.goto(`/projects/${setup.projectId}`, { waitUntil: 'domcontentloaded' });
    const main = page.getByRole('main');

    await expect(main.getByTestId('project-budget-card').first()).toBeVisible();
    await expect(main.getByTestId('project-budget-total').first()).toContainText(`$${setup.totalCreditsUsd.toFixed(2)}`);
    await expect(main.getByTestId('project-budget-used').first()).toContainText(`$${setup.usedCreditsUsd.toFixed(2)}`);
    await expect(main.getByTestId('project-budget-remaining').first()).toContainText(`$${setup.remainingUsd.toFixed(2)}`);
    await expect(main.getByTestId('project-budget-progress-fill').first()).toHaveClass(/bg-amber-500/);
  });

  test('public project page hides budget indicators when feature flag is off', async ({ page, request }) => {
    const setup = await createScenario(request, 'public_warning', false);

    await page.goto(`/projects/${setup.projectId}`, { waitUntil: 'domcontentloaded' });
    const main = page.getByRole('main');

    await expect(main.getByTestId('project-budget-card')).toHaveCount(0);
  });

  test('admin relaunch is blocked by budget and keeps project paused', async ({ page, request }) => {
    const setupBody = await postJsonWithRetry<{ projectId: string }>(request, '/api/test/budget-scenarios/relaunch-attempt');
    const projectId = setupBody.projectId as string;
    expect(projectId).toBeTruthy();

    // Trigger relaunch via test API (bypasses fragile UI autoconfirm)
    const relaunchBody = await postJsonWithRetry<{ success: boolean; error?: string }>(request, '/api/test/a2e', {
      data: { action: 'relaunch_project', projectId },
      headers: { cookie: 'e2e_admin_bypass=1' },
      requireOk: false,
    });
    // Relaunch should fail due to insufficient budget
    expect(relaunchBody.success).toBeFalsy();
    expect(relaunchBody.error).toMatch(/Insufficient budget/);

    await page.goto(`/admin/projects/${projectId}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('PAUSED').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Insufficient budget \(\$0\.05 remaining\)/).first()).toBeVisible();
    await expect(page.getByText(/Run queued\. Agent will start shortly\./)).toHaveCount(0);
  });

  test('admin top-up resumes paused-budget run and enqueues resumed run', async ({ page, request }) => {
    const setupBody = await postJsonWithRetry<PausedResumeSetupResponse>(request, '/api/test/budget-scenarios/paused-resume');
    const projectId = setupBody.projectId;
    expect(projectId).toBeTruthy();

    await page.goto(`/admin/projects/${projectId}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('PAUSED').first()).toBeVisible();

    const topUpBody = await postJsonWithRetry<{ resumedProjectId: string }>(request, '/api/test/budget-scenarios/paused-resume/top-up', {
      data: { projectId, totalCreditsUsd: 15 },
    });
    expect(topUpBody.resumedProjectId).toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByText('PROVISIONING').first()).toBeVisible();
    await expect(page.getByText('Resumed after budget top-up').first()).toBeVisible();
    await expect(page.getByText('RESUMED', { exact: true }).first()).toBeVisible();
  });
});
