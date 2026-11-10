import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedNestedFolderPaneCase, type NestedFolderPaneCase } from '../../fixtures/folder-pane.js'

test.describe('folder-pane sidebar tree keyboard behavior', () => {
  let containerUrl: string
  let nested: NestedFolderPaneCase

  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )

    containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL || ''
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to a readable container.')
    if (!containerUrl) return

    await authenticateProfileOwner(page)
    nested = await seedNestedFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    await expect(sidebar(page)).toBeVisible()
  })

  function sidebar (page: import('@playwright/test').Page) {
    return page.locator('folder-pane-sidebar')
  }

  function items (page: import('@playwright/test').Page) {
    return sidebar(page).getByRole('treeitem')
  }

  function itemFor (page: import('@playwright/test').Page, resourceUrl: string) {
    return sidebar(page).locator(`li[role="treeitem"][about="<${resourceUrl}>"]`)
  }

  async function focusItem (page: import('@playwright/test').Page, resourceUrl: string) {
    const item = itemFor(page, resourceUrl)
    await expect(item).toBeVisible()
    await item.focus()
    await expect(item).toBeFocused()
    return item
  }

  async function visibleResourceIds (page: import('@playwright/test').Page) {
    return items(page).evaluateAll(elements =>
      elements.map(element => element.getAttribute('data-resource-id'))
    )
  }

  test('focuses Home on storage entry', async ({ page }) => {
    const home = sidebar(page).getByRole('treeitem', { name: 'Home', exact: true })
    await expect(home).toBeFocused()
    await expect(home).toHaveAttribute('aria-selected', 'true')
  })

  test('keeps exactly one roving tabindex', async ({ page }) => {
    await expect(sidebar(page).locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)
    await expect(sidebar(page).locator('[role="treeitem"][tabindex="-1"]')).toHaveCount(
      (await items(page).count()) - 1
    )

    await focusItem(page, nested.levels[0])
    await page.keyboard.press('ArrowDown')
    await expect(sidebar(page).locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)
  })

  test('moves sequentially through visible items with ArrowDown and ArrowUp', async ({ page }) => {
    const ids = await visibleResourceIds(page)
    expect(ids.length).toBeGreaterThan(1)
    await focusItem(page, ids[0]!)

    for (const id of ids.slice(1)) {
      await page.keyboard.press('ArrowDown')
      await expect(itemFor(page, id!)).toBeFocused()
    }
    for (const id of ids.slice(0, -1).reverse()) {
      await page.keyboard.press('ArrowUp')
      await expect(itemFor(page, id!)).toBeFocused()
    }
  })

  test('expands with ArrowRight without selecting', async ({ page }) => {
    const parent = await focusItem(page, nested.levels[0])
    await expect(parent).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('ArrowRight')
    await expect(parent).toHaveAttribute('aria-expanded', 'true')
    await expect(itemFor(page, nested.levels[1])).toBeVisible()
    await expect(parent).toHaveAttribute('aria-selected', 'false')
    await expect(page.locator('folder-pane-content > solid-ui-file-explorer-provider')).toHaveCount(0)
  })

  test('moves to the first child when ArrowRight is pressed on an expanded parent', async ({ page }) => {
    await focusItem(page, nested.levels[0])
    await page.keyboard.press('ArrowRight')
    await expect(itemFor(page, nested.levels[0])).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(itemFor(page, nested.levels[1])).toBeFocused()
  })

  test('collapses and navigates to the parent with ArrowLeft', async ({ page }) => {
    await focusItem(page, nested.levels[0])
    await page.keyboard.press('ArrowRight')
    await expect(itemFor(page, nested.levels[0])).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(itemFor(page, nested.levels[1])).toBeFocused()

    await page.keyboard.press('ArrowLeft')
    await expect(itemFor(page, nested.levels[0])).toBeFocused()
    await expect(itemFor(page, nested.levels[0])).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(itemFor(page, nested.levels[0])).toHaveAttribute('aria-expanded', 'false')
    await expect(itemFor(page, nested.levels[1])).toHaveCount(0)
  })

  for (const key of ['Enter', ' ']) {
    test(`${key === ' ' ? 'Space' : key} selects exactly once`, async ({ page }) => {
      const target = await focusItem(page, nested.levels[0])
      await page.evaluate(() => {
        const element = document.querySelector('folder-pane-sidebar')
        if (!element) throw new Error('Sidebar is not mounted.')
        const sidebar = element as HTMLElement & { selectionCount?: number }
        sidebar.selectionCount = 0
        element.addEventListener('resource-selected', () => {
          sidebar.selectionCount = (sidebar.selectionCount || 0) + 1
        })
      })
      await page.keyboard.press(key)
      await expect.poll(() => page.locator('folder-pane-sidebar').evaluate(element =>
        (element as HTMLElement & { selectionCount?: number }).selectionCount
      )).toBe(1)
    })
  }

  test('keyboard navigation does not open resources', async ({ page }) => {
    const initialUrl = page.url()
    await expect(page.locator('folder-pane-container')).toBeVisible()
    await focusItem(page, nested.levels[0])
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('folder-pane-container')).toBeVisible()
    await expect(page.locator('folder-pane-content > solid-ui-file-explorer-provider')).toHaveCount(0)
    await expect(page).toHaveURL(initialUrl)
  })
})
