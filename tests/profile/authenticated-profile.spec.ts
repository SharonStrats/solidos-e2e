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
    page.on('response', async (response) => {
      if (response.status() >= 400) console.log(`[e2e HTTP ${response.status()}] ${response.request().method()} ${response.url()}`)
      if (response.status() >= 400 &&
        response.request().method() === 'PATCH' &&
        response.url() === getLocalRuntime().profileUrl) {
        await test.info().attach('failed-profile-patch', {
          body: JSON.stringify({
            contentType: response.request().headers()['content-type'],
            requestBody: response.request().postData(),
            status: response.status(),
            responseBody: await response.text()
          }, null, 2),
          contentType: 'application/json'
        })
      }
    })
    test.skip(
      process.env.E2E_RUN_LOCAL_PROFILE !== 'true',
      'Run npm run setup:local, then set E2E_RUN_LOCAL_PROFILE=true and E2E_USE_LOCAL_RUNTIME=true.'
    )
    await resetLocalProfile()
    console.log(`[e2e ${new Date().toISOString()}] Re-authenticating profile owner: ${test.info().title}`)
    await authenticateProfileOwner(page)
    console.log(`[e2e ${new Date().toISOString()}] Profile loaded: ${page.url()}`)
    await expect(page.getByLabel('Add or edit heading information').first()).toBeVisible()
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

    await page.getByLabel('Add or edit heading information').first().click()
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
    await expect(page.getByLabel('Profile heading').getByRole('heading', { name: updatedName, level: 1 })).toBeVisible()

    await page.getByLabel('Add or edit heading information').first().click()
    await page.locator('input[name="name"]').fill(seededName)
    await saveDialog(page)
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByLabel('Profile heading').getByRole('heading', { name: seededName, level: 1 })).toBeVisible()
  })

  test('uploads the same profile photo name without overwriting the existing resource', async ({ page }) => {
    const firstContent = 'first photo content'
    const secondContent = 'second photo content'

    await page.getByLabel('Add or edit heading information').first().click()
    await page.getByLabel('Upload new profile photo').click()
    await page.locator('input[type="file"]').last().setInputFiles({
      name: 'profile-collision.png',
      mimeType: 'image/png',
      buffer: Buffer.from(firstContent)
    })
    await saveDialog(page)

    const firstProfile = await readPersistedProfile(page)
    const firstPhotoUris = firstProfile
      .filter((quad) => quad.predicate.value === `${rdf.vcard}hasPhoto`)
      .map((quad) => quad.object.value)
    expect(firstPhotoUris).toHaveLength(1)

    await page.getByLabel('Add or edit heading information').first().click()
    await page.getByLabel('Upload new profile photo').click()
    await page.locator('input[type="file"]').last().setInputFiles({
      name: 'profile-collision.png',
      mimeType: 'image/png',
      buffer: Buffer.from(secondContent)
    })
    await saveDialog(page)

    const secondProfile = await readPersistedProfile(page)
    const secondPhotoUris = secondProfile
      .filter((quad) => quad.predicate.value === `${rdf.vcard}hasPhoto`)
      .map((quad) => quad.object.value)
    expect(secondPhotoUris).toHaveLength(1)
    expect(secondPhotoUris[0]).not.toBe(firstPhotoUris[0])

    const firstPhotoResponse = await page.request.get(firstPhotoUris[0])
    const secondPhotoResponse = await page.request.get(secondPhotoUris[0])
    await expect(firstPhotoResponse).toBeOK()
    await expect(secondPhotoResponse).toBeOK()
    await expect(firstPhotoResponse.text()).resolves.toBe(firstContent)
    await expect(secondPhotoResponse.text()).resolves.toBe(secondContent)
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
    const preservedEmail = 'e2e-contact-preserved@example.test'

    await page.getByLabel('Add contact information').click()
    await page.locator('input[name="email-value-0"]').fill(originalEmail)
    await page.getByLabel('Add another email address').click()
    await page.locator('input[name="email-value-0"]').fill(preservedEmail)
    await saveDialog(page)
    await expect.poll(async () => hasContactEmail(await readPersistedProfile(page), originalEmail)).toBe(true)
    await expect.poll(async () => hasContactEmail(await readPersistedProfile(page), preservedEmail)).toBe(true)

    await page.getByLabel('Edit contact information').click()
    await page.locator('input[name="email-value-1"]').fill(updatedEmail)
    await saveDialog(page)
    await expect.poll(async () => hasContactEmail(await readPersistedProfile(page), updatedEmail)).toBe(true)
    await expect.poll(async () => hasContactEmail(await readPersistedProfile(page), preservedEmail)).toBe(true)
    await expect.poll(async () => hasContactEmail(await readLocalProfileFile(), updatedEmail)).toBe(true)

    await page.getByLabel('Edit contact information').click()
    await page.getByLabel('Delete email address 2').click()
    await saveDialog(page)
    await expect.poll(async () => hasContactEmail(await readPersistedProfile(page), updatedEmail)).toBe(false)
  })

  test('accepts formatted phone values in the active solid-panes heading editor', async ({ page }) => {
    const formattedPhone = '555 010 3000'
    const normalizedPhone = '5550103000'

    await page.getByLabel('Add or edit heading information').first().click()
    await page.locator('input[name="phone-value"]').fill(formattedPhone)
    await saveDialog(page)

    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}value`,
      `tel:${normalizedPhone}`
    )).toBe(true)
  })

  test('saves combined heading and contact edits through one profile PATCH', async ({ page }) => {
    const runtime = getLocalRuntime()
    const profilePatches: string[] = []
    page.on('request', (request) => {
      if (request.url() !== runtime.profileUrl || request.method() !== 'PATCH') return
      const body = request.postData() || ''
      if (!body.includes('publicTypeIndex')) profilePatches.push(body)
    })

    await page.getByLabel('Add or edit heading information').first().click()
    await page.locator('input[name="name"]').fill('Atomic Heading Owner')
    await page.locator('input[name="email-value"]').fill('atomic-heading@example.test')
    await page.locator('input[name="phone-value"]').fill('555 010 5000')
    await saveDialog(page)

    await expect.poll(() => profilePatches.length).toBe(1)
    await expect.poll(async () => hasLiteral(
      await readPersistedProfile(page),
      runtime.webId,
      `${rdf.vcard}fn`,
      'Atomic Heading Owner'
    )).toBe(true)
    await expect.poll(async () => hasContactEmail(
      await readPersistedProfile(page),
      'atomic-heading@example.test'
    )).toBe(true)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}value`,
      'tel:5550105000'
    )).toBe(true)
  })

  test('creates, updates, and removes phone and postal-address entries through profile-pane', async ({ page }) => {
    const phone = '555 010 1000'
    const normalizedPhone = '5550101000'
    const updatedPhone = '555 010 2000'
    const normalizedUpdatedPhone = '5550102000'
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
      `tel:${normalizedPhone}`
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
      `tel:${normalizedUpdatedPhone}`
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
      `tel:${normalizedUpdatedPhone}`
    )).toBe(false)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}street-address`,
      updatedStreet
    )).toBe(false)
  })

  test('saves a combined contact edit through one profile PATCH', async ({ page }) => {
    const runtime = getLocalRuntime()
    const profilePatches: string[] = []
    page.on('request', (request) => {
      if (request.url() !== runtime.profileUrl || request.method() !== 'PATCH') return
      const body = request.postData() || ''
      if (!body.includes('publicTypeIndex')) profilePatches.push(body)
    })

    await page.getByLabel('Add contact information').click()
    await page.locator('input[name="email-value-0"]').fill('atomic-contact@example.test')
    await page.locator('input[name="phone-value-0"]').fill('555 010 4000')
    await page.locator('input[name="address-street-0"]').fill('400 Atomic Street')
    await saveDialog(page)

    await expect.poll(() => profilePatches.length).toBe(1)
    await expect.poll(async () => hasContactEmail(
      await readPersistedProfile(page),
      'atomic-contact@example.test'
    )).toBe(true)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}value`,
      'tel:5550104000'
    )).toBe(true)
    await expect.poll(async () => hasObjectValue(
      await readPersistedProfile(page),
      `${rdf.vcard}street-address`,
      '400 Atomic Street'
    )).toBe(true)
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

  test('surfaces a concurrent collection edit conflict without retrying as PATCH', async ({ page }) => {
    const runtime = getLocalRuntime()
    let concurrentWriteCompleted = false
    const patchRequests: string[] = []

    page.on('request', (request) => {
      if (request.url() === runtime.profileUrl && request.method() === 'PATCH') {
        const body = request.postData() || ''
        if (!body.includes('publicTypeIndex')) {
          patchRequests.push(body)
        }
      }
    })
    await page.route(runtime.profileUrl, async (route) => {
      const request = route.request()
      if (concurrentWriteCompleted || request.method() !== 'PUT') {
        await route.continue()
        return
      }

      concurrentWriteCompleted = true
      const response = await page.evaluate(async ({ url, body }) => {
        const session = (window as typeof window & {
          SolidLogic?: { authSession?: { authFetch?: typeof fetch, fetch?: typeof fetch } }
        }).SolidLogic?.authSession
        const fetcher = session?.authFetch ?? session?.fetch
        if (!fetcher) throw new Error('The authenticated Solid session is unavailable.')
        const current = await fetcher.call(session, url)
        const currentEtag = current.headers.get('etag')
        if (!current.ok || !currentEtag) {
          throw new Error(`Could not read the current profile ETag: ${current.status}`)
        }
        const result = await fetcher.call(session, url, {
          method: 'PUT',
          body: `${body}\n# concurrent edit`,
          headers: {
            'content-type': 'text/turtle',
            'if-match': currentEtag,
            'x-e2e-concurrent-write': 'true'
          }
        })
        return { status: result.status, body: await result.text(), etag: currentEtag }
      }, {
        url: runtime.profileUrl,
        body: request.postData() || ''
      })
      expect([200, 205]).toContain(response.status)
      await route.continue({
        headers: {
          ...request.headers(),
          'if-match': request.headers()['if-match'] || response.etag
        }
      })
    })

    await page.getByLabel('Add or edit languages').click()
    await page.getByLabel('Reorder language 2').dragTo(page.locator('[data-language-reorder-index="0"]'))
    const putResponse = page.waitForResponse((response) =>
      response.url() === runtime.profileUrl &&
      response.request().method() === 'PUT' &&
      !response.request().headers()['x-e2e-concurrent-write']
    )
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
    const response = await putResponse
    expect(response.status()).toBe(412)
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    expect(concurrentWriteCompleted).toBe(true)
    expect(patchRequests).toHaveLength(0)

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.unroute(runtime.profileUrl)
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
    await selectLanguage(page, 0, 'French', 'https://www.w3.org/ns/iana/language-code/fr')
    await saveDialog(page)
    await expect.poll(async () => languageOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['fr', 'en', 'es'])

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByLabel('Add or edit languages').click()
    await page.getByLabel('Delete language 1').click()
    await saveDialog(page)
    await expect.poll(async () => languageOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['en', 'es'])
  })

  test('creates and removes a social account through profile-pane', async ({ page }) => {
    const runtime = getLocalRuntime()
    const homepage = 'https://www.linkedin.com/in/e2e-profile'

    await page.getByLabel('Edit social accounts').click()
    await page.getByLabel('Add another social account').click()
    await selectSocialAccount(page, 0, 'LinkedIn')
    await page.locator('input[name="social-homepage-0"]').fill(homepage)
    await saveDialog(page)
    await expect.poll(async () => socialOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['LinkedIn', 'GitHub', 'Facebook'])

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByLabel('Edit social accounts').click()
    await page.getByLabel('Delete social account 1').click()
    await saveDialog(page)
    await expect.poll(async () => socialOrder(await readPersistedProfile(page), runtime.webId))
      .toEqual(['GitHub', 'Facebook'])
  })

  test('preserves the same username across different social providers', async ({ page }) => {
    const runtime = getLocalRuntime()
    const username = 'same-profile-user'

    await page.getByLabel('Edit social accounts').click()
    await page.getByLabel('Add another social account').click()
    await selectSocialAccount(page, 0, 'GitHub')
    await page.locator('input[name="social-homepage-0"]').fill(`https://github.com/${username}`)
    await saveDialog(page)
    await page.reload({ waitUntil: 'networkidle' })

    await page.getByLabel('Edit social accounts').click()
    await page.getByLabel('Add another social account').click()
    await selectSocialAccount(page, 0, 'Facebook')
    await page.locator('input[name="social-homepage-0"]').fill(`https://facebook.com/${username}`)
    await saveDialog(page)

    await expect.poll(async () => sameUsernameProviderCount(
      await readPersistedProfile(page),
      runtime.webId,
      username
    )).toBe(2)
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
  const dialog = page.getByRole('dialog')
  const error = dialog.getByRole('alert')
  await expect.poll(async () => {
    if (!await dialog.isVisible()) return 'saved'
    if (await error.isVisible()) return 'failed'
    return 'saving'
  }, { timeout: 30_000, message: 'Waiting for the profile save to complete or report an error' }).not.toBe('saving')
  if (await dialog.isVisible() && await error.isVisible()) {
    throw new Error(`Profile save failed: ${await error.textContent()}`)
  }
  await expect(dialog).toBeHidden()
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
  return rdfListMembers(profile, webId, `${rdf.foaf}account`).map((node) => {
    const type = profile.find((quad) =>
      quad.subject.value === node && quad.predicate.value === `${rdf.rdf}type`
    )?.object.value
    const accountType = type?.split('#').at(-1)?.replace(/Account$/, '') || ''
    return accountType === 'Github' ? 'GitHub' : accountType
  })
}

function sameUsernameProviderCount(
  profile: Awaited<ReturnType<typeof readPersistedProfile>>,
  _webId: string,
  username: string
): number {
  return profile.filter((quad) =>
    quad.predicate.value === `${rdf.foaf}accountName` &&
    (quad.object.value === username || quad.object.value.endsWith(`/${username}`))
  ).length
}
