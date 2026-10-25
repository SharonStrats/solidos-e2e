import { expect as baseExpect, test } from '../../fixtures/test.js'
import type { Page } from '@playwright/test'
import { authenticateProfileOwner, loginOwnerFromPage } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { resetLocalProfile } from '../../fixtures/reset-local-profile.js'

/*
 * The navigation and view matrix of mydocs/SolidosNavigationAndView.md.
 *
 * Folder views:
 * - explorer:  storage header, sidebar and content (own storage, server root, account menu, browse.html)
 * - storage:   sidebar and content only (someone else's storage, under their navbar)
 * - container: the container alone (a plain container URL)
 * None of them carries the file explorer header.
 */

type NavigationTargets = {
  serverRoot: string
  ownerStorage: string
  ownerProfile: string
  ownerResource: string
  ownerContainer: string
  ownerIndexedContainer: string
  otherStorage: string
  otherProfile: string
  browse: string
}

// A freshly created account's first page load also initialises its type
// indexes and preferences, which can delay the first render by several seconds.
const expect = baseExpect.configure({ timeout: 20_000 })

const runNavigationTests = process.env.E2E_RUN_NAVIGATION_VIEW === 'true'

function skipUnlessRunner (): void {
  test.skip(!runNavigationTests, 'Set E2E_RUN_NAVIGATION_VIEW=true to run the navigation and view matrix.')
  test.skip(process.env.E2E_USE_LOCAL_RUNTIME !== 'true', 'The navigation runner must provide an isolated local runtime.')
}

test.describe('logged in, viewing my own content', () => {
  test.setTimeout(90_000)

  test.beforeEach(async ({ page }) => {
    skipUnlessRunner()
    await resetLocalProfile()
    await authenticateProfileOwner(page)
  })

  // The 3100 root is public and lists the pods; a private root (3200, or a hosted server
  // such as solidcommunity.net) shows one error pointing the user to the account menu.
  test('the server root shows the full folder view, or an access error when it is private', async ({ page }) => {
    const targets = navigationTargets()
    const rootStatus = (await page.request.get(targets.serverRoot, { headers: { Accept: 'text/turtle' } })).status()

    await openLoggedIn(page, targets.serverRoot)

    if (rootStatus === 200) {
      await expectExplorerView(page)
      return
    }
    const error = page.locator('#OutlineView solid-ui-error-state')
    await expect(error).toHaveCount(1)
    await expect(error).toContainText('You are logged in, but this root resource is not publicly readable. Select a storage location from the account menu to continue.')
    await expectNoFolderView(page)
  })

  test('my pod root shows the full folder view without the file explorer header', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.ownerStorage, { waitUntil: 'domcontentloaded' })

    await expectExplorerView(page)
    await expect(page.locator('solid-panes-navbar')).toBeHidden()
  })

  test('my profile shows the profile pane', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.ownerProfile, { waitUntil: 'domcontentloaded' })

    await expectProfileView(page)
    await expect(page.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible()
    await expectNoFolderView(page)
  })

  test('a resource is shown by itself', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.ownerResource, { waitUntil: 'domcontentloaded' })

    await expect(page.locator('solid-ui-account')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Navigation E2E resource' })).toBeVisible()
    await expectNoFolderView(page)
  })

  test('a plain container shows the folder container only', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.ownerContainer, { waitUntil: 'domcontentloaded' })

    await expectContainerView(page)
    await expect(folderContainer(page)).toContainText(/navigation[- ]note\.txt/)
  })

  test('a container with an index shows its application pane', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.ownerIndexedContainer, { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('main', { name: 'Address Book', exact: true })).toBeVisible()
    await expectNoFolderView(page)
  })

  test('a container with an index opened without its trailing slash shows its application pane', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.ownerIndexedContainer.replace(/\/$/, ''), { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('main', { name: 'Address Book', exact: true })).toBeVisible()
    await expectNoFolderView(page)
    await expect(page.locator('#OutlineView solid-ui-error-state')).toHaveCount(0)
  })

  test('the account menu opens my profile, friends and storage whatever the URL', async ({ page }) => {
    const targets = navigationTargets()
    await openLoggedIn(page, targets.otherProfile)
    await expectProfileView(page)

    await selectAccountItem(page, 'Profile')
    await expectProfileView(page)
    await expect(page.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible()

    await selectAccountItem(page, 'Friends')
    await expectFriendsView(page, 'mine')

    await selectAccountItem(page, await findStorageMenuItem(page))
    await expectExplorerView(page)
  })
})

