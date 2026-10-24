import { test, expect } from '@playwright/test'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'

test('login becomes available and completes through the local identity provider', async ({ browser }) => {
  test.setTimeout(60_000)
  test.skip(
    process.env.E2E_RUN_AUTH !== 'true' ||
      process.env.E2E_USE_LOCAL_RUNTIME !== 'true',
    'Run npm run setup:local, then set E2E_RUN_AUTH and E2E_USE_LOCAL_RUNTIME.'
  )

  const runtime = getLocalRuntime()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(`${runtime.profileUrl}#me`, { waitUntil: 'domcontentloaded' })

    // A stalled session restore used to leave this control replaced by a
    // spinner forever. It must become actionable before login can start.
    const loginTrigger = page.getByRole('button', { name: 'Log In', exact: true })
    await expect(loginTrigger).toBeEnabled({ timeout: 15_000 })
    await loginTrigger.click()

    const issuerInput = page.locator('solid-ui-login-modal solid-ui-combobox input')
    await expect(issuerInput).toBeVisible()
    await issuerInput.fill(new URL('/', runtime.profileUrl).href)
    const submitLogin = page.getByRole('button', { name: 'Login', exact: true })
    await expect(submitLogin).toBeEnabled()
    await submitLogin.click()

    await page.waitForURL((url) =>
      url.pathname.startsWith('/.account/login/password/') ||
      url.pathname.startsWith('/.account/oidc/consent/')
    )
    if (page.url().includes('/.account/login/password/')) {
      await page.getByLabel('Email / username', { exact: true }).fill(runtime.email)
      await page.getByLabel('Password', { exact: true }).fill(runtime.password)
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await page.waitForURL('**/.account/oidc/consent/**')
    }

    await page.locator('#authorize:not([disabled])').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Authorize', exact: true }).click()
    await page.waitForURL((url) => url.origin === new URL(runtime.profileUrl).origin && !url.pathname.startsWith('/.account/'))
    await page.waitForFunction((expectedWebId) => {
      const session = (window as typeof window & {
        SolidLogic?: { authSession?: { info?: { isLoggedIn?: boolean, webId?: string } } }
      }).SolidLogic?.authSession
      return session?.info?.isLoggedIn === true && session.info.webId === expectedWebId
    }, runtime.webId)
  } finally {
    await context.close()
  }
})
