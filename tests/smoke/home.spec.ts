import { test, expect } from '../../fixtures/test.js'

test('application is reachable', async ({ page }) => {
  test.skip(
    process.env.E2E_RUN_SMOKE !== 'true',
    'Set E2E_RUN_SMOKE=true to run against an application.'
  )

  await page.goto('/')
  await expect(page).toHaveTitle(/.+/)
})
