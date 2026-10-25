import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')

async function requireRunningApplication () {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(baseURL, { signal: controller.signal, redirect: 'manual' })
    if (!response.ok) {
      throw new Error(`received HTTP ${response.status}`)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`[e2e-folder-pane] SolidOS is not available at ${baseURL}: ${reason}`)
    console.error('[e2e-folder-pane] Start the SolidOS app at localhost:3100, then run this command again.')
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
}

function runSetup (environment) {
  const result = spawnSync('npm', ['run', 'setup:local'], {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function hasUsableRuntime (runtime) {
  return Boolean(
    runtime?.authenticated &&
    runtime?.podUrl &&
    runtime?.profileUrl &&
    runtime?.email &&
    runtime?.password &&
    runtime?.profileFile &&
    existsSync(runtime.profileFile)
  )
}

const environment = {
  ...process.env,
  E2E_BASE_URL: baseURL,
  E2E_PIVOT_DATA_ROOT: process.env.E2E_PIVOT_DATA_ROOT || resolve('../pivot/data'),
  E2E_RUN_FOLDER_PANE: 'true',
  E2E_USE_LOCAL_RUNTIME: 'true'
}

async function cleanupDisposableRuntimes () {
  if (!existsSync(runtimeFile)) return

  const result = spawnSync('npm', ['run', 'cleanup:local'], {
    cwd: process.cwd(),
    env: {
      ...environment,
      E2E_CLEANUP_ALL_DISPOSABLE_PODS: 'true'
    },
    stdio: 'inherit'
  })
  if (result.error) {
    console.error(`[e2e-folder-pane] Unable to clean up disposable pods: ${result.error.message}`)
  } else if (result.status !== 0) {
    console.error(`[e2e-folder-pane] Disposable-pod cleanup failed with exit code ${result.status}`)
  }
}

async function main () {
  await requireRunningApplication()

  let runtime
  try {
    if (existsSync(runtimeFile)) {
      try {
        runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'))
      } catch (error) {
        console.warn(`[e2e-folder-pane] Ignoring unreadable runtime file ${runtimeFile}: ${String(error)}`)
      }
    }

    if (!hasUsableRuntime(runtime)) {
      console.log('[e2e-folder-pane] No usable disposable runtime found; creating a pod and profile.')
      runSetup(environment)
      runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'))
    }

    const containerURL = process.env.E2E_FOLDER_PANE_CONTAINER_URL || runtime?.podUrl
    if (!containerURL) {
      throw new Error(`Runtime file ${runtimeFile} does not contain a pod URL. Run "npm run setup:local" and try again.`)
    }

    const defaultTestFiles = [
      'tests/folder-pane/folder-pane-container.spec.ts',
      'tests/folder-pane/folder-pane-resources.spec.ts',
      'tests/folder-pane/folder-pane-created-resources.spec.ts',
      'tests/folder-pane/folder-pane-search.spec.ts',
      'tests/folder-pane/folder-pane-add-menu-panes.spec.ts',
      'tests/folder-pane/folder-pane-slideshow.spec.ts'
    ]
    const requestedTestFiles = process.argv.slice(2)
    const testFiles = requestedTestFiles.length > 0 ? requestedTestFiles : defaultTestFiles
    const result = spawnSync('npx', ['playwright', 'test', '--workers=1', ...testFiles], {
      cwd: process.cwd(),
      env: {
        ...environment,
        E2E_FOLDER_PANE_CONTAINER_URL: containerURL,
        E2E_USE_LOCAL_RUNTIME: 'true'
      },
      stdio: 'inherit'
    })

    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    await cleanupDisposableRuntimes()
  }
}

main().catch(error => {
  console.error(`[e2e-folder-pane] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
