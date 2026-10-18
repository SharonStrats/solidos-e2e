import { expect, test, type Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { resetLocalProfile } from '../../fixtures/reset-local-profile.js'
import { readPersistedProfile, rdf } from '../../fixtures/rdf-verification.js'

const fixedAccountItems = ['Profile', 'Friends', 'Dashboard', 'Preferences']
const friendProfileUrl = process.env.E2E_FRIEND_PROFILE_URL
const friendWebId = process.env.E2E_FRIEND_TARGET_WEBID

test.describe('profile navigation and friendship flows', () => {
  test.setTimeout(60_000)

  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_PROFILE_NAVIGATION !== 'true',
      'Set E2E_RUN_PROFILE_NAVIGATION=true to run profile navigation coverage.'
    )
    test.skip(
      process.env.E2E_RUN_LOCAL_PROFILE !== 'true' || process.env.E2E_USE_LOCAL_RUNTIME !== 'true',
      'Run npm run setup:local, then enable E2E_RUN_LOCAL_PROFILE and E2E_USE_LOCAL_RUNTIME.'
    )

    await resetLocalProfile()
    await authenticateProfileOwner(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/)
  })

  test('opens every logged-in account-menu destination and preserves route subjects', async ({ page }) => {
    const runtime = getLocalRuntime()
    const menuItems = await accountMenuItems(page)
    const storageItems = menuItems.filter((item) => !fixedAccountItems.includes(item) && item !== 'Sign out')

    expect(menuItems).toEqual(expect.arrayContaining([...fixedAccountItems, 'Sign out']))
    expect(storageItems.length).toBeGreaterThan(0)

    await selectAccountItem(page, 'Profile')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/)
    await expectNavigationState(page, { paneName: 'profile', paneUri: runtime.webId })

    await selectAccountItem(page, 'Friends')
    await expect(page.getByRole('tablist', { name: 'Social sections' })).toBeVisible()
    await expectNavigationState(page, { paneName: 'social', paneUri: runtime.webId })

    for (const item of storageItems) {
      await selectAccountItem(page, item)
      await expect(page.locator('folder-pane-container').getByRole('listbox', { name: 'Container resources' })).toBeVisible()
      await expectNavigationState(page, { paneName: 'folder', paneUri: runtime.podUrl })
    }

    await selectAccountItem(page, 'Dashboard')
    await expectNavigationState(page, { paneName: 'home' })

    await selectAccountItem(page, 'Preferences')
    await expectNavigationState(page, { paneName: 'basicPreferences' })
  })

  test('goes back from Friends to the profile route and resource', async ({ page }) => {
    const runtime = getLocalRuntime()

    await selectAccountItem(page, 'Friends')
    await expect(page.getByRole('tablist', { name: 'Social sections' })).toBeVisible()
    await page.goBack()

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/)
    await expectNavigationState(page, { paneName: 'profile', paneUri: runtime.webId })
    expect(new URL(page.url()).origin).toBe(new URL(runtime.profileUrl).origin)
    expect(new URL(page.url()).pathname).toBe(new URL(runtime.profileUrl).pathname)
  })

  test('shows the logged-in user profile without a self-friend action', async ({ page }) => {
    await expect(page.getByLabel('Add or edit heading information')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Friend relationship actions' })).toHaveCount(0)
  })

  test('adds a friend and keeps the existing-friend state on reload', async ({ page }) => {
    test.skip(
      !friendProfileUrl || !friendWebId,
      'Set E2E_FRIEND_PROFILE_URL and E2E_FRIEND_TARGET_WEBID for two-user friendship coverage.'
    )

    await page.goto(friendProfileUrl!, { waitUntil: 'domcontentloaded' })
    const friendButton = page.getByRole('button', { name: /Add as friend|Already a friend/ })
    await expect(friendButton).toBeVisible()

    if ((await friendButton.innerText()).includes('Add as friend')) {
      await friendButton.click()
      await expect(page.getByRole('status')).toContainText('Friend was added!')
      await expect.poll(async () => {
        const profile = await readPersistedProfile(page)
        return profile.some((quad) =>
          quad.subject.value === getLocalRuntime().webId &&
          quad.predicate.value === `${rdf.foaf}knows` &&
          quad.object.value === friendWebId
        )
      }).toBe(true)
    }

    await expect(page.getByRole('button', { name: 'Already a friend', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Already a friend', exact: true })).toHaveCount(1)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Already a friend', exact: true })).toBeDisabled()
  })
})

test.describe('logged-out profile restrictions', () => {
  test.setTimeout(30_000)

  test('shows login controls and no account-menu destinations', async ({ browser }) => {
    test.skip(
      process.env.E2E_RUN_PROFILE_NAVIGATION !== 'true',
      'Set E2E_RUN_PROFILE_NAVIGATION=true to run profile navigation coverage.'
    )
    test.skip(
      !process.env.E2E_PROFILE_URL,
      'Set E2E_PROFILE_URL to a readable public profile for logged-out coverage.'
    )

    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(process.env.E2E_PROFILE_URL!, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign Up', exact: true })).toBeVisible()
      await expect(page.locator('solid-ui-account solid-ui-menu-item')).toHaveCount(0)
      await expect(page.getByRole('group', { name: 'Friend relationship actions' })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})

async function accountMenuItems (page: Page): Promise<string[]> {
  await openAccountMenu(page)
  const items = await page.locator('solid-ui-account solid-ui-menu-item').allTextContents()
  return items.map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

async function selectAccountItem (page: Page, label: string): Promise<void> {
  await openAccountMenu(page)
  await page.locator('solid-ui-account solid-ui-menu-item').filter({ hasText: label }).first().click()
}

async function openAccountMenu (page: Page): Promise<void> {
  const menu = page.locator('solid-ui-account solid-ui-menu')
  const trigger = menu.locator('button[slot="trigger"]')
  if (!(await page.locator('solid-ui-account solid-ui-menu-item').first().isVisible().catch(() => false))) {
    await trigger.click()
  }
  await expect(page.locator('solid-ui-account solid-ui-menu-item').first()).toBeVisible()
}

async function expectNavigationState (
  page: Page,
  expected: { paneName: string, paneUri?: string }
): Promise<void> {
  await expect.poll(async () => page.evaluate(() => history.state)).toMatchObject(expected)
}
