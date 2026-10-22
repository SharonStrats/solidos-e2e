import { test, expect } from '../../fixtures/test.js'
import type { Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'

/**
 * Every pane exposed by the storage header Add menu is created through the
 * real pane mintNew implementation, then verified against the server, the
 * sidebar, the content area and the top-of-content status area.
 */
type PaneCase = {
  /** Server documents the pane must create, relative to the new resource. */
  files: string[]
  /** Path, relative to the container, of the direct child added to the container. */
  contained: (name: string) => string
  /** Path, relative to the container, of the thing opened in the content area. */
  opened: (name: string) => string
  /** Indexed panes render the container's index.ttl#this without the explorer header. */
  indexed: boolean
  name: (runId: string) => string
  /** Pane expected to render the result when the minting pane has no render(). */
  renderedPane?: string
}

const indexedPane = (files: string[] = ['index.ttl']): PaneCase => ({
  files,
  contained: name => `${encodeURIComponent(name)}/`,
  opened: name => `${encodeURIComponent(name)}/index.ttl#this`,
  indexed: true,
  name: runId => `e2e-add-${runId}`
})

// Keyed by pane-registry name. Every Add-menu pane must have a case here so a
// newly registered creation pane cannot be silently left untested.
const PANE_CASES: Record<string, PaneCase> = {
  issue: indexedPane(['index.ttl', 'state.ttl']),
  contact: indexedPane(['index.ttl', 'groups.ttl', 'people.ttl']),
  pad: indexedPane(),
  meeting: indexedPane(),
  'long chat': indexedPane(),
  schedule: {
    files: ['details.ttl', 'results.ttl'],
    contained: name => `${encodeURIComponent(name)}/`,
    opened: name => `${encodeURIComponent(name)}/details.ttl#event`,
    indexed: false,
    name: runId => `e2e-add-${runId}`
  },
  Dokieli: {
    files: [],
    contained: name => `${encodeURIComponent(name)}.html`,
    opened: name => `${encodeURIComponent(name)}.html`,
    indexed: false,
    renderedPane: 'humanReadable',
    name: runId => `e2e-add-${runId}`
  },
  folder: {
    files: [],
    contained: name => `${encodeURIComponent(name)}/`,
    opened: name => `${encodeURIComponent(name)}/`,
    indexed: false,
    name: runId => `e2e-add-${runId}`
  },
  source: {
    files: [],
    contained: name => encodeURIComponent(name),
    opened: name => encodeURIComponent(name),
    indexed: false,
    name: runId => `e2e-add-${runId}.ttl`
  }
}

async function getAddMenuPanes (page: Page): Promise<string[]> {
  const header = page.locator('folder-pane-storage-header')
  const read = () => header.evaluate(element =>
    ((element as HTMLElement & { availablePanes?: Array<{ name: string }> }).availablePanes ?? [])
      .map(pane => pane.name))
  // Audience filtering is asynchronous; wait until the menu has been populated.
  await expect.poll(async () => (await read()).length).toBeGreaterThan(0)
  return read()
}

async function authenticatedRequest (page: Page, url: string, method = 'GET') {
  return page.evaluate(async ({ url, method }) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('No authenticated Solid session.')
    const response = await authenticatedFetch.call(session, url, {
      method,
      headers: method === 'GET' ? { accept: 'text/turtle, */*;q=0.5' } : undefined
    })
    return { status: response.status, text: method === 'GET' ? await response.text() : '' }
  }, { url, method })
}

async function openSolo (page: Page, subjectUrl: string): Promise<void> {
  await page.goto(subjectUrl, { waitUntil: 'domcontentloaded' })
}

