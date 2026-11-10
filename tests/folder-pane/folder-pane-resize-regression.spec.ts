import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedResizeRegressionFolderPaneCase } from '../../fixtures/folder-pane.js'

type ExplorerProvider = HTMLElement & { pane?: { name?: string } }

test.describe('folder-pane resize regression', () => {
  test('preserves the image pane across desktop-mobile-desktop resizing', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true' || !containerUrl,
      'Set E2E_RUN_FOLDER_PANE=true and E2E_FOLDER_PANE_CONTAINER_URL to run folder-pane coverage.'
    )
    if (!containerUrl) return

    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl)
    const seeded = await seedResizeRegressionFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    await selectResource(page, seeded.containerUrl)
    await selectResource(page, seeded.imageUrl)

    const provider = page.locator('folder-pane-view solid-ui-file-explorer-provider').first()
    await expect(provider).toHaveCount(1)
    const paneName = await provider.evaluate((element: ExplorerProvider) => element.pane?.name)
    expect(paneName).toBeTruthy()
    await expect(provider.locator('img').first()).toBeVisible()

    await resizeAndAssert(page, provider, seeded.imageUrl, paneName!, () =>
      expect(provider.locator('img').first()).toBeVisible()
    )
  })

  test('preserves the source pane and text across desktop-mobile-desktop resizing', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true' || !containerUrl,
      'Set E2E_RUN_FOLDER_PANE=true and E2E_FOLDER_PANE_CONTAINER_URL to run folder-pane coverage.'
    )
    if (!containerUrl) return

    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl)
    const seeded = await seedResizeRegressionFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    await selectResource(page, seeded.containerUrl)
    await selectResource(page, seeded.sourceUrl)

    const provider = page.locator('folder-pane-view solid-ui-file-explorer-provider').first()
    await expect(provider).toHaveCount(1)
    await expect.poll(() => provider.evaluate((element: ExplorerProvider) => element.pane?.name))
      .toBe('source')
    const source = provider.locator('source-pane-source-editor-card .cm-content')
    await expect(source).toContainText('resizeRegressionMarker')

    await resizeAndAssert(page, provider, seeded.sourceUrl, 'source', () =>
      expect(source).toContainText('resizeRegressionMarker = "preserved"')
    )
  })
})

async function resizeAndAssert (
  page: Parameters<typeof openFolderPane>[0],
  provider: ReturnType<typeof page.locator>,
  resourceUrl: string,
  paneName: string,
  contentAssertion: () => Promise<void>
): Promise<void> {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport)
    await expect(provider).toBeVisible()
    await expect.poll(() => provider.evaluate((element: ExplorerProvider) => element.pane?.name))
      .toBe(paneName)
    await expect.poll(() => page.locator('folder-pane-view').evaluate((element, expectedUri) => {
      const selectedResource = (element as HTMLElement & {
        selectedResource?: { uri?: string }
      }).selectedResource
      return selectedResource?.uri ?? null
    }, resourceUrl)).toBe(resourceUrl)
    await contentAssertion()
  }
}

async function selectResource (page: Parameters<typeof openFolderPane>[0], resourceUrl: string): Promise<void> {
  const item = page.locator(`folder-pane-container li[role="option"][about="<${resourceUrl}>"]`)
  await expect(item).toBeVisible()
  await item.click()
}
