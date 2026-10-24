import { test } from '@playwright/test'
import { authenticateProfileOwner } from '../fixtures/authenticate-owner.js'
import { resetLocalProfile } from '../fixtures/reset-local-profile.js'
test('probe friends', async ({ page }) => {
  test.setTimeout(90_000)
  page.on('console', m => { if (m.type() !== 'debug') console.log('[c]', m.type(), m.text().slice(0, 300)) })
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  await resetLocalProfile()
  await authenticateProfileOwner(page)
  console.log('=== LOGGED IN', page.url())
  await page.locator('solid-ui-account solid-ui-menu button[slot="trigger"]').click()
  const item = page.locator('solid-ui-account solid-ui-menu-item').filter({ hasText: 'Friends' }).first()
  console.log('=== item visible', await item.isVisible(), await item.evaluate(e => e.outerHTML.slice(0, 400)))
  await item.click()
  console.log('=== CLICKED')
  await page.waitForTimeout(6000)
  console.log('=== state', JSON.stringify(await page.evaluate(() => history.state)), page.url())
  console.log('=== tablists', await page.evaluate(() => [...document.querySelectorAll('[role=tablist]')].map(t => t.getAttribute('aria-label') + ' vis=' + ((t as HTMLElement).offsetParent !== null))))
  console.log('=== main', await page.evaluate(() => { const m = document.querySelector('main') || document.body; const walk = (e: Element, d: number): string => d > 5 ? '' : '  '.repeat(d) + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0,3).join('.') : '') + (getComputedStyle(e).display === 'none' ? ' [HIDDEN]' : '') + '\n' + [...e.children].slice(0, 8).map(c => walk(c, d + 1)).join(''); return walk(m, 0) }))
  console.log('=== provider', await page.evaluate(() => { const p = document.querySelector('solid-ui-file-explorer-provider') as any; return JSON.stringify({ outer: p?.outerHTML.slice(0, 600), shadow: p?.shadowRoot?.innerHTML.slice(0, 1500), props: p ? Object.keys(p).slice(0, 30) : null }) }))
  console.log('=== provstate', await page.evaluate(() => { const p = document.querySelector('solid-ui-file-explorer-provider') as any; return JSON.stringify({ openPane: typeof p.openPane, rel: p.relevantPanes?.map((x: any) => x.name), pane: p.pane?.name, subj: p.subjectUri, kids: p.childNodes.length }) }))
  console.log('=== roles', await page.evaluate(async () => { const UI = (window as any).UI; if (!UI) return 'no window.UI'; const t = new Promise(r => setTimeout(() => r('TIMEOUT 8s'), 8000)); const r = UI.login.getUserRoles().then((x: any) => 'resolved ' + JSON.stringify(x.map((n: any) => n.value)), (e: any) => 'rejected ' + e); return await Promise.race([r, t]) }))
  console.log('=== social nodes', await page.evaluate(() => document.querySelectorAll('.social-pane, [class*=social-primary]').length))
})
