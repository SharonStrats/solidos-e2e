import { expect, test, type Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { resetLocalProfile } from '../../fixtures/reset-local-profile.js'
import {
  hasLiteral,
  rdf,
  rdfListMembers,
  readLocalProfileFile,
  readPersistedProfile
} from '../../fixtures/rdf-verification.js'

const seededName = 'E2E Test Profile'
const seededBio = 'Seeded profile used by SolidOS Playwright tests.'

test.describe('authenticated local profile mutations', () => {
  test.describe.configure({ mode: 'default' })
  test.setTimeout(60_000)

  test.beforeEach(async ({ page }) => {
    console.log(`[e2e ${new Date().toISOString()}] Starting test: ${test.info().title}`)
    page.on('console', (message) => console.log(`[e2e browser console] ${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => console.log(`[e2e browser page error] ${error.message}`))
    page.on('requestfailed', (request) => console.log(`[e2e request failed] ${request.method()} ${request.url()} (${request.failure()?.errorText || 'unknown error'})`))
    page.on('response', (response) => {
      if (response.status() >= 400) console.log(`[e2e HTTP ${response.status()}] ${response.request().method()} ${response.url()}`)
    })
    test.skip(
      process.env.E2E_RUN_LOCAL_PROFILE !== 'true',
      'Run npm run setup:local, then set E2E_RUN_LOCAL_PROFILE=true and E2E_USE_LOCAL_RUNTIME=true.'
    )
    await resetLocalProfile()
    console.log(`[e2e ${new Date().toISOString()}] Re-authenticating profile owner: ${test.info().title}`)
    await authenticateProfileOwner(page)
    console.log(`[e2e ${new Date().toISOString()}] Profile loaded: ${page.url()}`)
    await expect(page.getByLabel('Add or edit heading information')).toBeVisible()
    console.log(`[e2e ${new Date().toISOString()}] Authenticated profile UI ready for: ${test.info().title}`)
  })

  test.afterEach(async ({ page }, testInfo) => {
    console.log(`[e2e ${new Date().toISOString()}] Finished test: ${testInfo.title} (${testInfo.status}); final URL: ${page.url()}`)
  })

  test('serves valid seeded Turtle through HTTP and persists the same document locally', async ({ page }) => {
    const runtime = getLocalRuntime()
    const [served, stored] = await Promise.all([readPersistedProfile(page), readLocalProfileFile()])

    expect(hasLiteral(served, runtime.webId, `${rdf.foaf}name`, seededName)).toBe(true)
    expect(hasLiteral(served, runtime.webId, `${rdf.vcard}note`, seededBio)).toBe(true)
    expect(hasLiteral(stored, runtime.webId, `${rdf.foaf}name`, seededName)).toBe(true)
    expect(hasLiteral(stored, runtime.webId, `${rdf.vcard}note`, seededBio)).toBe(true)
  })

  test('updates and restores heading through profile-pane', async ({ page }) => {
    const runtime = getLocalRuntime()
    const updatedName = 'E2E Updated Profile'

    await page.getByLabel('Add or edit heading information').click()
    await page.locator('input[name="name"]').fill(updatedName)
    await saveDialog(page)
    await expect.poll(async () => hasLiteral(
      await readPersistedProfile(page),
      runtime.webId,
      `${rdf.vcard}fn`,
      updatedName
    )).toBe(true)
    await expect.poll(async () => hasLiteral(
      await readLocalProfileFile(),
      runtime.webId,
      `${rdf.vcard}fn`,
      updatedName
    )).toBe(true)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: updatedName, level: 1 })).toBeVisible()

    await page.getByLabel('Add or edit heading information').click()
    await page.locator('input[name="name"]').fill(seededName)
    await saveDialog(page)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: seededName, level: 1 })).toBeVisible()
  })

  test('creates, updates, removes, and restores bio through profile-pane', async ({ page }) => {
    const runtime = getLocalRuntime()
    const updatedBio = 'Updated through the authenticated profile-pane E2E test.'

    await page.getByLabel('Edit bio', { exact: true }).first().click()
    await page.locator('textarea[name="bio-description"]').fill(updatedBio)
    await saveDialog(page)
    await expect.poll(async () => hasLiteral(
      await readPersistedProfile(page),
      runtime.webId,
      `${rdf.vcard}note`,
      updatedBio
    )).toBe(true)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('region', { name: 'Bio', exact: true })).toContainText(updatedBio)

    await page.getByLabel('Edit bio', { exact: true }).first().click()
    await page.locator('textarea[name="bio-description"]').fill('')
    await saveDialog(page)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('group', { name: 'Empty bio section' })).toBeVisible()
    await expect.poll(async () => hasLiteral(
      await readPersistedProfile(page),
      runtime.webId,
      `${rdf.vcard}note`,
      updatedBio
    )).toBe(false)

    await page.getByRole('button', { name: 'Add Bio', exact: true }).click()
    await page.locator('textarea[name="bio-description"]').fill(seededBio)
    await saveDialog(page)
    await expect(page.getByRole('region', { name: 'Bio', exact: true })).toContainText(seededBio)
  })

  test('creates and removes a custom blank-node skill through profile-pane', async ({ page }) => {
    const runtime = getLocalRuntime()
    const skillName = 'E2E Custom Skill'

    await page.getByLabel(/Add (or edit )?skills/).click()
    await setComboboxText(page, 'Skill 1 Name', skillName)
    await saveDialog(page)
    await expect(page.getByRole('list', { name: 'Professional skills and competencies' })).toContainText(skillName)
    await expect.poll(async () => {
      const profile = await readPersistedProfile(page)
      return profile.some((quad) =>
        quad.predicate.value === `${rdf.schema}name` &&
        quad.object.value === skillName
      )
    }).toBe(true)

    await page.getByLabel(`Remove ${skillName} skill`).click()
    await expect.poll(async () => {
      const profile = await readPersistedProfile(page)
      return profile.some((quad) =>
        quad.predicate.value === `${rdf.schema}name` &&
        quad.object.value === skillName
      )
    }).toBe(false)
  })

  test('creates, updates, and removes a secondary email through profile-pane', async ({ page }) => {
    const originalEmail = 'e2e-contact@example.test'
    const updatedEmail = 'e2e-contact-updated@example.test'

    await page.getByLabel('Add contact information').click()
    await page.locator('input[name="email-value-0"]').fill(originalEmail)
    await saveDialog(page)
    await expect.poll(async () => hasContactEmail(await readPersistedProfile(page), originalEmail)).toBe(true)

    await page.getByLabel('Edit contact information').click()
    await page.locator('input[name="email-value-0"]').fill(updatedEmail)
    await saveDialog(page)
    await expect.poll(async () => hasContactEmail(await readPersistedProfile(page), updatedEmail)).toBe(true)
    await expect.poll(async () => hasContactEmail(await readLocalProfileFile(), updatedEmail)).toBe(true)

    await page.getByLabel('Edit contact information').click()
    await page.getByLabel('Delete email address 1').click()
    await saveDialog(page)
    await expect.poll(async () => hasContactEmail(await readPersistedProfile(page), updatedEmail)).toBe(false)
  })

  test('creates, updates, and removes phone and postal-address entries through profile-pane', async ({ page }) => {
    const phone = '5550101000'
    const updatedPhone = '5550102000'
    const street = '100 Test Street'
    const updatedStreet = '200 Updated Street'

    await page.getByLabel('Add contact information').click()
    await page.locator('input[name="phone-value-0"]').fill(phone)
    await page.locator('input[name="address-street-0"]').fill(street)
    await page.locator('input[name="address-locality-0"]').fill('Test City')
    await page.locator('input[name="address-postal-0"]').fill('10000')
    await page.locator('input[name="address-country-0"]').fill('Test Country')
    await saveDialog(page)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}value`,
      `tel:${phone}`
    )).toBe(true)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}street-address`,
      street
    )).toBe(true)

    await page.getByLabel('Edit contact information').click()
    await page.locator('input[name="phone-value-0"]').fill(updatedPhone)
    await page.locator('input[name="address-street-0"]').fill(updatedStreet)
    await saveDialog(page)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}value`,
      `tel:${updatedPhone}`
    )).toBe(true)
    await expect.poll(async () => hasObjectValue(
      await readLocalProfileFile(),
      `${rdf.vcard}street-address`,
      updatedStreet
    )).toBe(true)

    await page.getByLabel('Edit contact information').click()
    await page.getByLabel('Delete phone number 1').click()
    await page.getByLabel('Delete address 1').click()
    await saveDialog(page)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}value`,
      `tel:${updatedPhone}`
    )).toBe(false)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}street-address`,
      updatedStreet
    )).toBe(false)
  })

  test('creates, updates, and removes a resume role through profile-pane', async ({ page }) => {
    const title = 'E2E Test Role'
    const updatedTitle = 'E2E Updated Role'

    await openResumeEditor(page)
    await page.locator('input[name="resume-title-0"]').fill(title)
    await page.locator('#resume-current-role-0').check()
    await saveDialog(page)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}role`,
      title
    )).toBe(true)

    await page.getByLabel('Edit resume details').click()
    await page.locator('input[name="resume-title-0"]').fill(updatedTitle)
    await saveDialog(page)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}role`,
      updatedTitle
    )).toBe(true)
    await expect.poll(async () => hasObjectValue(
      await readLocalProfileFile(),
      `${rdf.vcard}role`,
      updatedTitle
    )).toBe(true)

    await page.getByLabel('Edit resume details').click()
    await page.getByLabel('Delete resume 1').click()
    await saveDialog(page)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}role`,
      updatedTitle
    )).toBe(false)
  })

  test('adds and unfollows a project or community through profile-pane', async ({ page }) => {
    const projectWebId = 'https://example.org/profile/card#me'

    await page.getByLabel('Add project details').click()
    await page.locator('input[name="project-0"]').fill(projectWebId)
    await saveDialog(page)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.solid}community`,
      projectWebId
    )).toBe(true)

    await page.getByLabel('Unfollow project').click()
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.solid}community`,
      projectWebId
    )).toBe(false)
  })

  test('reorders the language RDF list through profile-pane', async ({ page }) => {
    const runtime = getLocalRuntime()

    await page.getByLabel('Add or edit languages').click()
    await page.getByLabel('Reorder language 2').dragTo(page.locator('[data-language-reorder-index="0"]'))
    await saveDialog(page)
    await expect.poll(async () => languageOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['es', 'en'])

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByLabel('Add or edit languages').click()
    await page.getByLabel('Reorder language 2').dragTo(page.locator('[data-language-reorder-index="0"]'))
    await saveDialog(page)
    await expect.poll(async () => languageOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['en', 'es'])
  })

  test('reorders the social-account RDF list through profile-pane', async ({ page }) => {
    const runtime = getLocalRuntime()

    await page.getByLabel('Edit social accounts').click()
    await page.getByLabel('Reorder social account 2').dragTo(page.locator('[data-social-reorder-index="0"]'))
    await saveDialog(page)
    await expect.poll(async () => socialOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['Facebook', 'GitHub'])

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByLabel('Edit social accounts').click()
    await page.getByLabel('Reorder social account 2').dragTo(page.locator('[data-social-reorder-index="0"]'))
    await saveDialog(page)
    await expect.poll(async () => socialOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['GitHub', 'Facebook'])
  })

  test('creates and removes a language through profile-pane', async ({ page }) => {
    const runtime = getLocalRuntime()

    await page.getByLabel('Add or edit languages').click()
    await page.getByLabel('Add another language').click()
    await selectLanguage(page, 2, 'French', 'https://www.w3.org/ns/iana/language-code/fr')
    await saveDialog(page)
    await expect.poll(async () => languageOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['en', 'es', 'fr'])

    await page.getByLabel('Add or edit languages').click()
    await page.getByLabel('Delete language 3').click()
    await saveDialog(page)
    await expect.poll(async () => languageOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['en', 'es'])
  })

  test('creates and removes a social account through profile-pane', async ({ page }) => {
    const runtime = getLocalRuntime()
    const homepage = 'https://www.linkedin.com/in/e2e-profile'

    await page.getByLabel('Edit social accounts').click()
    await page.getByLabel('Add another social account').click()
    await selectSocialAccount(page, 2, 'LinkedIn')
    await page.locator('input[name="social-homepage-2"]').fill(homepage)
    await saveDialog(page)
    await expect.poll(async () => socialOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['GitHub', 'Facebook', 'LinkedIn'])

    await page.getByLabel('Edit social accounts').click()
    await page.getByLabel('Delete social account 3').click()
    await saveDialog(page)
    await expect.poll(async () => socialOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['GitHub', 'Facebook'])
  })
})

async function setComboboxText(page: Page, label: string, value: string): Promise<void> {
  await page.locator(`solid-ui-combobox[aria-label="${label}"]`).evaluate((element, nextValue) => {
    const input = element.shadowRoot?.querySelector('input')
    if (!input) throw new Error(`Could not find the ${label} combobox input`)
    input.value = nextValue as string
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  }, value)
}

async function selectLanguage(page: Page, index: number, label: string, value: string): Promise<void> {
  await selectComboboxOption(
    page.locator(`solid-ui-combobox[data-language-row-index="${index}"]`),
    label,
    value
  )
}

async function selectSocialAccount(page: Page, index: number, label: string): Promise<void> {
  await selectComboboxOption(
    page.locator(`solid-ui-combobox[name="social-account-type-${index}"]`),
    label,
    label
  )
}

async function selectComboboxOption(
  combobox: ReturnType<Page['locator']>,
  label: string,
  value: string
): Promise<void> {
  await combobox.evaluate((element, option) => {
    element.dispatchEvent(new CustomEvent('change', {
      bubbles: true,
      composed: true,
      detail: { option }
    }))
  }, { label, value })
}

async function saveDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}

async function openResumeEditor(page: Page): Promise<void> {
  const editButton = page.getByLabel('Edit resume details')
  if (await editButton.isVisible()) {
    await editButton.click()
    return
  }

  await page.getByRole('button', { name: 'Add Resume', exact: true }).click()
}

function hasContactEmail(profile: Awaited<ReturnType<typeof readPersistedProfile>>, email: string): boolean {
  return profile.some((quad) =>
    quad.predicate.value === `${rdf.vcard}value` &&
    quad.object.value === `mailto:${email}`
  )
}

function hasObjectValue(
  profile: Awaited<ReturnType<typeof readPersistedProfile>>,
  predicate: string,
  value: string
): boolean {
  return profile.some((quad) =>
    quad.predicate.value === predicate &&
    quad.object.value === value
  )
}

function languageOrder(profile: Awaited<ReturnType<typeof readPersistedProfile>>, webId: string): string[] {
  return rdfListMembers(profile, webId, `${rdf.schema}knowsLanguage`).map((node) => {
    const publicId = profile.find((quad) =>
      quad.subject.value === node && quad.predicate.value === `${rdf.solid}publicId`
    )?.object.value
    return publicId?.split('/').at(-1) || ''
  })
}

function socialOrder(profile: Awaited<ReturnType<typeof readPersistedProfile>>, webId: string): string[] {
  return rdfListMembers(profile, webId, `${rdf.foaf}account`).map((node) =>
    profile.find((quad) => quad.subject.value === node && quad.predicate.value === `${rdf.foaf}name`)?.object.value || ''
  )
}
