import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { createContainer } from '../../fixtures/folder-pane.js'

// Temporary release verification for the Sharing-pane menu wiring.
test.describe('Sharing pane release verification', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to a readable non-empty container.')
    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl!)
  })

  test('opens Sharing from the storage-header three-dot menu for Home', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const actions = page.locator('folder-pane-storage-header solid-ui-resource-actions-menu')

    await actions.getByTitle('More options').click()
    await actions.getByRole('menuitem', { name: 'Manage Access', exact: true }).click()
    await expectSharingPane(page, containerUrl)
  })

  test('opens Sharing from grid and list resource menus for an indexed folder', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const indexedFolderUrl = await createIndexedFolder(page, containerUrl)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    await openResourceSharingMenu(page, indexedFolderUrl)
    await expectSharingPane(page, indexedFolderUrl)

    await openFolderPane(page, containerUrl)
    await page.locator('folder-pane-storage-header').getByRole('button', { name: 'List view' }).click()
    await openResourceSharingMenu(page, indexedFolderUrl)
    await expectSharingPane(page, indexedFolderUrl)
  })

  test('opens Sharing from the shared file-explorer header control', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileUrl = new URL(`sharing-pane-release-${Date.now()}.txt`, containerUrl).toString()
    await putTextResource(page, fileUrl)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    await page.locator(`folder-pane-container li[role="option"][about="<${fileUrl}>"]`).click()

    const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
    await expect(provider).toHaveCount(1)
    const headerControls = provider.locator('solid-ui-file-explorer-header-controls')
    await expect(headerControls.getByTitle('Manage Access')).toBeVisible()
    await headerControls.getByTitle('Manage Access').click()
    await expectSharingPane(page, fileUrl)
  })
})

async function openResourceSharingMenu (page: Parameters<typeof openFolderPane>[0], resourceUrl: string) {
  const resource = page.locator(`folder-pane-container li[role="option"][about="<${resourceUrl}>"]`)
  await expect(resource).toHaveCount(1)
  const actions = resource.locator('solid-ui-resource-actions-menu')
  await actions.getByTitle('More options').click()
  await actions.getByRole('menuitem', { name: 'Manage Access', exact: true }).click()
}

async function expectSharingPane (page: Parameters<typeof openFolderPane>[0], subjectUri: string) {
  const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
  await expect(provider).toHaveCount(1)
  await expect.poll(() => provider.evaluate(element =>
    (element as HTMLElement & { pane?: { name?: string } }).pane?.name || null
  )).toBe('sharing')
  await expect.poll(() => provider.evaluate(element =>
    (element as HTMLElement & { subjectUri?: string }).subjectUri || null
  )).toBe(subjectUri)
}

async function createIndexedFolder (page: Parameters<typeof openFolderPane>[0], parentUrl: string) {
  const folderUrl = await createContainer(page, parentUrl, `sharing-pane-indexed-${Date.now()}`)
  const indexUrl = new URL('index.ttl', folderUrl).toString()
  await putTextResource(page, indexUrl, `<${indexUrl}#this> a <http://www.w3.org/2005/01/wtf/>, <http://www.w3.org/ns/ldp#Resource>.\n`, 'text/turtle')
  return folderUrl
}

async function putTextResource (
  page: Parameters<typeof openFolderPane>[0],
  resourceUrl: string,
  body = 'Sharing pane release verification.\n',
  contentType = 'text/plain'
) {
  const ok = await page.evaluate(async ({ resourceUrl, body, contentType }) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('No authenticated session available.')
    const response = await authenticatedFetch.call(session, resourceUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body
    })
    return response.ok
  }, { resourceUrl, body, contentType })
  expect(ok, `Unable to seed ${resourceUrl}`).toBe(true)
}
