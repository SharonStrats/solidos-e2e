import { chromium } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
if (process.env.E2E_EXTERNAL_SERVER === 'true' || !/^https?:\/\/localhost:3100\/?$/.test(baseURL)) {
  throw new Error('setup:local is only for the disposable localhost:3100 runtime; use E2E_* credentials/profile variables for an external server')
}
const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
const email = process.env.E2E_TEST_EMAIL || `e2e-${runId}@localhost.test`
const password = process.env.E2E_TEST_PASSWORD || `E2e-${randomBytes(12).toString('base64url')}!`
const podName = process.env.E2E_TEST_POD_NAME || `e2e-${runId}`
const viewerEmail = process.env.E2E_VIEWER_USERNAME || `e2e-viewer-${runId}@localhost.test`
const viewerPassword = process.env.E2E_VIEWER_PASSWORD || `E2e-${randomBytes(12).toString('base64url')}!`
const viewerPodName = process.env.E2E_VIEWER_POD_NAME || `e2e-viewer-${runId}`
const pivotDataRoot = process.env.E2E_PIVOT_DATA_ROOT || resolve('../pivot/data')

function profileFixture(webId, issuer, podUrl) {
  const profileDocument = webId.replace(/#me$/, '')
  const preferencesUrl = new URL('settings/prefs.ttl', podUrl).toString()
  return `
<${profileDocument}>
    a foaf:PersonalProfileDocument;
    foaf:maker <${webId}>;
    foaf:primaryTopic <${webId}>.

<${webId}>
    a foaf:Person;
    vcard:fn "E2E Test Profile";
    foaf:name "E2E Test Profile";
    vcard:note "Seeded profile used by SolidOS Playwright tests.";
    schema:knowsLanguage (
      [ solid:publicId <https://www.w3.org/ns/iana/language-code/en> ]
      [ solid:publicId <https://www.w3.org/ns/iana/language-code/es> ]
    );
    foaf:account (
      <#e2e-github>
      <#e2e-facebook>
    );
    solid:preferredSubjectPronoun "They";
    solid:preferredObjectPronoun "Them";
    pim:storage <${podUrl}>;
    pim:preferencesFile <${preferencesUrl}>;
    solid:oidcIssuer <${issuer}/>.

<#e2e-github>
    a <https://solidos.github.io/profile-pane/src/ontology/socialMedia.ttl#GithubAccount>;
    foaf:name "GitHub";
    foaf:accountName "e2e-github".

<#e2e-facebook>
    a <https://solidos.github.io/profile-pane/src/ontology/socialMedia.ttl#FacebookAccount>;
    foaf:name "Facebook";
    foaf:accountName "e2e-facebook".
`
}

function log(message) {
  console.log(`[e2e-setup ${new Date().toISOString()}] ${message}`)
}

async function main() {
  log(`Starting disposable local setup against ${baseURL}`)
  log(`Using email ${email} and pod ${podName}`)
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    page.on('console', (message) => log(`Browser console ${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => log(`Browser page error: ${error.message}`))
    page.on('requestfailed', (request) => log(`Request failed ${request.method()} ${request.url()} (${request.failure()?.errorText || 'unknown error'})`))
    page.on('response', (response) => {
      if (response.status() >= 400) log(`HTTP ${response.status()} ${response.request().method()} ${response.url()}`)
    })

    log('Opening local account registration')
    await page.goto(`${baseURL}/.account/login/password/register/`, { waitUntil: 'domcontentloaded' })
    log(`Registration page loaded: ${page.url()}`)
    await page.getByLabel('Email:', { exact: true }).fill(email)
    await page.getByLabel('Password:', { exact: true }).fill(password)
    await page.getByLabel('Confirm password:', { exact: true }).fill(password)
    log('Submitting registration form')
    await page.getByRole('button', { name: 'Register' }).click()
    await page.waitForURL('**/.account/account/**')
    log(`Registration complete; account page loaded: ${page.url()}`)

    await page.waitForFunction(() => Boolean(document.querySelector('#createPod')?.getAttribute('href')))
    log('Opening create-pod flow')
    await page.locator('#createPod[href]').click()
    const podNameInput = page.getByLabel('Name', { exact: true })
    await podNameInput.waitFor({ state: 'visible' })
    await podNameInput.fill(podName)
    log('Submitting create-pod form')
    await page.getByRole('button', { name: 'Create pod' }).click()

    const podLink = page.locator('#response-podBaseUrl')
    const webIdLink = page.locator('#response-webId')
    await podLink.waitFor({ state: 'visible' })
    await webIdLink.waitFor({ state: 'visible' })
    const podUrl = await podLink.getAttribute('href')
    const webId = await webIdLink.getAttribute('href')
    if (!podUrl || !webId) {
      throw new Error('Local identity provider did not return a pod URL and registered WebID')
    }
    log(`Pod created: ${podUrl}`)
    log(`WebID created: ${webId}`)
    const profileUrl = new URL('profile/card', podUrl.endsWith('/') ? podUrl : `${podUrl}/`).toString()
    const preferencesUrl = new URL('settings/prefs.ttl', podUrl).toString()
    // The server-side ACL suite needs a real second identity. Keep this
    // account disposable and only persist its credentials in runtime state.
    const viewerPage = await (await browser.newContext()).newPage()
    await viewerPage.goto(`${baseURL}/.account/login/password/register/`, { waitUntil: 'domcontentloaded' })
    await viewerPage.getByLabel('Email:', { exact: true }).fill(viewerEmail)
    await viewerPage.getByLabel('Password:', { exact: true }).fill(viewerPassword)
    await viewerPage.getByLabel('Confirm password:', { exact: true }).fill(viewerPassword)
    await viewerPage.getByRole('button', { name: 'Register' }).click()
    await viewerPage.waitForURL('**/.account/account/**')
    await viewerPage.waitForFunction(() => Boolean(document.querySelector('#createPod')?.getAttribute('href')))
    await viewerPage.locator('#createPod[href]').click()
    await viewerPage.getByLabel('Name', { exact: true }).fill(viewerPodName)
    await viewerPage.getByRole('button', { name: 'Create pod' }).click()
    const viewerPodLink = viewerPage.locator('#response-podBaseUrl')
    const viewerWebIdLink = viewerPage.locator('#response-webId')
    await viewerPodLink.waitFor({ state: 'visible' })
    await viewerWebIdLink.waitFor({ state: 'visible' })
    const viewerPodUrl = await viewerPodLink.getAttribute('href')
    const viewerWebId = await viewerWebIdLink.getAttribute('href')
    if (!viewerPodUrl || !viewerWebId) {
      throw new Error('Local identity provider did not return the disposable viewer pod and WebID')
    }
    await viewerPage.context().close()
    const profileFile = pivotDataRoot
      ? resolve(pivotDataRoot, podName, 'profile', 'card$.ttl')
      : null
    const storageState = resolve('storage-state', `local-${runId}.json`)
    await mkdir(resolve('storage-state'), { recursive: true })
    await context.storageState({ path: storageState })
    await writeFile(runtimeFile, JSON.stringify({
      baseURL,
      email,
      password,
      viewerEmail,
      viewerPassword,
      viewerPodName,
      viewerPodUrl,
      viewerWebId,
      podName,
      podUrl,
      webId,
      profileUrl,
      storageState,
      profileFile,
      seeded: false,
      createdAt: new Date().toISOString()
    }, null, 2))
    log(`Saved pre-auth runtime state to ${runtimeFile}`)

    if (!pivotDataRoot) {
      throw new Error('Set E2E_PIVOT_DATA_ROOT to seed the local Pivot profile fixture; runtime state was saved for cleanup')
    }

    await mkdir(resolve(profileFile, '..'), { recursive: true })
    await writeFile(profileFile, `@prefix foaf: <http://xmlns.com/foaf/0.1/>.\n@prefix pim: <http://www.w3.org/ns/pim/space#>.\n@prefix schema: <http://schema.org/>.\n@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.\n${profileFixture(webId, baseURL.replace(/\/$/, ''), podUrl)}`)
    log(`Seeded profile fixture at ${profileFile}`)

    log(`Opening seeded profile before authentication: ${profileUrl}#me`)
    await page.goto(`${profileUrl}#me`, { waitUntil: 'domcontentloaded' })
    log(`Profile page loaded before authentication: ${page.url()}`)
    await page.evaluate(({ issuer, redirectUrl }) => window.SolidLogic.authSession.login(issuer, redirectUrl), {
      issuer: `${baseURL.replace(/\/$/, '')}/`,
      redirectUrl: profileUrl
    })
    log('Local identity-provider login started')
    await page.waitForURL((url) =>
      url.pathname.startsWith('/.account/login/password/') ||
      url.pathname.startsWith('/.account/oidc/consent/')
    )
    log(`Identity-provider flow reached: ${page.url()}`)
    if (page.url().includes('/.account/login/password/')) {
      log('Submitting local identity-provider login')
      await page.getByLabel('Email / username', { exact: true }).fill(email)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await page.waitForURL('**/.account/oidc/consent/**')
      log(`Identity-provider login accepted; consent page loaded: ${page.url()}`)
    }
    await page.locator('#authorize:not([disabled])').waitFor({ state: 'visible' })
    log('Consent authorize button is enabled')
    await page.getByRole('button', { name: 'Authorize', exact: true }).click()
    log('Submitted authorization consent')
    await page.waitForURL((url) => url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/.account/'))
    log(`Returned to application after authorization: ${page.url()}`)
    await page.waitForFunction(async ({ expectedWebId, resourceUrl }) => {
      const session = window.SolidLogic?.authSession
      const authenticatedFetch = session?.authFetch || session?.fetch
      if (!session?.info?.isLoggedIn || session.info.webId !== expectedWebId || !authenticatedFetch) {
        return false
      }
      const response = await authenticatedFetch.call(session, resourceUrl)
      return response.ok
    }, { expectedWebId: webId, resourceUrl: profileUrl })
    log('Authenticated OIDC session can read the disposable profile')

    await page.goto(`${profileUrl}#me`, { waitUntil: 'domcontentloaded' })
    log(`Reloaded authenticated profile: ${page.url()}`)
    await selectFolderPaneAudiences(page, preferencesUrl)

    await context.storageState({ path: storageState })
    await writeFile(runtimeFile, JSON.stringify({
      baseURL,
      email,
      password,
      viewerEmail,
      viewerPassword,
      viewerPodName,
      viewerPodUrl,
      viewerWebId,
      podName,
      podUrl,
      webId,
      profileUrl,
      preferencesUrl,
      storageState,
      profileFile,
      seeded: true,
      authenticated: true,
      createdAt: new Date().toISOString()
    }, null, 2))
    log(`Saved authenticated storage state to ${storageState}`)

    console.log(`Created disposable WebID: ${webId}`)
    console.log(`Seeded profile: ${profileUrl}`)
    console.log(`Runtime state: ${runtimeFile}`)
  } finally {
    await browser.close()
  }
}

async function selectFolderPaneAudiences (page, preferencesUrl) {
  log('Opening Preferences from the authenticated account menu')
  await page.locator('solid-ui-account > solid-ui-menu > button[type="button"]').click()
  await page.getByText('Preferences', { exact: true }).click()
  await page.getByRole('heading', { name: 'User types', exact: true }).waitFor()

  const userTypes = page.locator('.classifierBox select[multiple]')
  await userTypes.waitFor({ state: 'visible' })
  const audienceValues = await userTypes.locator('option').evaluateAll(options =>
    options
      .filter(option => /^(power user|developer)$/i.test(option.textContent?.trim() || ''))
      .map(option => option.getAttribute('value') || option.textContent?.trim() || '')
  )
  if (audienceValues.length !== 2) {
    throw new Error(`Preferences UI did not expose Power User and Developer options: ${await userTypes.locator('option').allTextContents()}`)
  }
  await userTypes.selectOption(audienceValues)

  await page.waitForFunction(async (url) => {
    const session = window.SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch || session?.fetch
    const response = await authenticatedFetch?.call(session, url)
    if (!response?.ok) return false
    const turtle = await response.text()
    return turtle.includes('PowerUser') && turtle.includes('Developer')
  }, preferencesUrl)
  log('Persisted Power User and Developer audiences through Preferences')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
