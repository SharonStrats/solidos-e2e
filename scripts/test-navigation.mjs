import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
if (!/^https?:\/\/localhost:(3100|3200)\/?$/.test(baseURL)) {
  throw new Error('test:navigation requires E2E_BASE_URL to be localhost:3100 or localhost:3200')
}

const port = new URL(baseURL).port
const runtimeFile = resolve(`.e2e-navigation-${port}.json`)
const pivotDataRoot = resolve(
  process.env.E2E_PIVOT_DATA_ROOT ||
  (port === '3200' ? '../pivot/data-subdomain' : '../pivot/data')
)

function run (command, args, env) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}

async function requireRunningApplication () {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(baseURL, { signal: controller.signal, redirect: 'manual' })
    if (!response) throw new Error('No response')
  } catch (error) {
    throw new Error(`SolidOS is not running at ${baseURL}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timeout)
  }
}

await requireRunningApplication()

const environment = {
  ...process.env,
  E2E_BASE_URL: baseURL,
  E2E_RUNTIME_FILE: runtimeFile,
  E2E_PIVOT_DATA_ROOT: pivotDataRoot,
  E2E_RUN_NAVIGATION_VIEW: 'true',
  E2E_RUN_LOCAL_PROFILE: 'true',
  E2E_USE_LOCAL_RUNTIME: 'true',
  E2E_CLEANUP_ALL_DISPOSABLE_PODS: process.env.E2E_CLEANUP_ALL_DISPOSABLE_PODS || 'true'
}

let status = 1
try {
  status = run('npm', ['run', 'setup:local'], environment)
  if (status !== 0) process.exitCode = status
  else {
    // The accounts are disposable, so the friendship can be added for real
    environment.E2E_NAV_ALLOW_FRIEND_MUTATION = process.env.E2E_NAV_ALLOW_FRIEND_MUTATION || 'true'
    status = run('npx', ['playwright', 'test', 'tests/navigation/navigation-and-view.spec.ts', ...process.argv.slice(2)], environment)
    process.exitCode = status
  }
} finally {
  if (existsSync(runtimeFile)) {
    const cleanupStatus = run('npm', ['run', 'cleanup:local'], environment)
    if (status === 0 && cleanupStatus !== 0) process.exitCode = cleanupStatus
  }
  rmSync(runtimeFile, { force: true })
}
