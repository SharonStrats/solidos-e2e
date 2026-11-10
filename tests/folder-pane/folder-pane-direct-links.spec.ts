import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { createContainer, createResource } from '../../fixtures/folder-pane.js'

async function deleteResource (page: Parameters<typeof createResource>[0], resourceUrl: string) {
  await page.evaluate(async (url) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('The direct-link test has no authenticated Solid session.')
    await authenticatedFetch.call(session, url, { method: 'DELETE' })
  }, resourceUrl)
}

test.describe('folder-pane direct links', () => {
  test.beforeEach(async () => {
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    test.skip(
      !process.env.E2E_FOLDER_PANE_CONTAINER_URL,
      'Set E2E_FOLDER_PANE_CONTAINER_URL to run folder-pane coverage.'
    )
  })

  test('renders a direct container with the storage header and no explorer chrome', async ({ page }) => {
    await authenticateProfileOwner(page)
    const storageUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const containerUrl = await createContainer(page, storageUrl, `direct-public-${Date.now()}`)

    try {
      await page.goto(containerUrl, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-storage-header')).toHaveCount(1)
      await expect(page.locator('folder-pane-container')).toHaveCount(1)
      const storageHeader = page.locator('folder-pane-storage-header')
      await expect(storageHeader.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
      await expect(storageHeader.getByText(new URL(containerUrl).pathname.split('/').filter(Boolean).pop()!, { exact: true })).toBeVisible()
      await expect(page.locator('solid-ui-button[aria-label="Grid view"]')).toBeVisible()
      await expect(page.locator('solid-ui-button[aria-label="List view"]')).toBeVisible()
      await storageHeader.getByRole('button', { name: 'Home', exact: true }).click()
      await expect(storageHeader.locator('[aria-current="page"]')).toHaveText('Home')
      await expect(page.locator('folder-pane-sidebar')).toHaveCount(0)
      await expect(page.locator('solid-ui-file-explorer-header')).toHaveCount(0)
    } finally {
      await deleteResource(page, containerUrl)
    }
  })

  test('keeps the explorer header for a direct file but hides its in-app Back control', async ({ page }) => {
    await authenticateProfileOwner(page)
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const slug = `folder-pane-direct-link-${Date.now()}.js`
    const fileUrl = new URL(slug, containerUrl).toString()
    await createResource(page, containerUrl, slug, 'export const directLink = true\n', 'text/javascript')

    try {
      await page.goto(fileUrl, { waitUntil: 'domcontentloaded' })
      const header = page.locator('solid-ui-file-explorer-header')
      await expect(header).toHaveCount(1)
      await expect(header.locator('solid-ui-file-explorer-header-summary')).toHaveCount(1)
      await expect(header.locator('solid-ui-file-explorer-header-summary').getByTitle('Back')).toHaveCount(0)
    } finally {
      await deleteResource(page, fileUrl)
    }
  })

  test('keeps the Back control when a file is opened from the container view', async ({ page }) => {
    await authenticateProfileOwner(page)
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const slug = `folder-pane-in-app-link-${Date.now()}.js`
    const fileUrl = new URL(slug, containerUrl).toString()
    await createResource(page, containerUrl, slug, 'export const inAppLink = true\n', 'text/javascript')

    try {
      await page.goto(containerUrl, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('folder-pane-container')).toHaveCount(1)
      await page.locator(`folder-pane-container li[role="option"][about="<${fileUrl}>"]`).click()

      const header = page.locator('solid-ui-file-explorer-header')
      await expect(header).toHaveCount(1)
      await expect(header.locator('solid-ui-file-explorer-header-summary').getByTitle('Back')).toBeVisible()
    } finally {
      await deleteResource(page, fileUrl)
    }
  })
})
