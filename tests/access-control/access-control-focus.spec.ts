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
  type: 'agent' | 'agentGroup' | 'origin'
  value: string
  optionName: string
}

const subjectCases: SubjectCase[] = [
  { type: 'agent', value: 'http://127.0.0.1:3101/subjects/agent#me', optionName: 'E2E Agent' },
  { type: 'agentGroup', value: 'http://127.0.0.1:3101/subjects/group', optionName: 'E2E Group' },
  { type: 'origin', value: 'browser.example.test', optionName: 'Use origin https://browser.example.test' },
  { type: 'agent', value: 'http://127.0.0.1:3101/subjects/viewer#me', optionName: 'E2E Viewer' }
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
  await page.getByRole('option', { name: subject.optionName }).click()
}

async function saveAndReadState (page: Page) {
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(dialog(page)).toHaveCount(0)
  return page.evaluate(() => (window as unknown as { __accessControlState: () => unknown }).__accessControlState())
}

async function resetAcl (page: Page) {
  await page.evaluate(() => (window as unknown as { __resetAccessControlState: () => void }).__resetAccessControlState())
}

async function openProtectedRoot (page: Page) {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Open protected root sharing settings' }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(page.getByText('This is a protected storage resource.')).toHaveCount(0)
  await page.locator('solid-ui-access-control-modal').evaluate((modal: HTMLElement & {
      accessGrants: Array<{
        agent: string[]
        agentClass: string[]
        agentGroup: string[]
        origin: string[]
        accessTo: string[]
        default: string[]
        mode: string[]
      }>
      requestUpdate: () => void
    }) => {

    modal.accessGrants = [
      {
        agent: ['http://127.0.0.1:3101/profile/card#me'],
        agentClass: [],
        agentGroup: [],
        origin: [],
        accessTo: ['http://127.0.0.1:3101/'],
        default: [],
        mode: ['Read', 'Write', 'Control']
      },
      {
        agent: ['http://127.0.0.1:3101/subjects/viewer#me'],
        agentClass: [],
        agentGroup: [],
        origin: [],
        accessTo: ['http://127.0.0.1:3101/'],
        default: [],
        mode: ['Read']
      }
    ]
    modal.requestUpdate()
  })
}

