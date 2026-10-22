import { request } from '@playwright/test'
import { readdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')
const pivotDataRoot = process.env.E2E_PIVOT_DATA_ROOT

async function main() {
  const runtime = JSON.parse(await readFile(runtimeFile, 'utf8'))
  const storageState = JSON.parse(await readFile(runtime.storageState, 'utf8'))
  const cookies = storageState.cookies || []
  const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Cookie: cookieHeader }
  })

  let cleanupWarning = ''
  try {
    const controlsResponse = await api.get('/.account/', {
      headers: { Accept: 'application/json' }
    })
    if (!controlsResponse.ok()) {
      throw new Error(`Could not read local account controls: HTTP ${controlsResponse.status()}`)
    }

    const { controls } = await controlsResponse.json()
    if (controls.account?.pod) {
      const podsResponse = await api.get(controls.account.pod, {
        headers: { Accept: 'application/json' }
      })
      if (podsResponse.ok()) {
        const { pods = {} } = await podsResponse.json()
        const podEntries = process.env.E2E_CLEANUP_ALL_DISPOSABLE_PODS === 'true'
          ? Object.entries(pods).filter(([podUrl]) => {
              try {
                return new URL(podUrl).pathname.split('/').filter(Boolean).pop()?.startsWith('e2e-') === true
              } catch {
                return false
              }
            })
          : [runtime.podUrl, runtime.viewerPodUrl]
            .filter(Boolean)
            .map(podUrl => [podUrl, pods[podUrl]])

        for (const [podUrl, podDeleteUrl] of podEntries) {
          if (!podDeleteUrl) continue
          const deletedPod = await api.delete(podDeleteUrl)
          if (!deletedPod.ok()) {
            cleanupWarning = `Could not delete pod ${podUrl} through the local account API: HTTP ${deletedPod.status()}`
          }
        }
      }
    }

    if (controls.password?.create) {
      const loginsResponse = await api.get(controls.password.create, {
        headers: { Accept: 'application/json' }
      })
      if (loginsResponse.ok()) {
        const { passwordLogins = {} } = await loginsResponse.json()
        for (const login of [runtime.email, runtime.viewerEmail].filter(Boolean)) {
          const loginDeleteUrl = passwordLogins[login]
          if (loginDeleteUrl) {
            const deletedLogin = await api.delete(loginDeleteUrl)
            if (!deletedLogin.ok()) {
              cleanupWarning = `Could not delete test login: HTTP ${deletedLogin.status()}`
            }
          }
        }
      }
    }
  } finally {
    await api.dispose()
    await rm(runtime.storageState, { force: true })
    await rm(runtimeFile, { force: true })
    if (pivotDataRoot && runtime.podName.startsWith('e2e-')) {
      await rm(resolve(pivotDataRoot, runtime.podName), { force: true, recursive: true })
    }
    if (process.env.E2E_CLEANUP_ALL_DISPOSABLE_PODS === 'true') {
      if (pivotDataRoot) {
        for (const entry of await readdir(pivotDataRoot, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith('e2e-')) {
            await rm(resolve(pivotDataRoot, entry.name), { force: true, recursive: true })
          }
        }
      }

      const storageStateDirectory = resolve(runtimeFile, '..', 'storage-state')
      for (const entry of await readdir(storageStateDirectory, { withFileTypes: true }).catch(() => [])) {
        if (entry.isFile() && entry.name.startsWith('local-') && entry.name.endsWith('.json')) {
          await rm(resolve(storageStateDirectory, entry.name), { force: true })
        }
      }
    }
  }

  if (cleanupWarning) console.warn(cleanupWarning)
  console.log(
    process.env.E2E_CLEANUP_ALL_DISPOSABLE_PODS === 'true'
      ? `Cleaned disposable E2E pods and login for ${runtime.email}`
      : `Cleaned disposable pods and logins for ${runtime.email}${runtime.viewerEmail ? ` and ${runtime.viewerEmail}` : ''}`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
