import { test, expect } from '../../fixtures/test.js'
import type { Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { createContainer } from '../../fixtures/folder-pane.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'

async function deleteResource (page: Page, url: string) {
  await page.evaluate(async (resourceUrl) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (authenticatedFetch) await authenticatedFetch.call(session, resourceUrl, { method: 'DELETE' })
  }, url)
}

async function expectUploadedResource (page: Page, url: string, content: string) {
  await expect.poll(async () => page.evaluate(async ({ url: resourceUrl }) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) return null
    const response = await authenticatedFetch.call(session, resourceUrl)
    return response.ok ? response.text() : null
  }, { url })).toBe(content)
}

test.describe('folder-pane uploads', () => {
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

  test('uploads a file from the storage header Add menu', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-header-upload-${Date.now()}.txt`
    const fileUrl = new URL(fileName, containerUrl).toString()
    const content = `header upload ${fileName}`

    try {
      const header = page.locator('folder-pane-storage-header')
      await header.locator('button[aria-label="Add"]').click()
      const uploadItem = page.getByRole('menuitem', { name: 'Upload', exact: true })
      await expect(uploadItem).toBeVisible()

      const fileChooser = page.waitForEvent('filechooser')
      await uploadItem.click()
      await (await fileChooser).setFiles({
        name: fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(content)
      })

      await expectUploadedResource(page, fileUrl, content)
    } finally {
      await deleteResource(page, fileUrl)
    }
  })

  test('uploads files dropped onto the folder container', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const fileName = `folder-pane-drop-upload-${Date.now()}.txt`
    const fileUrl = new URL(fileName, containerUrl).toString()
    const content = `drop upload ${fileName}`

    try {
      const target = page.locator('folder-pane-container .folder-pane-container-content')
      await expect(target).toBeVisible()
      await expect.poll(() => page.locator('folder-pane-container').evaluate(element =>
        (element as HTMLElement & { canUpload?: boolean }).canUpload
      )).toBe(true)
      await target.evaluate((element, payload) => {
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(new File([payload.content], payload.name, { type: 'text/plain' }))
        element.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer
        }))
      }, { name: fileName, content })
      await expectUploadedResource(page, fileUrl, content)
    } finally {
      await deleteResource(page, fileUrl)
    }
  })

  test('uploads a file dropped onto an empty folder container', async ({ page }) => {
    const containerUrl = process.env.E2E_FOLDER_PANE_CONTAINER_URL!
    const folderName = `folder-pane-empty-drop-${Date.now()}`
    const emptyContainerUrl = await createContainer(page, containerUrl, folderName)
    const fileName = 'empty-container-drop.txt'
    const fileUrl = new URL(fileName, emptyContainerUrl).toString()
    const content = `empty container upload ${folderName}`

    try {
      await page.goto(`/browse.html?uri=${encodeURIComponent(emptyContainerUrl)}`, {
        waitUntil: 'domcontentloaded'
      })
      await expect(page.locator('folder-pane-container')).toBeVisible()
      await expect(page.getByText('This folder is empty', { exact: true })).toBeVisible()

      const target = page.locator('folder-pane-container .folder-pane-container-content')
      await expect.poll(() => page.locator('folder-pane-container').evaluate(element =>
        (element as HTMLElement & { canUpload?: boolean }).canUpload
      )).toBe(true)
      await target.evaluate((element, payload) => {
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(new File([payload.content], payload.name, { type: 'text/plain' }))
        element.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer
        }))
      }, { name: fileName, content })

      await expectUploadedResource(page, fileUrl, content)
    } finally {
      await deleteResource(page, fileUrl)
      await deleteResource(page, emptyContainerUrl)
    }
  })
})
