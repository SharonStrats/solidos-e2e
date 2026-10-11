import { chromium } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`
const email = process.env.E2E_TEST_EMAIL || `e2e-${runId}@localhost.test`
const password = process.env.E2E_TEST_PASSWORD || `E2e-${randomBytes(12).toString('base64url')}!`
const podName = process.env.E2E_TEST_POD_NAME || `e2e-${runId}`
const pivotDataRoot = process.env.E2E_PIVOT_DATA_ROOT

function profileFixture(webId, issuer) {
  const profileDocument = webId.replace(/#me$/, '')
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

    await page.locator('#createPod[href]').waitFor({ state: 'attached' })
    log('Opening create-pod flow')
    await page.locator('#createPod[href]').click()
    await page.getByLabel('Name').fill(podName)
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
    await writeFile(profileFile, `@prefix foaf: <http://xmlns.com/foaf/0.1/>.\n@prefix schema: <http://schema.org/>.\n@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.\n${profileFixture(webId, baseURL.replace(/\/$/, ''))}`)
    log(`Seeded profile fixture at ${profileFile}`)

    log(`Opening seeded profile before authentication: ${profileUrl}#me`)
    await page.goto(`${profileUrl}#me`, { waitUntil: 'domcontentloaded' })
    log(`Profile page loaded before authentication: ${page.url()}`)
    await page.getByRole('button', { name: 'Log In', exact: true }).click()
    log('Login dialog opened')
    await page.getByRole('heading', { name: 'Select an identity provider' }).waitFor()
    await page.getByRole('button', { name: 'Login', exact: true }).click()
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
    const authenticatedProfileFetch = page.waitForResponse((response) =>
      response.url() === profileUrl && response.ok()
    )
    await page.getByRole('button', { name: 'Authorize', exact: true }).click()
    log('Submitted authorization consent')
    await page.waitForURL((url) => url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/.account/'))
    log(`Returned to application after authorization: ${page.url()}`)
    await authenticatedProfileFetch
    log('Authenticated profile response received')
    await page.waitForTimeout(5_000)
    await page.goto(`${profileUrl}#me`, { waitUntil: 'networkidle' })
    log(`Reloaded authenticated profile: ${page.url()}`)
    await page.getByLabel('Add or edit heading information').waitFor()
    log('Authenticated profile UI is ready')

    await context.storageState({ path: storageState })
    await writeFile(runtimeFile, JSON.stringify({
      baseURL,
      email,
      password,
      podName,
      podUrl,
      webId,
      profileUrl,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
