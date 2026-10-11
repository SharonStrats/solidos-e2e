import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
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
  E2E_USE_LOCAL_RUNTIME: 'true'
}

if (!existsSync(runtimeFile)) {
  console.log(`[e2e-local ${new Date().toISOString()}] No runtime found; creating a disposable account`)
  run('npm', ['run', 'setup:local'], environment)
}

const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'))
if (process.env.E2E_PROFILE_URL) {
  environment.E2E_RUN_PROFILE_READS = 'true'
  environment.E2E_PROFILE_URL = process.env.E2E_PROFILE_URL
} else {
  environment.E2E_RUN_PROFILE_READS = 'false'
  console.log(`[e2e-local ${new Date().toISOString()}] No E2E_PROFILE_URL supplied; skipping public profile-read fixtures`)
}

console.log(`[e2e-local ${new Date().toISOString()}] Running all tests supported by ${baseURL}`)
run('npx', ['playwright', 'test'], environment)