test.describe('logged in, viewing someone else', () => {
  test.setTimeout(90_000)

  test.beforeEach(async ({ page }) => {
    skipUnlessRunner()
    await resetLocalProfile()
    await authenticateProfileOwner(page)
  })

  test('their pod root selects Storage and shows the sidebar and content only', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.otherStorage, { waitUntil: 'domcontentloaded' })

    await expectOtherUserNavigation(page, 'Storage')
    await expectStorageView(page)
  })

  test('their profile selects Profile', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.otherProfile, { waitUntil: 'domcontentloaded' })

    await expectOtherUserNavigation(page, 'Profile')
    await expectProfileView(page)
  })

  test('the tabs switch views whatever the URL', async ({ page }) => {
    const targets = navigationTargets()
    await openLoggedIn(page, targets.otherStorage)
    await expectOtherUserNavigation(page, 'Storage')

    await clickNavigationTab(page, 'Profile')
    await expectOtherUserNavigation(page, 'Profile')
    await expectProfileView(page)

    await clickNavigationTab(page, 'Friends')
    await expectOtherUserNavigation(page, 'Friends')
    await expectFriendsView(page, 'theirs')

    await clickNavigationTab(page, 'Storage')
    await expectOtherUserNavigation(page, 'Storage')
    await expectStorageView(page)
  })

  test('the friends tab offers to add them as a friend', async ({ page }) => {
    const targets = navigationTargets()

    await openLoggedIn(page, targets.otherProfile)
    await clickNavigationTab(page, 'Friends')

    await expect(page.getByRole('button', { name: 'Add as friend', exact: true })).toBeVisible()
  })

  test('once added, the action says Already a friend and is disabled', async ({ page }) => {
    test.skip(
      process.env.E2E_NAV_ALLOW_FRIEND_MUTATION !== 'true',
      'Set E2E_NAV_ALLOW_FRIEND_MUTATION=true to enable the friendship mutation test.'
    )
    const targets = navigationTargets()

    await openLoggedIn(page, targets.otherProfile)
    await clickNavigationTab(page, 'Friends')

    await page.getByRole('button', { name: 'Add as friend', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Already a friend', exact: true })).toBeDisabled()
  })
})

