import { test, expect } from '../../fixtures/test.js'
import type { Locator, Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedNestedFolderPaneCase } from '../../fixtures/folder-pane.js'

type FolderView = HTMLElement & {
  browserContext: unknown
  subject: unknown
  updateComplete: Promise<boolean>
}

function getViewButton (page: Page, view: 'Grid' | 'List'): Locator {
  return page.locator(`solid-ui-button[aria-label="${view} view"]`)
}

test.describe('folder-pane container presentation', () => {
  test.beforeEach(async ({ page }) => {
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

  test('omits Public and Trash from the Home container', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    const listedFolders = await container.getByRole('option').evaluateAll(items =>
      items
        .filter(item => item.querySelector('.resource-grid-icon--container'))
        .map(item => item.getAttribute('aria-label')?.toLowerCase())
    )

    expect(listedFolders).not.toContain('public')
    expect(listedFolders).not.toContain('trash')
  })

  test('does not expose a container index.ttl#this as a separate resource target', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    const resourceUris = await container.getByRole('option').evaluateAll(items =>
      items.map(item => item.getAttribute('about') || '')
    )
    expect(resourceUris.some(uri => /index\.ttl#this[">]?$/i.test(uri))).toBe(false)
    await expect(container.getByRole('listbox', { name: 'Container resources' })).toBeVisible()
  })

  test('shows public or private access indicators when resource metadata is available', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    const indicators = container.locator('.resource-access-indicator')
    await expect.poll(() => indicators.count(), {
      timeout: 5000,
      message: 'Waiting for resource access metadata'
    }).toBeGreaterThan(0)
    const labels = await indicators.evaluateAll(elements =>
      elements.map(element => element.getAttribute('title'))
    )
    expect(labels.every(label => label === 'Public' || label === 'Private')).toBe(true)
  })

  test('provides a three-dots action menu for each displayed resource', async ({ page }) => {
    const container = page.locator('folder-pane-container')
    await expect(container.getByRole('option').first().getByTitle('More options')).toBeVisible()
  })

  test('exposes Manage Access from a container resource action menu', async ({ page }) => {
    const resource = page.locator('folder-pane-container').getByRole('option').first()
    const about = await resource.getAttribute('about')
    expect(about).toBeTruthy()
    await resource.evaluate(element => {
      element.closest('folder-pane-container')?.addEventListener('solid-ui-file-explorer-manage-access', event => {
        const subjectUri = (event as CustomEvent<{ subjectUri?: string }>).detail?.subjectUri
        document.body.setAttribute('data-managed-access-uri', subjectUri || '')
      }, { once: true })
    })
    await resource.getByTitle('More options').click()
    const manageAccess = page.getByRole('menuitem', { name: 'Manage Access', exact: true })
    await expect(manageAccess).toBeVisible()
    await manageAccess.click()
    await expect(page.locator('body')).toHaveAttribute('data-managed-access-uri', about!.slice(1, -1))
  })

  test('opens a resource action in another registered pane', async ({ page }) => {
    const resource = page.locator('folder-pane-container').getByRole('option').first()
    const menu = resource.locator('solid-ui-resource-actions-menu')
    await menu.getByTitle('More options').click()
    const paneItems = page.getByRole('menuitem').filter({ hasNotText: /Manage Access|Upload/ })
    const itemCount = await paneItems.count()
    test.skip(itemCount === 0, 'The seeded resource has no alternate pane action.')
    const initialLabels = await paneItems.allTextContents()

    await paneItems.first().click()
    const provider = page.locator('solid-ui-file-explorer-provider')
    await expect(provider).toHaveCount(1)
    await expect.poll(() => provider.evaluate(element =>
      (element as HTMLElement & { pane?: { name?: string } }).pane?.name || null
    )).not.toBeNull()

    // Pane switching must not replace the resource's target-specific action
    // set with the small set of actions applicable to the selected pane.
    const headerMenu = provider.locator('solid-ui-file-explorer-header solid-ui-resource-actions-menu')
    await headerMenu.getByTitle('More options').click()
    const reopenedItems = page.getByRole('menuitem').filter({ hasNotText: /Manage Access|Upload/ })
    await expect(reopenedItems).toHaveCount(itemCount)
    await expect(reopenedItems.allTextContents()).resolves.toEqual(initialLabels)
  })

  test('exposes an accessible Add menu with Upload', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /Upload/ })).toBeVisible()
  })

  test('creates a Source file from the header Add action', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ttl`
    const fileUrl = new URL(fileName, containerUrl).toString()
    const fileRequest = page.waitForRequest(request =>
      request.method() === 'PUT' && request.url() === fileUrl
    )

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const sourceItem = page.getByRole('menuitem', { name: 'New file', exact: true })
    await expect(sourceItem).toBeVisible()
    await sourceItem.click()

    const dialog = page.locator('folder-pane-create-dialog')
    await expect(dialog.getByText('New file name', { exact: true })).toBeVisible()
    await expect(dialog.getByText('File name', { exact: true })).toBeVisible()
    await dialog.locator('input').fill(fileName)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    const request = await fileRequest
    expect(request.url()).toBe(fileUrl)
    expect(request.headers()['content-type']).toMatch(/^text\/turtle\b/)

    try {
      const resource = page.locator(`folder-pane-container li[role="option"][about="<${fileUrl}>"]`)
      await expect(resource).toHaveCount(1)
      await resource.click()
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name
      )).toBe('source')
      await expect(provider.locator('source-pane-source-editor-card .cm-editor')).toBeVisible()
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(0)
      expect(fileUrl.endsWith('/')).toBe(false)
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
    const folderItem = page.getByRole('menuitem', { name: 'New folder', exact: true })
    test.skip(await folderItem.count() === 0, 'The runtime does not register a folder creation pane.')
    await folderItem.click()

    const folderName = `folder-pane-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const folderUrl = new URL(`${encodeURIComponent(folderName)}/`, containerUrl).toString()
    const dialog = page.locator('folder-pane-create-dialog')
    await expect(dialog.getByText('New folder name', { exact: true })).toBeVisible()
    await dialog.locator('input').fill(folderName)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()

    try {
      const resource = page.locator(`folder-pane-container li[role="option"][about="<${folderUrl}>"]`)
      await expect(resource).toHaveCount(1)
      await expect(resource.locator('.resource-grid-icon--container')).toHaveCount(1)
      await resource.click()
      await expect(page.locator('folder-pane-content > folder-pane-container')).toHaveCount(1)
      await expect(page.locator('folder-pane-sidebar li[aria-selected="true"]'))
        .toHaveAttribute('about', `<${folderUrl}>`)

      await page.locator('folder-pane-sidebar li[aria-label="Home"] > .resource-row').click()
      await expect(page.locator(`folder-pane-container li[role="option"][about="<${folderUrl}>"]`)).toHaveCount(1)
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

  test('creates a Dokieli document from Add and opens it as HTML content', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const documentName = `folder-pane-dokieli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const documentUrl = new URL(`${encodeURIComponent(documentName)}.html`, containerUrl).toString()
    const documentRequest = page.waitForRequest(request =>
      request.method() === 'PUT' && request.url() === documentUrl
    )

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const dokieliItem = page.getByRole('menuitem', { name: 'New Dokieli', exact: true })
    test.skip(await dokieliItem.count() === 0, 'The runtime does not register the Dokieli creation pane.')
    await dokieliItem.click()

    const dialog = page.locator('folder-pane-create-dialog')
    await expect(dialog.getByText('New dokieli name', { exact: true })).toBeVisible()
    await dialog.locator('input').fill(documentName)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()

    try {
      const request = await documentRequest
      expect(request.url()).toBe(documentUrl)
      expect(request.headers()['content-type']).toMatch(/^text\/html\b/)
      expect(documentUrl.endsWith('/')).toBe(false)

      const document = await page.evaluate(async (url) => {
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
      expect(document.status).toBe(200)
      expect(document.contentType).toMatch(/^text\/html\b/)
      expect(document.text).toContain('<script src="https://dokie.li/scripts/dokieli.js"></script>')
      expect(document.text).toContain(`<title>${documentName}</title>`)
      expect(document.text).toContain(`<h1>${documentName}</h1>`)
      expect(document.text).toContain('typeof="schema:CreativeWork prov:Entity"')

      const resource = page.locator(`folder-pane-container li[role="option"][about="<${documentUrl}>"]`)
      await expect(resource).toHaveCount(1)
      await expect(resource.locator('.resource-grid-icon--container')).toHaveCount(0)
      await resource.click()
      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name
      )).toBe('humanReadable')
      await expect(provider.locator('iframe')).toHaveAttribute('src', documentUrl)
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
    await expect(page.locator('folder-pane-sidebar li[aria-label="Home"]')).toHaveAttribute(
      'aria-selected', 'true'
    )
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
