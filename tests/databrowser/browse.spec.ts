import { expect, test } from '../../fixtures/test.js'

test.describe('standalone browse.html Databrowser', () => {
  test.beforeEach(() => {
    test.skip(
      process.env.E2E_RUN_DATABROWSER !== 'true',
      'Set E2E_RUN_DATABROWSER=true to run Databrowser coverage.'
    )
  })

  test('serves the standalone Databrowser shell', async ({ request }) => {
    const response = await request.get('/browse.html')

    expect(response.ok()).toBeTruthy()
    const html = await response.text()
    expect(html).toContain('<solid-ui-provider>')
    expect(html).toContain('id="PageHeader"')
    expect(html).toContain('id="uriField"')
    expect(html).toContain('id="goButton"')
    expect(html).toContain('id="OutlineView"')
  })

  test('renders its header, URI field, Go button and resource browser', async ({ page }) => {
    await page.goto('/browse.html', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('banner')).toContainText('SolidOS Databrowser')
    await expect(page.locator('#uriField')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign Up', exact: true })).toBeVisible()
    await expect(page.locator('#OutlineView')).toHaveCount(1)
    await expect(page.locator('#OutlineView')).toHaveAttribute('aria-label', 'Resource browser')
  })

  test('navigates to a URI from the Go button and Enter key', async ({ page }) => {
    const uri = 'https://example.test/resource.ttl'
    await page.route('https://example.test/**', route => route.fulfill({ status: 404 }))
    await page.goto('/browse.html', { waitUntil: 'domcontentloaded' })

    const uriField = page.locator('#uriField')
    await uriField.fill(uri)
    await page.getByRole('button', { name: 'Go' }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('uri')).toBe(uri)

    const secondUri = 'https://example.test/other.ttl'
    await uriField.fill(secondUri)
    await uriField.press('Enter')
    await expect.poll(() => new URL(page.url()).searchParams.get('uri')).toBe(secondUri)
  })

  test('loads and displays the URI supplied in the query string', async ({ page }) => {
    const uri = 'https://example.test/initial.ttl'
    await page.route('https://example.test/**', route => route.fulfill({ status: 404 }))
    await page.goto(`/browse.html?uri=${encodeURIComponent(uri)}`, {
      waitUntil: 'domcontentloaded'
    })

    await expect(page.locator('#uriField')).toHaveValue(uri)
    await expect.poll(() => new URL(page.url()).searchParams.get('uri')).toBe(uri)
  })
})
