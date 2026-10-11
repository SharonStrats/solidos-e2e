import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const solidUiDist = resolve(root, '../solid-ui/dist')
const hostFile = resolve(root, 'test-host/access-control.html')
const port = Number(process.env.PORT || 3101)

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
}

function sendFile (response, file) {
  response.writeHead(200, {
    'content-type': contentTypes[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store'
  })
  createReadStream(file).pipe(response)
}

createServer((request, response) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname

  if (pathname === '/' || pathname === '/access-control') {
    sendFile(response, hostFile)
    return
  }

  if (pathname.startsWith('/solid-ui/')) {
    const relativePath = normalize(pathname.slice('/solid-ui/'.length))
    const file = resolve(solidUiDist, relativePath)

    if (file.startsWith(`${solidUiDist}${sep}`) && existsSync(file)) {
      sendFile(response, file)
      return
    }
  }

  if (pathname === '/shared-resource.acl') {
    response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/turtle' })
    response.end('')
    return
  }

  response.writeHead(404)
  response.end('Not found')
}).listen(port, '127.0.0.1', () => {
  console.log(`Access-control E2E host listening at http://127.0.0.1:${port}`)
})
