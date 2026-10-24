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

async function waitForConsentAuthorization(page: Page): Promise<void> {
  const authorizeButton = page.locator('#authorize:not([disabled])')
  const timeout = 15_000

  try {
    await authorizeButton.waitFor({ state: 'visible', timeout })
    return
  } catch (error) {
    if (!page.url().includes('/.account/oidc/consent/')) throw error
    console.log(`[e2e ${new Date().toISOString()}] Consent page did not become actionable within ${timeout}ms; reloading it once.`)
  }

  await page.reload({ waitUntil: 'domcontentloaded' })
  await authorizeButton.waitFor({ state: 'visible', timeout })
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
  // Mirror the solid-ui login button: the OIDC redirect URL cannot carry a
  // fragment, so #me is saved here and restored by SolidLogic on return,
  // before the main page chooses the profile pane.
  await page.evaluate(({ issuer, redirectUrl }) => {
    const session = (window as SolidSessionWindow).SolidLogic?.authSession
    if (!session?.login) throw new Error('SolidOS authentication session is unavailable.')
    localStorage.setItem('preLoginRedirectHash', new URL(window.location.href).hash)
    return session.login(issuer, redirectUrl)
  }, { issuer: `${baseURL}/`, redirectUrl: runtime.profileUrl })
  await page.waitForURL((url) =>
    url.pathname.startsWith('/.account/login/password/') ||
    url.pathname.startsWith('/.account/oidc/consent/'),
  { waitUntil: 'domcontentloaded' })

  if (page.url().includes('/.account/login/password/')) {
    await page.getByLabel('Email / username', { exact: true }).fill(user.username)
    await page.getByLabel('Password', { exact: true }).fill(user.password)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await page.waitForURL('**/.account/oidc/consent/**', { waitUntil: 'domcontentloaded' })
  }

  await waitForConsentAuthorization(page)
  await page.getByRole('button', { name: 'Authorize', exact: true }).click()
  await page.waitForURL((url) => url.origin === baseURL && !url.pathname.startsWith('/.account/'))

  const waitForLogin = () => page.waitForFunction(({ expectedWebId }) => {
    const session = (window as SolidSessionWindow).SolidLogic?.authSession
    return Boolean(session?.info?.isLoggedIn && session.info.webId === expectedWebId)
  }, { expectedWebId: user.webId })

  await waitForLogin()
  // Only adding #me to the current document would be a same-document
  // navigation that does not re-initialize the page, so load it fully.
  if (page.url() !== `${runtime.profileUrl}#me`) {
    console.log(`[e2e ${new Date().toISOString()}] Login returned to ${page.url()}; reloading the WebID.`)
    await page.goto(`${runtime.profileUrl}#me`, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForLogin()
  }

  // solid-logic restores (and then clears) preLoginRedirectHash on the next
  // page load. If it is still pending, the test's next page.goto() would get
  // "#me" appended and render a profile instead of the requested view.
  await page.waitForFunction(() => !localStorage.getItem('preLoginRedirectHash'), undefined, { timeout: 5_000 })
    .catch(() => undefined)
  await page.evaluate(() => localStorage.removeItem('preLoginRedirectHash'))
}

export async function authenticateProfileOwner (page: Page): Promise<void> {
  const runtime = getLocalRuntime()
  await authenticateSolidUser(page, {
    webId: runtime.webId,
    username: runtime.email,
    password: runtime.password
  })
}
