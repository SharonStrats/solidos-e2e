import { test, expect } from '../../fixtures/test.js'
import type { Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { createContainer, createResource } from '../../fixtures/folder-pane.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'

async function authenticatedFetch (page: Page, url: string, init: RequestInit = {}) {
  return page.evaluate(async ({ url, init }) => {
    const session: { fetch?: typeof fetch, authFetch?: typeof fetch } | undefined = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('The folder-pane test has no authenticated Solid session.')
    const response = await authenticatedFetch.call(session, url, init)
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text()
    }
  }, { url, init })
}

async function dropUrl (page: Page, url: string) {
  const target = page.locator('folder-pane-container .folder-pane-container-content')
  await expect(target).toBeVisible()
  await expect.poll(() => page.locator('folder-pane-container').evaluate(element =>
    (element as HTMLElement & { canUpload?: boolean }).canUpload
  )).toBe(true)
  await target.evaluate((element, resourceUrl) => {
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', resourceUrl)
    dataTransfer.setData('text/plain', resourceUrl)
    element.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer
    }))
  }, url)
}

async function expectText (page: Page, url: string, expected: string) {
  await expect.poll(async () => {
    const response = await authenticatedFetch(page, url)
    return response.ok ? response.text : `HTTP ${response.status}`
  }).toBe(expected)
}

