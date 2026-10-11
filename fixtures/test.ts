import { test as base, expect } from '@playwright/test'
import { ownerUser, viewerUser, type TestUser } from './test-users.js'

type Fixtures = {
  owner: TestUser
  viewer: TestUser
}

export const test = base.extend<Fixtures>({
  owner: async ({}, use) => use(ownerUser),
  viewer: async ({}, use) => use(viewerUser)
})

export { expect }
