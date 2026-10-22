import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
const publicProfileURL = process.env.E2E_PROFILE_URL || 'https://sharon.pivot-test.solidproject.org:3000/profile/card#me'
const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')
const pivotDataRoot = process.env.E2E_PIVOT_DATA_ROOT || resolve('../pivot/data')

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit'
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

const environment = {
  ...process.env,
  E2E_BASE_URL: baseURL,
  E2E_PIVOT_DATA_ROOT: pivotDataRoot,
  E2E_RUN_SMOKE: 'true',
  E2E_RUN_LOCAL_PROFILE: 'true',
  E2E_USE_LOCAL_RUNTIME: 'true',
  E2E_RUN_PROFILE_NAVIGATION: 'true',
  E2E_RUN_DATABROWSER: 'true'
}

async function requireRunningApplication() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    await fetch(baseURL, {
      signal: controller.signal,
      redirect: 'manual'
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`[e2e-local ${new Date().toISOString()}] SolidOS is not available at ${baseURL}: ${reason}`)
    console.error('[e2e-local] Start SolidOS first; no E2E setup, browser, or watcher will be started.')
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
}

await requireRunningApplication()

let runtimeNeedsSetup = !existsSync(runtimeFile)
if (!runtimeNeedsSetup) {
  try {
    const existingRuntime = JSON.parse(readFileSync(runtimeFile, 'utf8'))
    runtimeNeedsSetup = !existingRuntime.profileFile || !existsSync(existingRuntime.profileFile)
  } catch {
    runtimeNeedsSetup = true
  }
}

if (runtimeNeedsSetup) {
  console.log(`[e2e-local ${new Date().toISOString()}] No runtime found; creating a disposable account`)
  run('npm', ['run', 'setup:local'], environment)
}

const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'))
environment.E2E_RUN_PROFILE_READS = 'true'
environment.E2E_PROFILE_URL = publicProfileURL
console.log(`[e2e-local ${new Date().toISOString()}] Public profile reads use ${publicProfileURL}`)

console.log(`[e2e-local ${new Date().toISOString()}] Running all tests supported by ${baseURL}`)
run('npx', ['playwright', 'test'], environment)
