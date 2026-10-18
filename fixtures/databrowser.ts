import { expect, type Page } from '@playwright/test'

export type DatabrowserSeed = {
  containerUrl: string
  documentUrl: string
  textUrl: string
  subjectUrl: string
}

export async function seedDatabrowserResources (page: Page, podUrl: string): Promise<DatabrowserSeed> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const containerUrl = new URL(`databrowser-e2e-${runId}/`, podUrl).toString()
  const documentUrl = new URL('resource.ttl', containerUrl).toString()
  const textUrl = new URL('document.txt', containerUrl).toString()
  const subjectUrl = `${documentUrl}#resource`

  const parentUrl = podUrl.endsWith('/') ? podUrl : `${podUrl}/`
  const slug = new URL(containerUrl).pathname.split('/').filter(Boolean).at(-1)!
  await request(page, parentUrl, 'POST', ' ', 'text/turtle', {
    slug: `${slug}/`,
    link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
  })
  await request(page, documentUrl, 'PUT', `@prefix dcterms: <http://purl.org/dc/terms/> .
<${subjectUrl}> a <http://schema.org/CreativeWork> ;
  <http://schema.org/name> "Databrowser E2E resource" ;
  dcterms:description "A seeded RDF document for browser navigation." .
`, 'text/turtle')
  await request(page, textUrl, 'PUT', 'Databrowser E2E text document\n', 'text/plain')

  return { containerUrl, documentUrl, textUrl, subjectUrl }
}

async function request (
  page: Page,
  url: string,
  method: string,
  body: string,
  contentType: string,
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  const result = await page.evaluate(async ({ url, method, body, contentType, extraHeaders }) => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { authFetch?: typeof fetch, fetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const fetcher = session?.authFetch ?? session?.fetch
    if (!fetcher) throw new Error('The Databrowser test has no authenticated Solid session.')
    const response = await fetcher.call(session, url, {
      method,
      body,
      headers: { ...extraHeaders, 'content-type': contentType }
    })
    return { ok: response.ok, status: response.status }
  }, { url, method, body, contentType, extraHeaders })
  expect(result.ok, `Could not seed ${url}: ${result.status}`).toBeTruthy()
}
