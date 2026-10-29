/**
 * tests/e2e/smoke.spec.ts
 *
 * Playwright smoke test — to be expanded from M8 onward.
 * Verifies the dev server starts and the page loads.
 */
import { test, expect } from '@playwright/test';

test('smoke: page loads with correct title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/GPA Calculator/i);
});
