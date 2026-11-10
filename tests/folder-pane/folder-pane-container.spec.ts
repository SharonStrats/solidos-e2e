import { test, expect } from '../../fixtures/test.js'
import type { Locator, Page } from '@playwright/test'
import { authenticateProfileOwner, authenticateSolidUser } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedFriendProfile, seedNestedFolderPaneCase } from '../../fixtures/folder-pane.js'
import { hasConfiguredViewerUser, viewerUser } from '../../fixtures/test-users.js'

type FolderView = HTMLElement & {
  browserContext: unknown
  subject: unknown
  updateComplete: Promise<boolean>
}

function getViewButton (page: Page, view: 'Grid' | 'List'): Locator {
  return page.locator(`solid-ui-button[aria-label="${view} view"]`)
}

async function expectSharingPane (page: Page, subjectUri: string): Promise<Locator> {
  const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
  await expect(provider).toHaveCount(1)
  await expect.poll(() => provider.evaluate(element =>
    (element as HTMLElement & { pane?: { name?: string } }).pane?.name
  )).toBe('sharing')
  await expect(provider).toHaveJSProperty('subjectUri', subjectUri)
  await expect(provider.locator('.sharingPane')).toBeVisible()
  return provider
}

test.describe('folder-pane container presentation', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to a readable non-empty container.')
    if (!containerUrl) return
    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl)
  })

  test('switches between grid and list without changing resources or rendering nested targets', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    const grid = container.getByRole('listbox', { name: 'Container resources' })
    await expect(grid).toHaveClass('resource-grid')
    await expect(grid.getByRole('option').first()).toBeVisible()
    const resourceUris = await grid.getByRole('option').evaluateAll(items =>
      items.map(item => item.getAttribute('about'))
    )
    await expect(getViewButton(page, 'Grid')).toHaveAttribute('aria-pressed', 'true')

    await getViewButton(page, 'List').click()
    const list = container.getByRole('listbox', { name: 'Container resources' })
    await expect(list).toHaveClass('resource-list')
    expect(await list.getByRole('option').evaluateAll(items =>
      items.map(item => item.getAttribute('about'))
    )).toEqual(resourceUris)
    await expect(getViewButton(page, 'List')).toHaveAttribute('aria-pressed', 'true')
    await expect(container.locator('folder-pane-content')).toHaveCount(0)

    await getViewButton(page, 'Grid').click()
    await expect(grid).toHaveClass('resource-grid')
    expect(await grid.getByRole('option').evaluateAll(items =>
      items.map(item => item.getAttribute('about'))
    )).toEqual(resourceUris)
  })

  test('wraps long resource names in the grid', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-long-name-${'x'.repeat(140)}.txt`
    const fileUrl = new URL(fileName, containerUrl).toString()

    const created = await page.evaluate(async ({ fileUrl }) => {
      const session = (window as typeof window & {
        SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
      }).SolidLogic?.authSession
      const authenticatedFetch = session?.authFetch ?? session?.fetch
      if (!authenticatedFetch) throw new Error('No authenticated session for long-name resource creation.')
      const response = await authenticatedFetch.call(session, fileUrl, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: 'Long resource name wrapping test.'
      })
      return response.ok
    }, { fileUrl })
    expect(created).toBe(true)

    try {
      await authenticateProfileOwner(page)
      await openFolderPane(page, containerUrl)
      const resource = page.locator(`folder-pane-container li[role="option"][about="<${fileUrl}>"]`)
      await expect(resource).toHaveCount(1)
      const label = resource.locator('.resource-grid-label').first()
      await expect(label).toHaveText(fileName.replaceAll('-', ' '))
      const labelLayout = await label.evaluate(element => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return {
          height: rect.height,
          lineHeight: Number.parseFloat(style.lineHeight),
          overflowWrap: style.overflowWrap,
          whiteSpace: style.whiteSpace
        }
      })
      expect(labelLayout.overflowWrap).toBe('anywhere')
      expect(labelLayout.whiteSpace).toBe('normal')
      expect(labelLayout.height).toBeGreaterThan(labelLayout.lineHeight)
    } finally {
      await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (authenticatedFetch) await authenticatedFetch.call(session, url, { method: 'DELETE' })
      }, fileUrl)
    }
  })

  test('does not expose a container index.ttl#this as a separate resource target', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    const resourceUris = await container.getByRole('option').evaluateAll(items =>
      items.map(item => item.getAttribute('about') || '')
    )
    expect(resourceUris.some(uri => /index\.ttl#this[">]?$/i.test(uri))).toBe(false)
    await expect(container.getByRole('listbox', { name: 'Container resources' })).toBeVisible()
  })

  test('does not block resource rows while access metadata loads', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    await expect(container.getByRole('listbox', { name: 'Container resources' })).toBeVisible()
    await expect(container.getByRole('option').first()).toBeVisible()
  })

  test('targets the storage-header menu at the displayed resource, including Home', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const header = page.locator('folder-pane-storage-header')
    const actions = header.locator('solid-ui-resource-actions-menu')

    await expect(actions).toBeVisible()
    await expect(header.locator('.folder-pane-storage-header-resource-actions')).toBeVisible()
    await expect(header.locator('.folder-pane-storage-header-view-controls')).toBeVisible()

    await actions.getByTitle('More options').click()
    await expect(actions.getByRole('menuitem', { name: 'Manage Access', exact: true })).toBeVisible()
    await actions.getByRole('menuitem', { name: 'Manage Access', exact: true }).click()
    await expectSharingPane(page, containerUrl)

    const nested = await seedNestedFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    await selectResource(page, nested.levels[0])

    const displayedUrl = nested.levels[0]
    const displayedHeader = page.locator('folder-pane-storage-header')
    const displayedActions = displayedHeader.locator('solid-ui-resource-actions-menu')
    await displayedActions.getByTitle('More options').click()
    await expect(displayedActions.getByRole('menuitem', { name: 'Manage Access', exact: true })).toBeVisible()
    await displayedActions.getByRole('menuitem', { name: 'Manage Access', exact: true }).click()
    await expectSharingPane(page, displayedUrl)
  })

  test('opens a pane selected from the storage-header menu in the content area', async ({ page }) => {
    const header = page.locator('folder-pane-storage-header')
    const actions = header.locator('solid-ui-resource-actions-menu')
    await actions.getByTitle('More options').click()

    const source = actions.getByRole('menuitem', { name: 'Source', exact: true })
    await expect(source).toBeVisible()
    await source.click()

    const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
    await expect(provider).toHaveCount(1, { timeout: 30_000 })
    await expect.poll(() => provider.evaluate(element =>
      (element as HTMLElement & { pane?: { name?: string } }).pane?.name || null
    )).toBe('source')
  })

  test('shows a resource count and access status after opening its action menu', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const addressBookUrl = new URL('navigation-contacts/', containerUrl).toString()
    const addressBook = page.locator('folder-pane-container')
      .locator(`[role="option"][about="<${addressBookUrl}>"]`)

    await expect(addressBook).toBeVisible()
    await addressBook.getByTitle('More options').click()

    await expect(addressBook.locator('.container-member-count')).toBeVisible()
    await expect(addressBook.locator('.resource-access-indicator')).toBeVisible()
  })

  test('provides a three-dots action menu for each displayed resource', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    await expect(container.getByRole('option').first().getByTitle('More options')).toBeVisible()
  })

  test('opens the selected resource in a new tab', async ({ page }) => {
    test.setTimeout(120_000)
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const addressBookUrl = new URL('navigation-contacts/', containerUrl).toString()
    const addressBook = page.locator('folder-pane-container')
      .locator(`[role="option"][about="<${addressBookUrl}>"]`)

    await expect(addressBook).toBeVisible()
    await addressBook.getByTitle('More options').click()

    const popupPromise = page.context().waitForEvent('page')
    await addressBook.getByRole('menuitem', { name: 'Open in New Tab', exact: true }).click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')

    expect(popup.url()).toBe(addressBookUrl)
    await expect(page.locator('folder-pane-container')).toBeVisible()
    await popup.close()
  })

  for (const view of ['grid', 'list'] as const) {
    test(`lists the preferred pane before Contents and opens either choice in ${view} view`, async ({ page }) => {
      const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
      const addressBookUrl = new URL('navigation-contacts/', containerUrl).toString()
      await getViewButton(page, view === 'list' ? 'List' : 'Grid').click()

      const addressBook = page.locator('folder-pane-container')
        .locator(`[role="option"][about="<${addressBookUrl}>"]`)
      await expect(addressBook).toBeVisible()
      await addressBook.getByTitle('More options').click()

      const actionMenu = addressBook.locator('solid-ui-resource-actions-menu')
      const actionMenuItems = actionMenu.locator('solid-ui-menu-item')
      await expect.poll(async () => (await actionMenuItems.allTextContents()).map(label => label.trim())).toEqual(
        expect.arrayContaining(['Address book', 'Contents'])
      )
      const labels = (await actionMenuItems.allTextContents()).map(label => label.trim())
      expect(labels.indexOf('Address book')).toBeLessThan(labels.indexOf('Contents'))

      await actionMenu.getByRole('menuitem', { name: 'Address book', exact: true }).click()
      await expect(page.getByRole('main', { name: 'Address Book', exact: true })).toBeVisible()

      await page.goto(getLocalRuntime().profileUrl, { waitUntil: 'domcontentloaded' })
      await openFolderPane(page, containerUrl)
      await getViewButton(page, view === 'list' ? 'List' : 'Grid').click()

      const contentsResource = page.locator('folder-pane-container')
        .locator(`[role="option"][about="<${addressBookUrl}>"]`)
      await expect(contentsResource).toBeVisible()
      await contentsResource.getByTitle('More options').click()
      const contentsMenu = contentsResource.locator('solid-ui-resource-actions-menu')
      const contentsMenuItems = contentsMenu.locator('solid-ui-menu-item')
      await expect.poll(async () => (await contentsMenuItems.allTextContents()).map(label => label.trim())).toEqual(
        expect.arrayContaining(['Contents'])
      )
      // The action menu is re-rendered as the resource switches panes. Force
      // the click after the item is present so a transient host replacement
      // does not cancel the menu item's activation.
      await contentsMenu.getByRole('menuitem', { name: 'Contents', exact: true }).click({ force: true })

      const contentsContainer = page.locator('folder-pane-content > folder-pane-container')
      await expect(contentsContainer).toHaveCount(1, { timeout: 15_000 })
      await expect(contentsContainer).toBeVisible()
      await expect(contentsContainer.getByRole('listbox', { name: 'Container resources' })).toBeVisible()
      await expect(page.locator('folder-pane-storage-header')).toBeVisible()
      await expect(page.locator('folder-pane-sidebar')).toBeVisible()
    })

    test(`does not show a Manage Access header control without prefetched metadata in desktop ${view} view`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await getViewButton(page, view === 'list' ? 'List' : 'Grid').click()
      const container = page.locator('folder-pane-container')
      const resource = container.getByRole('option').filter({
        hasNot: container.locator('.resource-grid-icon--container, .resource-list-icon--container')
      }).first()
      await resource.click()
      const header = page.locator('solid-ui-file-explorer-header')
      await expect(header.getByTitle('Manage Access')).toHaveCount(0)
    })

    test(`hides header Manage Access icon and keeps menu action on mobile ${view} view`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await getViewButton(page, view === 'list' ? 'List' : 'Grid').click()
      const container = page.locator('folder-pane-container')
      await expect(page.locator('solid-ui-file-explorer-header').getByTitle('Manage Access')).toHaveCount(0)
      const resource = container.getByRole('option').filter({
        hasNot: container.locator('.resource-grid-icon--container, .resource-list-icon--container')
      }).first()
      await expect(page.locator('solid-ui-file-explorer-header').getByTitle('Manage Access')).toHaveCount(0)
      await resource.getByTitle('More options').click()
      await expect(page.getByRole('menuitem', { name: 'Manage Access', exact: true })).toBeVisible()
    })

    test(`opens the displayed resource from the file-explorer header in a new tab in ${view} view`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await getViewButton(page, view === 'list' ? 'List' : 'Grid').click()

      const container = page.locator('folder-pane-container')
      const resourceUrl = new URL('navigation-e2e.html', process.env.E2E_FOLDER_PANE_CONTAINER_URL!).toString()
      const resource = container.locator(`[role="option"][about="<${resourceUrl}>"]`)
      await expect(resource).toBeVisible()
      const about = await resource.getAttribute('about')
      expect(about).toBeTruthy()
      expect(about!.slice(1, -1)).toBe(resourceUrl)

      await resource.click()
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1, { timeout: 30_000 })
      const headerMenu = page.locator('solid-ui-file-explorer-header solid-ui-resource-actions-menu').first()
      await expect(headerMenu.getByTitle('More options')).toBeVisible()
      await headerMenu.getByTitle('More options').click()

      const popupPromise = page.context().waitForEvent('page')
      await headerMenu.getByRole('menuitem', { name: 'Open in New Tab', exact: true }).click()
      const popup = await popupPromise
      await popup.waitForLoadState('domcontentloaded')

      expect(popup.url()).toBe(resourceUrl)
      await popup.close()
    })

    test(`exposes Manage Access for file resources in ${view} view`, async ({ page }) => {
      await getViewButton(page, view === 'list' ? 'List' : 'Grid').click()

      const container = page.locator('folder-pane-container')
      const resourceUrl = new URL('navigation-e2e.html', process.env.E2E_FOLDER_PANE_CONTAINER_URL!).toString()
      const resource = container.locator(`[role="option"][about="<${resourceUrl}>"]`)
      await expect(resource).toBeVisible()
      const about = await resource.getAttribute('about')
      expect(about).toBeTruthy()
      const actions = resource.locator('solid-ui-resource-actions-menu')
      await actions.getByTitle('More options').click()
      // Pane discovery adds menu entries asynchronously. Target the labelled
      // entry, not a dropdown wrapper whose assigned slot can change.
      await expect(actions.getByText('Source', { exact: true })).toBeVisible()
      const manageAccess = actions.getByText('Manage Access', { exact: true })
      await expect(manageAccess).toBeVisible()
      await manageAccess.click()
      await expectSharingPane(page, resourceUrl)
    })

    test(`exposes Manage Access for container resources in ${view} view`, async ({ page }) => {
      const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
      const nested = await seedNestedFolderPaneCase(page, containerUrl)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await openFolderPane(page, containerUrl)

      await getViewButton(page, view === 'list' ? 'List' : 'Grid').click()

      const resource = page.locator('folder-pane-container').locator(`[role="option"][about="<${nested.levels[0]}>"]`)
      await expect(resource).toBeVisible()
      const actions = resource.locator('solid-ui-resource-actions-menu')
      await actions.getByTitle('More options').click()
      const manageAccess = actions.getByText('Manage Access', { exact: true })
      await expect(manageAccess).toBeVisible()
      await manageAccess.click()
      await expectSharingPane(page, nested.levels[0])
      await expect(page.locator('folder-pane-content > solid-ui-file-explorer-provider solid-ui-file-explorer-header')).toHaveCount(0)
    })
  }

  test('saves inherited folder sharing as folder and contents while keeping the owner', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const nested = await seedNestedFolderPaneCase(page, containerUrl)
    const folderUrl = nested.levels[0]
    const friend = await seedFriendProfile(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)

    const folder = page.locator('folder-pane-container').locator(`[role="option"][about="<${folderUrl}>"]`)
    const actions = folder.locator('solid-ui-resource-actions-menu')
    await actions.getByTitle('More options').click()
    await actions.getByText('Manage Access', { exact: true }).click()
    const sharing = await expectSharingPane(page, folderUrl)
    await sharing.getByRole('button', { name: 'Set specific sharing for this Folder', exact: true }).click()
    await sharing.getByRole('button', { name: 'Add ...', exact: true }).click()
    await sharing.getByRole('button', { name: 'Add Person', exact: true }).click()
    await sharing.getByRole('textbox').fill(friend)
    await sharing.getByRole('button', { name: 'Continue', exact: true }).click()
    const { Parser } = await import('n3')
    await expect.poll(async () => {
      const turtle = await page.evaluate(async aclUrl => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (!authenticatedFetch) throw new Error('No authenticated session for ACL verification.')
        const response = await authenticatedFetch.call(session, aclUrl, { headers: { accept: 'text/turtle' } })
        return response.ok ? response.text() : ''
      }, `${folderUrl}.acl`)
      return new Parser({ baseIRI: `${folderUrl}.acl` }).parse(turtle).some(quad =>
        quad.predicate.value === 'http://www.w3.org/ns/auth/acl#agent' &&
        quad.object.value === friend
      )
    }, { timeout: 30_000 }).toBe(true)

    const { owner, turtle } = await page.evaluate(async aclUrl => {
      const session = (window as typeof window & {
        SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch, info?: { webId?: string } } }
      }).SolidLogic?.authSession
      const authenticatedFetch = session?.authFetch ?? session?.fetch
      if (!authenticatedFetch) throw new Error('The folder-pane test has no authenticated Solid session.')
      const response = await authenticatedFetch.call(session, aclUrl, { headers: { accept: 'text/turtle' } })
      return { owner: session?.info?.webId, turtle: response.ok ? await response.text() : '' }
    }, `${folderUrl}.acl`)
    expect(turtle, 'The folder ACL was not written').not.toBe('')

    const quads = new Parser({ baseIRI: `${folderUrl}.acl` }).parse(turtle)
    const ACL = 'http://www.w3.org/ns/auth/acl#'
    const ruleFor = (predicate: string, subject: string) => {
      const rules = quads.filter(q => q.predicate.value === ACL + predicate && q.object.value === subject)
        .map(q => q.subject.value)
      expect(rules, `${subject} should have exactly one authorization`).toHaveLength(1)
      return quads.filter(q => q.subject.value === rules[0])
    }
    const has = (rule: typeof quads, predicate: string, object: string) =>
      rule.some(q => q.predicate.value === ACL + predicate && q.object.value === object)

    const ownerRule = ruleFor('agent', owner!)
    expect(has(ownerRule, 'accessTo', folderUrl)).toBe(true)
    expect(has(ownerRule, 'default', folderUrl)).toBe(true)
    expect(has(ownerRule, 'mode', ACL + 'Control')).toBe(true)

    const friendRule = ruleFor('agent', friend)
    expect(has(friendRule, 'accessTo', folderUrl)).toBe(true)
    expect(has(friendRule, 'default', folderUrl)).toBe(true)
    expect(has(friendRule, 'mode', ACL + 'Read')).toBe(true)
  })

  test('opens a resource action in another registered pane', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const friend = await seedFriendProfile(page, containerUrl)
    const documentUrl = friend.split('#')[0]
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await openFolderPane(page, containerUrl)
      const resource = page.locator(`folder-pane-container li[about="<${documentUrl}>"]`)
      const menu = resource.locator('solid-ui-resource-actions-menu')
      await expect(menu.getByTitle('More options')).toBeVisible()
      await menu.getByTitle('More options').click()
      const paneItems = menu.getByRole('menuitem').filter({ hasNotText: /Manage Access|Upload|Open in New Tab/ })
      const paneItemHosts = menu.locator('solid-ui-menu-item').filter({ hasNotText: /Manage Access|Upload|Open in New Tab/ })
      await expect(paneItems.first()).toBeVisible()
      await expect(paneItemHosts.first().locator(':scope > [slot="left-icon"]')).toHaveCount(1)
      const initialLabels = (await paneItems.allTextContents())
        .map(label => label.trim())
        .filter(Boolean)

      await menu.getByRole('menuitem', { name: 'Source', exact: true }).click()
      // The outer full-view explorer remains mounted while the selected pane
      // is rendered. Scope this assertion to the content target so a late
      // outer-provider update cannot make the locator strictness-racy.
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1, { timeout: 30_000 })
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name || null
      )).toBe('source')

      // Pane switching must retain the actions that were available for the
      // resource. The selected pane may also contribute additional actions.
      const headerMenu = provider.locator('solid-ui-file-explorer-header solid-ui-resource-actions-menu').first()
      await expect(headerMenu.getByTitle('More options')).toBeVisible()
      await headerMenu.getByTitle('More options').click()
      for (const label of initialLabels) {
        await expect(headerMenu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
      }
    } finally {
      const status = await page.evaluate(async url => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (!authenticatedFetch) throw new Error('No authenticated session for resource cleanup.')
        return (await authenticatedFetch.call(session, url, { method: 'DELETE' })).status
      }, documentUrl)
      expect((status >= 200 && status < 300) || status === 404, `Cleanup returned HTTP ${status}`).toBe(true)
    }
  })

  for (const [extension, contentType] of [
    ['.txt', 'text/plain'],
    ['.ttl', 'text/turtle']
  ]) {
  test(`creates a Source ${extension} file from the header Add action`, async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`
    const fileUrl = new URL(fileName, containerUrl).toString()
    const fileRequest = page.waitForRequest(request =>
      request.method() === 'PUT' && request.url() === fileUrl
    )

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const sourceItem = page.getByRole('menuitem', { name: 'New File', exact: true })
    await expect(sourceItem).toBeVisible()
    await sourceItem.click()

    const dialog = page.locator('folder-pane-create-dialog')
    await expect(dialog.getByRole('heading', { name: 'New File', exact: true })).toBeVisible()
    await expect(dialog.getByText('File name', { exact: true })).toBeVisible()
    await dialog.locator('input').fill(fileName)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    const request = await fileRequest
    expect(request.url()).toBe(fileUrl)
    expect(request.headers()['content-type']).toMatch(new RegExp(`^${contentType}\\b`))

    try {
      // A successful create opens the new file in the content area.
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name
      )).toBe('source')
      await expect(provider.locator('source-pane-source-editor-card .cm-editor')).toBeVisible()
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(0)
      expect(fileUrl.endsWith('/')).toBe(false)
      await page.locator('folder-pane-sidebar li[aria-label="Home"] > .resource-row').click()
      await expect(page.locator(`folder-pane-container li[role="option"][about="<${fileUrl}>"]`)).toHaveCount(1)
    } finally {
      if (!page.isClosed()) {
        await page.evaluate(async (url) => {
          const session = (window as typeof window & {
            SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
          }).SolidLogic?.authSession
          const authenticatedFetch = session?.authFetch ?? session?.fetch
          if (authenticatedFetch) await authenticatedFetch.call(session, url, { method: 'DELETE' })
        }, fileUrl)
      }
    }
  })
  }

  test('opens a newly created JSON file in Source instead of the folder view', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-json-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
    const fileUrl = new URL(fileName, containerUrl).toString()
    const fileRequest = page.waitForRequest(request =>
      request.method() === 'PUT' && request.url() === fileUrl
    )

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('menuitem', { name: 'New File', exact: true }).click()

    const dialog = page.locator('folder-pane-create-dialog')
    await expect(dialog.getByRole('heading', { name: 'New File', exact: true })).toBeVisible()
    await dialog.locator('input').fill(fileName)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()

    const request = await fileRequest
    expect(request.headers()['content-type']).toMatch(/^application\/json\b/)

    try {
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name
      )).toBe('source')
      await expect(provider.locator('source-pane-source-editor-card .cm-editor')).toBeVisible()
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(0)
    } finally {
      await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (authenticatedFetch) await authenticatedFetch.call(session, url, { method: 'DELETE' })
      }, fileUrl)
    }
  })

  test('uploads a PDF and opens it in the content area', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
    const fileUrl = new URL(fileName, containerUrl).toString()

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: 'Upload', exact: true }).click()
    const fileChooser = await chooser
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
    })

    try {
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name
      )).toBe('humanReadable')
      const frame = provider.locator('iframe')
      await expect(frame).toHaveCount(1)
      await expect.poll(() => frame.getAttribute('src')).toMatch(/^blob:/)
      await expect(frame).not.toHaveAttribute('sandbox')
      const frameLayout = await frame.evaluate(element => {
        const style = getComputedStyle(element)
        return { height: Number.parseFloat(style.height), minHeight: style.minHeight }
      })
      expect(frameLayout.height).toBeGreaterThanOrEqual(480)
      expect(frameLayout.minHeight).toBe('288px')
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(0)
    } finally {
      await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (authenticatedFetch) await authenticatedFetch.call(session, url, { method: 'DELETE' })
      }, fileUrl)
    }
  })

  test('uploads an MP4 with a human-readable filename and opens it in the content area', async ({ page }) => {
    test.setTimeout(180_000)
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `2023-03-01 DevOps Sprint Wrap Up & Demonstration-${Date.now()}.mp4`
    const fileUrl = new URL(encodeURIComponent(fileName), containerUrl).toString()

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: 'Upload', exact: true }).click()
    const fileChooser = await chooser
    const uploadResponse = page.waitForResponse(response =>
      response.request().method() === 'PUT' && response.url() === fileUrl
    )
    try {
      await fileChooser.setFiles({
        name: fileName,
        mimeType: 'video/mp4',
        buffer: Buffer.from('Folder-pane video filename and preview fixture.')
      })
      const response = await uploadResponse
      if (!response.ok()) {
        const error = page.locator('.folder-pane-status-error')
        await expect(error).toContainText(`HTTP ${response.status()}`)
        throw new Error(await error.textContent() ?? `MP4 upload returned HTTP ${response.status()}`)
      }
      expect(response.ok(), `MP4 upload returned HTTP ${response.status()}`).toBe(true)
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name
      )).toBe('video')
      const video = provider.locator('video')
      await expect(video).toHaveCount(1)
      await expect(video).toHaveAttribute('controls', 'yes')
      await expect.poll(() => video.getAttribute('src')).toMatch(/^blob:/)
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(0)
    } finally {
      await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (authenticatedFetch) await authenticatedFetch.call(session, url, { method: 'DELETE' })
      }, fileUrl)
    }
  })

  test('keeps a usable PDF preview height on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-mobile-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
    const fileUrl = new URL(fileName, containerUrl).toString()

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: 'Upload', exact: true }).click()
    const fileChooser = await chooser
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
    })

    try {
      const frame = page.locator('folder-pane-content > solid-ui-file-explorer-provider iframe')
      await expect(frame).toHaveCount(1)
      const frameLayout = await frame.evaluate(element => {
        const style = getComputedStyle(element)
        return { height: Number.parseFloat(style.height), minHeight: Number.parseFloat(style.minHeight) }
      })
      expect(frameLayout.height).toBe(844)
      expect(frameLayout.minHeight).toBe(844)
    } finally {
      await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (authenticatedFetch) await authenticatedFetch.call(session, url, { method: 'DELETE' })
      }, fileUrl)
    }
  })

  test('emits the same resource selection from both views with mouse and keyboard', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    // Isolate the emitter contract without navigating to or modifying a pod resource.
    await container.evaluate(element => {
      element.addEventListener('resource-selected', event => {
        event.stopPropagation()
        const resource = (event as CustomEvent<{ resource: { uri: string } }>).detail.resource
        element.setAttribute('data-selected-resource', resource.uri)
      })
    })

    const resource = container.getByRole('option').first()
    const about = await resource.getAttribute('about')
    expect(about).toBeTruthy()
    const resourceUri = about!.slice(1, -1)

    await resource.click()
    await expect(container).toHaveAttribute('data-selected-resource', resourceUri)
    for (const view of ['List', 'Grid'] as const) {
      await getViewButton(page, view).click()
      for (const key of ['Enter', 'Space']) {
        await container.evaluate(element => element.removeAttribute('data-selected-resource'))
        await container.getByRole('option').first().press(key)
        await expect(container).toHaveAttribute('data-selected-resource', resourceUri)
      }
    }
  })

  test('creates a folder with a trailing-slash URI and refreshes the explorer', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const folderItem = page.getByRole('menuitem', { name: 'New Folder', exact: true })
    test.skip(await folderItem.count() === 0, 'The runtime does not register a folder creation pane.')
    await folderItem.click()

    const folderName = `folder-pane-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const folderUrl = new URL(`${encodeURIComponent(folderName)}/`, containerUrl).toString()
    const dialog = page.locator('folder-pane-create-dialog')
    await expect(dialog.getByText('Folder name', { exact: true })).toBeVisible()
    await dialog.locator('input').fill(folderName)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()

    try {
      // A successful create opens the new folder in the content area.
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(1)
      await expect(page.locator('folder-pane-sidebar li[aria-selected="true"]'))
        .toHaveAttribute('about', `<${folderUrl}>`)

      await page.locator('folder-pane-sidebar li[aria-label="Home"] > .resource-row').click()
      const resource = page.locator(`folder-pane-container li[role="option"][about="<${folderUrl}>"]`)
      await expect(resource).toHaveCount(1)
      await expect(resource.locator('.resource-grid-icon--container')).toHaveCount(1)
    } finally {
      await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (authenticatedFetch) await authenticatedFetch.call(session, url, { method: 'DELETE' })
      }, folderUrl)
    }
  })

  test('creates a Dokieli document from Add, opens it in Dokieli and saves an edit', async ({ page }) => {
    test.setTimeout(180_000)
    page.on('console', message => console.log(`[dokieli-console:${message.type()}] ${message.text()}`))
    page.on('pageerror', error => console.log(`[dokieli-pageerror] ${error.stack || error.message}`))
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const documentName = `folder-pane-dokieli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const documentUrl = new URL(`${encodeURIComponent(documentName)}.html`, containerUrl).toString()
    const documentResponse = page.waitForResponse(response =>
      response.request().method() === 'PUT' && response.url() === documentUrl
    )

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const dokieliItem = page.getByRole('menuitem', { name: 'New Dokieli Document', exact: true })
    test.skip(await dokieliItem.count() === 0, 'The runtime does not register the Dokieli creation pane.')
    await dokieliItem.click()

    const dialog = page.locator('folder-pane-create-dialog')
    await expect(dialog.getByText('Dokieli Document name', { exact: true })).toBeVisible()
    await dialog.locator('input').fill(documentName)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()

    try {
      const response = await documentResponse
      expect(response.ok()).toBe(true)
      const request = response.request()
      expect(request.url()).toBe(documentUrl)
      expect(request.headers()['content-type']).toMatch(/^text\/html\b/)
      expect(documentUrl.endsWith('/')).toBe(false)

      const fetchedDocument = await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (!authenticatedFetch) throw new Error('The Dokieli test has no authenticated Solid session.')
        const response = await authenticatedFetch.call(session, url)
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          text: await response.text()
        }
      }, documentUrl)
      expect(fetchedDocument.status).toBe(200)
      expect(fetchedDocument.contentType).toMatch(/^text\/html\b/)
      expect(fetchedDocument.text).toContain('<script src="https://dokie.li/scripts/dokieli.js"></script>')
      expect(fetchedDocument.text).toContain(`<title>${documentName}</title>`)
      expect(fetchedDocument.text).toContain(`<h1>${documentName}</h1>`)
      expect(fetchedDocument.text).toContain('typeof="schema:CreativeWork prov:Entity"')

      // A successful create opens the new document in the content area.
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name
      )).toBe('humanReadable')
      const frame = provider.locator('iframe')
      // Dokieli runs as the document itself: at the document URL, not a nested SolidOS shell.
      const framed = provider.frameLocator('iframe')
      console.log('[dokieli-e2e] waiting for rendered heading')
      await expect(framed.locator('h1', { hasText: documentName }).first()).toBeVisible({ timeout: 15_000 })
      console.log('[dokieli-e2e] rendered heading')
      await expect(framed.getByTitle('Open menu')).toBeEnabled({ timeout: 30_000 })
      await expect(framed.locator('#MainContent, solid-ui-header, folder-pane-sidebar')).toHaveCount(0)
      console.log('[dokieli-e2e] isolated document assertions')
      await expect(frame).toHaveAttribute('sandbox', /allow-scripts/)
      await expect(frame).not.toHaveAttribute('sandbox', /allow-same-origin/)
      await expect(frame).toHaveAttribute('srcdoc', /<base href=/)
      expect((await frame.boundingBox())?.height ?? 0).toBeGreaterThan(100)
      await expect(provider.getByRole('link', { name: /new tab/i })).toHaveCount(0)

      // Layout: nothing scrolls horizontally, and the preview itself does not
      // create a nested scrollbar. Long documents scroll with the outer pane.
      const layout = await provider.evaluate(element => {
        const paneDiv = element.querySelector(':scope > .paneDiv') as HTMLElement
        const iframe = paneDiv.querySelector('iframe') as HTMLIFrameElement
        const paneBox = paneDiv.getBoundingClientRect()
        const frameBox = iframe.getBoundingClientRect()
        const horizontalOverflow = [document.documentElement, document.body, ...Array.from(document.querySelectorAll('*'))]
          .filter(node => {
            const style = getComputedStyle(node)
            return node.scrollWidth > node.clientWidth + 1 &&
              node.tagName !== 'IFRAME' &&
              (node === document.documentElement || ['auto', 'scroll'].includes(style.overflowX))
          })
          .map(node => node.tagName.toLowerCase() + (node.className && typeof node.className === 'string' ? '.' + node.className.split(' ').join('.') : ''))
        return {
          horizontalOverflow,
          frameScrollsVertically: iframe.scrollHeight > iframe.clientHeight + 1,
          paneOverflowY: getComputedStyle(paneDiv).overflowY,
          rightInset: paneBox.right - frameBox.right,
          frameBottomInsidePane: frameBox.bottom <= paneBox.bottom + 1
        }
      })
      expect(layout.horizontalOverflow).toEqual([])
      expect(layout.frameScrollsVertically).toBe(false)
      expect(layout.paneOverflowY).toBe('visible')
      expect(Math.round(layout.rightInset)).toBe(40)
      expect(layout.frameBottomInsidePane).toBe(true)
      console.log('[dokieli-e2e] layout assertions')

      // Use Dokieli: enable its editor, change the heading and save through the SolidOS session.
      const editedHeading = `${documentName} edited in Dokieli`
      await framed.getByTitle('Open menu').click()
      await framed.locator('#document-menu button.editor-enable').click()
      const heading = framed.locator('.ProseMirror h1').first()
      await heading.click()
      await heading.evaluate(element => {
        const selection = element.ownerDocument.getSelection()!
        selection.selectAllChildren(element)
        selection.collapseToEnd()
      })
      await page.keyboard.type(' edited in Dokieli')
      await expect(framed.locator('h1').first()).toHaveText(editedHeading)
      console.log('[dokieli-e2e] edited heading')
      const documentRequests: string[] = []
      page.on('request', request => {
        if (request.url().startsWith(documentUrl)) {
          documentRequests.push(`${request.method()} ${request.url()}`)
        }
      })
      const saveResponse = page.waitForResponse(response =>
        response.request().method() === 'PUT' && response.url() === documentUrl
      , { timeout: 10000 })
      console.log('[dokieli-e2e] waiting for save')
      await framed.getByTitle('Open menu').click()
      await framed.locator('#document-menu button.resource-save').click()
      console.log('[dokieli-e2e] clicked save')
      let savedResponse
      try {
        savedResponse = await saveResponse
      } catch (error) {
        throw new Error(`Dokieli save did not reach the exact document: ${documentRequests.join(', ')}`, { cause: error })
      }
      expect(savedResponse.ok()).toBe(true)
      console.log('[dokieli-e2e] save response received')
      const saved = await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (!authenticatedFetch) throw new Error('The Dokieli test has no authenticated Solid session.')
        const response = await authenticatedFetch.call(session, url, {
          signal: AbortSignal.timeout(10_000)
        })
        return response.text()
      }, documentUrl)
      console.log('[dokieli-e2e] verified saved content')
      expect(saved).toContain(`<h1>${editedHeading}</h1>`)
      await page.locator('folder-pane-sidebar li[aria-label="Home"] > .resource-row').click()
      const resource = page.locator(`folder-pane-container li[role="option"][about="<${documentUrl}>"]`)
      await expect(resource).toHaveCount(1)
      await expect(resource.locator('.resource-grid-icon--container')).toHaveCount(0)
    } finally {
      if (page.isClosed()) return
      await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (authenticatedFetch) {
          await authenticatedFetch.call(session, url, {
            method: 'DELETE',
            signal: AbortSignal.timeout(10_000)
          })
        }
      }, documentUrl)
    }
  })

  for (const [variant, prefix] of [['a simple name', 'folder-pane-dokieli-stays'], ['a name with spaces', 'My Dokieli Doc']] as const) {
  test(`keeps a newly created Dokieli document with ${variant} in the content area instead of the folder view`, async ({ page }) => {
    test.setTimeout(90_000)
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const documentName = `${prefix} ${Date.now()}`.replace(/^(folder-pane-dokieli-stays) /, '$1-')
    const documentUrl = new URL(`${encodeURIComponent(documentName)}.html`, containerUrl).toString()

    // Record every content-area change so a later re-render back to the folder view is caught.
    await page.evaluate(() => {
      const w = window as typeof window & { __contentLog?: string[] }
      w.__contentLog = []
      const content = document.querySelector('folder-pane-content')
      if (!content) throw new Error('No folder-pane content area')
      const record = () => {
        const child = content.firstElementChild as (HTMLElement & { pane?: { name?: string }, subjectUri?: string }) | null
        w.__contentLog!.push(child ? `${child.tagName.toLowerCase()}:${child.pane?.name ?? ''}:${child.subjectUri ?? ''}` : 'empty')
      }
      new MutationObserver(record).observe(content, { childList: true })
    })

    await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(1)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const dokieliItem = page.getByRole('menuitem', { name: 'New Dokieli Document', exact: true })
    test.skip(await dokieliItem.count() === 0, 'The runtime does not register the Dokieli creation pane.')
    await dokieliItem.click()
    const dialog = page.locator('folder-pane-create-dialog')
    await dialog.locator('input').fill(documentName)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()

    try {
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1, { timeout: 20_000 })
      await expect(provider.frameLocator('iframe').locator('h1', { hasText: documentName }).first()).toBeVisible()

      // It must stay open: no later refresh may swap the folder view back in.
      await page.waitForTimeout(5_000)
      const log = await page.evaluate(() => (window as typeof window & { __contentLog?: string[] }).__contentLog)
      await expect(page.locator('folder-pane-content > folder-pane-container'), `content changes: ${log?.join(' -> ')}`).toHaveCount(0)
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name
      )).toBe('humanReadable')
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { subjectUri?: string }).subjectUri
      )).toBe(documentUrl)
      await expect(provider.frameLocator('iframe').locator('h1', { hasText: documentName }).first()).toBeVisible()
      expect(log?.at(-1)).toMatch(/^solid-ui-file-explorer-provider:humanReadable:/)
    } finally {
      await page.evaluate(async (url) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const authenticatedFetch = session?.authFetch ?? session?.fetch
        if (authenticatedFetch) await authenticatedFetch.call(session, url, { method: 'DELETE' })
      }, documentUrl)
    }
  })
  }

  test('replaces the content target on selection and preserves the chosen view on return Home', async ({ page }) => {
    for (const view of ['List', 'Grid'] as const) {
      await getViewButton(page, view).click()
      const container = page.locator('folder-pane-container')
      const firstResource = container.getByRole('option').first()
      await expect(firstResource).toBeVisible()
      const about = await firstResource.getAttribute('about')
      expect(about).toBeTruthy()
      const resourceUri = about!.slice(1, -1)
      await firstResource.click()

      await expect.poll(() => page.locator('folder-pane-content').evaluate((element, selectedUri) => {
        const child = element.firstElementChild as HTMLElement & {
          subject?: { uri: string }
          subjectUri?: string
        } | null
        const renderedUri = child?.subject?.uri || child?.subjectUri
        return renderedUri === selectedUri || renderedUri === `${selectedUri}index.ttl#this`
      }, resourceUri)).toBe(true)
      await expect(page.locator('folder-pane-content folder-pane-content')).toHaveCount(0)
      await expect(page.locator('folder-pane-sidebar li[aria-selected="true"]')).toHaveAttribute('about', about!)

      await page.locator('folder-pane-sidebar li[aria-label="Home"] > .resource-row').click()
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(1)
      await expect(page.locator('folder-pane-container').getByRole('listbox')).toHaveClass(
        view === 'List' ? 'resource-list' : 'resource-grid'
      )
    }
  })

  test('passes shared dependencies and state explicitly to direct descendants', async ({ page }) => {
    const view = page.locator('folder-pane-view')
    await expect.poll(() => view.evaluate(element => {
      const host = element as FolderView
      const sidebar = host.querySelector('folder-pane-sidebar') as HTMLElement & {
        store?: unknown
        resourceLogic?: unknown
        subject?: unknown
        selectedResource?: unknown
      }
      const container = host.querySelector('folder-pane-container') as HTMLElement & {
        resourceLogic?: unknown
        view?: string
      }
      return Boolean(sidebar.store) &&
        Boolean(sidebar.resourceLogic) &&
        sidebar.subject === host.subject &&
        sidebar.selectedResource === host.subject &&
        Boolean(container.resourceLogic) &&
        container.view === 'grid'
    })).toBe(true)

    await getViewButton(page, 'List').click()
    await expect(page.locator('folder-pane-container')).toHaveJSProperty('view', 'list')

    const firstResource = page.locator('folder-pane-container').getByRole('option').first()
    const about = await firstResource.getAttribute('about')
    await firstResource.click()
    await expect(page.locator('folder-pane-sidebar li[aria-selected="true"]')).toHaveAttribute('about', about!)

    await page.locator('folder-pane-sidebar li[aria-label="Home"] > .resource-row').click()
    await expect(page.locator('folder-pane-container').getByRole('listbox')).toHaveClass('resource-list')
  })

  test('preserves view state across normal and full-page targets', async ({ page }) => {
    const view = page.locator('folder-pane-view')
    await getViewButton(page, 'List').click()
    await expect(page.locator('folder-pane-content > folder-pane-container').getByRole('listbox')).toHaveClass('resource-list')
    await view.evaluate(element => { (element as HTMLElement & { fullView: boolean }).fullView = true })
    await expect(page.locator('.folder-pane-full-view > folder-pane-container').getByRole('listbox')).toHaveClass('resource-list')
    await expect(page.locator('folder-pane-sidebar')).toHaveCount(0)

    await view.evaluate(element => { (element as HTMLElement & { fullView: boolean }).fullView = false })
    await expect(page.locator('folder-pane-content > folder-pane-container').getByRole('listbox')).toHaveClass('resource-list')
    await expect(page.locator('folder-pane-sidebar')).toHaveCount(1)
  })

  test('keeps explorer content inside the folder-pane content column', async ({ page }) => {
    const bounds = await page.locator('.folder-pane-content-column').evaluate(element => {
      const column = element.getBoundingClientRect()
      const content = element.querySelector('folder-pane-content')?.getBoundingClientRect()
      const explorer = element.querySelector('folder-pane-content > *')?.getBoundingClientRect()
      return {
        column: { left: column.left, right: column.right, top: column.top, bottom: column.bottom },
        content: content && { left: content.left, right: content.right, top: content.top, bottom: content.bottom },
        explorer: explorer && { left: explorer.left, right: explorer.right, top: explorer.top, bottom: explorer.bottom }
      }
    })
    expect(bounds.content).toBeTruthy()
    expect(bounds.explorer).toBeTruthy()
    expect(bounds.explorer!.left).toBeGreaterThanOrEqual(bounds.column.left)
    expect(bounds.explorer!.right).toBeLessThanOrEqual(bounds.column.right)
    expect(bounds.explorer!.top).toBeGreaterThanOrEqual(bounds.column.top)
    expect(bounds.explorer!.bottom).toBeLessThanOrEqual(bounds.column.bottom)
  })

  test('keeps the file explorer header and its actions inside the content area', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const nested = await seedNestedFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    for (const levelUrl of nested.levels) {
      await selectResource(page, levelUrl)
    }
    await selectResource(page, nested.fileUrl)

    const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
    const header = provider.locator('solid-ui-file-explorer-header')
    await expect(header.getByTitle('More options')).toBeVisible()

    const bounds = await provider.evaluate(element => {
      const rect = (target: Element | null | undefined) => {
        if (!target) return null
        const box = target.getBoundingClientRect()
        return { left: box.left, right: box.right }
      }
      const headerHost = element.querySelector('solid-ui-file-explorer-header')
      return {
        provider: rect(element)!,
        header: rect(headerHost?.shadowRoot?.querySelector('header'))
      }
    })

    expect(bounds.header).toBeTruthy()
    expect(bounds.header!.left).toBeGreaterThanOrEqual(bounds.provider.left - 0.5)
    expect(bounds.header!.right).toBeLessThanOrEqual(bounds.provider.right + 0.5)
    const actions = header.locator('button:visible')
    expect(await actions.count()).toBeGreaterThan(0)
    for (const action of await actions.all()) {
      const box = await action.boundingBox()
      expect(box).toBeTruthy()
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds.provider.right + 0.5)
    }
  })

  test('navigates through seeded containers up to three levels and returns with Back', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const nested = await seedNestedFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)

    for (const levelUrl of nested.levels) {
      await selectResource(page, levelUrl)
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(1)
    }
    await selectResource(page, nested.fileUrl)
    const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
    await expect(provider.locator('source-pane-source-editor-card .cm-editor')).toBeVisible()

    await provider.getByTitle('Back').click()
    await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(1)
    const returnedContainer = page.locator('folder-pane-content > folder-pane-container')
    await expect.poll(() => returnedContainer.evaluate(element =>
      (element as HTMLElement & { subject?: { value?: string } }).subject?.value
    )).toBe(nested.levels.at(-1))
    await expect(returnedContainer.locator(`li[role="option"][about="<${nested.fileUrl}>"]`)).toHaveCount(1)
  })

  test('reloads and revisits a container after opening a resource', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const nested = await seedNestedFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)

    for (const levelUrl of nested.levels) {
      await selectResource(page, levelUrl)
    }
    await selectResource(page, nested.fileUrl)
    const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
    await expect(provider.locator('source-pane-source-editor-card .cm-content'))
      .toContainText('export const nested = true')

    // A browser reload is the reliable user-visible recovery path available to
    // this local harness; it does not manufacture an HTTP failure.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    for (const levelUrl of nested.levels) {
      await selectResource(page, levelUrl)
    }
    await expect(page.locator(`folder-pane-container li[role="option"][about="<${nested.fileUrl}>"]`))
      .toHaveCount(1)
  })

  test('opens a JavaScript file in Source instead of an empty container', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const nested = await seedNestedFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    for (const levelUrl of nested.levels) {
      await selectResource(page, levelUrl)
    }

    await selectResource(page, nested.fileUrl)
    const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
    await expect(provider).toHaveCount(1)
    await expect.poll(() => provider.evaluate(element =>
      (element as HTMLElement & { pane?: { name?: string } }).pane?.name
    )).toBe('source')
    await expect(provider.locator('source-pane-source-provider')).toHaveCount(1)
    await expect(provider.locator('source-pane-source-editor-card .cm-editor')).toBeVisible()
    await expect(provider.locator('source-pane-source-editor-card .cm-content')).toContainText('export const nested = true')
    await provider.locator('solid-ui-file-explorer-header').getByTitle('More options').click()
    await page.getByRole('menuitem', { name: 'Javascript Source', exact: true }).click()
    await expect(provider.locator('source-pane-source-editor-card .cm-editor')).toBeVisible()
    await expect(provider.locator('source-pane-source-editor-card .cm-content')).toContainText('export const nested = true')

    await provider.getByTitle('Back').click()
    for (const levelUrl of nested.levels) {
      await page.locator('folder-pane-sidebar').locator(`li[about="<${levelUrl}>"]`)
        .locator(':scope > .resource-row > .resource-expand-button').click()
    }
    await page.locator('folder-pane-sidebar').locator(`li[about="<${nested.fileUrl}>"]`)
      .locator(':scope > .resource-row').click()
    await expect(provider.locator('source-pane-source-editor-card .cm-content')).toContainText('export const nested = true')
    await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(0)
    await expect(page.locator('.folder-pane-resource-error')).toHaveCount(0)
  })
})

