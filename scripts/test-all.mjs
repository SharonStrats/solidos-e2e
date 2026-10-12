import { spawnSync } from 'node:child_process'

const commands = [
  ['Local SolidOS E2E tests', ['run', 'test:local']],
  ['Access-control UI E2E tests', ['run', 'test:access-control']]
]

let failed = false

try {
  for (const [label, args] of commands) {
    console.log(`\n[e2e-all] Starting ${label}`)
    const result = spawnSync('npm', args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    })

    if (result.error) {
      console.error(`[e2e-all] ${label} could not start: ${result.error.message}`)
      failed = true
      continue
    }

    if (result.status !== 0) {
      console.error(`[e2e-all] ${label} failed with exit code ${result.status ?? 'unknown'}`)
      failed = true
    }
  }
} finally {
  console.log('\n[e2e-all] Cleaning access-control disposable resources')
  const cleanup = spawnSync('npm', ['run', 'cleanup:access-control'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })
  if (cleanup.error || cleanup.status !== 0) {
    console.error('[e2e-all] Access-control cleanup failed')
    failed = true
  }
}

if (failed) process.exitCode = 1
else console.log('\n[e2e-all] All E2E workflows passed')
