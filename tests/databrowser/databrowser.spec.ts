import { expect, test } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { seedDatabrowserResources, type DatabrowserSeed } from '../../fixtures/databrowser.js'

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
})
