import { spawnSync } from 'node:child_process'

const externalServer = process.env.E2E_EXTERNAL_SERVER === 'true'
const summaryEnvironment = {
  ...process.env,
  E2E_SUMMARY: 'true'
}
const externalEnvironment = {
  ...summaryEnvironment,
  E2E_RUN_SMOKE: 'true',
  E2E_RUN_DATABROWSER: 'true',
  E2E_RUN_PROFILE_READS: 'true',
  E2E_RUN_LOCAL_PROFILE: 'false',
  E2E_USE_LOCAL_RUNTIME: 'false',
  E2E_RUN_PROFILE_NAVIGATION: 'false',
  E2E_RUN_ACCESS_CONTROL_SERVER: 'false'
}
const commands = externalServer
  ? [
      ['External SolidOS E2E tests', ['run', 'test:e2e'], externalEnvironment],
      ['Access-control UI E2E tests', ['run', 'test:access-control'], summaryEnvironment]
    ]
  : [
        ['Local SolidOS E2E tests', ['run', 'test:local'], summaryEnvironment],
        ['Access-control UI E2E tests', ['run', 'test:access-control'], summaryEnvironment]
    ]

let failed = false
const workflowSummaries = []

function readSummary (output) {
  const summaries = []
  for (const line of output.matchAll(/^@@E2E_SUMMARY@@(.+)$/gm)) {
    try {
      summaries.push(JSON.parse(line[1]))
    } catch {
      // A malformed reporter result is treated like a workflow with no report.
    }
  }
  return summaries.at(-1)
}

function printOutput (result) {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

function printWorkflowSummary (label, summary) {
  const counts = summary || { passed: 0, failed: 0, skipped: 0, failures: [] }
  console.log(`[e2e-all] ${label}: passed=${counts.passed}, failed=${counts.failed}, skipped=${counts.skipped}`)
  for (const failure of counts.failures) {
    console.log(`[e2e-all]   failed: ${failure.title} (${failure.location})`)
  }
}

try {
  for (const [label, args, environment] of commands) {
    console.log(`\n[e2e-all] Starting ${label}`)
    const result = spawnSync('npm', args, {
      cwd: process.cwd(),
      env: environment,
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8'
    })
    printOutput(result)
    workflowSummaries.push({ label, summary: readSummary(`${result.stdout || ''}\n${result.stderr || ''}`) })
    printWorkflowSummary(label, workflowSummaries.at(-1).summary)

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

const consolidated = workflowSummaries.reduce((total, { summary }) => {
  if (!summary) return total
  total.passed += summary.passed
  total.failed += summary.failed
  total.skipped += summary.skipped
  total.failures.push(...summary.failures)
  return total
}, { passed: 0, failed: 0, skipped: 0, failures: [] })
console.log(`\n[e2e-all] Consolidated: passed=${consolidated.passed}, failed=${consolidated.failed}, skipped=${consolidated.skipped}`)
for (const failure of consolidated.failures) {
  console.log(`[e2e-all]   failed: ${failure.title} (${failure.location})`)
}

if (failed) process.exitCode = 1
else console.log('[e2e-all] All E2E workflows passed')
