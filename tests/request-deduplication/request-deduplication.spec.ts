import { expect, test } from '../../fixtures/test.js'
import type { Page } from '@playwright/test'
import { authenticateProfileOwner } from '../../fixtures/authenticate-owner.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'

function documentUrl (value: string): string {
  const url = new URL(value)
  url.hash = ''
  url.search = ''
  return url.href
}

function countDocumentLoads (page: Page, target: string): {
  count: () => number
  stop: () => void
} {
  let count = 0
  const onRequest = (request: { method: () => string, resourceType: () => string, url: () => string }) => {
    if (
      request.method() === 'GET' &&
      ['fetch', 'xhr'].includes(request.resourceType()) &&
      documentUrl(request.url()) === target
    ) {
      count += 1
    }
  }
  page.on('request', onRequest)
  return {
    count: () => count,
    stop: () => page.off('request', onRequest)
  }
}

test.describe('client-side request deduplication', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_REQUEST_DEDUP !== 'true',
      'Set E2E_RUN_REQUEST_DEDUP=true to run request-deduplication coverage.'
    )
    test.skip(
      process.env.E2E_USE_LOCAL_RUNTIME !== 'true',
      'Run this coverage against the disposable local Solid runtime.'
    )
    await authenticateProfileOwner(page)
  })

  test('opening a folder loads its container document only once', async ({ page }) => {
    const runtime = getLocalRuntime()
    const tracker = countDocumentLoads(page, documentUrl(runtime.podUrl))
    try {
      await openFolderPane(page, runtime.podUrl)
      await expect(page.locator('folder-pane-container')).toBeVisible()
      await expect.poll(tracker.count, { timeout: 5_000 }).toBe(1)
    } finally {
      tracker.stop()
    }
  })

  test('loading the profile card concurrently performs one card GET', async ({ page }) => {
    const runtime = getLocalRuntime()
    const tracker = countDocumentLoads(page, documentUrl(runtime.profileUrl))
    try {
      await page.goto(`${runtime.profileUrl}#me`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/)
      await expect.poll(tracker.count, { timeout: 5_000 }).toBe(1)
    } finally {
      tracker.stop()
    }
  })
})
