import { request } from '@playwright/test'
import { readFile, rm } from 'node:fs/promises'
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
        const podDeleteUrl = pods[runtime.podUrl]
        if (podDeleteUrl) {
          const deletedPod = await api.delete(podDeleteUrl)
          if (!deletedPod.ok()) {
            cleanupWarning = `Could not delete pod through the local account API: HTTP ${deletedPod.status()}`
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
        const loginDeleteUrl = passwordLogins[runtime.email]
        if (loginDeleteUrl) {
          const deletedLogin = await api.delete(loginDeleteUrl)
          if (!deletedLogin.ok()) {
            cleanupWarning = `Could not delete test login: HTTP ${deletedLogin.status()}`
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
  }

  if (cleanupWarning) console.warn(cleanupWarning)
  console.log(`Cleaned disposable pod and login for ${runtime.email}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
