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

type SubjectCase = {
  type: 'agent' | 'agentGroup' | 'agentClass' | 'origin'
  value: string
}

const subjectCases: SubjectCase[] = [
  { type: 'agent', value: 'http://127.0.0.1:3101/subjects/agent#me' },
  { type: 'agentGroup', value: 'http://127.0.0.1:3101/subjects/group' },
  { type: 'agentClass', value: 'http://www.w3.org/ns/auth/acl#AuthenticatedAgent' },
  { type: 'origin', value: 'browser.example.test' }
]
const roles = ['Viewer', 'Poster', 'Submitter', 'Owner', 'Editor'] as const

async function selectRole (page: Page, input: Locator, role: string) {
  const roles = ['No Access', 'Viewer', 'Poster', 'Submitter', 'Owner', 'Editor']
  await input.focus()
  const current = roles.indexOf(await input.inputValue())
  const target = roles.indexOf(role)
  const key = target >= current ? 'ArrowDown' : 'ArrowUp'
  for (let index = 0; index < Math.abs(target - current); index++) {
    await input.press(key)
  }
  await input.press('Enter')
}

async function addSubject (page: Page, subject: SubjectCase, role: string) {
  const inputs = comboboxes(page)
  const principal = inputs.nth(0)
  await selectRole(page, inputs.nth(1), role)
  await principal.fill(subject.value)
}

async function saveAndReadState (page: Page) {
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog(page)).toHaveCount(0)
  return page.evaluate(() => (window as unknown as { __accessControlState: () => unknown }).__accessControlState())
}

async function resetAcl (page: Page) {
  await page.evaluate(() => (window as unknown as { __resetAccessControlState: () => void }).__resetAccessControlState())
}

test.describe('access-control dialog keyboard focus and reflow', () => {
  test.setTimeout(300_000)
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

  test('adds every subject kind at every access role and persists the ACL mapping', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    for (const subject of subjectCases) {
      for (const role of roles) {
        await page.getByRole('button', { name: 'Open sharing settings' }).click()
        await expect(dialog(page)).toBeVisible()
        await addSubject(page, subject, role)
        const state = await saveAndReadState(page) as { grants: Array<{ agent: string[], agentGroup: string[], agentClass: string[], origin: string[], mode: string[] }> }
        const grant = state.grants.find(item =>
          item[subject.type].includes(subject.type === 'origin' ? 'https://browser.example.test' : subject.value))
        expect(grant, `${subject.type} ${role} grant`).toBeTruthy()
        expect(grant?.mode).toEqual(role === 'Viewer'
          ? ['Read']
          : role === 'Poster'
            ? ['Read', 'Append']
            : role === 'Submitter'
              ? ['Append']
              : role === 'Owner'
                ? ['Read', 'Write', 'Control']
                : ['Read', 'Write'])
      }
    }
  })

  test('changes and removes every shared-with subject kind', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    for (const subject of subjectCases) {
      await page.getByRole('button', { name: 'Open sharing settings' }).click()
      await expect(dialog(page)).toBeVisible()
      await addSubject(page, subject, 'Viewer')
      await saveAndReadState(page)

      await page.getByRole('button', { name: 'Open sharing settings' }).click()
      await expect(dialog(page)).toBeVisible()
      const row = page.locator('.access-grants-list li').first()
      await expect(row).toBeVisible()
      await selectRole(page, comboboxes(page).nth(3), 'Owner')
      await saveAndReadState(page)

      await page.getByRole('button', { name: 'Open sharing settings' }).click()
      await expect(dialog(page)).toBeVisible()
      const updatedRow = page.locator('.access-grants-list li').first()
      await selectRole(page, comboboxes(page).nth(3), 'No Access')
      const state = await saveAndReadState(page) as { grants: unknown[] }
      expect(state.grants).toHaveLength(0)
    }
  })

  test('supports every authenticated-agent role and public grant/revoke', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()
    const generalRole = comboboxes(page).nth(-2)
    const publicRole = comboboxes(page).nth(-1)
    for (const role of roles) {
      await selectRole(page, generalRole, role)
      await saveAndReadState(page)
      await page.getByRole('button', { name: 'Open sharing settings' }).click()
      await expect(dialog(page)).toBeVisible()
      await expect(comboboxes(page).nth(-2)).toHaveValue(role)
    }

    await selectRole(page, comboboxes(page).nth(-1), 'Viewer')
    const state = await saveAndReadState(page) as { grants: Array<{ agentClass: string[], mode: string[] }> }
    expect(state.grants.find(grant => grant.agentClass.includes('http://xmlns.com/foaf/0.1/Agent'))?.mode)
      .toEqual(['Read'])
    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()

    await selectRole(page, comboboxes(page).nth(-1), 'No Access')
    const revoked = await saveAndReadState(page) as { grants: Array<{ agentClass: string[] }> }
    expect(revoked.grants.some(grant => grant.agentClass.includes('http://xmlns.com/foaf/0.1/Agent'))).toBe(false)
  })

  test('saves pending input, Shared with, and General changes together', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()
    const inputs = comboboxes(page)
    await selectRole(page, inputs.nth(1), 'Editor')
    await inputs.nth(0).fill('http://127.0.0.1:3101/subjects/agent#me')
    await selectRole(page, comboboxes(page).nth(-2), 'Viewer')
    await selectRole(page, comboboxes(page).nth(-1), 'Viewer')
    const state = await saveAndReadState(page) as { grants: Array<{ agent: string[], agentClass: string[], mode: string[] }> }
    expect(state.grants.find(grant => grant.agent.length)?.mode).toEqual(['Read', 'Write'])
    expect(state.grants.filter(grant => grant.agentClass.length)).toHaveLength(2)
  })

  test.skip('displays a visible error when an ACL grant fails', async () => {
    // Future host support will make applyPlan reject and expose the dialog error.
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
