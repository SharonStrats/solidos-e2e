import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100'
const startApp = process.env.E2E_START_APP === 'true'
const runtimeFile = process.env.E2E_RUNTIME_FILE || '.e2e-runtime.json'
const runtimeState = process.env.E2E_USE_LOCAL_RUNTIME === 'true' && existsSync(runtimeFile)
  ? JSON.parse(readFileSync(runtimeFile, 'utf8')) as { storageState?: string }
  : null

console.log(`[e2e-config ${new Date().toISOString()}] baseURL=${baseURL}`)
console.log(`[e2e-config ${new Date().toISOString()}] local runtime enabled=${process.env.E2E_USE_LOCAL_RUNTIME === 'true'}; storage state loaded=${Boolean(runtimeState?.storageState)}`)
console.log(`[e2e-config ${new Date().toISOString()}] workers=${process.env.CI || process.env.E2E_RUN_LOCAL_PROFILE === 'true' ? 1 : 'default'}; fullyParallel=true`)

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Local-profile tests reset one disposable profile file before every test.
  // Keep those resets non-overlapping without using Playwright's serial mode,
  // which would skip later tests after a failure.
  workers: process.env.CI || process.env.E2E_RUN_LOCAL_PROFILE === 'true' ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['line']] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
    ...(runtimeState?.storageState ? { storageState: runtimeState.storageState } : {})
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  ...(startApp
    ? {
        webServer: {
          command: process.env.E2E_APP_COMMAND || 'npm run start',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000
        }
      }
    : {})
})
