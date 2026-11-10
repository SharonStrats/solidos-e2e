import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { ensureContainer, seedMobileFolderPaneCase } from '../../fixtures/folder-pane.js'

test.describe('folder-pane mobile', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to a readable non-empty container.')
    if (!containerUrl) return

    await page.setViewportSize({ width: 390, height: 844 })
    await authenticateProfileOwner(page)
    await ensureContainer(page, containerUrl, 'public')
    await openFolderPane(page, containerUrl)
  })

  test('hides the desktop sidebar and does not expose separate mobile storage tabs', async ({ page }) => {
    const sidebar = page.locator('folder-pane-sidebar')
    await expect(sidebar).toBeHidden()
    await expect(page.locator('.folder-pane-sidebar-resizer')).toBeHidden()
    await expect(page.locator('.folder-pane-sidebar-toggle')).toBeHidden()
    await expect(page.locator('folder-pane-storage-header nav[aria-label="Storage locations"]')).toHaveCount(0)
    await expect(
      page.locator('folder-pane-container').getByRole('option', { name: /^Public$/i })
    ).toBeVisible()
  })

  test('hides expanded navigation when resizing from desktop to mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 844 })
    const sidebar = page.locator('folder-pane-sidebar')
    const toggle = page.locator('.folder-pane-sidebar-toggle')
    if (await toggle.getAttribute('aria-expanded') === 'false') {
      await toggle.click()
    }
    await expect(sidebar).toBeVisible()

    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await expect(sidebar).toBeHidden()
      await expect(page.locator('.folder-pane-sidebar-resizer')).toBeHidden()
      await expect(toggle).toBeHidden()
      const bounds = await page.locator('.folder-pane-main-content').evaluate(element => ({
        shell: element.getBoundingClientRect().width,
        content: element.querySelector('.folder-pane-content-column')!.getBoundingClientRect().width
      }))
      expect(bounds.content).toBeCloseTo(bounds.shell, 0)
    }

    await page.setViewportSize({ width: 1280, height: 844 })
    await expect(sidebar).toBeVisible()
    await expect(toggle).toBeVisible()
  })

  test('keeps the mobile storage header, hides breadcrumbs, and floats Add for editors', async ({ page }) => {
    const header = page.locator('folder-pane-storage-header')
    await expect(header).toBeVisible()
    await expect(header.locator('nav[aria-label="Storage breadcrumb"]')).toBeHidden()
    const add = header.getByRole('button', { name: 'Add', exact: true })
    await expect(add).toBeVisible()
    await expect(header.locator('.folder-pane-storage-header-add-trigger')).toHaveCSS('position', 'fixed')

    await add.click()
    await expect(page.getByRole('menuitem', { name: 'Upload', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^New / }).first()).toBeVisible()
  })

  test('switches mobile grid/list views and preserves card width for the final card', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const seeded = await seedMobileFolderPaneCase(page, containerUrl)
    await page.goto(getLocalRuntime().profileUrl, { waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    const container = page.locator('folder-pane-container')
    const lastResource = container.locator(`[role="option"][about="<${seeded.lastResourceUrl}>"]`)
    await expect(lastResource).toHaveCount(1)

    await expect(container.getByRole('listbox', { name: 'Container resources' })).toHaveClass('resource-grid')
    const gridBounds = await lastResource.boundingBox()
    expect(gridBounds?.width).toBeGreaterThan(0)
    await page.locator('folder-pane-storage-header solid-ui-button[aria-label="List view"]').click()
    await expect(container.getByRole('listbox', { name: 'Container resources' })).toHaveClass('resource-list')
    await page.locator('folder-pane-storage-header solid-ui-button[aria-label="Grid view"]').click()
    await expect(container.getByRole('listbox', { name: 'Container resources' })).toHaveClass('resource-grid')

    const seededCards = container.locator(`[role="option"][about*="folder-pane-mobile-scroll-"]`)
    await expect(seededCards).toHaveCount(25)
    const cards = await seededCards.evaluateAll(items => items.map(item => {
      const bounds = item.getBoundingClientRect()
      return { top: bounds.top, width: bounds.width }
    }))
    const finalCard = await lastResource.boundingBox()
    expect(finalCard?.width).toBeCloseTo(cards[0].width, 0)
  })

  test('uses the regular page scroll on a narrow viewport', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const seeded = await seedMobileFolderPaneCase(page, containerUrl)
    await page.goto(getLocalRuntime().profileUrl, { waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    const container = page.locator('folder-pane-container')
    await page.locator('folder-pane-storage-header solid-ui-button[aria-label="List view"]').click()

    const lastResource = container.locator(`[role="option"][about="<${seeded.lastResourceUrl}>"]`)
    await expect(lastResource).toHaveCount(1)

    const scrollState = await container.locator('.folder-pane-container-content').evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight
    }))
    expect(scrollState.scrollHeight).toBeLessThanOrEqual(scrollState.clientHeight)
    expect(scrollState.documentScrollHeight).toBeGreaterThan(scrollState.viewportHeight)
    await lastResource.scrollIntoViewIfNeeded()
    await expect(lastResource).toBeInViewport()
  })
})
