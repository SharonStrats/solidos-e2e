import { writeFile } from 'node:fs/promises'
import { getLocalRuntime } from './local-runtime.js'

function seededProfileTurtle(webId: string, issuer: string, podUrl: string): string {
  const profileDocument = webId.replace(/#me$/, '')
  const preferencesUrl = new URL('settings/prefs.ttl', podUrl).toString()
  return `@prefix foaf: <http://xmlns.com/foaf/0.1/>.
@prefix pim: <http://www.w3.org/ns/pim/space#>.
@prefix schema: <http://schema.org/>.
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.

<${profileDocument}>
    a foaf:PersonalProfileDocument;
    foaf:maker <${webId}>;
    foaf:primaryTopic <${webId}>.

<${webId}>
    a foaf:Person;
    vcard:fn "E2E Test Profile";
    foaf:name "E2E Test Profile";
    vcard:note "Seeded profile used by SolidOS Playwright tests.";
    schema:knowsLanguage (
      [ solid:publicId <https://www.w3.org/ns/iana/language-code/en> ]
      [ solid:publicId <https://www.w3.org/ns/iana/language-code/es> ]
    );
    foaf:account (
      <#e2e-github>
      <#e2e-facebook>
    );
    solid:preferredSubjectPronoun "They";
    solid:preferredObjectPronoun "Them";
    pim:storage <${podUrl}>;
    pim:preferencesFile <${preferencesUrl}>;
    solid:oidcIssuer <${issuer}/>.

<#e2e-github>
    a <https://solidos.github.io/profile-pane/src/ontology/socialMedia.ttl#GithubAccount>;
    foaf:name "GitHub";
    foaf:accountName "e2e-github".

<#e2e-facebook>
    a <https://solidos.github.io/profile-pane/src/ontology/socialMedia.ttl#FacebookAccount>;
    foaf:name "Facebook";
    foaf:accountName "e2e-facebook".
`
}

export async function resetLocalProfile(): Promise<void> {
  const runtime = getLocalRuntime()
  if (!runtime.profileFile) {
    throw new Error('The local runtime does not include a disposable profile file to reset.')
  }

  await writeFile(
    runtime.profileFile,
    seededProfileTurtle(runtime.webId, new URL(runtime.profileUrl).origin, runtime.podUrl)
  )
  console.log(`[e2e ${new Date().toISOString()}] Reset disposable profile file: ${runtime.profileFile}`)
}
