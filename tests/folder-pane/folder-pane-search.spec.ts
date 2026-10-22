import { test, expect } from '../../fixtures/test.js'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'
import { seedSearchFolderPaneCase, type SearchFolderPaneCase } from '../../fixtures/folder-pane.js'

test.describe.skip('folder-pane storage search', () => {
  let containerUrl: string
  let searchCase: SearchFolderPaneCase

  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )

    containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL || ''
    test.skip(
      !containerUrl,
      'Set E2E_FOLDER_PANE_CONTAINER_URL to a readable container containing the search resources.'
    )
    if (!containerUrl) return

    await authenticateProfileOwner(page)
    searchCase = await seedSearchFolderPaneCase(page, containerUrl)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openFolderPane(page, containerUrl)
    await expect(page.locator('folder-pane-storage-header input[aria-label="Search"]')).toHaveCount(1)
  })

  function searchInput (page: import('@playwright/test').Page) {
    return page.locator('folder-pane-storage-header input[aria-label="Search"]')
  }

  function options (page: import('@playwright/test').Page) {
    return page.locator('folder-pane-container li[role="option"]')
  }

  test('exposes the storage-header search input and filters resources case-insensitively', async ({ page }) => {
    await expect(searchInput(page)).toBeVisible()
    await searchInput(page).fill('  ALPHA  ')

    await expect.poll(() => options(page).count()).toBeGreaterThan(0)
    await expect(options(page).filter({ hasText: 'Alpha' })).toHaveCount(1)
    await expect(options(page).filter({ hasText: 'Beta' })).toHaveCount(0)
  })

  test('shows a no-results state for a non-matching query', async ({ page }) => {
    await searchInput(page).fill(`does-not-exist-${Date.now()}`)
    await expect(page.getByText('No resources match this search.', { exact: true })).toBeVisible()
    await expect(options(page)).toHaveCount(0)
  })

  test('clearing search restores all resources', async ({ page }) => {
    await expect.poll(() => options(page).count()).toBeGreaterThan(0)
    const initialCount = await options(page).count()
    await searchInput(page).fill('Alpha')
    await expect.poll(() => options(page).count()).toBeGreaterThan(0)
    await searchInput(page).fill('')
    await expect(options(page)).toHaveCount(initialCount)
    await expect(page.getByText('No resources match this search.', { exact: true })).toHaveCount(0)
  })

  test('selects a resource from filtered results and clears the search', async ({ page }) => {
    await searchInput(page).fill('Beta')
    const result = page.locator(`folder-pane-container li[role="option"][about="<${searchCase.betaUrl}>"]`)
    await expect(result).toHaveCount(1)
    await result.click()

    await expect(searchInput(page)).toHaveValue('')
    await expect(page.locator('folder-pane-content > solid-ui-file-explorer-provider')).toHaveCount(1)
  })

  test('treats whitespace-only search as the known empty-query edge case', async ({ page }) => {
    await expect.poll(() => options(page).count()).toBeGreaterThan(0)
    const initialCount = await options(page).count()
    await searchInput(page).fill('   ')
    await expect(options(page)).toHaveCount(initialCount)
    await expect(page.getByText('No resources match this search.', { exact: true })).toHaveCount(0)
  })
})
