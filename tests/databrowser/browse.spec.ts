import { expect, test } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { writeAuthenticatedResource } from '../../fixtures/databrowser.js'

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

    const secondUri = 'https://example.test/profile/card#me'
    await uriField.fill(secondUri)
    await uriField.press('Enter')
    await expect.poll(() => new URL(page.url()).searchParams.get('uri')).toBe(secondUri)
  })

  test('loads and displays the URI supplied in the query string', async ({ page }) => {
    const uri = 'https://example.test/profile/card#me'
    await page.route('https://example.test/**', route => route.fulfill({ status: 404 }))
    await page.goto(`/browse.html?uri=${encodeURIComponent(uri)}`, {
      waitUntil: 'domcontentloaded'
    })

    await expect(page.locator('#uriField')).toHaveValue(uri)
    await expect.poll(() => new URL(page.url()).searchParams.get('uri')).toBe(uri)
  })

  test('shows a W3C profile document in the data content pane', async ({ page }) => {
    await page.goto('/browse.html?uri=' + encodeURIComponent('https://www.w3.org/People/Berners-Lee/card'), {
      waitUntil: 'domcontentloaded'
    })

    await expect(page.locator('#OutlineView .dataContentPane')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#OutlineView folder-pane-container')).toHaveCount(0)
  })

  test('shows a specific resource in solo mode instead of the folder explorer', async ({ page }) => {
    const uri = 'https://example.test/solo-resource.ttl'
    await page.route('https://example.test/**', route => route.fulfill({
      status: 200,
      contentType: 'text/turtle',
      body: '<> <http://purl.org/dc/terms/title> "Solo browse resource" .'
    }))
    await page.goto(`/browse.html?uri=${encodeURIComponent(uri)}`, {
      waitUntil: 'domcontentloaded'
    })

    await expect(page.locator('#OutlineView .outline-subject-block')).toBeVisible()
    await expect(page.locator('#OutlineView folder-pane-container')).toHaveCount(0)
  })

  test('preserves a Linked Data subject when its RDF document redirects', async ({ page }) => {
    const subjectUri = 'https://example.test/id/alice'
    await page.route('https://example.test/**', route => {
      if (route.request().url() === subjectUri) {
        return route.fulfill({
          status: 303,
          headers: { location: 'https://example.test/profile/alice.ttl' }
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/turtle',
        body: '<https://example.test/id/alice> <http://xmlns.com/foaf/0.1/name> "Alice" .'
      })
    })
    await page.goto(`/browse.html?uri=${encodeURIComponent(subjectUri)}`, {
      waitUntil: 'domcontentloaded'
    })

    await expect(page.locator('#uriField')).toHaveValue(subjectUri)
    await expect(page.locator('#OutlineView .outline-subject-block')).toBeVisible()
  })

  for (const container of [true, false]) {
    test(container
      ? 'normalizes a loaded container without losing its query or fragment'
      : 'does not treat a POST-capable resource as a container', async ({ page }) => {
      test.skip(
        process.env.E2E_USE_LOCAL_RUNTIME === 'true',
        'Synthetic header responses are covered by the standalone browse run.'
      )
      const uri = 'https://example.test/resource?view=1#section'
      const expected = container
        ? 'https://example.test/resource/?view=1#section'
        : uri
      await page.route('https://example.test/**', route => route.fulfill({
        status: 200,
        contentType: 'text/turtle',
        headers: {
          'access-control-expose-headers': 'Link, Allow',
          allow: 'GET, HEAD, POST',
          ...(container ? { link: '<http://www.w3.org/ns/ldp#Container>; rel="type"' } : {})
        },
        body: '<> <http://purl.org/dc/terms/title> "Browse resource" .'
      }))
      await page.goto(`/browse.html?uri=${encodeURIComponent(uri)}`, {
        waitUntil: 'domcontentloaded'
      })

      await expect(page.locator('#uriField')).toHaveValue(expected)
      await expect.poll(() => new URL(page.url()).searchParams.get('uri')).toBe(expected)
    })
  }
})

test.describe('authenticated browse.html storage root', () => {
  test.setTimeout(90_000)

  test('shows the profile heading for the URI supplied in the query string', async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_DATABROWSER !== 'true' ||
      process.env.E2E_RUN_LOCAL_PROFILE !== 'true' ||
      process.env.E2E_USE_LOCAL_RUNTIME !== 'true',
      'Run setup:local with E2E_RUN_DATABROWSER, E2E_RUN_LOCAL_PROFILE and E2E_USE_LOCAL_RUNTIME enabled.'
    )

    const runtime = getLocalRuntime()
    if (!runtime.viewerProfileUrl) {
      test.skip(true, 'The local runtime has no second profile for browse.html heading coverage.')
    }

    await authenticateProfileOwner(page)
    const profileUri = `${runtime.viewerProfileUrl}#me`
    await page.goto(`/browse.html?uri=${encodeURIComponent(profileUri)}`, {
      waitUntil: 'domcontentloaded'
    })

    const headingMount = page.locator('#profile-heading-mount')
    await expect(headingMount).toBeVisible()
    await expect(headingMount.locator('solid-panes-profile-heading')).toBeVisible()
  })

  test('opens a private resource from the owner storage root after login', async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_DATABROWSER !== 'true' ||
      process.env.E2E_RUN_LOCAL_PROFILE !== 'true' ||
      process.env.E2E_USE_LOCAL_RUNTIME !== 'true',
      'Run setup:local with E2E_RUN_DATABROWSER, E2E_RUN_LOCAL_PROFILE and E2E_USE_LOCAL_RUNTIME enabled.'
    )

    const runtime = getLocalRuntime()
    await authenticateProfileOwner(page)

    const fileName = `browse-private-${Date.now()}.txt`
    const privateResourceUrl = new URL(fileName, runtime.podUrl).toString()
    await writeAuthenticatedResource(
      page,
      privateResourceUrl,
      'Private browse.html storage-root resource',
      'text/plain'
    )

    const podAddressWithoutTrailingSlash = runtime.podUrl.replace(/\/$/, '')
    const browseUrl = new URL(
      `/browse.html?uri=${encodeURIComponent(podAddressWithoutTrailingSlash)}`,
      runtime.podUrl
    ).toString()
    const normalizedBrowseUrl = new URL(
      `/browse.html?uri=${encodeURIComponent(runtime.podUrl)}`,
      runtime.podUrl
    ).toString()
    await page.goto(browseUrl, {
      waitUntil: 'domcontentloaded'
    })

    await expect(page.locator('#uriField')).toHaveValue(runtime.podUrl)
    const resource = page.locator(
      `folder-pane-container li[role="option"][about="<${privateResourceUrl}>"]`
    )
    await expect(resource).toBeVisible()
    await resource.click()

    // browse.html is a shell: selecting a resource must not navigate away from
    // browse.html or lose the authenticated resource view.
    await expect(page).toHaveURL(new RegExp(`${normalizedBrowseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await expect.poll(async () => page.locator('#OutlineView').innerText()).toContain(
      'Private browse.html storage-root resource'
    )
    await expect(page.locator('body')).not.toContainText(/access denied/i)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(new RegExp(`${normalizedBrowseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await expect(
      page.locator(`folder-pane-container li[role="option"][about="<${privateResourceUrl}>"]`)
    ).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/access denied/i)
  })
})
