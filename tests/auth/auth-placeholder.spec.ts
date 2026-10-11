import { test, expect } from '../../fixtures/test.js'

test('authenticated test identity is configured when auth coverage is enabled', async ({
  owner
}) => {
  test.skip(
    process.env.E2E_RUN_AUTH !== 'true',
    'Set E2E_RUN_AUTH=true after configuring a test-only identity provider.'
  )

  expect(owner.webId).not.toContain('example.invalid')
  expect(owner.username).toBeTruthy()
  expect(owner.password).toBeTruthy()
})
