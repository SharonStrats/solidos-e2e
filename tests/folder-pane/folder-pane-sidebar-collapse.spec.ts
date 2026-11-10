import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedNestedFolderPaneCase, type NestedFolderPaneCase } from '../../fixtures/folder-pane.js'

test.describe('folder-pane Step 4 sidebar collapse', () => {
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

  function toggle (page: import('@playwright/test').Page) {
    return page.locator('button.folder-pane-sidebar-toggle')
  }

  function itemFor (page: import('@playwright/test').Page, resourceUrl: string) {
    return page.locator(`folder-pane-sidebar li[role="treeitem"][about="<${resourceUrl}>"]`)
  }

  test('exposes an action label and updates expanded state', async ({ page }) => {
    const button = toggle(page)
    await expect(button).toHaveAccessibleName('Collapse navigation')
    await expect(button).toHaveAttribute('aria-expanded', 'true')

    await button.click()
    await expect(button).toHaveAccessibleName('Expand navigation')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.folder-pane-main-content')).toHaveAttribute(
      'data-sidebar-collapsed',
      'true'
    )
  })

  test('collapses the sidebar and expands the content column', async ({ page }) => {
    const shell = page.locator('.folder-pane-main-content')
    const sidebar = page.locator('folder-pane-sidebar')
    const resizer = page.locator('.folder-pane-sidebar-resizer')
    const content = page.locator('.folder-pane-content-column')
    const expandedContentWidth = await content.evaluate(element => element.getBoundingClientRect().width)

    await expect(resizer).toBeVisible()
    await toggle(page).click()

    await expect(sidebar).toHaveAttribute('aria-hidden', 'true')
    await expect(sidebar).toHaveAttribute('inert', '')
    await expect(resizer).toBeVisible()
    await expect.poll(() => content.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(expandedContentWidth)
    await expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true')
  })

  test('preserves expanded tree state across collapse and expansion', async ({ page }) => {
    const parent = itemFor(page, nested.levels[0])
    await parent.focus()
    await page.keyboard.press('ArrowRight')
    await expect(parent).toHaveAttribute('aria-expanded', 'true')

    const button = toggle(page)
    await button.click()
    await expect(button).toHaveAccessibleName('Expand navigation')
    await button.click()
    await expect(button).toHaveAccessibleName('Collapse navigation')
    await expect(itemFor(page, nested.levels[0])).toHaveAttribute('aria-expanded', 'true')
  })

  test('moves focus to the expand control when a focused tree collapses', async ({ page }) => {
    const parent = itemFor(page, nested.levels[0])
    await parent.focus()
    await expect(parent).toBeFocused()

    await page.locator('.folder-pane-main-content').evaluate(element => {
      element.dispatchEvent(new CustomEvent('folder-pane-toggle-sidebar', {
        bubbles: true,
        composed: true
      }))
    })
    const button = toggle(page)
    await expect(button).toBeFocused()
    await expect(button).toHaveAccessibleName('Expand navigation')
  })

  test('does not steal focus when the sidebar is expanded', async ({ page }) => {
    const button = toggle(page)
    await button.click()
    await expect(button).toBeFocused()
    await button.click()
    await expect(button).toBeFocused()
    await expect(button).toHaveAccessibleName('Collapse navigation')
  })

  test('removes tree descendants from the tab sequence while collapsed', async ({ page }) => {
    await toggle(page).click()
    const item = page.locator('folder-pane-sidebar [role="treeitem"]').first()
    await item.focus()
    await expect(item).not.toBeFocused()
    await expect(page.locator('folder-pane-sidebar')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('folder-pane-sidebar')).toHaveAttribute('inert', '')
  })
})
