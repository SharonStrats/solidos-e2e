import { test, expect } from '../../fixtures/test.js'
import type { Locator, Page } from '@playwright/test'
import { seedRepresentativeFolderPaneCases } from '../../fixtures/folder-pane.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'

test.describe('folder-pane resource selection', () => {
  test('opens each configured representative resource through the folder flow', async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )

    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(
      !containerUrl,
      'Set E2E_FOLDER_PANE_CONTAINER_URL to a readable container containing the representative resources.'
    )
    if (!containerUrl) return

    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl)
    const cases = await seedRepresentativeFolderPaneCases(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const registeredPaneNames = await getSeedablePaneNames(page, containerUrl)
    const missingPanes = cases
      .map(({ paneName }) => paneName)
      .filter((paneName, index, names) =>
        names.indexOf(paneName) === index &&
        !registeredPaneNames.includes(paneName)
      )
    expect(missingPanes, 'Configured pane cases must refer to registered panes').toEqual([])
    const configuredPaneNames = new Set(cases.map(({ paneName }) => paneName))
    expect(
      registeredPaneNames.filter((paneName) =>
        !configuredPaneNames.has(paneName) && paneName !== 'questionnaire'
      ),
      'Every viewable mintable pane and the Source pane needs a self-seeded representative resource'
    ).toEqual([])

    for (const resourceCase of cases) {
      await openFolderPane(page, containerUrl)

      // The about URI is the resource identity exposed by folder-pane, rather than
      // a presentation label which can change with localization.
      const matchingResource = page.locator('folder-pane-container li[role="option"]')
        .evaluateAll((items, resourceUrl) => items.findIndex((item) =>
          item.getAttribute('about') === `<${resourceUrl}>`
        ), resourceCase.resourceUrl)
      const resourceIndex = await matchingResource
      expect(resourceIndex, `Resource is not listed in ${containerUrl}: ${resourceCase.resourceUrl}`).toBeGreaterThanOrEqual(0)
      await page.locator('folder-pane-container li[role="option"]').nth(resourceIndex).click()

      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider, `Expected ${resourceCase.paneName} for ${resourceCase.resourceUrl}`).toHaveCount(1)
      await expect.poll(async () => provider.evaluate((element) =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name || null
      )).toBe(resourceCase.paneName)
      if (resourceCase.paneName === 'source') {
        await expect(provider.locator('source-pane-source-editor-card .cm-editor')).toBeVisible()
        await expect(provider.locator('source-pane-source-editor-card .cm-content')).toContainText('export const seeded = true')
      }
    }
  })

  test('keeps non-index image and HTML pane content below its explorer header while scrolling', async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to a readable container containing the representative resources.')
    if (!containerUrl) return

    await authenticateProfileOwner(page)
    const resources = await seedScrollablePaneResources(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })

    for (const resource of resources) {
      await openFolderPane(page, containerUrl)
      const item = page.locator(`folder-pane-container li[role="option"][about="<${resource.url}>"]`)
      await expect(item, `Expected ${resource.url} to be listed`).toHaveCount(1)
      await item.click()

      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      await expect.poll(() => provider.evaluate(element =>
        (element as HTMLElement & { pane?: { name?: string } }).pane?.name || null
      )).toBe(resource.paneName)
      await expect(provider.locator('solid-ui-file-explorer-header')).toHaveCount(1)
      await expect.poll(() => getPaneScrollGeometry(provider)).toEqual(expect.objectContaining({
        headerPosition: 'sticky',
        contentBelowHeader: true
      }))
    }
  })

  test('edits, saves, and rejects invalid source-pane content', async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to run source-pane coverage.')
    if (!containerUrl) return

    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl)
    const cases = await seedRepresentativeFolderPaneCases(page, containerUrl)
    const sourceCase = cases.find(resourceCase => resourceCase.paneName === 'source')
    expect(sourceCase, 'Expected a seeded Source pane resource').toBeDefined()
    if (!sourceCase) return

    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    const item = page.locator(`folder-pane-container li[role="option"][about="<${sourceCase.resourceUrl}>"]`)
    await expect(item).toHaveCount(1)
    await item.click()

    const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
    await expect(provider).toHaveCount(1)
    await provider.evaluate((element) => {
      const editorProvider = element as HTMLElement & {
        value?: { beginEditing?: () => void }
      }
      editorProvider.value?.beginEditing?.()
    })

    const editor = provider.locator('source-pane-source-editor-card')
    await expect(editor.locator('.sourcePaneSaveButton')).toBeVisible()
    await expect(editor.locator('.sourcePaneCancelButton')).toBeVisible()

    const content = editor.locator('.cm-content')
    await content.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await expect.poll(() => content.textContent()).toMatch(/\t| {2}/)
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement
      return active instanceof HTMLElement &&
        (active.matches('.cm-content') || Boolean(active.closest('.cm-editor')))
    })).toBe(true)

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.type('export const seeded = false\n')
    await editor.locator('.sourcePaneSaveButton').click()

    await expect.poll(async () => readAuthenticatedResource(page, sourceCase.resourceUrl))
      .toContain('export const seeded = false')
    await expect(editor.locator('.sourcePaneSaveButton')).toHaveCount(0)

    await provider.evaluate((element) => {
      const editorProvider = element as HTMLElement & {
        value?: { beginEditing?: () => void }
      }
      editorProvider.value?.beginEditing?.()
    })
    await expect(editor.locator('.sourcePaneSaveButton')).toBeVisible()
    await content.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.type('export const = invalid\n')
    await editor.locator('.sourcePaneSaveButton').click()

    await expect(page.locator('.sourcePaneStatus')).toContainText('Syntax error: fix the document before saving.')
    await expect.poll(async () => readAuthenticatedResource(page, sourceCase.resourceUrl))
      .toContain('export const seeded = false')
  })
})

