import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
const disposable = process.env.E2E_EXTERNAL_SERVER !== 'true' && /^https?:\/\/localhost:3100\/?$/.test(baseURL)
const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')
const environment = {
  ...process.env,
  E2E_RUN_ACCESS_CONTROL_SERVER: 'true',
  E2E_BASE_URL: baseURL
}

let exitCode = 1
let runtimeCreated = false
try {
  if (disposable && !existsSync(runtimeFile)) {
    const setup = spawnSync('npm', ['run', 'setup:local'], { cwd: process.cwd(), env: environment, stdio: 'inherit' })
    if (setup.error) throw setup.error
    runtimeCreated = setup.status === 0
    if (setup.status !== 0) exitCode = setup.status || 1
  }
  if (exitCode === 1 && (!disposable || existsSync(runtimeFile))) {
    const tests = spawnSync('npx', ['playwright', 'test', 'tests/access-control/access-control-server.spec.ts'], {
      cwd: process.cwd(), env: environment, stdio: 'inherit'
    })
    if (tests.error) throw tests.error
    exitCode = tests.status || 0
  }
} finally {
  // Always clean disposable local runtime state, including state left by a
  // previous interrupted run.
  if (disposable && existsSync(runtimeFile)) {
    const cleanup = spawnSync('npm', ['run', 'cleanup:local'], {
      cwd: process.cwd(), env: environment, stdio: 'inherit'
    })
    if (cleanup.error || cleanup.status !== 0) exitCode = 1
  }
}

process.exitCode = exitCode
