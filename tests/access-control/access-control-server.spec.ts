import { DataFactory, Parser, Writer, type Quad } from 'n3'
import { expect, test } from '../../fixtures/test.js'
import { authenticateProfileOwner, authenticateSolidUser } from '../../fixtures/authenticate-owner.js'
import { acl, findAclUrl } from '../../fixtures/acl-verification.js'
import { getLocalRuntime } from '../../fixtures/local-runtime.js'
import { hasConfiguredViewerUser, ownerUser, viewerUser } from '../../fixtures/test-users.js'
import { openFolderPane } from '../../fixtures/open-folder-pane.js'

const foafAgent = 'http://xmlns.com/foaf/0.1/Agent'
const rdfType = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const aclDefault = 'http://www.w3.org/ns/auth/acl#default'
const aclAgentClass = 'http://www.w3.org/ns/auth/acl#agentClass'
const authenticatedAgent = 'http://www.w3.org/ns/auth/acl#AuthenticatedAgent'
const aclCondition = 'http://www.w3.org/ns/auth/acl#condition'
const aclDescription = 'http://www.w3.org/ns/auth/acl#description'

type SolidResponse = {
  status: number
  link: string | null
  body: string
}

type ResourceCase = {
  folderUrl?: string
  fileUrl: string
  aclUrl: string
}

async function solidRequest (page: import('@playwright/test').Page, url: string, init: RequestInit = {}): Promise<SolidResponse> {
  return page.evaluate(async ({ url, init }) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('No authenticated Solid session is available.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await authenticatedFetch.call(session, url, { ...init, signal: controller.signal })
      return {
        status: response.status,
        link: response.headers.get('link'),
        body: await response.text()
      }
    } catch (error) {
      throw new Error(`${init.method ?? 'GET'} ${url} failed${controller.signal.aborted ? ' after 15000ms' : ''}`, { cause: error })
    } finally {
      clearTimeout(timeout)
    }
  }, { url, init })
}

async function createResource (page: import('@playwright/test').Page, parentUrl: string, slug: string, body: string, contentType: string): Promise<string> {
  const url = new URL(slug, parentUrl).toString()
  const response = await solidRequest(page, url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body
  })
  expect(response.status, `Could not create ${url}: ${response.body}`).toBeLessThan(300)
  return url
}

async function createFolder (page: import('@playwright/test').Page, parentUrl: string, slug: string): Promise<string> {
  const folderUrl = new URL(`${slug}/`, parentUrl).toString()
  const response = await solidRequest(page, parentUrl, {
    method: 'POST',
    headers: {
      'content-type': 'text/turtle',
      slug: `${slug}/`,
      link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
    },
    body: ' '
  })
  expect(response.status, `Could not create ${folderUrl}: ${response.body}`).toBeLessThan(300)
  return folderUrl
}

async function aclFor (page: import('@playwright/test').Page, resourceUrl: string): Promise<string> {
  // Resource bodies may be plain text; the Link header is enough to discover
  // the ACL and avoids asking the server to negotiate Turtle for that body.
  const response = await solidRequest(page, resourceUrl)
  expect(response.status, `Could not read ${resourceUrl}`).toBeLessThan(300)
  return findAclUrl({
    headers: () => ({ link: response.link || '' })
  } as never, resourceUrl)
}

async function readAcl (page: import('@playwright/test').Page, aclUrl: string): Promise<Quad[]> {
  const response = await solidRequest(page, aclUrl, { headers: { accept: 'text/turtle' } })
  if (response.status === 404) {
    return []
  }
  expect(response.status, `Could not read ACL ${aclUrl}`).toBeLessThan(300)
  return new Parser({ baseIRI: aclUrl }).parse(response.body)
}

function writeQuads (quads: Quad[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: 'text/turtle' })
    writer.addQuads(quads)
    writer.end((error, result) => error ? reject(error) : resolve(result))
  })
}

