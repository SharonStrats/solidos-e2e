import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.env.PORT || 3101)
const hostFile = resolve(root, 'test-host/access-control.html')

const turtle = (response, body) => {
  response.writeHead(200, {
    'access-control-allow-origin': '*',
    'content-type': 'text/turtle'
  })
  response.end(body)
}

const middleware = (request, response, next) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname

  if (pathname === '/shared-resource.acl') {
    turtle(response, '')
    return
  }

  if (pathname === '/shared-resource' || pathname === '/shared-folder/' || pathname === '/shared-folder') {
    const aclPath = pathname.startsWith('/shared-folder')
      ? '/shared-folder/.acl'
      : '/shared-resource.acl'
    response.writeHead(200, {
      'access-control-allow-origin': '*',
      'content-type': 'text/plain',
      link: `<http://127.0.0.1:3101${aclPath}>; rel="acl"`
    })
    response.end('E2E shared resource')
    return
  }

  if (pathname === '/shared-folder/.acl') {
    turtle(response, '')
    return
  }

  if (pathname === '/profile/card') {
    turtle(response, `
      @prefix acl: <http://www.w3.org/ns/auth/acl#>.
      <#me> acl:trustedApp <#trusted-app>.
      <#trusted-app> acl:origin <https://trusted.example.test/>.
      <https://other-user.example/profile/card#me> acl:trustedApp <#unrelated-app>.
      <#unrelated-app> acl:origin <https://unrelated.example.test/>.
    `)
    return
  }

  if (pathname === '/protected-root.acl') {
    turtle(response, `
      @prefix acl: <http://www.w3.org/ns/auth/acl#>.
      <#owner> a acl:Authorization;
        acl:accessTo <http://127.0.0.1:3101/>;
        acl:agent <http://127.0.0.1:3101/profile/card#me>;
        acl:mode acl:Read, acl:Write, acl:Control.
      <#viewer> a acl:Authorization;
        acl:accessTo <http://127.0.0.1:3101/>;
        acl:agent <http://127.0.0.1:3101/subjects/viewer#me>;
        acl:mode acl:Read.
    `)
    return
  }

  if (pathname === '/subjects/agent') {
    turtle(response, '@prefix foaf: <http://xmlns.com/foaf/0.1/>. <> a foaf:PersonalProfileDocument. <#me> a foaf:Person; foaf:name "E2E Agent".')
    return
  }

  if (pathname === '/subjects/viewer') {
    turtle(response, '@prefix foaf: <http://xmlns.com/foaf/0.1/>. <> a foaf:PersonalProfileDocument. <#me> a foaf:Person; foaf:name "E2E Viewer".')
    return
  }

  if (pathname === '/subjects/group') {
    turtle(response, '@prefix vcard: <http://www.w3.org/2006/vcard/ns#>. <> a vcard:Group; vcard:fn "E2E Group".')
    return
  }

  if (pathname === '/ns/auth/acl') {
    turtle(response, '@prefix acl: <http://www.w3.org/ns/auth/acl#>. @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>. acl:AuthenticatedAgent rdfs:label "Authenticated agents".')
    return
  }

  if (pathname === '/') {
    response.setHeader('Link', '<http://127.0.0.1:3101/protected-root.acl>; rel="acl"')
  }

  next()
}

const server = await createServer({
  root,
  optimizeDeps: {
    force: true
  },
  server: {
    host: '127.0.0.1',
    port,
    middlewareMode: false
  },
  resolve: {
    preserveSymlinks: true
  },
  plugins: [{
    name: 'access-control-fixtures',
    configureServer (vite) {
      vite.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname
        if (pathname === '/' || pathname === '/access-control') {
          const html = await vite.transformIndexHtml(pathname, readFileSync(hostFile, 'utf8'))
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            ...(pathname === '/'
              ? { Link: '<http://127.0.0.1:3101/protected-root.acl>; rel="acl"' }
              : {})
          })
          response.end(html)
          return
        }
        middleware(request, response, next)
      })
    }
  }]
})

if (!existsSync(hostFile)) throw new Error(`Missing access-control host: ${hostFile}`)
await server.listen()
console.log(`Access-control E2E host listening at http://127.0.0.1:${port}`)
