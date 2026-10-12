import { request } from '@playwright/test'
import { readdir, readFile, rm } from 'node:fs/promises'
import { resolve, basename } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
const runtimeFile = resolve(process.env.E2E_ACCESS_CONTROL_RUNTIME_FILE || '.access-control-runtime.json')
const storageRoot = resolve(process.env.E2E_STORAGE_STATE_ROOT || 'storage-state')
const pivotDataRoot = process.env.E2E_PIVOT_DATA_ROOT
  ? resolve(process.env.E2E_PIVOT_DATA_ROOT)
  : null
const disposablePod = /^e2e-acl-(owner|viewer)-\d+-[a-z0-9]+$/
const disposableStorage = /^access-control-(owner|viewer)-\d+-[a-z0-9]+\.json$/

const warnings = []
const removed = []

function warn(message) {
  warnings.push(message)
  console.warn(`[access-control-cleanup] ${message}`)
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function storageFiles() {
  let names
  try {
    names = await readdir(storageRoot)
  } catch {
    return []
  }
  return names.filter((name) => disposableStorage.test(name)).map((name) => resolve(storageRoot, name))
}

function cookiesFrom(storageState) {
  return (storageState?.cookies || [])
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ')
}

async function cleanupSession(file) {
  const storageState = await readJson(file)
  if (!storageState) {
    warn(`Could not read storage state ${file}`)
    return
  }

  const cookieHeader = cookiesFrom(storageState)
  if (!cookieHeader) {
    warn(`Storage state has no cookies: ${file}`)
    return
  }

  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Cookie: cookieHeader } })
  try {
    const controlsResponse = await api.get('/.account/', { headers: { Accept: 'application/json' } })
    if (!controlsResponse.ok()) {
      warn(`Could not read account controls for ${file}: HTTP ${controlsResponse.status()}`)
      return
    }
    const { controls } = await controlsResponse.json()

    if (controls.account?.pod) {
      const podsResponse = await api.get(controls.account.pod, { headers: { Accept: 'application/json' } })
      if (podsResponse.ok()) {
        const { pods = {} } = await podsResponse.json()
        for (const [podUrl, deleteUrl] of Object.entries(pods)) {
          const podName = basename(new URL(podUrl).pathname.replace(/\/$/, ''))
          if (!disposablePod.test(podName)) continue
          const response = await api.delete(deleteUrl, { data: {} })
          if (response.ok()) removed.push(`pod ${podName}`)
          else warn(`Could not delete pod ${podName}: HTTP ${response.status()}`)
        }
      } else {
        warn(`Could not list pods for ${file}: HTTP ${podsResponse.status()}`)
      }
    }

    if (controls.password?.create) {
      const loginsResponse = await api.get(controls.password.create, { headers: { Accept: 'application/json' } })
      if (loginsResponse.ok()) {
        const { passwordLogins = {} } = await loginsResponse.json()
        for (const [email, deleteUrl] of Object.entries(passwordLogins)) {
          if (!email.startsWith('e2e-acl-')) continue
          const response = await api.delete(deleteUrl, { data: {} })
          if (response.ok()) removed.push(`login ${email}`)
          else warn(`Could not delete login ${email}: HTTP ${response.status()}`)
        }
      } else {
        warn(`Could not list password logins for ${file}: HTTP ${loginsResponse.status()}`)
      }
    }
  } finally {
    await api.dispose()
  }
}

async function removeLocalFixtures() {
  if (!pivotDataRoot) return
  let names
  try {
    names = await readdir(pivotDataRoot)
  } catch {
    return
  }
  for (const name of names.filter((entry) => disposablePod.test(entry))) {
    await rm(resolve(pivotDataRoot, name), { recursive: true, force: true })
    removed.push(`fixture ${name}`)
  }
}

async function main() {
  const runtime = await readJson(runtimeFile)
  const files = new Set(await storageFiles())
  for (const candidate of [runtime?.owner?.storageState, runtime?.viewer?.storageState]) {
    if (candidate && disposableStorage.test(basename(candidate))) files.add(resolve(candidate))
  }

  for (const file of files) await cleanupSession(file)
  await removeLocalFixtures()
  for (const file of files) {
    await rm(file, { force: true })
    removed.push(`storage ${file}`)
  }
  await rm(runtimeFile, { force: true })

  console.log(`[access-control-cleanup] Removed ${removed.length} resource(s).`)
  if (warnings.length) console.warn(`[access-control-cleanup] ${warnings.length} blocker(s) remain.`)
}

main().catch((error) => {
  console.error(`[access-control-cleanup] ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
