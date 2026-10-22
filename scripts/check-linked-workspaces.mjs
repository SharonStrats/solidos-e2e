import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const e2eRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workspaceRoot = resolve(e2eRoot, '..')
const packages = ['solid-logic', 'solid-ui', 'folder-pane', 'solid-panes']

for (const name of packages) {
  const link = resolve(e2eRoot, 'node_modules', name)
  const expected = resolve(workspaceRoot, name)
  if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`${name} is not linked in ${link}; run npm install in workspaces/solidos-e2e`)
  }
  if (realpathSync(link) !== realpathSync(expected)) {
    throw new Error(`${name} points to ${realpathSync(link)} instead of ${expected}`)
  }
  const manifest = JSON.parse(readFileSync(resolve(expected, 'package.json'), 'utf8'))
  const entry = resolve(expected, manifest.exports?.['.']?.import || manifest.module)
  if (!existsSync(entry)) throw new Error(`${name} is linked but not built: ${entry}`)

  const rdflibManifest = resolve(expected, 'node_modules/rdflib/package.json')
  const rdflibVersion = JSON.parse(readFileSync(rdflibManifest, 'utf8')).version
  if (rdflibVersion !== '2.4.1') {
    throw new Error(`${name} uses rdflib ${rdflibVersion}; expected 2.4.1`)
  }
}

console.log(`Linked workspace packages ready: ${packages.join(', ')}; rdflib 2.4.1`)
