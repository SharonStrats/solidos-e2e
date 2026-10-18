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
  await accountMenu.getByText('Storage', { exact: true }).click()
  await expect(page.locator('folder-pane-container')).toHaveCount(1)
}
