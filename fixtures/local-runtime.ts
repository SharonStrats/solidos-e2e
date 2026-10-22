import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type LocalRuntime = {
  authenticated: boolean
  email: string
  password: string
  viewerEmail?: string
  viewerPassword?: string
  viewerWebId?: string
  viewerPodUrl?: string
  profileFile: string | null
  profileUrl: string
  podUrl: string
  preferencesUrl?: string
  storageState: string
  webId: string
}

const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')

export function getLocalRuntime(): LocalRuntime {
  if (!existsSync(runtimeFile)) {
    const profileUrl = process.env.E2E_PROFILE_URL
    const podUrl = process.env.E2E_POD_URL
    const webId = process.env.E2E_OWNER_WEBID
    if (profileUrl && podUrl && webId && process.env.E2E_EXTERNAL_SERVER === 'true') {
      return {
        authenticated: false,
        email: process.env.E2E_OWNER_USERNAME || '',
        password: process.env.E2E_OWNER_PASSWORD || '',
        profileFile: null,
        profileUrl,
        podUrl,
        storageState: '',
        webId
      }
    }
    throw new Error(`Local E2E runtime state is missing: ${runtimeFile}. Run npm run setup:local first.`)
  }

  const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8')) as Partial<LocalRuntime>
  if (!runtime.authenticated || !runtime.email || !runtime.password || !runtime.profileUrl || !runtime.podUrl || !runtime.webId) {
    throw new Error('Local E2E runtime state does not contain an authenticated profile session. Run npm run setup:local again.')
  }

  return runtime as LocalRuntime
}
