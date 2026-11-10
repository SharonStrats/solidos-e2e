import { expect, test } from '../../fixtures/test.js'

test.describe('Data Content pane accessibility', () => {
  test.beforeEach(() => {
    test.skip(
      process.env.E2E_RUN_DATABROWSER !== 'true',
      'Set E2E_RUN_DATABROWSER=true to run Data Content coverage.'
    )
  })

  test('exposes RDF relationships, collections, language tags, and sanitized XMLLiteral content', async ({ page }) => {
    const resourceUrl = 'https://example.test/data-content.ttl'
    await page.route('https://example.test/**', route => route.fulfill({
      status: 200,
      contentType: 'text/turtle',
      body: `@prefix ex: <https://example.test/ns#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.

<> ex:title "Bonjour"@fr, "Au revoir"@fr;
   ex:related <https://example.test/related>;
   ex:details _:details;
   ex:otherDetails _:details;
   ex:list ( <https://example.test/related> "Second item" );
   ex:content "<p>Safe content</p><img src='diagram.png' alt='Diagram'><script>window.bad = true</script>"^^rdf:XMLLiteral.

_:details ex:label "Nested value".`
    }))

    await page.goto(`/browse.html?uri=${encodeURIComponent(resourceUrl)}`, {
      waitUntil: 'domcontentloaded'
    })

    const pane = page.locator('#OutlineView .dataContentPane')
    await expect(pane).toBeVisible({ timeout: 30_000 })
    await expect(pane.locator('th[scope="row"]').first()).toBeVisible()
    await expect(pane.locator('th.data-content-pane__predicate-cell', {
      has: page.locator('a[href="https://example.test/ns#title"]')
    }))
      .toHaveAttribute('rowspan', '2')
    await expect(pane.locator('[lang="fr"]')).toHaveCount(2)
    await expect(pane.locator('ol > li')).toHaveCount(2)

    const embedded = pane.locator('[role="group"][aria-label="Embedded HTML content"]')
    await expect(embedded).toContainText('Safe content')
    await expect(embedded.locator('img')).toHaveAttribute('alt', 'Diagram')
    await expect(embedded.locator('script')).toHaveCount(0)
  })

  test('supports named-node links and blank-node fragment navigation', async ({ page }) => {
    const resourceUrl = 'https://example.test/data-content-links.ttl'
    await page.route('https://example.test/**', route => route.fulfill({
      status: 200,
      contentType: 'text/turtle',
      body: `@prefix ex: <https://example.test/ns#>.

<> ex:related <https://example.test/related>;
   ex:details _:details;
   ex:otherDetails _:details.

_:details ex:label "Nested value".`
    }))

    await page.goto(`/browse.html?uri=${encodeURIComponent(resourceUrl)}`, {
      waitUntil: 'domcontentloaded'
    })

    const pane = page.locator('#OutlineView .dataContentPane')
    await expect(pane).toBeVisible({ timeout: 30_000 })
    await expect(pane.locator('a[href="https://example.test/related"]')).toBeVisible()

    const reference = pane.locator('a.bnodeRef').first()
    const definition = pane.locator('a.bnodeDef[tabindex="-1"]').first()
    await expect(reference).toBeVisible()
    await expect(definition).toHaveAttribute('aria-label', /Blank node/)
    const fragment = await definition.getAttribute('id')
    expect(fragment).toBeTruthy()
    await expect(reference).toHaveAttribute('href', `#${fragment}`)
    await reference.click()
    await expect.poll(() => new URL(page.url()).hash).not.toBe('')
  })
})