async function createDisposableContainer (page: Page, parentUrl: string): Promise<string> {
  const slug = `e2e-add-target-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const response = await page.evaluate(async ({ parentUrl, slug }) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('No authenticated Solid session.')
    const result = await authenticatedFetch.call(session, parentUrl, {
      method: 'POST',
      body: ' ',
      headers: {
        'content-type': 'text/turtle',
        slug: `${slug}/`,
        link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
      }
    })
    return result.status
  }, { parentUrl, slug })
  expect(response, `Could not create nested Add-menu target in ${parentUrl}`).toBe(201)
  return new URL(`${slug}/`, parentUrl).toString()
}

async function openNestedAddTarget (page: Page, rootUrl: string): Promise<string> {
  const nestedUrl = await createDisposableContainer(page, rootUrl)
  await openFolderPane(page, rootUrl)
  const nestedItem = page.locator(
    `folder-pane-content folder-pane-container li[about="<${nestedUrl}>"]`
  )
  await expect(nestedItem).toHaveCount(1)
  await nestedItem.click()
  await expect(page.locator('folder-pane-sidebar li[aria-selected="true"]'))
    .toHaveAttribute('about', `<${nestedUrl}>`)
  return nestedUrl
}

/**
 * Delete a disposable resource. Panes keep writing after they open (long chat
 * creates today's dated chat document on render), so retry until it is gone.
 */
async function removeDisposable (page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await removeRecursively(page, url)
    if ((await authenticatedRequest(page, url)).status === 404) return
    await page.waitForTimeout(500)
  }
  throw new Error(`Could not remove disposable resource ${url}`)
}

/** Delete a resource; containers are emptied depth first. */
async function removeRecursively (page: Page, url: string): Promise<void> {
  if (url.endsWith('/')) {
    const listing = await authenticatedRequest(page, url)
    if (listing.status === 200) {
      const members = [...listing.text.matchAll(/<([^>]+)>/g)]
        .map(match => new URL(match[1], url).toString())
        .filter(member => member !== url && member.startsWith(url) &&
          !member.slice(url.length).replace(/\/$/, '').includes('/'))
      for (const member of new Set(members)) await removeRecursively(page, member)
    }
  }
  await authenticatedRequest(page, url, 'DELETE')
}

test.describe('folder-pane Add menu panes', () => {
  test.describe.configure({ mode: 'serial' })

  let nestedContainerUrl: string | undefined

  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to a writable disposable container.')
    if (!containerUrl) return
    await authenticateProfileOwner(page)
    nestedContainerUrl = await openNestedAddTarget(page, containerUrl)
  })

  test.afterEach(async ({ page }) => {
    if (!nestedContainerUrl) return
    try {
      await removeDisposable(page, nestedContainerUrl)
    } finally {
      nestedContainerUrl = undefined
    }
  })

  test('the Add menu offers exactly the registered creation panes, each with E2E coverage', async ({ page }) => {
    const registered = await page.evaluate(() => {
      const list = (window as typeof window & {
        panes?: { list?: Array<{ name?: string, mintNew?: unknown }> }
      }).panes?.list ?? []
      return list.filter(pane => pane.mintNew).map(pane => pane.name)
    })
    const menuPanes = await getAddMenuPanes(page)
    expect(menuPanes.length).toBeGreaterThan(0)
    expect(menuPanes).not.toContain('chat')
    for (const name of menuPanes) expect(registered).toContain(name)
    expect(
      menuPanes.filter(name => !PANE_CASES[name] && name !== 'questionnaire' && name !== 'questionaire'),
      'Add-menu panes without an E2E case'
    ).toEqual([])

    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const items = page.getByRole('menuitem', { name: /^New / })
    await expect(items).toHaveCount(menuPanes.length)
    await page.keyboard.press('Escape')
  })

  for (const [paneName, paneCase] of Object.entries(PANE_CASES)) {
    test(`creates a "${paneName}" resource with its files, refreshes the sidebar and opens it`, async ({ page }) => {
      test.setTimeout(90_000)
      const containerUrl = nestedContainerUrl!
      const menuPanes = await getAddMenuPanes(page)
      const menuIndex = menuPanes.indexOf(paneName)
      test.skip(menuIndex < 0, `The ${paneName} pane is not registered for this user/runtime.`)

      const runId = `${paneName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const name = paneCase.name(runId)
      const containedUrl = new URL(paneCase.contained(name), containerUrl).toString()
      const openedUrl = new URL(paneCase.opened(name), containerUrl).toString()
      const dialogs: string[] = []
      page.on('dialog', dialog => {
        dialogs.push(`${dialog.type()}: ${dialog.message()}`)
        void dialog.accept()
      })

      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByRole('menuitem', { name: /^New / }).nth(menuIndex).click()
      const dialog = page.locator('folder-pane-create-dialog')
      await dialog.locator('input').fill(name)
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()

      try {
        const status = page.locator('.folder-pane-content-column > .folder-pane-status')
        const message = status.locator('.folder-pane-status-message')
        await expect.poll(async () => {
          if (await message.count() === 0) return 'cleared'
          return await message.getAttribute('data-status')
        }, { timeout: 30_000 }).toMatch(/cleared|success|error/)
        if (await message.count() > 0) {
          const statusText = await status.textContent()
          expect(await message.getAttribute('data-status'), `Mint failed: ${statusText} ${dialogs.join(' | ')}`).toBe('success')
        }
        await expect(page.locator('folder-pane-storage-header .folder-pane-status')).toHaveCount(0)

        const contained = await authenticatedRequest(page, containedUrl)
        expect(contained.status, `${containedUrl} was not created`).toBe(200)
        for (const file of paneCase.files) {
          const fileUrl = new URL(file, containedUrl).toString()
          const response = await authenticatedRequest(page, fileUrl)
          expect(response.status, `${fileUrl} was not created`).toBe(200)
        }

        const sidebarItem = page.locator(`folder-pane-sidebar li[about="<${containedUrl}>"]`)
        await expect(sidebarItem).toHaveCount(1)

        const content = page.locator('folder-pane-content')
        if (containedUrl.endsWith('/') && !paneCase.indexed && paneCase.files.length === 0) {
          await expect(content.locator('folder-pane-container')).toHaveCount(1)
        } else {
          const provider = content.locator('solid-ui-file-explorer-provider')
          await expect(provider).toHaveCount(1)
          await expect.poll(() => provider.evaluate(element =>
            (element as HTMLElement & { pane?: { name?: string } }).pane?.name
          )).toBe(paneCase.renderedPane ?? paneName)
          await expect.poll(() => provider.evaluate(element =>
            (element as HTMLElement & { subjectUri?: string, subject?: { uri?: string } }).subjectUri ??
            (element as HTMLElement & { subject?: { uri?: string } }).subject?.uri
          )).toBe(openedUrl)
          await expect(provider.locator('solid-ui-file-explorer-header'))
            .toHaveCount(paneCase.indexed ? 0 : 1)
        }

        if (paneCase.files.includes('index.ttl')) {
          // The real index.ttl document stays visible when browsing the new container.
          const expand = sidebarItem.locator('> .resource-row .resource-expand-button')
          if ((await sidebarItem.getAttribute('aria-expanded')) !== 'true') await expand.click()
          const indexUrl = new URL('index.ttl', containedUrl).toString()
          await expect(page.locator(`folder-pane-sidebar li[about="<${indexUrl}>"]`)).toHaveCount(1)
        }

        if (paneCase.indexed && (paneName === 'contact' || paneName === 'pad')) {
          await expect(page.locator('folder-pane-storage-header')).toHaveCount(1)
          await expect(page.locator('folder-pane-sidebar')).toHaveCount(1)
          await openSolo(page, containedUrl)
          const soloProvider = page.locator('solid-ui-file-explorer-provider')
          await expect(soloProvider).toHaveCount(1)
          await expect(page.locator('folder-pane-container')).toHaveCount(0)
          await expect(page.locator('folder-pane-storage-header')).toHaveCount(0)
          await expect(page.locator('folder-pane-sidebar')).toHaveCount(0)
          await expect.poll(() => soloProvider.evaluate(element =>
            (element as HTMLElement & { pane?: { name?: string } }).pane?.name
          )).toBe(paneName)
          await expect.poll(() => soloProvider.evaluate(element =>
            (element as HTMLElement & { subjectUri?: string, subject?: { uri?: string } }).subjectUri ??
            (element as HTMLElement & { subject?: { uri?: string } }).subject?.uri
          )).toBe(openedUrl)
          await expect(soloProvider.locator('solid-ui-file-explorer-header')).toHaveCount(0)
          if (paneName === 'contact') {
            await soloProvider.evaluate(element => {
              const provider = element as HTMLElement & { handleAccessClick?: () => Promise<void> | void }
              if (!provider.handleAccessClick) {
                throw new Error('Indexed pane provider does not expose an access handler')
              }
              return provider.handleAccessClick()
            })
            const accessDialog = page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')
            await expect(accessDialog).toBeVisible()
            await expect.poll(() => page.locator('solid-ui-access-control-modal').evaluate(element =>
              (element as HTMLElement & { subjectUri?: string }).subjectUri
            )).toBe(new URL(openedUrl).toString().split('#')[0])
            await page.getByRole('button', { name: 'Cancel', exact: true }).click()
            await expect(accessDialog).toHaveCount(0)
          }
          await openFolderPane(page, process.env.E2E_FOLDER_PANE_CONTAINER_URL!)
          await expect(page.locator('folder-pane-storage-header')).toHaveCount(1)
          await expect(page.locator('folder-pane-sidebar')).toHaveCount(1)
        }
      } finally {
        await removeDisposable(page, containedUrl)
      }
    })
  }
})