test.describe('folder-pane URL copies', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    test.skip(process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.')
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to run folder-pane coverage.')
    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl!)
  })

  test('copies a dropped file and preserves the source', async ({ page }) => {
    const root = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const sourceContainer = await createContainer(page, root, `copy-source-${Date.now()}`)
    const destination = await createContainer(page, root, `copy-destination-${Date.now()}`)
    const sourceUrl = new URL('source.txt', sourceContainer).toString()
    const destinationUrl = new URL('source.txt', destination).toString()

    try {
      await createResource(page, sourceContainer, 'source.txt', 'copied file', 'text/plain')
      await page.goto(`/browse.html?uri=${encodeURIComponent(destination)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-container')).toBeVisible()
      await dropUrl(page, sourceUrl)
      await expectText(page, sourceUrl, 'copied file')
      await expectText(page, destinationUrl, 'copied file')
    } finally {
      await authenticatedFetch(page, sourceContainer, { method: 'DELETE' })
      await authenticatedFetch(page, destination, { method: 'DELETE' })
    }
  })

  test('lets the user keep both files or replace the colliding destination', async ({ page }) => {
    const root = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const sourceContainer = await createContainer(page, root, `copy-collision-source-${Date.now()}`)
    const destination = await createContainer(page, root, `copy-collision-destination-${Date.now()}`)
    const sourceUrl = new URL('same.txt', sourceContainer).toString()
    const destinationUrl = new URL('same.txt', destination).toString()

    try {
      await createResource(page, sourceContainer, 'same.txt', 'source content', 'text/plain')
      await createResource(page, destination, 'same.txt', 'existing content', 'text/plain')
      await page.goto(`/browse.html?uri=${encodeURIComponent(destination)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-container')).toBeVisible()
      await dropUrl(page, sourceUrl)
      await page.getByRole('button', { name: 'Keep both files', exact: true }).click()
      await expectText(page, sourceUrl, 'source content')
      await expectText(page, destinationUrl, 'existing content')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-container')).toBeVisible()
      const keptCopy = page.locator('folder-pane-container li[role="option"][about*="same-copy-"]')
      await expect(keptCopy).toBeVisible()
      const keptCopyAbout = await keptCopy.getAttribute('about')
      expect(keptCopyAbout).toBeTruthy()
      const keptCopyUrl = keptCopyAbout!.slice(1, -1)
      await expectText(page, keptCopyUrl, 'source content')

      await dropUrl(page, sourceUrl)
      await page.getByRole('button', { name: 'Replace existing file', exact: true }).click()
      await expectText(page, sourceUrl, 'source content')
      await expectText(page, destinationUrl, 'source content')
      await expectText(page, keptCopyUrl, 'source content')
    } finally {
      await authenticatedFetch(page, sourceContainer, { method: 'DELETE' })
      await authenticatedFetch(page, destination, { method: 'DELETE' })
    }
  })

  test('copies a dropped folder recursively and preserves its source', async ({ page }) => {
    const root = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const source = await createContainer(page, root, `copy-folder-source-${Date.now()}`)
    const destination = await createContainer(page, root, `copy-folder-destination-${Date.now()}`)
    const nested = await createContainer(page, source, 'nested')
    const sourceFile = new URL('root.txt', source).toString()
    const nestedFile = new URL('nested.txt', nested).toString()
    const copiedFolderName = source.split('/').slice(-2, -1)[0]
    const copiedRootFile = new URL(`${copiedFolderName}/root.txt`, destination).toString()
    const copiedNestedFile = new URL(`${copiedFolderName}/nested/nested.txt`, destination).toString()

    try {
      await createResource(page, source, 'root.txt', 'root content', 'text/plain')
      await createResource(page, nested, 'nested.txt', 'nested content', 'text/plain')
      await page.goto(`/browse.html?uri=${encodeURIComponent(destination)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-container')).toBeVisible()
      await dropUrl(page, source)
      await expectText(page, sourceFile, 'root content')
      await expectText(page, nestedFile, 'nested content')
      await expectText(page, copiedRootFile, 'root content')
      await expectText(page, copiedNestedFile, 'nested content')
    } finally {
      await authenticatedFetch(page, source, { method: 'DELETE' })
      await authenticatedFetch(page, destination, { method: 'DELETE' })
    }
  })

  test('asks once for a colliding top-level folder and keeps its descendants together', async ({ page }) => {
    const root = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const sourceParent = await createContainer(page, root, `copy-collision-folder-source-${Date.now()}`)
    const destination = await createContainer(page, root, `copy-collision-folder-destination-${Date.now()}`)
    const source = await createContainer(page, sourceParent, 'folder')
    const existing = await createContainer(page, destination, 'folder')
    const sourceFile = new URL('nested.txt', source).toString()

    try {
      await createResource(page, source, 'nested.txt', 'nested source content', 'text/plain')
      await createResource(page, existing, 'existing.txt', 'existing content', 'text/plain')
      const sourceAcl = await authenticatedFetch(page, new URL('.acl', source).toString())
      expect([404, 410], `Unexpected source ACL response: ${sourceAcl.status}`).toContain(sourceAcl.status)
      await page.goto(`/browse.html?uri=${encodeURIComponent(destination)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-container')).toBeVisible()
      await dropUrl(page, source)
      await page.getByRole('button', { name: 'Keep both folders', exact: true }).click()
      await expectText(page, sourceFile, 'nested source content')

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-container')).toBeVisible()
      const copiedFolder = page.locator('folder-pane-container li[role="option"][about*="folder-copy-"]')
      await expect(copiedFolder).toBeVisible()
      const copiedFolderAbout = await copiedFolder.getAttribute('about')
      expect(copiedFolderAbout).toBeTruthy()
      const copiedFolderUrl = copiedFolderAbout!.slice(1, -1)
      await expectText(page, new URL('nested.txt', copiedFolderUrl).toString(), 'nested source content')
      await expect(page.getByRole('button', { name: 'Keep both folders', exact: true })).toHaveCount(0)
    } finally {
      await authenticatedFetch(page, sourceParent, { method: 'DELETE' })
      await authenticatedFetch(page, destination, { method: 'DELETE' })
    }
  })

  test('copies a container ACL sidecar when it is exposed as a member', async ({ page }) => {
    const root = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const source = await createContainer(page, root, `copy-sidecars-source-${Date.now()}`)
    const destination = await createContainer(page, root, `copy-sidecars-destination-${Date.now()}`)
    const copiedSource = new URL(source.split('/').slice(-2, -1)[0] + '/', destination).toString()
    const sidecars = [
      ['.acl', `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix : <${source}.acl#>.

:owner a acl:Authorization;
  acl:agentClass acl:AuthenticatedAgent;
  acl:accessTo <${source}>;
  acl:default <${source}>;
  acl:mode acl:Read, acl:Write, acl:Control.
`, 'text/turtle']
    ] as const

    try {
      for (const [name, contentType, type] of sidecars) {
        const response = await authenticatedFetch(page, new URL(name, source).toString(), {
          method: 'PUT',
          body: contentType,
          headers: { 'content-type': type }
        })
        expect(response.ok, `Could not write ${name}: ${response.status}`).toBeTruthy()
        await expectText(page, new URL(name, source).toString(), contentType)
      }
      await page.goto(`/browse.html?uri=${encodeURIComponent(destination)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-container')).toBeVisible()
      await dropUrl(page, source)
      for (const [name, content] of sidecars) {
        const expected = name === '.acl' ? content.replaceAll(source, copiedSource) : content
        await expectText(page, new URL(name, copiedSource).toString(), expected)
      }
      const copiedMeta = await authenticatedFetch(page, new URL('.meta', copiedSource).toString())
      expect(copiedMeta.ok, `Could not read recreated .meta: ${copiedMeta.status}`).toBeTruthy()
    } finally {
      for (const [name] of sidecars) {
        await authenticatedFetch(page, new URL(name, source).toString(), { method: 'DELETE' })
      }
      await authenticatedFetch(page, source, { method: 'DELETE' })
      await authenticatedFetch(page, destination, { method: 'DELETE' })
    }
  })
})
