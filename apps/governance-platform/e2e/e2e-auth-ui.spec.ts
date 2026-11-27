import { test, expect } from '@playwright/test';

test.describe('E2E: auth ui', () => {
  test('unauthenticated header shows sign-in entrypoint', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('link', { name: /^Sign in$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /R Ralph Arena/ })).toBeVisible();
  });
});
