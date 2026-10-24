import { expect, type Page } from '@playwright/test'
import { getLocalRuntime } from './local-runtime.js'

export async function openFolderPane(page: Page, containerUrl: string): Promise<void> {
  const runtime = getLocalRuntime()
  if (containerUrl !== runtime.podUrl) {
    throw new Error(
      `Folder-pane local E2E requires the disposable pod root (${runtime.podUrl}), received ${containerUrl}.`
    )
  }

  const accountMenu = page.locator('solid-ui-account > solid-ui-menu')
  await accountMenu.locator('> button[type="button"]').click()
  const storageItems = accountMenu.getByRole('menuitem', { name: /^Storage(?: \d+)?$/ })
  const storageCount = await storageItems.count()

  for (let index = 0; index < storageCount; index++) {
    await storageItems.nth(index).click()
    await expect(page.locator('folder-pane-view')).toHaveCount(1)
    const selectedStorage = await page.locator('folder-pane-view').evaluate(
      (element: Element) => (element as HTMLElement & { subject?: { value?: string } }).subject?.value
    )
    if (selectedStorage === runtime.podUrl) {
      await expect(page.locator('folder-pane-container')).toHaveCount(1)
      return
    }
    await accountMenu.locator('> button[type="button"]').click()
  }

  throw new Error(`The account menu does not expose the disposable storage ${runtime.podUrl}.`)
}
