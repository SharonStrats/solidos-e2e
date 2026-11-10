import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedSearchFolderPaneCase } from '../../fixtures/folder-pane.js'

test.describe('folder-pane sidebar layout and resizing', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    test.skip(
      !process.env.E2E_FOLDER_PANE_CONTAINER_URL,
      'Set E2E_FOLDER_PANE_CONTAINER_URL to run folder-pane coverage.'
    )

    await authenticateProfileOwner(page)
    await openFolderPane(page, process.env.E2E_FOLDER_PANE_CONTAINER_URL!)
  })

  test('wires the default expanded sidebar width to the folder-pane shell', async ({ page }) => {
    const shell = page.locator('.folder-pane-main-content')
    const sidebar = page.locator('folder-pane-sidebar')

    await expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false')
    await expect(shell).toHaveAttribute('style', /--folder-pane-sidebar-width:\s*256px/)
    await expect.poll(() => sidebar.evaluate(element => getComputedStyle(element).width)).toBe('256px')
  })

  test('exposes the resize range and keyboard focus styling accessibly', async ({ page }) => {
    const separator = page.getByRole('separator', { name: 'Resize navigation sidebar' })
    await expect(separator).toHaveAttribute('aria-orientation', 'vertical')
    await expect(separator).toHaveAttribute('aria-valuemin', '180')
    await expect(separator).toHaveAttribute('aria-valuemax', /^(?:\d+)$/)
    await expect(separator).toHaveAttribute('aria-valuenow', '256')
    await expect(separator).toHaveAttribute('tabindex', '0')
    await separator.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => separator.evaluate(element => ({
      focusVisible: element.matches(':focus-visible'),
      outlineWidth: getComputedStyle(element).outlineWidth,
      outlineColor: getComputedStyle(element).outlineColor
    }))).toEqual({
      focusVisible: true,
      outlineWidth: '1px',
      outlineColor: 'rgb(230, 220, 255)'
    })
  })

  test('keeps the selected resource while the layout is updated', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const seeded = await seedSearchFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)

    const item = page.locator(`folder-pane-container li[role="option"][about="<${seeded.alphaUrl}>"]`)
    await expect(item).toBeVisible()
    await item.click()

    const view = page.locator('folder-pane-view')
    await expect.poll(() => view.evaluate((element, expectedUri) => {
      const selectedResource = (element as HTMLElement & {
        selectedResource?: { uri?: string }
      }).selectedResource
      return selectedResource?.uri ?? null
    }, seeded.alphaUrl)).toBe(seeded.alphaUrl)

    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport)
      await expect.poll(() => view.evaluate((element, expectedUri) => {
        const selectedResource = (element as HTMLElement & {
          selectedResource?: { uri?: string }
        }).selectedResource
        return selectedResource?.uri ?? null
      }, seeded.alphaUrl)).toBe(seeded.alphaUrl)
      await expect(page.locator('.folder-pane-main-content')).toHaveAttribute(
        'style',
        /--folder-pane-sidebar-width:\s*256px/
      )
    }
  })

  test('defaults to a collapsed sidebar when the pane host is narrow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, process.env.E2E_FOLDER_PANE_CONTAINER_URL!)

    const shell = page.locator('.folder-pane-main-content')
    const content = page.locator('.folder-pane-content-column')
    await expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true')
    await expect(page.locator('button.folder-pane-sidebar-toggle'))
      .toHaveAccessibleName('Expand navigation')
    await expect.poll(() => content.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => {
      const root = document.scrollingElement
      return root ? root.scrollWidth <= root.clientWidth : true
    })).toBe(true)
  })

  test('resizes the existing divider with the keyboard and preserves width across collapse', async ({ page }) => {
    const separator = page.getByRole('separator', { name: 'Resize navigation sidebar' })
    const sidebar = page.locator('folder-pane-sidebar')
    const toggle = page.locator('button.folder-pane-sidebar-toggle')
    await expect(separator).toHaveAttribute('aria-valuenow', '256')
    await separator.focus()
    await page.keyboard.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '272')
    await expect.poll(() => sidebar.evaluate(el => el.getBoundingClientRect().width)).toBe(272)
    await page.keyboard.press('ArrowLeft')
    await expect(separator).toHaveAttribute('aria-valuenow', '256')
    await page.keyboard.press('Home')
    await expect(separator).toHaveAttribute('aria-valuenow', '180')
    await page.keyboard.press('End')
    const maximum = await separator.getAttribute('aria-valuemax')
    await expect(separator).toHaveAttribute('aria-valuenow', maximum!)
    await toggle.click()
    await expect(separator).toBeHidden()
    await expect(toggle).toHaveAccessibleName('Expand navigation')
    await toggle.click()
    await expect(separator).toBeVisible()
    await expect(separator).toHaveAttribute('aria-valuenow', maximum!)
  })

  test('captures pointer drags on the existing line without activating the collapse button', async ({ page }) => {
    const separator = page.getByRole('separator', { name: 'Resize navigation sidebar' })
    const divider = page.locator('.folder-pane-sidebar-resizer')
    const bounds = await separator.boundingBox()
    expect(bounds).not.toBeNull()
    const x = bounds!.x + bounds!.width / 2
    const y = bounds!.y + bounds!.height / 4
    await page.mouse.move(x, y)
    await page.mouse.down({ button: 'right' })
    await expect(divider).toHaveAttribute('data-resizing', 'false')
    await page.mouse.up({ button: 'right' })
    await page.mouse.down()
    await expect(divider).toHaveAttribute('data-resizing', 'true')
    await page.mouse.move(x + 64, y, { steps: 4 })
    await expect(separator).toHaveAttribute('aria-valuenow', '320')
    await expect.poll(() => page.locator('folder-pane-sidebar')
      .evaluate(el => el.getBoundingClientRect().width)).toBe(320)
    await page.mouse.up()
    await expect(divider).toHaveAttribute('data-resizing', 'false')
    await page.mouse.move(x + 100, y)
    await expect(separator).toHaveAttribute('aria-valuenow', '320')
    await expect(page.locator('.folder-pane-main-content')).toHaveAttribute('data-sidebar-collapsed', 'false')
  })

  test('makes the resize handle inert while the sidebar is collapsed', async ({ page }) => {
    const separator = page.locator('.folder-pane-sidebar-resize-handle')
    await page.locator('button.folder-pane-sidebar-toggle').click()
    await expect(separator).toBeHidden()
    await expect(separator).toHaveAttribute('inert', '')
    await expect(separator).toHaveAttribute('tabindex', '-1')
    await expect(page.locator('button.folder-pane-sidebar-toggle')).toHaveAccessibleName('Expand navigation')
  })
})
