import { expect, type Page } from '@playwright/test'

export type FolderPaneCase = {
  resourceUrl: string
  paneName: string
}

export type NestedFolderPaneCase = {
  levels: string[]
  fileUrl: string
}

export type SearchFolderPaneCase = {
  alphaUrl: string
  betaUrl: string
  unrelatedUrl: string
}

export type SlideshowFolderPaneCase = {
  containerUrl: string
  imageUrls: [string, string]
}

type MintablePane = {
  name: string
  mintClass: string
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

export async function seedRepresentativeFolderPaneCases (
  page: Page,
  containerUrl: string
): Promise<FolderPaneCase[]> {
  const panes = await page.evaluate(() => {
    const registered = (window as typeof window & {
      panes?: { list?: Array<{ name?: string, global?: boolean, mintClass?: { uri?: string }, render?: unknown }> }
    }).panes?.list || []
    return registered
      .filter((pane): pane is { name: string, mintClass: { uri: string } } =>
        !pane.global && pane.name !== 'questionnaire' && typeof pane.render === 'function' &&
        typeof pane.name === 'string' && typeof pane.mintClass?.uri === 'string'
      )
      .map(pane => ({ name: pane.name, mintClass: pane.mintClass.uri }))
  }) as MintablePane[]

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const cases: FolderPaneCase[] = []
  for (const pane of panes) {
    const slug = `folder-pane-representative-${runId}-${encodeURIComponent(pane.name)}.ttl`
    const resourceUrl = new URL(slug, containerUrl).toString()
    const statements = [
      `<${resourceUrl}> <${RDF_TYPE}> <${pane.mintClass}>.`,
      `<${resourceUrl}#this> <${RDF_TYPE}> <${pane.mintClass}>.`
    ]
    // Meeting's ordered tabs require a tool list, even when it is empty.
    if (pane.name === 'meeting') {
      statements.push(`<${resourceUrl}> <http://www.w3.org/ns/pim/meeting#toolList> ().`)
    }
    const turtle = statements.join('\n')
    await createResource(page, containerUrl, slug, turtle, 'text/turtle')
    cases.push({ resourceUrl, paneName: pane.name })
  }

  const javascriptSlug = `folder-pane-representative-${runId}.js`
  const javascriptUrl = new URL(javascriptSlug, containerUrl).toString()
  await createResource(page, containerUrl, javascriptSlug, 'export const seeded = true\n', 'text/javascript')
  cases.push({ resourceUrl: javascriptUrl, paneName: 'source' })
  return cases
}

export async function seedNestedFolderPaneCase (
  page: Page,
  containerUrl: string
): Promise<NestedFolderPaneCase> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const rootSlug = `folder-pane-nested-${runId}`
  const root = await createContainer(page, containerUrl, rootSlug)
  const one = await createContainer(page, root, 'one')
  const two = await createContainer(page, one, 'two')
  const levels = [root, one, two]
  const fileUrl = new URL('seeded.js', levels.at(-1)!).toString()
  await putResource(page, fileUrl, 'export const nested = true\n', 'text/javascript')
  return { levels, fileUrl }
}

export async function seedFriendProfile (
  page: Page,
  containerUrl: string
): Promise<string> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const profileUrl = new URL(`folder-pane-friend-${runId}.ttl`, containerUrl).toString()
  await putResource(page, profileUrl, '<#me> a <http://xmlns.com/foaf/0.1/Person>.\n', 'text/turtle')
  return `${profileUrl}#me`
}

export async function seedSearchFolderPaneCase (
  page: Page,
  containerUrl: string
): Promise<SearchFolderPaneCase> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const names = {
    alpha: `Folder Pane Search Alpha ${runId}.txt`,
    beta: `Folder Pane Search Beta ${runId}.txt`,
    unrelated: `Folder Pane Unrelated ${runId}.txt`
  }

  for (const name of Object.values(names)) {
    await createResource(page, containerUrl, name, `seeded ${name}\n`, 'text/plain')
  }

  return {
    alphaUrl: new URL(names.alpha, containerUrl).toString(),
    betaUrl: new URL(names.beta, containerUrl).toString(),
    unrelatedUrl: new URL(names.unrelated, containerUrl).toString()
  }
}

export async function seedSlideshowFolderPaneCase (
  page: Page,
  containerUrl: string
): Promise<SlideshowFolderPaneCase> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const slideshowContainer = await createContainer(page, containerUrl, `slideshow-${runId}`)
  const imageUrls = [
    new URL('slide-1.svg', slideshowContainer).toString(),
    new URL('slide-2.svg', slideshowContainer).toString()
  ] as [string, string]

  await Promise.all(imageUrls.map((imageUrl, index) =>
    putResource(
      page,
      imageUrl,
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${index === 0 ? 'teal' : 'purple'}"/></svg>`,
      'image/svg+xml'
    )
  ))

  const webId = await page.evaluate(() => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { info?: { webId?: string } } }
    }).SolidLogic?.authSession
    if (!session?.info?.webId) throw new Error('The folder-pane test has no authenticated Solid session.')
    return session.info.webId
  })
  const acl = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

<#public>
    a acl:Authorization;
    acl:agentClass foaf:Agent;
    acl:accessTo <./>;
    acl:default <./>;
    acl:mode acl:Read.

<#owner>
    a acl:Authorization;
    acl:agent <${webId}>;
    acl:accessTo <./>;
    acl:default <./>;
    acl:mode acl:Read, acl:Write, acl:Control.
`
  await putResource(page, new URL('.acl', slideshowContainer).toString(), acl, 'text/turtle')

  return { containerUrl: slideshowContainer, imageUrls }
}

async function createContainer (page: Page, parentUrl: string, slug: string): Promise<string> {
  const response = await authenticatedRequest(page, parentUrl, 'POST', ' ', 'text/turtle', {
    slug: `${slug}/`,
    link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
  })
  expect(response.ok, `Could not create container ${slug}: ${response.status}`).toBeTruthy()
  return new URL(`${slug}/`, parentUrl).toString()
}

async function createResource (
  page: Page,
  containerUrl: string,
  slug: string,
  body: string,
  contentType: string
): Promise<void> {
  const response = await authenticatedRequest(page, containerUrl, 'POST', body, contentType, { slug })
  expect(response.ok, `Could not create ${slug}: ${response.status}`).toBeTruthy()
}

async function putResource (
  page: Page,
  url: string,
  body: string,
  contentType: string,
  headers: Record<string, string> = {}
): Promise<void> {
  const response = await authenticatedRequest(page, url, 'PUT', body, contentType, headers)
  expect(response.ok, `Could not write ${url}: ${response.status}`).toBeTruthy()
}

async function authenticatedRequest (
  page: Page,
  url: string,
  method: string,
  body: string,
  contentType: string,
  headers: Record<string, string> = {}
): Promise<{ ok: boolean, status: number }> {
  return page.evaluate(async ({ url, method, body, contentType, headers }) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { fetch?: typeof fetch, authFetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const authenticatedFetch = session?.authFetch ?? session?.fetch
    if (!authenticatedFetch) throw new Error('The folder-pane test has no authenticated Solid session.')
    const response = await authenticatedFetch.call(session, url, {
      method,
      body,
      headers: { ...headers, 'content-type': contentType }
    })
    return { ok: response.ok, status: response.status }
  }, { url, method, body, contentType, headers })
}
