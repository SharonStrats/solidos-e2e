import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedSlideshowFolderPaneCase } from '../../fixtures/folder-pane.js'

type ExplorerProvider = HTMLElement & {
  pane?: { name?: string }
}

test.describe('folder-pane slideshow', () => {
  test('opens public image containers as slideshows in solo and regular folder views', async ({ page }) => {
    test.setTimeout(60_000)
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const podUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!podUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to run folder-pane coverage.')
    if (!podUrl) return

    await authenticateProfileOwner(page)
    await openFolderPane(page, podUrl)
    const slideshow = await seedSlideshowFolderPaneCase(page, podUrl)

    await page.goto(slideshow.containerUrl, { waitUntil: 'domcontentloaded' })
    const soloProvider = page.locator('solid-ui-file-explorer-provider')
    await expect(soloProvider).toHaveCount(1)
    await expect.poll(() => soloProvider.evaluate((element: ExplorerProvider) => element.pane?.name || null))
      .toBe('slideshow')
    await expect(soloProvider.locator('solid-ui-file-explorer-header')).toHaveCount(0)

    await openFolderPane(page, podUrl)
    const resource = page.locator(`folder-pane-container [role="option"][about="<${slideshow.containerUrl}>"]`)
    await expect(resource).toBeVisible()
    await resource.getByTitle('More options').click()
    await expect(page.getByRole('menuitem', { name: 'Manage Access', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await resource.click()

    const regularProvider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
    await expect(regularProvider).toHaveCount(1)
    await expect.poll(() => regularProvider.evaluate((element: ExplorerProvider) => element.pane?.name || null))
      .toBe('slideshow')

    const figures = regularProvider.locator('.bss-slides figure')
    await expect(figures).toHaveCount(2)
    await expect.poll(() => figures.evaluateAll(elements =>
      elements.map(element => element.querySelector('img')?.getAttribute('src') || '')
    )).toEqual([
      expect.stringMatching(/^blob:/),
      expect.stringMatching(/^blob:/)
    ])

    await expect(figures.nth(0)).toHaveClass(/bss-show/)
    await regularProvider.locator('.bss-next').click()
    await expect(figures.nth(1)).toHaveClass(/bss-show/)
    await expect(figures.nth(0)).not.toHaveClass(/bss-show/)
    await regularProvider.locator('.bss-prev').click()
    await expect(figures.nth(0)).toHaveClass(/bss-show/)
  })
})
