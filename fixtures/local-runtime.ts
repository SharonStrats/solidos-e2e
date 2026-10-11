import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type LocalRuntime = {
  authenticated: boolean
  email: string
  password: string
  profileFile: string | null
  profileUrl: string
  storageState: string
  webId: string
}

const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')

export function getLocalRuntime(): LocalRuntime {
  if (!existsSync(runtimeFile)) {
    throw new Error(`Local E2E runtime state is missing: ${runtimeFile}. Run npm run setup:local first.`)
  }

  const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8')) as Partial<LocalRuntime>
  if (!runtime.authenticated || !runtime.email || !runtime.password || !runtime.profileUrl || !runtime.storageState || !runtime.webId) {
    throw new Error('Local E2E runtime state does not contain an authenticated profile session. Run npm run setup:local again.')
  }

  return runtime as LocalRuntime
}
