import { test, expect } from '@playwright/test'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'

test.describe('authentication options A and B', () => {
  test('uses the remembered issuer without showing the issuer picker', async ({ browser }) => {
    test.skip(
      process.env.E2E_RUN_AUTH_OPTIONS !== 'true' ||
        process.env.E2E_USE_LOCAL_RUNTIME !== 'true',
      'Run npm run test:auth-options.'
    )

    const runtime = getLocalRuntime()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.goto(`${runtime.profileUrl}#me`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(async issuer => {
        localStorage.clear()
        sessionStorage.clear()
        if (indexedDB.databases) {
          await Promise.all((await indexedDB.databases()).map(database => new Promise<void>(resolve => {
            if (!database.name) {
              resolve()
              return
            }
            const request = indexedDB.deleteDatabase(database.name)
            request.onsuccess = request.onerror = request.onblocked = () => resolve()
          })))
        }
        localStorage.setItem('loginIssuer', issuer)
      }, new URL('/', runtime.profileUrl).href)
      await page.reload({ waitUntil: 'domcontentloaded' })

      await page.getByRole('button', { name: 'Log In', exact: true }).click()
      await page.waitForURL(url =>
        url.pathname.startsWith('/.account/login/password/') ||
        url.pathname.startsWith('/.account/oidc/consent/')
      )
      await expect(page.locator('solid-ui-login-modal')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('uses same-site detection and goes directly to authorization', async ({ browser }) => {
    test.skip(
      !process.env.E2E_SAME_SITE_AUTH_URL ||
        !process.env.E2E_AUTH_STORAGE_STATE ||
        process.env.E2E_RUN_AUTH_OPTIONS !== 'true',
      'Set E2E_SAME_SITE_AUTH_URL and E2E_AUTH_STORAGE_STATE for a real-domain Option A run.'
    )

    const context = await browser.newContext({
      storageState: process.env.E2E_AUTH_STORAGE_STATE
    })
    const page = await context.newPage()

    try {
      await page.goto(process.env.E2E_SAME_SITE_AUTH_URL!, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Log In', exact: true }).click()
      await page.waitForURL(url => url.pathname.startsWith('/.account/oidc/consent/'))
      await expect(page.locator('solid-ui-login-modal')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})