async function grant (
  page: import('@playwright/test').Page,
  aclUrl: string,
  resourceUrl: string,
  agent: string,
  options: { defaultResource?: string, publicAgent?: boolean, modes?: string[], conditionDescription?: string } = {}
): Promise<void> {
  const { literal, namedNode, quad } = DataFactory
  const subject = namedNode(`${aclUrl}#e2e-${options.publicAgent ? 'public' : 'viewer'}`)
  const condition = namedNode(`${aclUrl}#e2e-condition`)
  const quads = await readAcl(page, aclUrl)
  if (quads.length === 0) {
    const ownerSubject = namedNode(`${aclUrl}#e2e-owner`)
    quads.push(
      quad(ownerSubject, namedNode(rdfType), namedNode('http://www.w3.org/ns/auth/acl#Authorization')),
      quad(ownerSubject, namedNode(acl.agent), namedNode(ownerUser.webId)),
      quad(ownerSubject, namedNode(acl.accessTo), namedNode(resourceUrl)),
      quad(ownerSubject, namedNode(acl.mode), namedNode(acl.read)),
      quad(ownerSubject, namedNode(acl.mode), namedNode(acl.write)),
      quad(ownerSubject, namedNode(acl.mode), namedNode(acl.control))
    )
    if (options.defaultResource) {
      quads.push(quad(ownerSubject, namedNode('http://www.w3.org/ns/auth/acl#default'), namedNode(options.defaultResource)))
    }
  }
  quads.push(
    quad(subject, namedNode(rdfType), namedNode('http://www.w3.org/ns/auth/acl#Authorization')),
    quad(subject, namedNode(acl.agent), namedNode(agent)),
    quad(subject, namedNode(acl.accessTo), namedNode(resourceUrl)),
    ...(options.modes ?? [acl.read]).map(mode =>
      quad(subject, namedNode(acl.mode), namedNode(mode)))
  )
  if (options.defaultResource) {
    quads.push(quad(subject, namedNode('http://www.w3.org/ns/auth/acl#default'), namedNode(options.defaultResource)))
  }
  if (options.conditionDescription) {
    quads.push(
      quad(subject, namedNode(aclCondition), condition),
      quad(condition, namedNode(aclDescription), literal(options.conditionDescription, 'en'))
    )
  }
  if (options.publicAgent) {
    quads.splice(quads.findIndex(item => item.subject.equals(subject) && item.predicate.value === acl.agent), 1)
    quads.push(quad(subject, namedNode('http://www.w3.org/ns/auth/acl#agentClass'), namedNode(foafAgent)))
  }
  const body = await writeQuads(quads)
  const response = await solidRequest(page, aclUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/turtle' },
    body
  })
  expect(response.status, `Could not write ACL ${aclUrl}: ${response.body}`).toBeLessThan(300)
}

async function cleanup (description: string, action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    // Record cleanup errors without replacing an exception from the test body.
    expect.soft(error, description).toBeUndefined()
  }
}

async function closeViewerContext (context: import('@playwright/test').BrowserContext): Promise<void> {
  await cleanup('Could not close the viewer browser context', () => context.close())
}

async function dispose (page: import('@playwright/test').Page, resource: ResourceCase): Promise<void> {
  for (const url of [resource.fileUrl, resource.folderUrl].filter(Boolean) as string[]) {
    await cleanup(`Could not delete test resource ${url}`, async () => {
      const response = await solidRequest(page, url, { method: 'DELETE' })
      expect([200, 204, 205, 404], response.body).toContain(response.status)
    })
  }
}

async function makeFile (page: import('@playwright/test').Page, suffix: string): Promise<ResourceCase> {
  const runtime = getLocalRuntime()
  const fileUrl = await createResource(page, runtime.podUrl, `e2e-acl-${Date.now()}-${suffix}.txt`, 'ACL E2E', 'text/plain')
  return { fileUrl, aclUrl: await aclFor(page, fileUrl) }
}

async function makeFolderAndFile (page: import('@playwright/test').Page, suffix: string): Promise<ResourceCase> {
  const runtime = getLocalRuntime()
  const folderUrl = await createFolder(page, runtime.podUrl, `e2e-acl-${Date.now()}-${suffix}`)
  const fileUrl = await createResource(page, folderUrl, 'child.txt', 'ACL E2E child', 'text/plain')
  return { folderUrl, fileUrl, aclUrl: await aclFor(page, folderUrl) }
}

