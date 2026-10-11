import { spawnSync } from 'node:child_process'

const commands = [
  ['Local SolidOS E2E tests', ['run', 'test:local']],
  ['Access-control E2E tests', ['run', 'test:access-control']]
]

let failed = false

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

if (failed) process.exitCode = 1
else console.log('\n[e2e-all] All E2E workflows passed')
