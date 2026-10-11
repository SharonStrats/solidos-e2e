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

export const ownerUser: TestUser = {
  webId: process.env.E2E_OWNER_WEBID || 'https://example.invalid/profile/card#me',
  username: process.env.E2E_OWNER_USERNAME,
  password: process.env.E2E_OWNER_PASSWORD
}

export const viewerUser: TestUser = {
  webId: process.env.E2E_VIEWER_WEBID || 'https://example.invalid/viewer/card#me',
  username: process.env.E2E_VIEWER_USERNAME,
  password: process.env.E2E_VIEWER_PASSWORD
}