async function openManageAccessForFolder (page: import('@playwright/test').Page, folderUrl: string): Promise<void> {
  await openManageAccessForResource(page, folderUrl, true)
}

async function openManageAccessForResource (page: import('@playwright/test').Page, resourceUrl: string, container: boolean): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' })
  const root = getLocalRuntime().podUrl
  await openFolderPane(page, root)
  if (!resourceUrl.startsWith(root)) throw new Error(`Resource ${resourceUrl} is outside the disposable pod.`)
  const parentSegments = resourceUrl.slice(root.length).replace(/\/$/, '').split('/').slice(0, -1)
  let parentUrl = root
  for (const segment of parentSegments) {
    parentUrl = new URL(`${segment}/`, parentUrl).toString()
    await page.locator(`folder-pane-container [role="option"][about="<${parentUrl}>"]`).click()
  }
  const resource = page.locator('folder-pane-container').locator(`[role="option"][about="<${resourceUrl}>"]`)
  await expect(resource).toBeVisible()
  await resource.getByTitle('More options').click()
  if (container) {
    const manageAccess = resource.getByRole('menuitem', { name: 'Manage Access', exact: true })
    await expect(manageAccess).toBeVisible()
    await manageAccess.click()
  } else {
    const view = resource.getByRole('menuitem', { name: 'View', exact: true })
    await expect(view).toBeVisible()
    await view.click()
    const manageAccess = page.locator('solid-ui-file-explorer-header').getByTitle('Manage Access', { exact: true })
    await expect(manageAccess).toBeVisible()
    await manageAccess.click()
  }
  await expect(page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')).toBeVisible()
}

const accessRoles = ['Viewer', 'Poster', 'Submitter', 'Owner', 'Editor'] as const
const accessRoleModes: Record<typeof accessRoles[number], string[]> = {
  Viewer: [acl.read],
  Poster: [acl.read, 'http://www.w3.org/ns/auth/acl#Append'],
  Submitter: ['http://www.w3.org/ns/auth/acl#Append'],
  Owner: [acl.read, acl.write, acl.control],
  Editor: [acl.read, acl.write]
}

async function selectRole (input: import('@playwright/test').Locator, role: string): Promise<void> {
  await input.click()
  await input.page().getByRole('option', {
    name: role === 'No Access' ? /^(No Access|Remove)$/ : role,
    exact: true
  }).click()
  await expect(input).toHaveValue(role === 'No Access' ? /^(No Access|Remove)$/ : role)
}

async function selectPublicRole (input: import('@playwright/test').Locator, role: 'No Access' | 'Viewer'): Promise<void> {
  await selectRole(input, role)
}

async function selectViewerGrant (page: import('@playwright/test').Page, role = 'Viewer'): Promise<void> {
  const inputs = page.locator('solid-ui-access-control-modal solid-ui-combobox input[role="combobox"]')
  await expect(inputs.first()).toBeVisible()
  await selectRole(page.locator('solid-ui-access-control-modal solid-ui-combobox.access-role-select--top input'), role)
  await inputs.first().fill(viewerUser.webId)
  const principalOptions = page.locator('solid-ui-access-control-modal solid-ui-combobox.access-principal-combobox [role="option"]')
  await expect.poll(() => principalOptions.count(), {
    timeout: 10_000,
    message: 'The viewer WebID did not produce an access-target option'
  }).toBeGreaterThan(0)
  await inputs.first().press('ArrowDown')
  await inputs.first().press('Enter')
  await expect(page.locator('solid-ui-access-control-modal .access-grants-pending-item')).toHaveCount(1)
}

