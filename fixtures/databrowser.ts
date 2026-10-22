import { expect, type Page } from '@playwright/test'

export type DatabrowserSeed = {
  containerUrl: string
  documentUrl: string
  textUrl: string
  htmlUrl: string
  otherUrl: string
  mimeMismatchUrl: string
  subjectUrl: string
}

export async function seedDatabrowserResources (page: Page, podUrl: string): Promise<DatabrowserSeed> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const containerUrl = new URL(`databrowser-e2e-${runId}/`, podUrl).toString()
  const documentUrl = new URL('resource.ttl', containerUrl).toString()
  const textUrl = new URL('document.txt', containerUrl).toString()
  const htmlUrl = new URL('preview.html', containerUrl).toString()
  const otherUrl = new URL('other-user-resource.txt', containerUrl).toString()
  const mimeMismatchUrl = new URL('preview-mime-mismatch.bin', containerUrl).toString()
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
  <http://schema.org/creator> <${subjectUrl}-creator> ;
  dcterms:description "A seeded RDF document for browser navigation." .
<${subjectUrl}-creator> <http://schema.org/name> "Databrowser E2E creator" .
`, 'text/turtle')
  await request(page, textUrl, 'PUT', 'Databrowser E2E text document\n', 'text/plain')
await request(page, otherUrl, 'PUT', 'This resource must remain unchanged.\n', 'text/plain')
await request(page, mimeMismatchUrl, 'PUT', '<html><body>Initial non-HTML response</body></html>\n', 'image/png')
await request(
  page,
  htmlUrl,
  'PUT',
  `<!doctype html>
<html>
<head>
  <script src="https://dokie.li/scripts/dokieli.js"></script>
</head>
<body>
  <h1>Databrowser E2E HTML preview</h1>
  <script>
    Promise.all([
      fetch(${JSON.stringify(htmlUrl)}, {
        method: 'PUT',
        body: 'Dokieli exact-document save completed.'
      }),
      fetch(${JSON.stringify(otherUrl)}, {
        method: 'PUT',
        body: 'This cross-resource write must be rejected.'
      })
    ])
  </script>
</body>
</html>
`,
  'text/html'
)

return { containerUrl, documentUrl, textUrl, htmlUrl, otherUrl, mimeMismatchUrl, subjectUrl }
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

export async function writeAuthenticatedResource (
  page: Page,
  url: string,
  body: string,
  contentType: string
): Promise<void> {
  await request(page, url, 'PUT', body, contentType)
}

export async function readAuthenticatedResource (page: Page, url: string): Promise<string> {
  return page.evaluate(async resourceUrl => {
    const session = (window as typeof window & {
      SolidLogic?: { authSession?: { authFetch?: typeof fetch, fetch?: typeof fetch } }
    }).SolidLogic?.authSession
    const fetcher = session?.authFetch ?? session?.fetch
    if (!fetcher) throw new Error('The Databrowser test has no authenticated Solid session.')
    const response = await fetcher.call(session, resourceUrl)
    if (!response.ok) throw new Error(`Could not read ${resourceUrl}: ${response.status}`)
    return response.text()
  }, url)
}
