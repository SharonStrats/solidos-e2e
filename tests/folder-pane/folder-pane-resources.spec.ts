import { test, expect } from '../../fixtures/test.js'
import type { Page } from '@playwright/test'
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
})

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
