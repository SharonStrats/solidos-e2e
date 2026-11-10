import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedNestedFolderPaneCase, type NestedFolderPaneCase } from '../../fixtures/folder-pane.js'

test.describe('folder-pane Step 8 browser sidebar validation', () => {
  let nested: NestedFolderPaneCase

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL || ''
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to a readable container.')

    await authenticateProfileOwner(page)
    nested = await seedNestedFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    await expect(page.locator('folder-pane-sidebar')).toBeVisible()
  })

  function sidebar (page: import('@playwright/test').Page) {
    return page.locator('folder-pane-sidebar')
  }

  function itemFor (page: import('@playwright/test').Page, resourceUrl: string) {
    return sidebar(page).locator(`li[role="treeitem"][about="<${resourceUrl}>"]`)
  }

  test('uses one tree entry point and leaves the tree with Tab', async ({ page }) => {
    const tree = sidebar(page).getByRole('tree')
    const treeItems = sidebar(page).getByRole('treeitem')
    await expect.poll(() => treeItems.count()).toBeGreaterThan(0)
    await expect(sidebar(page).locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)
    await expect.poll(() => sidebar(page).locator('.resource-expand-button').evaluateAll(
      buttons => buttons.every(button => button.getAttribute('tabindex') === '-1')
    )).toBe(true)

    await sidebar(page).getByRole('treeitem', { name: 'Home', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement
      return active?.closest('folder-pane-sidebar [role="tree"]') !== null
    })).toBe(false)
    await expect(tree).toBeVisible()
  })

  test('selects only the clicked nested row, not its ancestor', async ({ page }) => {
    const parent = itemFor(page, nested.levels[0])
    const child = itemFor(page, nested.levels[1])
    await parent.locator('.resource-expand-button').click()
    await expect(child).toBeVisible()

    await child.locator('.resource-row').click()
    await expect(child).toHaveAttribute('aria-selected', 'true')
    await expect(parent).toHaveAttribute('aria-selected', 'false')
  })

  test('keeps the sidebar usable at high zoom on a narrow desktop', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2'
    })

    const sidebarElement = sidebar(page)
    await expect(sidebarElement).toBeVisible()
    await expect(sidebarElement.getByRole('tree')).toBeVisible()
    await expect(sidebarElement.getByRole('treeitem', { name: 'Home', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const root = document.scrollingElement
      return root ? root.scrollWidth >= root.clientWidth : true
    })).toBe(true)
  })

  test('cleans up a cancelled pointer resize', async ({ page }) => {
    const handle = page.locator('.folder-pane-sidebar-resize-handle')
    const resizer = page.locator('.folder-pane-sidebar-resizer')
    const bounds = await handle.boundingBox()
    expect(bounds).not.toBeNull()

    await page.mouse.move(bounds!.x + 2, bounds!.y + 20)
    await page.mouse.down()
    await expect(resizer).toHaveAttribute('data-resizing', 'true')
    await handle.dispatchEvent('pointercancel', { bubbles: true, pointerId: 1 })
    await expect(resizer).toHaveAttribute('data-resizing', 'false')
  })

  test('honors reduced motion for sidebar transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(() => page.locator('.folder-pane-main-content').evaluate(element => {
      const styles = getComputedStyle(element)
      return parseFloat(styles.transitionDuration)
    })).toBeLessThan(0.001)
  })
})