async function readAuthenticatedResource (page: Page, url: string): Promise<string> {
  return page.evaluate(async resourceUrl => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { authFetch?: typeof fetch, fetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const fetcher = session?.authFetch ?? session?.fetch
    if (!fetcher) throw new Error('The folder-pane test has no authenticated Solid session.')
    const response = await fetcher.call(session, resourceUrl)
    if (!response.ok) throw new Error(`Could not read ${resourceUrl}: ${response.status}`)
    return response.text()
  }, url)
}

async function seedScrollablePaneResources (page: Page, containerUrl: string): Promise<Array<{ url: string, paneName: string }>> {
  return page.evaluate(async (container) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('The folder-pane test has no authenticated Solid session.')

    const runId = Date.now()
    const imageUrl = new URL(`folder-pane-scroll-${runId}.png`, container).toString()
    const htmlUrl = new URL(`folder-pane-scroll-${runId}.html`, container).toString()
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 1600
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('Unable to create the scroll regression image.')
    canvasContext.fillStyle = '#ffffff'
    canvasContext.fillRect(0, 0, canvas.width, canvas.height)
    canvasContext.fillStyle = '#4c1d95'
    canvasContext.font = '48px sans-serif'
    canvasContext.fillText('Folder pane scroll test', 40, 100)
    const imageBlob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to encode the scroll regression image.')), 'image/png')
    )
    const imageResponse = await authenticatedFetch.call(session, imageUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: await imageBlob.arrayBuffer()
    })
    if (!imageResponse.ok) throw new Error(`Could not seed ${imageUrl}: ${imageResponse.status}`)

    const htmlResponse = await authenticatedFetch.call(session, htmlUrl, {
      method: 'PUT',
      headers: { 'content-type': 'text/html' },
      body: '<!doctype html><html><body><h1>Folder pane scroll test</h1><div style="height: 2400px">Scrollable HTML content</div></body></html>'
    })
    if (!htmlResponse.ok) throw new Error(`Could not seed ${htmlUrl}: ${htmlResponse.status}`)

    return [
      { url: imageUrl, paneName: 'image' },
      { url: htmlUrl, paneName: 'humanReadable' }
    ]
  }, containerUrl)
}

async function getPaneScrollGeometry (provider: Locator): Promise<{
  headerPosition: string
  contentBelowHeader: boolean
}> {
  return provider.evaluate(element => {
    const header = element.querySelector('solid-ui-file-explorer-header')
    const pane = element.querySelector('.paneDiv')
    if (!header || !pane) {
      return { headerPosition: '', contentBelowHeader: false }
    }

    const scrollHost = element.closest('folder-pane-content') as HTMLElement | null
    if (scrollHost) {
      scrollHost.scrollTop = scrollHost.scrollHeight
    }
    const headerRect = header.getBoundingClientRect()
    const paneRect = pane.getBoundingClientRect()
    return {
      headerPosition: getComputedStyle(header).position,
      contentBelowHeader: paneRect.top >= headerRect.bottom - 1
    }
  })
}

async function getSeedablePaneNames (page: Page, containerUrl: string): Promise<string[]> {
  await openFolderPane(page, containerUrl)
  await expect(page.locator('folder-pane-view')).toHaveCount(1)
  return page.evaluate(() => {
    const panes = (window as typeof window & {
      panes?: { list?: Array<{ name?: string, global?: boolean, mintClass?: { uri?: string }, render?: unknown }> }
    }).panes?.list || []
    return panes
      .filter((pane) => !pane.global && pane.name !== 'questionnaire' && typeof pane.render === 'function' &&
        (typeof pane.mintClass?.uri === 'string' || pane.name === 'source'))
      .map((pane) => pane.name)
      .filter((name): name is string => Boolean(name))
  })
}
