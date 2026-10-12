import { spawnSync } from 'node:child_process'

const environment = {
  ...process.env,
  E2E_RUN_ACCESS_CONTROL: 'true',
  E2E_START_APP: 'true',
  E2E_BASE_URL: 'http://127.0.0.1:3101',
  E2E_APP_COMMAND: 'node scripts/access-control-test-host.mjs'
}

let exitCode = 1
try {
  const build = spawnSync('npm', ['--prefix', '../solid-ui', 'run', 'build-cdn'], {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit'
  })
  if (build.error) throw build.error
  if (build.status !== 0) {
    exitCode = build.status || 1
  } else {
    const tests = spawnSync('npx', ['playwright', 'test', 'tests/access-control/access-control-focus.spec.ts'], {
      cwd: process.cwd(),
      env: environment,
      stdio: 'inherit'
    })
    if (tests.error) throw tests.error
    exitCode = tests.status || 0
  }
} finally {
  const cleanup = spawnSync('npm', ['run', 'cleanup:access-control'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })
  if (cleanup.error || cleanup.status !== 0) exitCode = 1
}

process.exitCode = exitCode