test.describe('access-control dialog keyboard focus and reflow', () => {
  test.setTimeout(60_000)
  test.beforeEach(async ({ page }) => {
    test.skip(!accessControlEnabled, 'Set E2E_RUN_ACCESS_CONTROL=true to run the Solid UI access-control dialog host.')

    await page.route('**/ns/auth/acl', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/turtle',
        headers: {
          'access-control-allow-origin': '*'
        },
        body: '@prefix acl: <http://www.w3.org/ns/auth/acl#>. @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>. acl:AuthenticatedAgent rdfs:label "Authenticated agents".'
      })
    })

    await page.goto('/access-control')
    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()
  })

  test('keeps the complete keyboard flow visible and operable', async ({ page }) => {
    const close = dialog(page).getByRole('button', { name: 'Close' })
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
    const removePendingGrant = page.getByRole('button', { name: /Remove https:\/\/trusted\.example\.test/ })
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
    await expect(page.getByRole('option', { name: 'Use origin https://example.test' })).toBeVisible()
    await page.keyboard.press('Enter')
    await addRole.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Save Changes' }).press('Enter')

    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open sharing settings' })).toBeFocused()
  })

  test('does not expose condition editing and preserves an existing condition', async ({ page }) => {
    await expect(page.getByText(/ClientCondition|IssuerCondition/)).toHaveCount(0)
    const firstGrant = page.locator('.access-grants-list li').first()
    await expect(firstGrant).toBeVisible()
    await selectRole(page, firstGrant.locator('input[role="combobox"]'), 'Editor')

    const state = await saveAndReadState(page) as {
      grants: Array<{ condition?: Array<{ id: string, properties: Record<string, string[]> }> }>
    }
    expect(state.grants[0]?.condition).toEqual([{
      id: 'http://127.0.0.1:3101/shared-resource.acl#condition-1',
      blankNode: false,
      properties: {
        'http://www.w3.org/ns/auth/acl#client': ['https://example.com/client']
      }
    }])
  })

  test('adds every direct subject kind at every access role and persists the ACL mapping', async ({ page }) => {
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

  test('keeps Advanced unavailable for now and saves linked folder access by default', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open folder sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()

    await expect(page.getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(0)
    await addSubject(page, subjectCases[0], 'Viewer')
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __accessControlLastScope: string }).__accessControlLastScope))
      .toBe('folder+contents')
  })

  test('warns and disables edits for mixed folder and contents policies', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    await page.evaluate(() => (window as unknown as {
      __setAccessControlScopes: (scopes: string[]) => void
    }).__setAccessControlScopes(['folder+contents', 'contents', 'folder']))

    await page.getByRole('button', { name: 'Open folder sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(0)
    const mixedScopeAlert = page.getByRole('alert').filter({ hasText: 'different access settings for the folder and its contents' })
    await expect(mixedScopeAlert).toContainText('different access settings for the folder and its contents')
    await expect(mixedScopeAlert).toContainText('Currently you can only add and/or update access on the folder and contents combined.')
    await expect(comboboxes(page).first()).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  })

  test('preserves inherited defaults when materializing folder ACL changes', async ({ page }) => {
    const scopes = [
      { scope: 'folder', expectedDefault: false },
      { scope: 'contents', expectedDefault: true },
      { scope: 'folder+contents', expectedDefault: true }
    ] as const

    for (const { scope, expectedDefault } of scopes) {
      await resetAcl(page)
      await page.evaluate((value) => {
        (window as unknown as {
          __setAccessControlScopes: (scopes: string[]) => void
          __setAccessControlInherited: (inherited: boolean) => void
        }).__setAccessControlScopes([value])
        ;(window as unknown as { __setAccessControlInherited: (inherited: boolean) => void })
          .__setAccessControlInherited(true)
      }, scope)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Open folder sharing settings' }).click()
      await expect(dialog(page)).toBeVisible()
      await addSubject(page, subjectCases[0], 'Viewer')
      await page.getByRole('button', { name: 'Save Changes' }).click()
      await expect(dialog(page)).toHaveCount(0)

      const patch = await page.evaluate(() => (window as unknown as {
        __accessControlLastPatch: Array<{ subject: string, predicate: string, target?: string }>
      }).__accessControlLastPatch)
      expect(patch.some(entry => entry.predicate === 'acl:default')).toBe(expectedDefault)
      expect(patch.some(entry =>
        entry.predicate === 'acl:agent' &&
        entry.subject === subjectCases[0].value
      )).toBe(true)
    }
  })

  test('searches trusted apps from acl:trustedApp and keeps direct origin entry available', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    const principal = comboboxes(page).nth(0)

    await principal.fill('unrelated.example.test')
    await expect(page.getByRole('option', { name: 'Trusted app: https://unrelated.example.test' })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'Use origin https://unrelated.example.test' })).toBeVisible()

    await selectRole(page, comboboxes(page).nth(1), 'Editor')
    await principal.fill('trusted')
    const trustedOption = page.getByRole('option', { name: 'Trusted app: https://trusted.example.test' })
    await expect(trustedOption).toBeVisible()
    await expect(trustedOption.locator('icon-lucide-globe')).toHaveCount(1)
    await trustedOption.hover()
    await principal.press('Enter')
    await expect(page.getByRole('button', { name: /Remove https:\/\/trusted\.example\.test/ })).toBeVisible()

    const state = await saveAndReadState(page) as {
      grants: Array<{ agent: string[], agentGroup: string[], agentClass: string[], origin: string[], mode: string[] }>
    }
    expect(state.grants).toEqual([{
      agent: [],
      agentGroup: [],
      agentClass: [],
      origin: ['https://trusted.example.test'],
      mode: ['Read', 'Write']
    }])

    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    const nextPrincipal = comboboxes(page).nth(0)
    await nextPrincipal.fill('direct.example.test')
    await expect(page.getByRole('option', { name: 'Use origin https://direct.example.test' })).toBeVisible()
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

  test('displays a visible error when an ACL grant fails', async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __accessControlFailNextGrant: boolean }).__accessControlFailNextGrant = true
    })
    await addSubject(page, subjectCases[0], 'Viewer')

    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(dialog(page)).toBeVisible()
    await expect(page.getByText('Some access changes could not be saved')).toBeVisible()
    await expect(page.getByText(subjectCases[0].value)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  test('shows an inline error and keeps the dialog open for an unverifiable target', async ({ page }) => {
    const principal = comboboxes(page).nth(0)

    await principal.fill('http://127.0.0.1:3101/subjects/missing#me')
    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(dialog(page)).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Could not verify this access target' }))
      .toContainText('Could not verify this access target')
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  })

  test('shows successful changes and clears failed drafts after a partial save', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()

    const principal = comboboxes(page).nth(0)
    await principal.fill('browser.example.test')
    await expect(page.getByRole('option', { name: 'Use origin https://browser.example.test' })).toBeVisible()
    await principal.press('ArrowDown')
    await principal.press('Enter')
    await expect(page.getByRole('button', { name: /Remove https:\/\/browser\.example\.test/ })).toBeVisible()

    await page.evaluate(() => {
      (window as unknown as { __accessControlFailNextGrant: boolean }).__accessControlFailNextGrant = true
    })
    await principal.fill(subjectCases[0].value)
    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(dialog(page)).toBeVisible()
    await expect(page.locator('.access-grants-list li')).toHaveCount(1)
    await expect(page.getByText('Any successful changes are shown above. The list below shows only the changes that failed. Close this dialog and reopen it if you want to try again.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Remove https:\/\/browser\.example\.test/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Remove E2E Agent/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  test('does not offer reset to default for the protected site root', async ({ page }) => {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open protected root sharing settings' }).click()
    await expect(dialog(page)).toBeVisible()
    await expect(page.getByText('This is a protected storage resource.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reset custom sharing to default' })).toHaveCount(0)
  })

  test('does not offer the contents scope for a protected root', async ({ page }) => {
    await resetAcl(page)
    await openProtectedRoot(page)

    const ownerRow = page.locator('.access-grants-list li').first()
    await expect(ownerRow).toBeVisible()
    await selectRole(page, ownerRow.locator('solid-ui-combobox input[role="combobox"]'), 'Editor')
    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(page.getByRole('heading', { name: 'Apply to contents?' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Container and contents' })).toHaveCount(0)
  })

  test('shows a visible error when removing the last protected Control authorization', async ({ page }) => {
    await resetAcl(page)
    await openProtectedRoot(page)

    const ownerRow = page.locator('.access-grants-list li').first()
    await expect(ownerRow).toBeVisible()
    await selectRole(page, ownerRow.locator('solid-ui-combobox input[role="combobox"]'), 'No Access')
    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(dialog(page)).toBeVisible()
    await expect(page.getByText('Some access changes could not be saved')).toBeVisible()
    await expect(page.getByText('The protected storage resource must retain at least one Control authorization.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  test('closes after a successful change and exposes the saved ACL grant', async ({ page }) => {
    await resetAcl(page)
    await addSubject(page, subjectCases[0], 'Viewer')

    const state = await saveAndReadState(page) as {
      grants: Array<{ agent: string[], mode: string[] }>
    }

    expect(state.grants.find(grant => grant.agent.includes(subjectCases[0].value))?.mode)
      .toEqual(['Read'])
  })

  test('coalesces equal-mode principals without coupling distinct contents grants', async ({ page }) => {
    await resetAcl(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open sharing settings' }).click()
    await addSubject(page, subjectCases[0], 'Viewer')
    await addSubject(page, subjectCases[3], 'Viewer')

    const grouped = await saveAndReadState(page) as {
      grants: Array<{
        agent: string[]
        agentGroup: string[]
        agentClass: string[]
        origin: string[]
        mode: string[]
      }>
    }
    expect(grouped.grants).toEqual([{
      agent: [subjectCases[0].value, subjectCases[3].value],
      agentGroup: [],
      agentClass: [],
      origin: [],
      mode: ['Read']
    }])

  })

  test.skip('reflows without horizontal scrolling at 320 CSS pixels', async ({ page }) => {
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
