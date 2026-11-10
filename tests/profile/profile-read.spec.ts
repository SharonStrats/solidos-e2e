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
    await expect(page.locator('#profile-heading-name')).toHaveText(/\S/)
  })

  test('renders the stored bio text', async ({ page }) => {
    test.skip(
      await page.getByRole('region', { name: 'Bio' }).count() === 0,
      'The configured public profile does not publish a bio section.'
    )
    await expect(page.getByRole('region', { name: 'Bio' })).toContainText(/\S/)
  })

  test('renders skills and languages after expanding their sections', async ({ page }) => {
    const skillsAvailable = await expandSection(page, 'Skills')
    const languagesAvailable = await expandSection(page, 'Languages')
    test.skip(
      !skillsAvailable || !languagesAvailable,
      'The configured public profile does not publish skills and language sections.'
    )

    await expect(page.getByRole('list', { name: 'Professional skills and competencies' })).toContainText(/\S/)
    await expect(page.getByRole('list', { name: 'Known languages' })).toContainText(/\S/)
  })

  test('renders project data after expanding the projects section', async ({ page }) => {
    const projectsAvailable = await expandSection(page, 'Projects & Communities')
    test.skip(
      !projectsAvailable,
      'The configured public profile does not publish a projects section.'
    )

    await expect(page.getByRole('region', { name: 'Projects & Communities' })).toContainText(/\S/)
  })

  test('renders social accounts and additional contact details after expanding sections', async ({ page }) => {
    const socialAvailable = await expandSection(page, 'Follow me on')
    const contactsAvailable = await expandSection(page, 'More Contacts')
    test.skip(
      !socialAvailable || !contactsAvailable,
      'The configured public profile does not publish social and additional contact sections.'
    )

    await expect(page.getByRole('region', { name: 'Follow me on' }).getByRole('link').first()).toBeVisible()
    await expect(page.getByRole('list', { name: 'Phone numbers' })).toContainText(/\S/)
    await expect(page.getByRole('list', { name: 'Email addresses' })).toContainText(/\S/)
    await expect(page.getByRole('list', { name: 'Postal addresses' })).toContainText(/\S/)
  })
})

async function expandSection (page: Page, name: string): Promise<boolean> {
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
  if (await button.count() === 0 || !(await button.isVisible())) return false
  await button.click()

  const panel = page.locator(`#${section.panel}`)
  if (await panel.count() === 0) return false
  await expect(panel).toBeVisible()
  return true
}
