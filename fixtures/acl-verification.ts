import { DataFactory, Parser, type Quad } from 'n3'
import type { APIResponse, APIRequestContext } from '@playwright/test'

export const acl = {
  accessTo: 'http://www.w3.org/ns/auth/acl#accessTo',
  agent: 'http://www.w3.org/ns/auth/acl#agent',
  mode: 'http://www.w3.org/ns/auth/acl#mode',
  read: 'http://www.w3.org/ns/auth/acl#Read',
  write: 'http://www.w3.org/ns/auth/acl#Write',
  control: 'http://www.w3.org/ns/auth/acl#Control'
}

export function findAclUrl(response: APIResponse, resourceUrl: string): string {
  const link = response.headers().link || ''
  const match = link.match(/<([^>]+)>;\s*rel=["']?acl["']?/i)
  if (!match) throw new Error(`No ACL link returned for ${resourceUrl}`)
  return new URL(match[1], resourceUrl).toString()
}

export async function readAcl(api: APIRequestContext, aclUrl: string): Promise<Quad[]> {
  const response = await api.get(aclUrl, { headers: { accept: 'text/turtle' } })
  if (!response.ok()) throw new Error(`Could not read ACL ${aclUrl}: HTTP ${response.status()}`)
  return new Parser({ baseIRI: aclUrl }).parse(await response.text())
}

export function hasGrant(quads: Quad[], resourceUrl: string, webId: string, modes: string[]): boolean {
  const { namedNode } = DataFactory
  const grants = quads.filter((quad) =>
    quad.predicate.value === acl.agent && quad.object.value === webId &&
    quads.some((candidate) => candidate.subject.equals(quad.subject) && candidate.predicate.value === acl.accessTo && candidate.object.value === resourceUrl)
  )
  return grants.some((grant) => modes.every((mode) =>
    quads.some((quad) => quad.subject.equals(grant.subject) && quad.predicate.value === acl.mode && quad.object.equals(namedNode(mode)))
  ))
}