test.describe('logged out, viewing someone else', () => {
  test.setTimeout(90_000)
  test.beforeEach(() => skipUnlessRunner())

  test('their profile shows the tabs without the add-friend action', async ({ browser }) => {
    const targets = navigationTargets()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.goto(targets.otherProfile, { waitUntil: 'domcontentloaded' })

      await expectOtherUserNavigation(page, 'Profile')
      await expectProfileView(page)
      await clickNavigationTab(page, 'Friends')
      await expectOtherUserNavigation(page, 'Friends')
      await expect(page.getByRole('button', { name: /Add as friend|Already a friend/ })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('their pod root selects Storage and shows the sidebar and content only', async ({ browser }) => {
    const targets = navigationTargets()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.goto(targets.otherStorage, { waitUntil: 'domcontentloaded' })

      await expectOtherUserNavigation(page, 'Storage')
      await expectStorageView(page)
    } finally {
      await context.close()
    }
  })

  test('their tabs switch between Profile, Friends and Storage without login', async ({ browser }) => {
    const targets = navigationTargets()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.goto(targets.otherProfile, { waitUntil: 'domcontentloaded' })
      await expectOtherUserNavigation(page, 'Profile')

      await clickNavigationTab(page, 'Friends')
      await expectOtherUserNavigation(page, 'Friends')
      await expect(page.getByRole('tablist', { name: 'Social sections' })
        .getByRole('tab', { name: 'All Friends' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Add as friend|Already a friend/ })).toHaveCount(0)

      await clickNavigationTab(page, 'Storage')
      await expectOtherUserNavigation(page, 'Storage')
      await expectStorageView(page)
    } finally {
      await context.close()
    }
  })
})

test.describe('logged out, opening private content by its URL', () => {
  test.setTimeout(120_000)
  test.beforeEach(() => skipUnlessRunner())

  const privateTargets: Array<[string, (targets: NavigationTargets) => string]> = [
    ['a container with an index', targets => targets.ownerIndexedContainer],
    ['a container with an index without its trailing slash', targets => targets.ownerIndexedContainer.replace(/\/$/, '')],
    ['a plain container', targets => targets.ownerContainer],
    ['a resource', targets => targets.ownerResource]
  ]

  for (const [name, target] of privateTargets) {
    test(`${name} shows only an access denied error`, async ({ browser }) => {
      const context = await browser.newContext()
      const page = await context.newPage()

      try {
        await page.goto(target(navigationTargets()), { waitUntil: 'domcontentloaded' })

        await expectSoloAccessDenied(page)
      } finally {
        await context.close()
      }
    })
  }

  test('after logging in, a container with an index shows its application pane', async ({ browser }) => {
    const targets = navigationTargets()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.goto(targets.ownerIndexedContainer, { waitUntil: 'domcontentloaded' })
      await expectSoloAccessDenied(page)

      await resetLocalProfile()
      await authenticateProfileOwner(page)
      await page.goto(targets.ownerIndexedContainer, { waitUntil: 'domcontentloaded' })

      await expect(page.getByRole('main', { name: 'Address Book', exact: true })).toBeVisible()
      await expectNoFolderView(page)
      await expect(page.locator('#OutlineView solid-ui-error-state')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})

test.describe('logging in from the page being viewed', () => {
  test.setTimeout(120_000)
  test.beforeEach(() => skipUnlessRunner())

  // The identity provider returns to the page itself. For a container or the server root the
  // callback must not be turned into a `//` URL that loses the login (see mydocs/pivotchange.md).
  test('from the server root returns to the root, logged in', async ({ browser }) => {
    const targets = navigationTargets()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await resetLocalProfile()
      await loginOwnerFromPage(page, targets.serverRoot)

      expect(page.url()).toBe(targets.serverRoot)
    } finally {
      await context.close()
    }
  })

  test('from a private container returns to it and shows its application pane', async ({ browser }) => {
    const targets = navigationTargets()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await resetLocalProfile()
      await loginOwnerFromPage(page, targets.ownerIndexedContainer)

      expect(page.url()).toBe(targets.ownerIndexedContainer)
      await expect(page.getByRole('main', { name: 'Address Book', exact: true })).toBeVisible()
      await expectNoFolderView(page)
      await expect(page.locator('#OutlineView solid-ui-error-state')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})

test.describe('browse.html', () => {
  test.setTimeout(90_000)
  test.beforeEach(() => skipUnlessRunner())

  test('shows a pod in the full folder view', async ({ page }) => {
    const targets = navigationTargets()

    await page.goto(targets.browse, { waitUntil: 'domcontentloaded' })

    await expect(page.locator('#PageHeader')).toBeVisible()
    await expectExplorerView(page)
  })
})

function navigationTargets (): NavigationTargets {
  const runtime = getLocalRuntime() as ReturnType<typeof getLocalRuntime> & Record<string, string | undefined>
  const baseURL = process.env.E2E_BASE_URL || new URL('/', runtime.podUrl).toString()
  const required = (name: string): string => {
    const value = runtime[name]
    if (!value) throw new Error(`The local runtime has no ${name}; run the suite with npm run test:navigation.`)
    return value
  }

  return {
    serverRoot: new URL('/', baseURL).toString(),
    ownerStorage: runtime.podUrl,
    ownerProfile: `${runtime.profileUrl}#me`,
    ownerResource: required('ownerResourceUrl'),
    ownerContainer: required('ownerContainerUrl'),
    ownerIndexedContainer: required('ownerIndexedContainerUrl'),
    otherStorage: required('viewerPodUrl'),
    otherProfile: `${required('viewerProfileUrl')}#me`,
    browse: `${new URL('/browse.html', baseURL)}?uri=${encodeURIComponent(runtime.podUrl)}`
  }
}

/**
 * Opens `url` as the logged-in owner. A login belongs to one origin: in subdomain mode the
 * server root and other pods are different origins from the owner's pod, so, like a real
 * user there, the owner logs in again from that page. In suffix mode this is a plain goto.
 */
async function openLoggedIn (page: Page, url: string): Promise<void> {
  if (new URL(url).origin === new URL(getLocalRuntime().profileUrl).origin) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    return
  }
  await loginOwnerFromPage(page, url)
}

function folderContainer (page: Page) {
  return page.locator('folder-pane-container').getByRole('listbox', { name: 'Container resources' })
}

async function expectNoFileExplorerHeader (page: Page): Promise<void> {
  await expect(page.locator('solid-ui-file-explorer-header')).toHaveCount(0)
}

/** Storage header, sidebar and content. */
async function expectExplorerView (page: Page): Promise<void> {
  await expect(page.locator('folder-pane-storage-header')).toBeVisible()
  await expect(page.locator('folder-pane-sidebar')).toBeVisible()
  await expect(folderContainer(page)).toBeVisible()
  await expectNoFileExplorerHeader(page)
}

/** Sidebar and content, without the storage header. */
async function expectStorageView (page: Page): Promise<void> {
  await expect(page.locator('folder-pane-sidebar')).toBeVisible()
  await expect(folderContainer(page)).toBeVisible()
  await expect(page.locator('folder-pane-storage-header')).toHaveCount(0)
  await expectNoFileExplorerHeader(page)
}

/** The container alone. */
async function expectContainerView (page: Page): Promise<void> {
  await expect(folderContainer(page)).toBeVisible()
  await expect(page.locator('folder-pane-storage-header')).toHaveCount(0)
  await expect(page.locator('folder-pane-sidebar')).toHaveCount(0)
}

async function expectNoFolderView (page: Page): Promise<void> {
  await expect(page.locator('folder-pane-view')).toHaveCount(0)
}

/** A single access error in place of the solo view, without any folder view or explorer chrome. */
async function expectSoloAccessDenied (page: Page): Promise<void> {
  const errorState = page.locator('#OutlineView solid-ui-error-state')
  await expect(errorState).toHaveCount(1)
  await expect(errorState).toHaveAttribute('message', /not publicly readable\. Log in to view it\./)
  await expect(page.locator('#OutlineView [data-outline-error-for]:not(solid-ui-error-state)')).toHaveCount(0)
  await expect(page.locator('folder-pane-view')).toHaveCount(0)
  await expect(page.locator('folder-pane-sidebar')).toHaveCount(0)
  await expectNoFileExplorerHeader(page)
  await expect(page.locator('contacts-pane-address-book')).toHaveCount(0)
}

async function expectProfileView (page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(/\S/)
}

/** My own friends list has friend requests; someone else's shows the friends we have in common. */
async function expectFriendsView (page: Page, whose: 'mine' | 'theirs'): Promise<void> {
  const sections = page.getByRole('tablist', { name: 'Social sections' })
  await expect(sections.getByRole('tab', { name: 'All Friends' })).toBeVisible()
  await expect(sections.getByRole('tab', { name: whose === 'mine' ? 'Requests' : 'Mutual' })).toBeVisible()
}

function navbarButton (page: Page, label: string) {
  return page.locator('solid-panes-navbar').getByRole('button', { name: label, exact: true })
}

/** The person's heading, and the Profile, Friends and Storage tabs with one of them selected. */
async function expectOtherUserNavigation (page: Page, selected: 'Profile' | 'Friends' | 'Storage'): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(/\S/)
  for (const label of ['Profile', 'Friends', 'Storage']) {
    const button = navbarButton(page, label)
    await expect(button).toBeVisible()
    if (label === selected) await expect(button).toHaveClass(/\bselected\b/)
    else await expect(button).not.toHaveClass(/\bselected\b/)
  }
}

async function clickNavigationTab (page: Page, label: string): Promise<void> {
  await navbarButton(page, label).click()
}

async function openAccountMenu (page: Page): Promise<void> {
  const item = page.locator('solid-ui-account solid-ui-menu-item').first()
  if (!(await item.isVisible().catch(() => false))) {
    await page.locator('solid-ui-account solid-ui-menu button[slot="trigger"]').click()
  }
  await expect(item).toBeVisible()
}

async function selectAccountItem (page: Page, label: string): Promise<void> {
  await openAccountMenu(page)
  await page.locator('solid-ui-account solid-ui-menu-item').filter({ hasText: label }).first().click()
  // Let the menu finish closing so the next selection reopens it rather than racing the close.
  await expect(page.locator('solid-ui-account solid-ui-menu-item').first()).toBeHidden()
}

async function findStorageMenuItem (page: Page): Promise<string> {
  await openAccountMenu(page)
  const items = await page.locator('solid-ui-account solid-ui-menu-item').allTextContents()
  const storageItem = items
    .map(item => item.replace(/\s+/g, ' ').trim())
    .find(item => /storage/i.test(item)) ??
    items.map(item => item.replace(/\s+/g, ' ').trim())
      .find(item => !['Profile', 'Friends', 'Dashboard', 'Preferences', 'Sign out', 'Log out'].includes(item))
  if (!storageItem) throw new Error('The account menu did not expose a storage destination.')
  return storageItem
}
