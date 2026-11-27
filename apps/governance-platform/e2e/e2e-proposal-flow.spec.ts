import { test, expect } from '@playwright/test';

test.describe('E2E: proposal flow', () => {
  test('new proposal page renders required form controls', async ({ page }) => {
    await page.goto('/proposals/new', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'New Proposal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Proposal' })).toBeVisible();
    await expect(page.locator('input#title')).toHaveAttribute('required', '');
    await expect(page.locator('input#description')).toHaveAttribute('required', '');
    await expect(page.locator('textarea#spec')).toHaveAttribute('required', '');
    await expect(page.getByRole('link', { name: 'Cancel' })).toBeVisible();
  });
});
