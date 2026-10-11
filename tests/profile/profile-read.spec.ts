import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/test.js'

const profileUrl = process.env.E2E_PROFILE_URL

test.describe('profile pane read scenarios', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_PROFILE_READS !== 'true',
      'Set E2E_RUN_PROFILE_READS=true to run profile coverage.'
    )
    test.skip(
      !profileUrl,
      'Set E2E_PROFILE_URL to run profile coverage.'
    )
    if (!profileUrl) return
    await page.goto(profileUrl)
  })

  test('renders the public profile heading and primary contact details', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/)
  })

  test('renders the stored bio text', async ({ page }) => {
    await expect(page.getByRole('region', { name: 'Bio' })).toContainText(/\S/)
  })

  test('renders skills and languages after expanding their sections', async ({ page }) => {
    await expandSection(page, 'Skills')
    await expandSection(page, 'Languages')

    await expect(page.getByRole('list', { name: 'Professional skills and competencies' })).toContainText(/\S/)
    await expect(page.getByRole('list', { name: 'Known languages' })).toContainText(/\S/)
  })

  test('renders project data after expanding the projects section', async ({ page }) => {
    await expandSection(page, 'Projects & Communities')

    await expect(page.getByRole('region', { name: 'Projects & Communities' })).toContainText(/\S/)
  })

  test('renders social accounts and additional contact details after expanding sections', async ({ page }) => {
    await expandSection(page, 'Follow me on')
    await expandSection(page, 'More Contacts')

    await expect(page.getByRole('region', { name: 'Follow me on' }).getByRole('link').first()).toBeVisible()
    await expect(page.getByRole('list', { name: 'Phone numbers' })).toContainText(/\S/)
    await expect(page.getByRole('list', { name: 'Email addresses' })).toContainText(/\S/)
    await expect(page.getByRole('list', { name: 'Postal addresses' })).toContainText(/\S/)
  })
})

async function expandSection (page: Page, name: string): Promise<void> {
  const sections: Record<string, { button: string, panel: string }> = {
    Skills: { button: 'Toggle skills section', panel: 'skills-panel' },
    Languages: { button: 'Toggle languages section', panel: 'languages-panel' },
    'Projects & Communities': { button: 'Toggle projects section', panel: 'projects-panel' },
    'Follow me on': { button: 'Toggle social accounts section', panel: 'social-panel' },
    'More Contacts': { button: 'Toggle contact information section', panel: 'contact-details-panel' }
  }
  const section = sections[name]
  if (!section) throw new Error(`Unknown profile section: ${name}`)

  const button = page.getByLabel(section.button)
  if (await button.isVisible()) {
    await button.click()
  }

  const panel = page.locator(`#${section.panel}`)
  if (await panel.count()) {
    await expect(panel).toBeVisible()
  }
}
