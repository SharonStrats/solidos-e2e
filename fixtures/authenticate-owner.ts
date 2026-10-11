import type { Page } from '@playwright/test'
import { getLocalRuntime } from './local-runtime.js'

export async function authenticateProfileOwner(page: Page): Promise<void> {
  const runtime = getLocalRuntime()
  const baseURL = new URL(runtime.profileUrl).origin

  await page.goto(`${runtime.profileUrl}#me`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Log In', exact: true }).click()
  await page.getByRole('heading', { name: 'Select an identity provider' }).waitFor()
  await page.getByRole('button', { name: 'Login', exact: true }).click()
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
  const authenticatedProfileFetch = page.waitForResponse((response) =>
    response.url() === runtime.profileUrl && response.ok()
  )
  await page.getByRole('button', { name: 'Authorize', exact: true }).click()
  await page.waitForURL((url) => url.origin === baseURL && !url.pathname.startsWith('/.account/'))
  await authenticatedProfileFetch
  await page.goto(`${runtime.profileUrl}#me`, { waitUntil: 'networkidle' })
}