async function selectResource (page: Parameters<typeof openFolderPane>[0], resourceUrl: string): Promise<void> {
  const options = page.locator('folder-pane-container li[role="option"]')
  await expect.poll(() => options.evaluateAll(
    (items, url) => items.findIndex(item => item.getAttribute('about') === `<${url}>`),
    resourceUrl
  )).toBeGreaterThanOrEqual(0)
  const index = await options.evaluateAll((items, url) =>
    items.findIndex(item => item.getAttribute('about') === `<${url}>`),
  resourceUrl)
  expect(index, `Resource is not listed: ${resourceUrl}`).toBeGreaterThanOrEqual(0)
  const matching = options.nth(index)
  await expect(matching).toBeVisible()
  await matching.click()
}

test.describe('folder-pane permissions', () => {
  test('does not expose Add to a configured non-editable viewer', async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true' ||
      !hasConfiguredViewerUser() ||
      !process.env.E2E_FOLDER_PANE_VIEWER_URL,
      'Set E2E_FOLDER_PANE_VIEWER_URL and configure the local viewer to run permission coverage.'
    )

    await authenticateSolidUser(page, viewerUser)
    await page.goto(process.env.E2E_FOLDER_PANE_VIEWER_URL!, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('folder-pane-storage-header')).toBeVisible()
    const add = page.locator('folder-pane-storage-header').getByRole('button', { name: 'Add', exact: true })
    await expect(add).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Upload', exact: true })).toHaveCount(0)
  })
})
