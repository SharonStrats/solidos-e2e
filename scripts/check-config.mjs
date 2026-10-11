const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'

try {
  const url = new URL(baseURL)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
  if (process.env.E2E_RUN_PROFILE_READS === 'true' && !process.env.E2E_PROFILE_URL) {
    throw new Error('E2E_PROFILE_URL is required when E2E_RUN_PROFILE_READS=true')
  }
  if (process.env.E2E_PROFILE_URL) {
    const profileURL = new URL(process.env.E2E_PROFILE_URL)
    if (!['http:', 'https:'].includes(profileURL.protocol)) throw new Error('unsupported profile URL protocol')
  }
  console.log(`E2E_BASE_URL=${url.toString()}`)
  console.log(`E2E_START_APP=${process.env.E2E_START_APP || 'false'}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : `Invalid E2E_BASE_URL: ${baseURL}`)
  process.exitCode = 1
}