async function assertAgentGrant (
  page: import('@playwright/test').Page,
  aclUrl: string,
  resourceUrl: string,
  modes: string[],
  defaultResource?: string
): Promise<void> {
  const quads = await readAcl(page, aclUrl)
  const subject = quads.find(item =>
    item.predicate.value === acl.agent &&
    item.object.value === viewerUser.webId &&
    quads.some(candidate =>
      candidate.subject.equals(item.subject) &&
      candidate.predicate.value === acl.accessTo &&
      candidate.object.value === resourceUrl
    )
  )?.subject
  expect(subject, `No viewer grant for ${resourceUrl}`).toBeTruthy()
  const actualModes = quads
    .filter(item => item.subject.equals(subject!) && item.predicate.value === acl.mode)
    .map(item => item.object.value)
    .sort()
  expect(actualModes).toEqual([...modes].sort())
  if (defaultResource) {
    expect(quads.some(item =>
      item.subject.equals(subject!) &&
      item.predicate.value === aclDefault &&
      item.object.value === defaultResource
    )).toBe(true)
  }
}

async function assertNoAgentGrant (page: import('@playwright/test').Page, aclUrl: string): Promise<void> {
  const quads = await readAcl(page, aclUrl)
  expect(quads.some(item => item.predicate.value === acl.agent && item.object.value === viewerUser.webId)).toBe(false)
}

async function saveContainerScope (
  page: import('@playwright/test').Page,
  scope: 'folder+contents'
): Promise<void> {
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')).toHaveCount(0)
}

async function assertViewerScope (
  page: import('@playwright/test').Page,
  aclUrl: string,
  folderUrl: string,
  scope: 'folder+contents'
): Promise<void> {
  const quads = await readAcl(page, aclUrl)
  const viewerSubjects = new Set(quads
    .filter(item => item.predicate.value === acl.agent && item.object.value === viewerUser.webId)
    .map(item => item.subject.value))
  const hasPredicate = (predicate: string): boolean => quads.some(item =>
    viewerSubjects.has(item.subject.value) &&
    item.predicate.value === predicate &&
    item.object.value === folderUrl
  )
  expect(hasPredicate(acl.accessTo)).toBe(true)
  expect(hasPredicate('http://www.w3.org/ns/auth/acl#default')).toBe(true)
}

async function assertViewerAuthorization (
  ownerPage: import('@playwright/test').Page,
  viewerPage: import('@playwright/test').Page,
  resource: ResourceCase,
  expected: { folder: boolean, child: boolean }
): Promise<void> {
  const folderRead = await solidRequest(viewerPage, resource.folderUrl!)
  const childRead = await solidRequest(viewerPage, resource.fileUrl)
  expect(folderRead.status >= 200 && folderRead.status < 300).toBe(expected.folder)
  expect(childRead.status >= 200 && childRead.status < 300).toBe(expected.child)
  for (const url of [resource.folderUrl!, resource.fileUrl]) {
    const write = await solidRequest(viewerPage, url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'viewer must not write'
    })
    expect([401, 403, 405]).toContain(write.status)
  }
  // Keep the owner session live through the authorization assertions so the
  // test can still dispose the resources if the viewer request fails.
  expect(await solidRequest(ownerPage, resource.folderUrl!).then(response => response.status)).toBe(200)
}

