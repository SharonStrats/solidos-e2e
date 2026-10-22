import type { Page } from '@playwright/test'
import { getLocalRuntime } from './local-runtime.js'
import type { TestUser } from './test-users.js'

type SolidSessionWindow = Window & {
  SolidLogic?: {
    authSession?: {
      info?: { isLoggedIn?: boolean, webId?: string }
      fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      authFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      login?: (issuer: string, redirectUrl: string) => Promise<void>
    }
  }
}

export async function authenticateSolidUser (page: Page, user: TestUser): Promise<void> {
  const runtime = getLocalRuntime()
  const baseURL = new URL(runtime.profileUrl).origin
  if (!user.username || !user.password) {
    throw new Error('The requested E2E Solid user has no username and password configured.')
  }

  await page.context().clearCookies()
  await page.goto(`${runtime.profileUrl}#me`, { waitUntil: 'domcontentloaded' })
  // SolidOS keeps the local OIDC session in IndexedDB. Clearing cookies alone
  // leaves the previous test's in-memory/session database available, so a
  // subsequent login can redirect successfully without restoring the user
  // expected by this test.
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    if (!indexedDB.databases) return
    await Promise.all((await indexedDB.databases()).map(database => new Promise<void>((resolve) => {
      if (!database.name) {
        resolve()
        return
      }
      const request = indexedDB.deleteDatabase(database.name)
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.evaluate(({ issuer, redirectUrl }) => {
    const session = (window as SolidSessionWindow).SolidLogic?.authSession
    if (!session?.login) throw new Error('SolidOS authentication session is unavailable.')
    return session.login(issuer, redirectUrl)
  }, { issuer: `${baseURL}/`, redirectUrl: runtime.profileUrl })
  await page.waitForURL((url) =>
    url.pathname.startsWith('/.account/login/password/') ||
    url.pathname.startsWith('/.account/oidc/consent/')
  )

  if (page.url().includes('/.account/login/password/')) {
    await page.getByLabel('Email / username', { exact: true }).fill(user.username)
    await page.getByLabel('Password', { exact: true }).fill(user.password)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await page.waitForURL('**/.account/oidc/consent/**')
  }

  await page.locator('#authorize:not([disabled])').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Authorize', exact: true }).click()
  await page.waitForURL((url) => url.origin === baseURL && !url.pathname.startsWith('/.account/'))

  await page.waitForFunction(({ expectedWebId }) => {
    const session = (window as SolidSessionWindow).SolidLogic?.authSession
    return Boolean(session?.info?.isLoggedIn && session.info.webId === expectedWebId)
  }, { expectedWebId: user.webId })
  await page.goto(`${runtime.profileUrl}#me`, { waitUntil: 'domcontentloaded' })
}

export async function authenticateProfileOwner (page: Page): Promise<void> {
  const runtime = getLocalRuntime()
  await authenticateSolidUser(page, {
    webId: runtime.webId,
    username: runtime.email,
    password: runtime.password
  })
}
