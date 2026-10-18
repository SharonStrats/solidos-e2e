import { test, expect } from '../../fixtures/test.js'
import type { Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'

type RegisteredPane = {
  name: string
  mintClass: string
}

type CreatedResource = {
  documentUrl: string
}

const RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const UI_NAMESPACE = 'http://www.w3.org/ns/ui#'

test.describe('folder-pane created resources', () => {
  test('creates and lists one resource for every creatable pane class', async ({ page }) => {
    test.setTimeout(120_000)
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )

    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(
      !containerUrl,
      'Set E2E_FOLDER_PANE_CONTAINER_URL to a writable container in the disposable local pod.'
    )
    if (!containerUrl) return

    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl)
    const panes = await getCreatablePanes(page, containerUrl)
    test.skip(
      panes.length === 0,
      'No non-global pane with mintClass is registered; nothing can be created.'
    )

    const created: CreatedResource[] = []
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      for (const pane of panes) {
        const resource = await createResource(page, containerUrl, pane, runId)
        created.push(resource)
      }

      // Container contents are cached by the active explorer. Start a new
      // authenticated explorer session so the assertions read the server's
      // directory listing after the out-of-band POSTs.
      await authenticateProfileOwner(page)
      await openFolderPane(page, containerUrl)
      for (const resource of created) {
        const options = page.locator('folder-pane-container li[role="option"]')
        await expect.poll(() => options.evaluateAll((items, documentUrl) =>
          items.findIndex((item) => item.getAttribute('about') === `<${documentUrl}>`),
        resource.documentUrl)).toBeGreaterThanOrEqual(0)
        const resourceIndex = await options.evaluateAll((items, documentUrl) =>
          items.findIndex((item) => item.getAttribute('about') === `<${documentUrl}>`),
        resource.documentUrl)
        expect(resourceIndex, `Created resource is not listed: ${resource.documentUrl}`).toBeGreaterThanOrEqual(0)
        await options.nth(resourceIndex).click()
        await expect(page.locator('folder-pane-sidebar li[aria-selected="true"]'))
          .toHaveAttribute('about', `<${resource.documentUrl}>`)
        await page.locator('folder-pane-sidebar li[aria-label="Home"] > .resource-row').click()
        await expect(page.locator('folder-pane-container')).toHaveCount(1)
      }
    } finally {
      for (const resource of created.reverse()) {
        await removeResource(page, containerUrl, resource)
      }
    }
  })
})

async function getCreatablePanes (page: Page, containerUrl: string): Promise<RegisteredPane[]> {
  void containerUrl
  const registeredPanes = await page.evaluate(() => {
    const registered = (window as typeof window & {
      panes?: { list?: Array<{ name?: string, global?: boolean, mintClass?: { uri?: string }, mintNew?: unknown }> }
    }).panes?.list || []
    return registered
      .filter((pane) => !pane.global && pane.name !== 'questionnaire' && pane.mintNew)
      .map((pane) => ({ name: pane.name, mintClass: pane.mintClass?.uri }))
  })
  const panes = registeredPanes.filter((pane): pane is RegisteredPane =>
    typeof pane.name === 'string' && typeof pane.mintClass === 'string'
  )
  const unsupported = await page.evaluate(() => {
    const registered = (window as typeof window & {
      panes?: { list?: Array<{ name?: string, global?: boolean, mintClass?: { uri?: string }, mintNew?: unknown }> }
    }).panes?.list || []
    return registered
      .filter((pane) => !pane.global && pane.name !== 'questionnaire')
      .filter((pane) => !pane.mintNew || !pane.mintClass?.uri)
      .map((pane) => pane.name)
      .filter((name): name is string => Boolean(name))
  })
  if (unsupported.length > 0) {
    console.warn(`[folder-pane] Skipping panes without mintNew support: ${unsupported.join(', ')}`)
  }
  return panes
}

async function createResource (
  page: Page,
  containerUrl: string,
  pane: RegisteredPane,
  runId: string
): Promise<CreatedResource> {
  const slug = `folder-pane-${runId}-${encodeURIComponent(pane.name)}.ttl`
  const documentUrl = new URL(slug, containerUrl).toString()
  const subjectUrl = `${documentUrl}#this`
  const turtle = [
    `@prefix rdf: <${RDF_NAMESPACE}>.`,
    `@prefix ui: <${UI_NAMESPACE}>.`,
    '@prefix dc: <http://purl.org/dc/terms/>.',
    `<${documentUrl}> ui:mintClass <${pane.mintClass}>;`,
    `  rdf:type <${pane.mintClass}>.`,
    `<${subjectUrl}> rdf:type <${pane.mintClass}>;`,
    `  dc:title "Folder pane ${pane.name} ${runId}".`
  ].join('\n')
  const response = await authenticatedFetch(page, containerUrl, 'POST', turtle, 'text/turtle', { slug })
  expect(response.ok, `Could not create ${documentUrl}: ${response.status}`).toBeTruthy()
  const location = response.location
  expect(location, 'Container POST did not return the created resource location').toBeTruthy()
  expect(new URL(location!, containerUrl).toString()).toBe(documentUrl)
  return { documentUrl }
}

async function removeResource (page: Page, _containerUrl: string, resource: CreatedResource): Promise<void> {
  const documentResponse = await authenticatedFetch(page, resource.documentUrl, 'DELETE')
  expect(
    documentResponse.ok || documentResponse.status === 404,
    `Could not delete ${resource.documentUrl}: ${documentResponse.status}`
  ).toBeTruthy()
}

async function authenticatedFetch (
  page: Page,
  url: string,
  method: string,
  body?: string,
  contentType?: string,
  headers: Record<string, string> = {}
): Promise<{ ok: boolean, status: number, location: string | null }> {
  return page.evaluate(async ({ url, method, body, contentType, headers }) => {
    const session = (window as typeof window & {
      SolidLogic?: {
        authSession?: {
          fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
          authFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
        }
      }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('The folder-pane test has no authenticated Solid session.')
    const response = await authenticatedFetch.call(session, url, {
      method,
      body,
      headers: contentType ? { ...headers, 'content-type': contentType } : headers
    })
    return { ok: response.ok, status: response.status, location: response.headers.get('location') }
  }, { url, method, body, contentType, headers })
}
