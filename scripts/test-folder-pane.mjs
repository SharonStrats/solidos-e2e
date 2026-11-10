import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
const runtimeFile = resolve(process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json')
const suiteStartedAt = Date.now()

function formatElapsedTime () {
  const elapsedSeconds = Math.round((Date.now() - suiteStartedAt) / 1000)
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

async function requireRunningApplication () {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(baseURL, { signal: controller.signal, redirect: 'manual' })
    if (!response) throw new Error('no response')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`[e2e-folder-pane] SolidOS is not available at ${baseURL}: ${reason}`)
    console.error('[e2e-folder-pane] Start the SolidOS app at localhost:3100 or localhost:3200, then run this command again.')
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
  E2E_PIVOT_DATA_ROOT: process.env.E2E_PIVOT_DATA_ROOT ||
    resolve(new URL(baseURL).port === '3200' ? '../pivot/data-subdomain' : '../pivot/data'),
  E2E_RUN_FOLDER_PANE: 'true',
  E2E_USE_LOCAL_RUNTIME: 'true',
  E2E_CLEANUP_ALL_DISPOSABLE_PODS: process.env.E2E_CLEANUP_ALL_DISPOSABLE_PODS || 'false'
}

async function cleanupDisposableRuntimes () {
  if (!existsSync(runtimeFile)) return

  const result = spawnSync('npm', ['run', 'cleanup:local'], {
    cwd: process.cwd(),
    env: {
      ...environment,
      E2E_CLEANUP_ALL_DISPOSABLE_PODS: process.env.E2E_CLEANUP_ALL_DISPOSABLE_PODS || 'false'
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
      'tests/folder-pane/folder-pane-sidebar-tree.spec.ts',
      'tests/folder-pane/folder-pane-sidebar-collapse.spec.ts',
      'tests/folder-pane/folder-pane-sidebar-validation.spec.ts',
      'tests/folder-pane/folder-pane-resources.spec.ts',
      'tests/folder-pane/folder-pane-copy.spec.ts',
      'tests/folder-pane/folder-pane-created-resources.spec.ts',
      'tests/folder-pane/folder-pane-search.spec.ts',
      'tests/folder-pane/folder-pane-add-menu-panes.spec.ts',
      'tests/folder-pane/folder-pane-upload.spec.ts',
      'tests/folder-pane/folder-pane-delete.spec.ts',
      'tests/folder-pane/folder-pane-slideshow.spec.ts',
      'tests/folder-pane/folder-pane-mobile.spec.ts',
      'tests/folder-pane/folder-pane-layout.spec.ts',
      'tests/folder-pane/folder-pane-resize-regression.spec.ts'
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
    console.log(`[e2e-folder-pane] Total elapsed time: ${formatElapsedTime()}`)
  }
}

main().catch(error => {
  console.error(`[e2e-folder-pane] ${error instanceof Error ? error.message : String(error)}`)
  console.log(`[e2e-folder-pane] Total elapsed time: ${formatElapsedTime()}`)
  process.exitCode = 1
})
