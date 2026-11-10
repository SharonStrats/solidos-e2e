import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
if (!/^https?:\/\/localhost:(3100|3200)\/?$/.test(baseURL)) {
  throw new Error('test:auth-options requires E2E_BASE_URL to be localhost:3100 or localhost:3200')
}

const runtimeFile = resolve(`.e2e-auth-options-${new URL(baseURL).port}.json`)
const startedAt = Date.now()
const environment = {
  ...process.env,
  E2E_BASE_URL: baseURL,
  E2E_RUNTIME_FILE: runtimeFile,
  E2E_RUN_AUTH_OPTIONS: 'true',
  E2E_USE_LOCAL_RUNTIME: 'true',
  E2E_PIVOT_DATA_ROOT: process.env.E2E_PIVOT_DATA_ROOT ||
    (new URL(baseURL).port === '3200' ? '../pivot/data-subdomain' : '../pivot/data'),
  E2E_CLEANUP_ALL_DISPOSABLE_PODS: process.env.E2E_CLEANUP_ALL_DISPOSABLE_PODS || 'false'
}

function run (command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}

const running = await fetch(baseURL, { redirect: 'manual' }).catch(() => null)
if (!running) throw new Error(`SolidOS is not running at ${baseURL}`)

let status = 1
try {
  status = run('npm', ['run', 'setup:local'])
  if (status === 0) {
    status = run('npx', [
      'playwright', 'test', 'tests/auth/auth-options.spec.ts',
      ...process.argv.slice(2)
    ])
  }
  process.exitCode = status
} finally {
  if (existsSync(runtimeFile)) {
    const cleanupStatus = run('npm', ['run', 'cleanup:local'])
    if (status === 0 && cleanupStatus !== 0) process.exitCode = cleanupStatus
  }
  rmSync(runtimeFile, { force: true })
  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  console.log(`[e2e-auth-options] Total elapsed time: ${elapsed}s`)
}
