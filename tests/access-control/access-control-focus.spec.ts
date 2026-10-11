import { expect, test, type Locator, type Page } from '@playwright/test'

const accessControlEnabled = process.env.E2E_RUN_ACCESS_CONTROL === 'true'

function dialog (page: Page): Locator {
  return page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')
}

function comboboxes (page: Page): Locator {
  return page.locator('solid-ui-access-control-modal solid-ui-combobox input[role="combobox"]')
}

async function expectVisibleKeyboardFocus (element: Locator) {
  await expect(element).toBeFocused()

  const focusAppearance = await element.evaluate((node) => {
    const style = getComputedStyle(node)
    const hasOutline = style.outlineStyle !== 'none' && style.outlineWidth !== '0px'
    const hasBoxShadow = style.boxShadow !== 'none'

    return {
      focusVisible: node.matches(':focus-visible'),
      hasOutline,
      hasBoxShadow
    }
  })

  expect(focusAppearance.focusVisible).toBe(true)
  expect(focusAppearance.hasOutline || focusAppearance.hasBoxShadow).toBe(true)
}

async function expectInsideScrollingGrantList (element: Locator) {
  const visibility = await element.evaluate((node) => {
    const roleSelect = (node.getRootNode() as ShadowRoot).host as HTMLElement
    const list = roleSelect.closest('li')?.parentElement

    if (!(list instanceof HTMLElement)) return { visible: false, reason: 'grant list missing' }

    const target = node.getBoundingClientRect()
    const container = list.getBoundingClientRect()
    return {
      visible: target.top >= container.top && target.bottom <= container.bottom &&
        target.left >= container.left && target.right <= container.right,
      target: { top: target.top, bottom: target.bottom, left: target.left, right: target.right },
      container: { top: container.top, bottom: container.bottom, left: container.left, right: container.right },
      scrollTop: list.scrollTop
    }
  })

  expect(visibility.visible, JSON.stringify(visibility)).toBe(true)
  await expectVisibleKeyboardFocus(element)
}

test.describe('access-control dialog keyboard focus and reflow', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!accessControlEnabled, 'Set E2E_RUN_ACCESS_CONTROL=true to run the Solid UI access-control dialog host.')

    await page.goto('/access-control')
    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()
  })

  test('keeps the complete keyboard flow visible and operable', async ({ page }) => {
    const close = page.getByRole('button', { name: 'Close' })
    const principal = comboboxes(page).nth(0)
    const addRole = comboboxes(page).nth(1)
    const search = comboboxes(page).nth(2)
    const authenticatedRole = comboboxes(page).nth(-2)
    const publicRole = comboboxes(page).nth(-1)
    const copyLink = page.getByRole('button', { name: 'Copy Link' })
    const cancel = page.getByRole('button', { name: 'Cancel' })
    const save = page.getByRole('button', { name: 'Save Changes' })

    await close.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(close)
    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(principal)

    await principal.fill('example.test')
    await page.keyboard.press('ArrowDown')
    await expect(principal).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('option', { name: 'Use origin https://example.test' })).toBeVisible()
    await page.keyboard.press('Enter')
    const removePendingGrant = page.getByRole('button', { name: /Remove Use origin https:\/\/example\.test/ })
    await expect(removePendingGrant).toBeVisible()

    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(removePendingGrant)
    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(addRole)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(addRole).not.toHaveValue('Viewer')

    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(search)

    const roleInputs = page.locator('solid-ui-access-control-modal .access-grants-list solid-ui-combobox input')
    for (let index = 0; index < await roleInputs.count(); index++) {
      await page.keyboard.press('Tab')
      const role = roleInputs.nth(index)
      await expectInsideScrollingGrantList(role)
    }

    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(copyLink)
    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(authenticatedRole)
    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(publicRole)
    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(cancel)
    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(save)

    await page.keyboard.press('Shift+Tab')
    await expectVisibleKeyboardFocus(cancel)
    await page.keyboard.press('Shift+Tab')
    await expectVisibleKeyboardFocus(publicRole)

    await removePendingGrant.focus()
    await expectVisibleKeyboardFocus(removePendingGrant)
    await page.keyboard.press('Enter')
    await expect(removePendingGrant).toHaveCount(0)

    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(addRole)
    await page.keyboard.press('Tab')
    await expectVisibleKeyboardFocus(search)

    await cancel.focus()
    await page.keyboard.press('Enter')
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open sharing settings' })).toBeFocused()

    await page.getByRole('button', { name: 'Open sharing settings' }).press('Enter')
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open sharing settings' })).toBeFocused()
  })

  test('saves keyboard-selected access changes and restores opener focus', async ({ page }) => {
    const principal = comboboxes(page).nth(0)
    const addRole = comboboxes(page).nth(1)

    await principal.focus()
    await principal.fill('example.test')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'Use origin https://example.test' })).toBeVisible()
    await page.keyboard.press('Enter')
    await addRole.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Save Changes' }).press('Enter')

    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open sharing settings' })).toBeFocused()
  })

  test('reflows without horizontal scrolling at 320 CSS pixels', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })

    const geometry = await page.evaluate(() => {
      const modal = document.querySelector('solid-ui-access-control-modal')
      const nativeDialog = modal?.shadowRoot?.querySelector('solid-ui-dialog')
        ?.shadowRoot?.querySelector('dialog')
      const selectors = modal?.shadowRoot?.querySelectorAll<HTMLElement>('.access-role-select') ?? []
      const rows = modal?.shadowRoot?.querySelectorAll<HTMLElement>('.access-grants-list li') ?? []
      const footer = modal?.shadowRoot?.querySelector<HTMLElement>('.access-control-footer-actions')

      const overflows = (element: Element | null | undefined) =>
        !element || element.scrollWidth <= element.clientWidth

      return {
        documentFits: document.documentElement.scrollWidth <= window.innerWidth,
        dialogFits: overflows(nativeDialog),
        selectorsFit: Array.from(selectors).every(overflows),
        rowsFit: Array.from(rows).every(overflows),
        footerFits: overflows(footer)
      }
    })

    expect(geometry).toEqual({
      documentFits: true,
      dialogFits: true,
      selectorsFit: true,
      rowsFit: true,
      footerFits: true
    })

    for (const control of [
      comboboxes(page).nth(0),
      comboboxes(page).nth(1),
      page.getByRole('button', { name: 'Cancel' }),
      page.getByRole('button', { name: 'Save Changes' })
    ]) {
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeVisible()
      const fitsViewport = await control.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= window.innerWidth
      })
      expect(fitsViewport).toBe(true)
    }
  })
})
