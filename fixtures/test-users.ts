import { readFileSync } from 'node:fs'

/**
 * Safe, non-secret test identity placeholders.
 *
 * Supply real values through environment variables or CI secret storage. Do not
 * put passwords, client secrets, or personal WebIDs in this repository.
 */
export type TestUser = {
  webId: string
  username?: string
  password?: string
}

function localRuntime (): Partial<Record<string, string>> {
  if (process.env.E2E_EXTERNAL_SERVER === 'true' || process.env.E2E_BASE_URL && !/^https?:\/\/localhost:3100\/?$/.test(process.env.E2E_BASE_URL)) return {}
  try {
    return JSON.parse(readFileSync(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json', 'utf8'))
  } catch {
    return {}
  }
}

const runtime = localRuntime()

export const ownerUser: TestUser = {
  webId: process.env.E2E_OWNER_WEBID || runtime.webId || 'https://example.invalid/profile/card#me',
  username: process.env.E2E_OWNER_USERNAME || runtime.email,
  password: process.env.E2E_OWNER_PASSWORD || runtime.password
}

export const viewerUser: TestUser = {
  webId: process.env.E2E_VIEWER_WEBID || runtime.viewerWebId || 'https://example.invalid/viewer/card#me',
  username: process.env.E2E_VIEWER_USERNAME || runtime.viewerEmail,
  password: process.env.E2E_VIEWER_PASSWORD || runtime.viewerPassword
}

export function hasConfiguredViewerUser (): boolean {
  return Boolean(
    viewerUser.username &&
    viewerUser.password &&
    viewerUser.webId &&
    !viewerUser.webId.includes('example.invalid')
  )
}
