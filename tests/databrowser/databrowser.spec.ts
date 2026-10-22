import { expect, test } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import {
  readAuthenticatedResource,
  seedDatabrowserResources,
  writeAuthenticatedResource,
  type DatabrowserSeed
} from '../../fixtures/databrowser.js'

test.describe('mashlib databrowser representation', () => {
  test('serves the static databrowser shell and representation markers', async ({ request }) => {
    test.skip(
      process.env.E2E_RUN_DATABROWSER !== 'true',
      'Set E2E_RUN_DATABROWSER=true to run Databrowser coverage.'
    )

    const response = await request.get('/databrowser.html')
    expect(response.ok()).toBeTruthy()
    const html = await response.text()
    expect(html).toContain('<solid-ui-provider>')
    expect(html).toContain('id="MainContent"')
    expect(html).toContain('id="OutlineView"')
    expect(html).toContain('panes.runDataBrowser()')
    expect(html).toContain('data-app-shell="databrowser"')
  })
})

test.describe('authenticated mashlib databrowser', () => {
  test.setTimeout(90_000)

  let seed: DatabrowserSeed

  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_DATABROWSER !== 'true' ||
      process.env.E2E_RUN_LOCAL_PROFILE !== 'true' ||
      process.env.E2E_USE_LOCAL_RUNTIME !== 'true',
      'Run setup:local with E2E_RUN_DATABROWSER, E2E_RUN_LOCAL_PROFILE and E2E_USE_LOCAL_RUNTIME enabled.'
    )

    const runtime = getLocalRuntime()
    const leakedValues = [runtime.email, runtime.password]
    page.on('request', request => {
      const url = request.url()
      for (const value of leakedValues) expect(url).not.toContain(value)
    })
    await authenticateProfileOwner(page)
    seed = await seedDatabrowserResources(page, runtime.podUrl)
  })

  test('boots solid-ui-provider, MainContent, OutlineView and the application header', async ({ page }) => {
    await page.goto(seed.containerUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('solid-ui-provider')).toHaveCount(1)
    await expect(page.locator('#MainContent')).toBeVisible()
    await expect(page.locator('#OutlineView')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open help', exact: true })).toBeVisible()
    await expect(page.locator('body[data-app-shell="databrowser"]')).toHaveCount(1)
  })

  test('navigates authenticated containers and document resources', async ({ page }) => {
    await page.goto(seed.containerUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#MainContent')).toBeVisible()
    await expect(
      page.getByRole('listbox', { name: 'Container resources' })
        .locator('[role="option"]', { hasText: 'resource.ttl' })
    ).toBeVisible()

    await page.goto(seed.documentUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#OutlineView')).toBeVisible()
    await expect.poll(async () => page.locator('#OutlineView').innerText()).toContain('Databrowser E2E resource')

    await page.goto(seed.textUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#MainContent')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(new URL(seed.textUrl).pathname)
  })

  test('opens a pane through the owning Databrowser explorer provider', async ({ page }) => {
    await page.goto(seed.documentUrl, { waitUntil: 'domcontentloaded' })
    const provider = page.locator('#OutlineView solid-ui-file-explorer-provider').first()
    await expect(provider).toHaveCount(1)

    await provider.evaluate((element, htmlUrl) => {
      const paneProvider = element as HTMLElement & {
        openPane?: (subject: { uri: string, doc: () => unknown }, paneName: string) => void
      }
      const subject = { uri: htmlUrl, doc: () => subject }
      if (!paneProvider.openPane) throw new Error('Databrowser explorer provider has no openPane callback.')
      paneProvider.openPane(subject, 'humanReadable')
    }, seed.htmlUrl)

    await expect(provider.locator('iframe[name="solidos-human-readable-preview"]')).toHaveCount(1)
  })

  test('enters an expanded object at its first property', async ({ page }) => {
    await page.goto(seed.documentUrl, { waitUntil: 'domcontentloaded' })
    const object = page.locator(
      `#OutlineView [data-outline-node="object"][about="<${seed.subjectUrl}-creator>"]`
    )
    await expect(object).toHaveCount(1)

    await object.focus()
    await page.keyboard.press('ArrowRight')

    const provider = object.locator(':scope > solid-ui-file-explorer-provider')
    await expect(provider).toHaveCount(1)
    await expect(provider.locator('[data-outline-node="object"].selected').first()).toBeVisible()
  })

  test('leaves an expanded object with Left without collapsing its enclosing resource', async ({ page }) => {
    await page.goto(seed.documentUrl, { waitUntil: 'domcontentloaded' })
    const object = page.locator(
      `#OutlineView [data-outline-node="object"][about="<${seed.subjectUrl}-creator>"]`
    )
    await object.focus()
    await page.keyboard.press('ArrowRight')

    const provider = object.locator(':scope > solid-ui-file-explorer-provider')
    await expect(provider).toHaveCount(1)
    await expect(provider.locator('[data-outline-node="object"].selected').first()).toBeVisible()

    await page.keyboard.press('ArrowLeft')

    await expect(object).toHaveCount(1)
    await expect(object.locator(':scope > solid-ui-file-explorer-provider')).toHaveCount(0)
    await expect(page.locator('#OutlineView')).toContainText('Databrowser E2E resource')
  })

  test('shift-clicks an RDF object into the outer Databrowser view', async ({ page }) => {
    await page.goto(seed.documentUrl, { waitUntil: 'domcontentloaded' })
    const object = page.locator(
      `#OutlineView [data-outline-node="object"][about="<${seed.subjectUrl}-creator>"]`
    )
    await expect(object).toHaveCount(1)

    await object.locator('img[alt="expand"]').click({ modifiers: ['Shift'] })

    await expect(page.locator('#OutlineView solid-ui-file-explorer-provider')).toHaveAttribute(
      'about',
      `<${seed.subjectUrl}-creator>`
    )
    await expect(page.locator('#OutlineView .outline-subject-block')).toHaveAttribute(
      'about',
      `<${seed.subjectUrl}-creator>`
    )
  })

  test('follows a browser subject link and restores the previous subject with back', async ({ page }) => {
    await page.goto(seed.documentUrl, { waitUntil: 'domcontentloaded' })
    await expect.poll(async () => page.locator('#OutlineView').innerText()).toContain('Databrowser E2E resource')

    const subjectLinkIndex = await page.locator('#OutlineView a').evaluateAll((links, subject) =>
      links.findIndex(link => (link as HTMLAnchorElement).href === subject), seed.subjectUrl)
    expect(subjectLinkIndex, 'The RDF representation should expose a navigable subject link').toBeGreaterThanOrEqual(0)
    await page.locator('#OutlineView a').nth(subjectLinkIndex).click()
    await expect.poll(async () => page.url()).toContain('#resource')
    await page.goBack()
    await expect(page.locator('#OutlineView')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(new URL(seed.documentUrl).pathname)
    expect(page.url()).not.toContain(getLocalRuntime().password)
    expect(await page.locator('body').innerText()).not.toContain(getLocalRuntime().password)
  })

  test('renders Databrowser HTML in an isolated preview and mediates only the current document save', async ({ page }) => {
    await page.goto(seed.htmlUrl, { waitUntil: 'domcontentloaded' })

    const preview = page.locator('iframe[name="solidos-human-readable-preview"]')
    await expect(preview).toHaveCount(1)
    await expect(preview).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals'
    )
    await expect(preview).toHaveAttribute('srcdoc', /Databrowser E2E HTML preview/)

    await expect.poll(() => readAuthenticatedResource(page, seed.htmlUrl)).toContain(
      'Dokieli exact-document save completed.'
    )
    await expect.poll(() => readAuthenticatedResource(page, seed.otherUrl)).toContain(
      'This resource must remain unchanged.'
    )
  })

  test('uses the actual MIME type when cached metadata identifies a resource as non-HTML', async ({ page }) => {
    await page.goto(seed.mimeMismatchUrl, { waitUntil: 'domcontentloaded' })
    const preview = page.locator('iframe[name="solidos-human-readable-preview"]')
    await expect(preview).toHaveAttribute('src', /blob:/)
    await expect(preview).toHaveAttribute('sandbox', /allow-scripts/)

    await writeAuthenticatedResource(
      page,
      seed.mimeMismatchUrl,
      '<!doctype html><html><body><script>window.parent.compromised = true</script><h1>Actual HTML response</h1></body></html>',
      'text/html'
    )
    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(preview).toHaveAttribute('srcdoc', /Actual HTML response/)
    await expect(preview).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals'
    )
    await expect(preview).not.toHaveAttribute('src', /blob:/)
  })
})