test.describe('server-side ACL authorization', () => {
  // Run sequentially without skipping independent scenarios after a failure.
  test.describe.configure({ mode: 'default' })
  test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 })
  test.setTimeout(180_000)

  test.beforeEach(async ({ page, viewer }) => {
    if (!hasConfiguredViewerUser()) {
      throw new Error('Server-side ACL tests require viewer credentials. Run setup:local for the default localhost:3100 runtime, or set E2E_VIEWER_* for an external server.')
    }
    await authenticateSolidUser(page, ownerUser)
  })

  test('allows a granted viewer to read a file but rejects writes', async ({ page, viewer }) => {
    const resource = await makeFile(page, 'viewer')
    try {
      await grant(page, resource.aclUrl, resource.fileUrl, viewerUser.webId)
      const viewerContext = await page.context().browser()?.newContext()
      if (!viewerContext) throw new Error('Could not create a viewer browser context.')
      const viewerPage = await viewerContext.newPage()
      try {
        await authenticateSolidUser(viewerPage, viewer)
        const read = await solidRequest(viewerPage, resource.fileUrl)
        expect(read.status).toBe(200)
        const write = await solidRequest(viewerPage, resource.fileUrl, {
          method: 'PUT',
          headers: { 'content-type': 'text/plain' },
          body: 'viewer must not write'
        })
        expect([401, 403, 405]).toContain(write.status)
      } finally {
        await closeViewerContext(viewerContext)
      }
    } finally {
      await dispose(page, resource)
    }
  })

  for (const scenario of [
    {
      name: 'default Folder and contents',
      scope: 'folder+contents' as const,
      authorization: { folder: true, child: true }
    }
  ]) {
    test(`applies the UI ${scenario.name} scope and enforces it`, async ({ page, viewer }) => {
      const runtime = getLocalRuntime()
      const folderUrl = await createFolder(page, runtime.podUrl, `e2e-acl-${Date.now()}-${scenario.scope.replace('+', '-')}`)
      const resource: ResourceCase = {
        folderUrl,
        fileUrl: '',
        aclUrl: await aclFor(page, folderUrl)
      }
      const viewerContext = await page.context().browser()?.newContext()
      if (!viewerContext) throw new Error('Could not create a viewer browser context.')
      const viewerPage = await viewerContext.newPage()
      try {
        await openManageAccessForFolder(page, folderUrl)
        await selectViewerGrant(page)
        await saveContainerScope(page, scenario.scope)
        await assertViewerScope(page, resource.aclUrl, folderUrl, scenario.scope)

        resource.fileUrl = await createResource(page, folderUrl, 'child.txt', 'ACL UI scope child', 'text/plain')
        await authenticateSolidUser(viewerPage, viewer)
        await assertViewerAuthorization(page, viewerPage, resource, scenario.authorization)
      } finally {
        await closeViewerContext(viewerContext)
        await dispose(page, resource)
      }
    })
  }

  test('covers every supported role on a regular resource', async ({ page, viewer }) => {
    const viewerContext = await page.context().browser()?.newContext()
    if (!viewerContext) throw new Error('Could not create a viewer browser context.')
    const viewerPage = await viewerContext.newPage()
    try {
      await authenticateSolidUser(viewerPage, viewer)
      for (const role of accessRoles) {
        const resource = await makeFile(page, `role-${role.toLowerCase()}`)
        try {
          await openManageAccessForResource(page, resource.fileUrl, false)
          await selectViewerGrant(page, role)
          await saveContainerScope(page, 'folder+contents')
          await assertAgentGrant(page, resource.aclUrl, resource.fileUrl, accessRoleModes[role])

          const read = await solidRequest(viewerPage, resource.fileUrl)
          expect(read.status >= 200 && read.status < 300).toBe(accessRoleModes[role].includes(acl.read))
          const write = await solidRequest(viewerPage, resource.fileUrl, {
            method: 'PUT',
            headers: { 'content-type': 'text/plain' },
            body: `role ${role} write probe`
          })
          expect(write.status >= 200 && write.status < 300).toBe(accessRoleModes[role].includes(acl.write))
        } finally {
          await dispose(page, resource)
        }
      }
    } finally {
      await closeViewerContext(viewerContext)
    }
  })

  test('covers every supported role on a container and its default contents', async ({ page, viewer }) => {
    for (const role of accessRoles) {
      const folderUrl = await createFolder(page, getLocalRuntime().podUrl, `e2e-acl-container-role-${role.toLowerCase()}-${Date.now()}`)
      const resource: ResourceCase = {
        folderUrl,
        fileUrl: '',
        aclUrl: ''
      }
      resource.aclUrl = await aclFor(page, folderUrl)
      try {
        await openManageAccessForFolder(page, folderUrl)
        await selectViewerGrant(page, role)
        await saveContainerScope(page, 'folder+contents')
        await assertAgentGrant(page, resource.aclUrl, folderUrl, accessRoleModes[role], folderUrl)

        resource.fileUrl = await createResource(page, folderUrl, 'child.txt', 'ACL role matrix child', 'text/plain')
        const viewerContext = await page.context().browser()?.newContext()
        if (!viewerContext) throw new Error('Could not create a viewer browser context.')
        const viewerPage = await viewerContext.newPage()
        try {
          await authenticateSolidUser(viewerPage, viewer)
          const folderRead = await solidRequest(viewerPage, folderUrl)
          const childRead = await solidRequest(viewerPage, resource.fileUrl)
          const canRead = accessRoleModes[role].includes(acl.read)
          expect(folderRead.status >= 200 && folderRead.status < 300).toBe(canRead)
          expect(childRead.status >= 200 && childRead.status < 300).toBe(canRead)
        } finally {
          await closeViewerContext(viewerContext)
        }
      } finally {
        await dispose(page, resource)
      }
    }
  })

  test('edits and removes grants on both regular resources and containers', async ({ page }) => {
    const resources: ResourceCase[] = [
      await makeFile(page, 'edit-remove'),
      {
        folderUrl: await createFolder(page, getLocalRuntime().podUrl, `e2e-acl-edit-remove-${Date.now()}`),
        fileUrl: '',
        aclUrl: ''
      }
    ]
    resources[1].aclUrl = await aclFor(page, resources[1].folderUrl!)
    for (const resource of resources) {
      try {
        await openManageAccessForResource(page, resource.folderUrl ?? resource.fileUrl, Boolean(resource.folderUrl))
        await selectViewerGrant(page, 'Viewer')
        await saveContainerScope(page, 'folder+contents')

        await openManageAccessForResource(page, resource.folderUrl ?? resource.fileUrl, Boolean(resource.folderUrl))
        const viewerRow = page.locator('solid-ui-access-control-modal .access-grants-list li').last()
        await selectRole(viewerRow.locator('solid-ui-combobox input[role="combobox"]'), 'Editor')
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
        await expect(page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')).toHaveCount(0)
        await assertAgentGrant(page, resource.aclUrl, resource.folderUrl ?? resource.fileUrl, accessRoleModes.Editor, resource.folderUrl)

        await openManageAccessForResource(page, resource.folderUrl ?? resource.fileUrl, Boolean(resource.folderUrl))
        const updatedViewerRow = page.locator('solid-ui-access-control-modal .access-grants-list li').last()
        await selectRole(updatedViewerRow.locator('solid-ui-combobox input[role="combobox"]'), 'No Access')
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
        await expect(page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')).toHaveCount(0)
        await assertNoAgentGrant(page, resource.aclUrl)
      } finally {
        await dispose(page, resource)
      }
    }
  })

  test('replaces contents access in a combined container grant without retaining stale modes', async ({ page }) => {
    const resource: ResourceCase = {
      folderUrl: await createFolder(page, getLocalRuntime().podUrl, `e2e-acl-combined-${Date.now()}`),
      fileUrl: '',
      aclUrl: ''
    }
    const folderUrl = resource.folderUrl!
    resource.aclUrl = await aclFor(page, folderUrl)
    const aclUrl = resource.aclUrl!
    try {
      await grant(page, aclUrl, folderUrl, viewerUser.webId, {
        defaultResource: folderUrl,
        modes: [acl.read, acl.write],
        conditionDescription: 'trusted client only'
      })
      await openManageAccessForFolder(page, folderUrl)
      const viewerRow = page.locator('solid-ui-access-control-modal .access-grants-list li').last()
      await selectRole(viewerRow.locator('solid-ui-combobox input[role="combobox"]'), 'Viewer')
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
      await expect(page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')).toHaveCount(0)
      await assertAgentGrant(page, aclUrl, folderUrl, accessRoleModes.Viewer, folderUrl)
      const quads = await readAcl(page, aclUrl)
      const viewerSubjects = new Set(quads
        .filter(item => item.predicate.value === acl.agent && item.object.value === viewerUser.webId)
        .map(item => item.subject.value))
      expect(viewerSubjects.size).toBeGreaterThan(0)
      for (const subject of viewerSubjects) {
        expect(quads.some(item =>
          item.subject.value === subject &&
          item.predicate.value === aclCondition)).toBe(true)
      }
    } finally {
      await dispose(page, resource)
    }
  })

  test('preserves conditions when editing an inherited conditional grant', async ({ page }) => {
    const parentUrl = await createFolder(page, getLocalRuntime().podUrl, `e2e-acl-inherited-condition-${Date.now()}`)
    const childUrl = new URL('child/', parentUrl).toString()
    const child: ResourceCase = { folderUrl: childUrl, fileUrl: '', aclUrl: '' }
    const parentAclUrl = await aclFor(page, parentUrl)
    try {
      await grant(page, parentAclUrl, parentUrl, viewerUser.webId, {
        defaultResource: parentUrl,
        modes: [acl.read, acl.write],
        conditionDescription: 'trusted client only'
      })
      await createFolder(page, parentUrl, 'child')
      child.aclUrl = await aclFor(page, childUrl)
      await openManageAccessForFolder(page, childUrl)
      const viewerRow = page.locator('solid-ui-access-control-modal .access-grants-list li').last()
      await selectRole(viewerRow.locator('solid-ui-combobox input[role="combobox"]'), 'Viewer')
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
      await expect(page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')).toHaveCount(0)

      const quads = await readAcl(page, child.aclUrl)
      const viewerSubjects = new Set(quads
        .filter(item => item.predicate.value === acl.agent && item.object.value === viewerUser.webId)
        .map(item => item.subject.value))
      expect(viewerSubjects.size).toBeGreaterThan(0)
      for (const subject of viewerSubjects) {
        expect(quads.some(item =>
          item.subject.value === subject &&
          item.predicate.value === aclCondition)).toBe(true)
      }
    } finally {
      await dispose(page, child)
      await dispose(page, { folderUrl: parentUrl, fileUrl: '', aclUrl: parentAclUrl })
    }
  })

  test('saves several principal and general-access changes together', async ({ page }) => {
    const resource = await makeFile(page, 'batch')
    try {
      await openManageAccessForResource(page, resource.fileUrl, false)
      await selectViewerGrant(page, 'Editor')
      await selectRole(page.locator('solid-ui-access-control-modal .access-role-select--authenticated input'), 'Viewer')
      await selectPublicRole(page.locator('solid-ui-access-control-modal .access-role-select--public input'), 'Viewer')
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
      await expect(page.locator('solid-ui-access-control-modal solid-ui-dialog dialog')).toHaveCount(0)

      await assertAgentGrant(page, resource.aclUrl, resource.fileUrl, accessRoleModes.Editor)
      const quads = await readAcl(page, resource.aclUrl)
      expect(quads.some(item =>
        item.predicate.value === aclAgentClass &&
        item.object.value === authenticatedAgent &&
        quads.some(candidate =>
          candidate.subject.equals(item.subject) &&
          candidate.predicate.value === acl.accessTo &&
          candidate.object.value === resource.fileUrl &&
          quads.some(mode => mode.subject.equals(item.subject) && mode.predicate.value === acl.mode && mode.object.value === acl.read)
        )
      )).toBe(true)
      expect(quads.some(item =>
        item.predicate.value === aclAgentClass &&
        item.object.value === foafAgent &&
        quads.some(candidate =>
          candidate.subject.equals(item.subject) &&
          candidate.predicate.value === acl.accessTo &&
          candidate.object.value === resource.fileUrl
        )
      )).toBe(true)
    } finally {
      await dispose(page, resource)
    }
  })

  test('allows unauthenticated public reads when a public Read grant is supported', async ({ page, request }) => {
    const resource = await makeFile(page, 'public')
    try {
      await grant(page, resource.aclUrl, resource.fileUrl, foafAgent, { publicAgent: true })
      const response = await request.get(resource.fileUrl)
      expect(response.status()).toBe(200)
      expect(await response.text()).toContain('ACL E2E')
    } finally {
      await dispose(page, resource)
    }
  })
})
