import { readFile } from 'node:fs/promises'
import { DataFactory, Parser, type Quad } from 'n3'
import type { Page } from '@playwright/test'
import { getLocalRuntime } from './local-runtime.js'

export const rdf = {
  foaf: 'http://xmlns.com/foaf/0.1/',
  schema: 'http://schema.org/',
  solid: 'http://www.w3.org/ns/solid/terms#',
  vcard: 'http://www.w3.org/2006/vcard/ns#'
}

export async function readPersistedProfile(page: Page): Promise<Quad[]> {
  const runtime = getLocalRuntime()
  const response = await page.request.get(runtime.profileUrl, {
    headers: { Accept: 'text/turtle' }
  })

  if (!response.ok()) {
    throw new Error(`Could not read authenticated profile Turtle: HTTP ${response.status()}`)
  }

  return new Parser({ baseIRI: runtime.profileUrl }).parse(await response.text())
}

export async function readLocalProfileFile(): Promise<Quad[]> {
  const runtime = getLocalRuntime()
  if (!runtime.profileFile) {
    throw new Error('The local runtime does not include a provider profile file.')
  }

  return new Parser({ baseIRI: runtime.profileUrl }).parse(await readFile(runtime.profileFile, 'utf8'))
}

export function hasLiteral(quadList: Quad[], subject: string, predicate: string, value: string): boolean {
  return quadList.some((quad) =>
    quad.subject.value === subject &&
    quad.predicate.value === predicate &&
    quad.object.termType === 'Literal' &&
    quad.object.value === value
  )
}

export function rdfListMembers(quadList: Quad[], subject: string, predicate: string): string[] {
  const { namedNode } = DataFactory
  const first = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#first')
  const rest = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#rest')
  const nil = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'
  let cursor = quadList.find((quad) =>
    quad.subject.value === subject && quad.predicate.value === predicate
  )?.object
  const members: string[] = []

  while (cursor && cursor.value !== nil) {
    const current = cursor
    const item = quadList.find((quad) => quad.subject.equals(current) && quad.predicate.equals(first))?.object
    const next = quadList.find((quad) => quad.subject.equals(current) && quad.predicate.equals(rest))?.object
    if (!item || !next) throw new Error(`Malformed RDF list for ${predicate}`)
    members.push(item.value)
    cursor = next
  }

  return members
}
