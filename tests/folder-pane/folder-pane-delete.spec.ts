import { test, expect } from '../../fixtures/test.js'
import type { Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'

async function authenticatedFetch (page: Page, url: string, init: RequestInit = {}) {
  return page.evaluate(async ({ url, init }) => {
    const session = (window as typeof window & {
      SolidLogic?: {
        authSession?: {
          fetch?: (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>
          authFetch?: (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>
        }
      }
    }).SolidLogic?.authSession
    const fetch = session?.authFetch ?? session?.fetch
    if (!fetch) throw new Error('The folder-pane test has no authenticated Solid session.')
    const response = await fetch.call(session, url, init)
    return { status: response.status, ok: response.ok }
  }, { url, init })
}

test.describe('folder-pane deletion', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    test.skip(
      process.env.E2E_RUN_FOLDER_PANE !== 'true',
      'Set E2E_RUN_FOLDER_PANE=true to run folder-pane coverage.'
    )
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL
    test.skip(!containerUrl, 'Set E2E_FOLDER_PANE_CONTAINER_URL to run folder-pane coverage.')
    await authenticateProfileOwner(page)
    await openFolderPane(page, containerUrl!)
  })

  test('deletes an RDF resource from Under The Hood and removes it from the folder view', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-delete-${Date.now()}.ttl`
    const fileUrl = new URL(fileName, containerUrl).toString()
    const content = `<> <http://purl.org/dc/terms/title> "delete test ${fileName}" .`

    const created = await authenticatedFetch(page, containerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'text/turtle',
        slug: fileName
      },
      body: content
    })
    expect(created.ok, `Could not create ${fileUrl}: ${created.status}`).toBeTruthy()

    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await openFolderPane(page, containerUrl)
      const resource = page.locator(`folder-pane-container li[role="option"][about="<${fileUrl}>"]`)
      await expect(resource).toBeVisible()
      await resource.click()

      const provider = page.locator('folder-pane-content > solid-ui-file-explorer-provider')
      await expect(provider).toHaveCount(1)
      const actionsMenu = provider.locator('solid-ui-resource-actions-menu').first()
      await actionsMenu.getByTitle('More options').click()
      await actionsMenu.getByRole('menuitem', { name: 'Under The Hood', exact: true }).click()

      const deleteControl = provider.locator('.internalPaneDeleteButton')
      await expect(deleteControl).toBeVisible()
      await deleteControl.click()
      const dialog = page.locator('solid-panes-resource-action-dialog')
      const nativeDialog = dialog.getByRole('dialog', { name: 'Delete resource', exact: true })
      await expect(nativeDialog).toBeVisible()
      await expect(nativeDialog).toHaveAccessibleDescription(`Are you sure you want to delete <${fileUrl}>? This cannot be undone.`)
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
      await expect(cancel).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(dialog).toHaveCount(0)
      await expect(deleteControl).toBeFocused()
      expect((await authenticatedFetch(page, fileUrl)).ok).toBeTruthy()

      await deleteControl.click()
      await expect(cancel).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(deleteControl).toBeFocused()

      await deleteControl.click()
      await expect(cancel).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(cancel).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused()
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(deleteControl).toBeFocused()

      await deleteControl.click()
      await expect(cancel).toBeFocused()
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

      await expect(dialog.getByRole('heading', { name: 'Resource deleted', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeFocused()
      await dialog.getByRole('button', { name: 'OK', exact: true }).click()
      await expect.poll(async () => (await authenticatedFetch(page, fileUrl)).status)
        .toBe(404)
      await expect(resource).toHaveCount(0)
    } finally {
      const response = await authenticatedFetch(page, fileUrl, { method: 'DELETE' })
      expect(
        response.ok || response.status === 404,
        `Could not clean up ${fileUrl}: ${response.status}`
      ).toBeTruthy()
    }
  })
})
