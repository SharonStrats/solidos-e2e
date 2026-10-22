# SolidOS End-to-End Tests

`npm run test:local` runs the smoke, authenticated-profile, profile-navigation,
and Databrowser tests against `http://localhost:3100`. `npm run test:all` runs
that local workflow and the separate browser-based access-control dialog
workflow. The public profile-read tests use
`https://sharon.pivot-test.solidproject.org:3000/profile/card#me` by default and
can be overridden with `E2E_PROFILE_URL`.

Standalone Playwright tests for the SolidOS browser application. The suite is
kept separate from the SolidOS application workspace so it can test a running
deployment without changing application dependencies or source code.

## What this repository does

The test suite:

- drives SolidOS in a real Chromium browser;
- verifies accessible UI behavior;
- checks persisted RDF through authenticated HTTP responses;
- optionally checks the provider's local Turtle file;
- supports disposable local accounts for mutation tests;
- leaves the application untouched by default.

The default target is `http://localhost:3100`. The target URL and all
environment-specific values are configurable.

## Requirements

- Node.js 20 or newer;
- npm;
- a running SolidOS application;
- Chromium installed through Playwright;
- a local SolidOS checkout when using the disposable-account setup.

The E2E workspace normally attaches to an already-running application. It does
not start, reset, or modify the application unless startup or local setup is
explicitly enabled.

## Installation

From this workspace:

```bash
npm install
npx playwright install chromium
cp .env.example .env.local
npm run typecheck
npm run check-config
```

`.env.local` is ignored by Git. Store credentials, WebIDs, URLs, and other
machine-specific values there or in CI secret variables. Do not commit
authentication state, passwords, or generated runtime files.

## Running the tests

### Default E2E workflows

Start SolidOS on `http://localhost:3100`, then run this from the E2E workspace:

```bash
npm run test:all
```

The local workflow checks that the configured application URL is reachable
before creating runtime data or launching any E2E process. If
`http://localhost:3100` is down, it exits without starting setup, a browser, or
a watcher.

This runs the default localhost:3100 SolidOS tests first, followed by the
browser-driven access-control dialog tests. It does not include the separate
server-enforced ACL or folder-pane suites; run
`npm run test:access-control:server` and `npm run test:folder-pane` when those
are needed. If `.e2e-runtime.json` does not
exist, it creates disposable owner/viewer accounts and pods and seeds the
owner profile using `../pivot/data`; later runs reuse that runtime.
Set `E2E_PIVOT_DATA_ROOT` when using a different local environment. The access-
control cleanup command removes local fixture directories only when this
variable is supplied.

Public profile-read fixtures are skipped unless `E2E_PROFILE_URL` points to a
complete readable profile, because the disposable mutation profile is
intentionally minimal. To run those reads as part of the same command:

```bash
E2E_PROFILE_URL=http://localhost:3100/<public-profile>/profile/card#me \
npm run test:all
```

The command reports each workflow and exits unsuccessfully if any workflow
fails. Its `finally` cleanup removes matching access-control pods and saved
storage-state files, including those left by a setup that failed before
`.access-control-runtime.json` was written. It removes matching local fixture
directories only when `E2E_PIVOT_DATA_ROOT` is set. Account login deletion is
attempted but is not guaranteed; see the cleanup limitation below.

To clean only those resources explicitly:

```bash
E2E_PIVOT_DATA_ROOT=/absolute/path/to/pivot/data npm run cleanup:access-control
```

Cleanup only considers storage-state files named
`access-control-owner-*`/`access-control-viewer-*`, account logins beginning
with `e2e-acl-`, pods named `e2e-acl-owner-*` or `e2e-acl-viewer-*`, and matching
local fixture directories (when `E2E_PIVOT_DATA_ROOT` is set). Other accounts,
pods, and data are not selected. Login deletion can fail for the last-password-
login restriction described below.

The access-control tests are separate because they run a temporary Vite test
host on port 3101. The host resolves the linked workspace packages through
their normal package exports; it does not use the Solid UI CDN build, generated
ESM shims, or an import map:

```bash
npm run test:access-control
```

There are three functional test modes:

1. **Public profile reads** — run against a readable profile, including a
   locally running SolidOS application. These tests do not write data.
2. **Authenticated local mutations** — run against a disposable local account
   and profile created by `setup:local`. These tests create, update, reorder,
   and remove profile data, then verify the saved RDF.
3. **Access-control dialog behavior** — serves a focused test host containing
   the real dialog. It exercises sharing changes in the browser and verifies
   the resulting in-memory ACL mapping; it does not contact a pod or modify
   application data.

### Linked workspace setup

From this directory, install the E2E dependencies after building the linked
packages in dependency order (`solid-logic`, `solid-ui`, `folder-pane`,
`solid-panes`; `mashlib` is not required by this host):

```bash
npm install
npm run check:linked-workspaces
```

The E2E manifest uses `file:../solid-logic`, `file:../solid-ui`,
`file:../folder-pane`, and `file:../solid-panes`. npm installs these as
symlinks under `workspaces/solidos-e2e/node_modules`; do not replace them with
registry versions. Each linked workspace must have a built ESM entrypoint and
must resolve `rdflib` version `2.4.1`. The repository's existing `npm link`
workflow remains valid for linking dependencies between the workspaces; run
`npm install` in this E2E workspace afterward so its four direct links are
present.

The server-enforcement ACL suite exercises the real Manage Access UI and actual
pod authorization rather than only dialog output or generated patches. It
currently contains **9 sequential tests**: viewer read versus write on a file; the
UI's default **Folder and contents** scope with container and child
authorization; every supported role on a resource and on a container with
default contents; grant editing/removal; replacement of contents access in a
combined grant; preservation of an existing condition while editing; multiple
principal and general-access changes; and anonymous public reads when
supported. The live server suite does not exercise Folder-only or
Contents-only scope selection. Those advanced-scope behaviors are covered by
the focused dialog/UI suite with synthetic ACL data, not by pod enforcement.

On desktop, the server suite opens a file through its **View** menu item and
uses **Manage Access** in the file header. Containers use **Manage Access** in
their resource menu. The file resource menu does not expose that desktop action.

The server suite uses one worker and continues with independent scenarios after
a failure, rather than skipping the rest of a serial group. Actions and
authenticated resource requests have a 15-second timeout; navigation has a
30-second timeout. Each scenario retains its 180-second overall budget for
multi-role checks. Cleanup failures are reported as additional test failures
without replacing the original error. Traces are retained on failures, including
local runs without retries, under `test-results/`.

For the default `localhost:3100` run, if `.e2e-runtime.json` is absent, the
runner provisions disposable owner and viewer accounts and pods, seeds the
owner profile, authenticates both users through the live OIDC UI flow, runs the
tests, and attempts pod/runtime cleanup. Set `E2E_PIVOT_DATA_ROOT` if cleanup
should also remove the generated local fixture directories; setup uses
`../pivot/data` by default but cleanup does not infer that path. Generated
passwords are kept in the ignored runtime file. Playwright `storageState` does
not restore the localhost app's IndexedDB-backed OIDC session, so the ACL tests
explicitly log in and authorize in the browser; a saved storage-state snapshot
is not treated as authenticated credentials.

```bash
npm run test:access-control:server
```

The command expects SolidOS already running at `http://localhost:3100` and
automatically provisions missing disposable local runtime state. The wrapper
runs the server suite sequentially and performs cleanup in `finally`. For an
external SolidOS server, opt in explicitly and provide the application base
URL, both users' WebIDs and login credentials, and the owner's profile and pod
URLs. The external mode does not create accounts or pods:

```bash
E2E_EXTERNAL_SERVER=true \
E2E_BASE_URL=https://pod.example.test \
E2E_OWNER_WEBID=https://pod.example.test/owner/profile/card#me \
E2E_OWNER_USERNAME=owner \
E2E_OWNER_PASSWORD='provided-at-runtime' \
E2E_VIEWER_WEBID=https://pod.example.test/viewer/profile/card#me \
E2E_VIEWER_USERNAME=viewer \
E2E_VIEWER_PASSWORD='provided-at-runtime' \
E2E_PROFILE_URL=https://pod.example.test/owner/profile/card \
E2E_POD_URL=https://pod.example.test/owner/ \
npm run test:access-control:server
```

The suite authenticates the owner and viewer in the browser and removes
per-test resources after use. For local disposable runs, cleanup also removes
the disposable pods, their local Pivot fixture directories, runtime JSON, and
saved browser-state files when those can be identified. It is **not reliable
account-identity cleanup**: the current CSS v7 account API has no account
deletion endpoint and requires at least one password login. The cleanup script
attempts to delete generated password logins, but the API may reject deleting
the last login with HTTP 400. In that case, pod/data cleanup can succeed while
the owner and viewer identities remain; a warning may be printed even when the
wrapper exits with code 0. Do not interpret a “cleaned” summary line as proof
that test logins were removed.

Results depend on the running SolidOS deployment, linked workspace builds, and
the configured disposable runtime. This README does not claim that the current
tests pass; inspect the Playwright result and exit status from each run.

The focused dialog suite also covers mixed authorization entries (a folder rule
and a contents-default rule), the advanced-sharing warning, one-card summary
rendering, reopen classification, and folder/folder-open icon selection. These
checks are gated by `E2E_RUN_ACCESS_CONTROL=true` and do not contact a pod.

To run only the live server test for the UI's default Folder and contents
scope:

```bash
E2E_RUN_ACCESS_CONTROL_SERVER=true \
E2E_USE_LOCAL_RUNTIME=true \
E2E_RUN_LOCAL_PROFILE=true \
E2E_VIEWER_WEBID=https://localhost:3100/<viewer>/profile/card#me \
E2E_VIEWER_USERNAME=<viewer-username> \
E2E_VIEWER_PASSWORD=<viewer-password> \
npx playwright test tests/access-control/access-control-server.spec.ts \
  --grep "applies the UI"
```

There is also a safe discovery mode. Running `npm run test:e2e` with no
environment flags only discovers the tests; it does not run the functional
scenarios. Gated tests will be reported as skipped.

### Non-access-control coverage

The non-access-control suites are opt-in when run directly. The local wrapper
sets the required flags for the smoke, authenticated profile, profile
navigation, public profile reads, and Databrowser suites:

```bash
npm run test:local
```

For a single area, start SolidOS separately and use the corresponding command
below. These commands exercise real browser flows; they do not imply that a
run is currently passing.

```bash
# Reachability and title
E2E_RUN_SMOKE=true npm run test:e2e -- tests/smoke/home.spec.ts

# Authenticated profile persistence and RDF verification
E2E_RUN_LOCAL_PROFILE=true \
E2E_USE_LOCAL_RUNTIME=true \
npm run test:e2e -- tests/profile/authenticated-profile.spec.ts

# Account-menu, profile-route/back-navigation, friendship, and logged-out controls
E2E_RUN_PROFILE_NAVIGATION=true \
E2E_RUN_LOCAL_PROFILE=true \
E2E_USE_LOCAL_RUNTIME=true \
npm run test:e2e -- tests/profile/profile-navigation.spec.ts

# Static and authenticated Databrowser coverage
E2E_RUN_DATABROWSER=true \
npm run test:e2e -- tests/databrowser/databrowser.spec.ts
```

The authenticated profile suite uses the disposable runtime created by
`npm run setup:local`; it updates and restores profile fields and verifies the
served Turtle and, when configured, the local provider file. The public
profile-read suite is separate and requires `E2E_RUN_PROFILE_READS=true` and a
readable `E2E_PROFILE_URL`.

Access-control is deliberately outside this non-access-control coverage:

- `npm run test:access-control` runs the synthetic dialog/UI and keyboard
  accessibility suites on the temporary host at port 3101.
- `npm run test:access-control:server` runs the live pod-enforcement suite and
  requires the local disposable runtime or the documented external-server
  variables.
- `npm run test:local` and the direct non-access-control commands above do not
  run either access-control suite.
- `npm run test:all` includes the dialog/UI command, but still excludes the
  server-enforced command and the folder-pane command. Run
  `npm run test:folder-pane` separately for folder-pane coverage.

The commands below use inline environment variables, so they work in a fresh
terminal without a `.env.local` file. If you keep values in `.env.local`, load
them into the current shell before running a command:

```bash
set -a
. ./.env.local
set +a
```

The test runner reads environment variables from the shell. It does not load
`.env.local` automatically.

### First workflow: test an already-running local app

This is the recommended starting workflow. Start SolidOS separately and wait
until it is available at `http://localhost:3100`, then run these commands from
this workspace:

```bash
E2E_BASE_URL=http://localhost:3100 \
E2E_RUN_SMOKE=true \
npm run test:e2e -- tests/smoke/home.spec.ts

E2E_BASE_URL=http://localhost:3100 \
E2E_RUN_PROFILE_READS=true \
E2E_PROFILE_URL=http://localhost:3100/<profile>/profile/card#me \
npm run test:e2e -- tests/profile/profile-read.spec.ts
```

Replace `<profile>` with the profile route that exists in the running local
application. Playwright reports the results and exit status for the deployment
under test; no pass count is asserted here. These commands perform real browser
tests and are different from plain `npm run test:e2e`, which only discovers
gated tests when no flags are supplied.

### Smoke test

Use the smoke test to confirm that the configured application is reachable:

```bash
E2E_RUN_SMOKE=true \
E2E_BASE_URL=http://localhost:3100 \
npm run test:e2e -- tests/smoke/home.spec.ts
```

### Access-control keyboard focus and reflow

Run this focused browser test from the E2E workspace:

```bash
npm run test:access-control
```

The command rebuilds Solid UI's CDN bundle, starts the E2E test host on port
3101, and verifies keyboard tab order, combobox selection, role selection,
pending-grant removal, Save/Cancel/Escape behavior, focus restoration and
visible focus indicators. It also validates reflow at a 320 CSS-pixel viewport
using DOM geometry and scroll-width assertions. This command is intentionally
separate from the default discovery suite because it needs the local Solid UI
build output.

### Public profile reads

Set `E2E_PROFILE_URL` to a readable profile document in the target environment:

```bash
E2E_RUN_PROFILE_READS=true \
E2E_BASE_URL=http://localhost:3100 \
E2E_PROFILE_URL=http://localhost:3100/<profile>/profile/card#me \
npm run test:e2e -- tests/profile/profile-read.spec.ts
```

The read suite does not write to the configured profile. It is suitable for a
stable public test profile or a local read-only fixture. If the SolidOS app is
already running on `localhost:3100`, this is the command to run the public
profile scenario; the app must be started separately.

### Profile navigation and friendship

The focused profile-navigation suite reuses the disposable local account and
checks the authenticated account menu (Profile, Friends, storage, Dashboard and
Preferences), browser back navigation, self-profile restrictions, and logged-out
controls:

```bash
E2E_RUN_PROFILE_NAVIGATION=true \
E2E_RUN_LOCAL_PROFILE=true \
E2E_USE_LOCAL_RUNTIME=true \
npm run test:e2e -- tests/profile/profile-navigation.spec.ts
```

Set `E2E_PROFILE_URL` to a readable public profile for the logged-out test.
Friend-button add/already-friend coverage additionally requires
`E2E_FRIEND_PROFILE_URL` and `E2E_FRIEND_TARGET_WEBID`; without those values that
single two-user test is skipped.

#### Access-control scenario and identity notes

The server suite uses a distinct owner and viewer. The owner creates resources
and edits their ACLs through Manage Access; the viewer authenticates separately
to verify actual read/write behavior. The public-read case is an anonymous
request, not a viewer request. Focused dialog tests use synthetic ACL data for
subject kinds, conditions, inherited rules, and advanced scopes; passing those
UI tests does not establish that the corresponding authorization is enforced
by a pod. The live server suite currently verifies only the default
Folder-and-contents container scope, and does not claim group-membership or
conditional-authorization enforcement.

### Authenticated profile mutations

Mutation tests require a disposable local account created by the setup script:

```bash
E2E_PIVOT_DATA_ROOT=/absolute/path/to/pivot/data \
npm run setup:local

E2E_RUN_LOCAL_PROFILE=true \
E2E_USE_LOCAL_RUNTIME=true \
npm run test:e2e -- tests/profile/authenticated-profile.spec.ts

E2E_PIVOT_DATA_ROOT=/absolute/path/to/pivot/data \
npm run cleanup:local
```

For the currently running local application on port 3100, the authenticated test
command is:

```bash
E2E_BASE_URL=http://localhost:3100 \
E2E_RUN_LOCAL_PROFILE=true \
E2E_USE_LOCAL_RUNTIME=true \
npm run test:e2e -- tests/profile/authenticated-profile.spec.ts
```

Run `npm run setup:local` first when `.e2e-runtime.json` does not exist or the
saved session has expired. The setup and authenticated tests print timestamped
milestones, browser console errors, page errors, and failed requests. The setup
logs never print the generated password or cookie contents.

The setup script creates unique owner and viewer accounts and pods, seeds the
owner's test profile, stores runtime details in `.e2e-runtime.json`, and saves
the owner's browser state under `storage-state/`. Both locations are ignored
by Git. Before each authenticated profile scenario, the suite restores the
disposable profile file and performs the live OIDC login/consent flow in the
browser. Playwright `storageState` does not restore the localhost app's
IndexedDB-backed OIDC session, so the saved state file is not a substitute for
authentication. Local-profile runs use one Playwright worker so file resets
cannot overlap, while later tests continue after an individual failure.
Cleanup should be run after successful and interrupted test runs.

Do not use the setup or mutation commands against a personal account, shared
pod, or production deployment.

### Starting the application through Playwright

If the application can be started from the E2E workspace, Playwright can
manage it instead of requiring a separately running server:

```bash
E2E_START_APP=true \
E2E_APP_COMMAND='npm run start' \
E2E_RUN_PROFILE_READS=true \
E2E_PROFILE_URL=http://localhost:3100/<profile>/profile/card#me \
npm run test:e2e -- tests/profile/profile-read.spec.ts
```

This is optional. `E2E_APP_COMMAND` must start the intended SolidOS
application and serve the configured `E2E_BASE_URL`; otherwise, start the
application separately.

### Other Playwright modes

```bash
npm run test:e2e                 # discovery only unless a test mode is enabled
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:e2e:debug
npm run report
```

Most environment-dependent tests are skipped unless their corresponding
`E2E_RUN_*` variable is explicitly enabled.

### Databrowser coverage

The mashlib Databrowser suite checks both the static `databrowser.html` HTML
representation and the authenticated application flow. It seeds a disposable
container, RDF document, and text resource in the local runtime pod, then
verifies provider/bootstrap elements, container and resource
navigation, RDF-subject links, browser back behavior, and that credentials
never appear in navigation URLs or rendered content.

The authenticated cases also cover opening a pane through its owning explorer,
expanded-object navigation (entering at the first property, leaving with
**Left**, and shift-clicking an RDF object into the outer Databrowser view),
subject-link navigation/back restoration, and isolated previews. The preview
checks that Databrowser HTML is rendered in an isolated preview and that only
the current document's save is mediated. A separate MIME-isolation scenario
confirms that cached non-HTML metadata does not cause a resource to be treated
as HTML.

Run the suite with:

```bash
E2E_RUN_DATABROWSER=true \
E2E_RUN_LOCAL_PROFILE=true \
E2E_USE_LOCAL_RUNTIME=true \
npm run test:e2e -- tests/databrowser/databrowser.spec.ts
```

The focused suite requires a running SolidOS application. The static shell
test can run with only `E2E_RUN_DATABROWSER=true`; authenticated navigation,
expanded-object, preview, and MIME cases are skipped unless the disposable
runtime flags and runtime from `npm run setup:local` are available.

## Design decisions

### Attach to the existing application

The suite defaults to an already-running SolidOS application instead of
starting a second workspace. This ensures that tests use the same linked
packages, branches, server configuration, and build that the developer is
inspecting. `E2E_START_APP=true` is available only when an appropriate
`E2E_APP_COMMAND` has been configured.

### Use disposable identities for writes

Mutation tests must not use a personal or shared profile. The local setup flow
uses the real account and pod UI, then seeds only the disposable profile owned
by the run. This tests authentication and persistence without risking unrelated
data.

### Verify both UI and RDF persistence

A visible value proves that the browser state rendered correctly, but it does
not prove that the RDF PATCH was complete. Mutation tests therefore:

1. perform the action through the profile UI;
2. assert the updated visible result;
3. read the authenticated Turtle response;
4. parse predicates, objects, list order, and owned nodes;
5. confirm removed data is absent;
6. restore or remove data created by the test.

When configured with `E2E_PIVOT_DATA_ROOT`, the suite also compares the served
document with the provider's local Turtle file. The local file is used only as
a persistence assertion; tests never write expected results directly into it.

### Gate external and destructive work

Public reads and smoke tests are opt-in. Account creation, authentication, and
mutations are separately gated. This keeps ordinary test discovery safe,
repeatable, and suitable for CI environments without test credentials.

### Prefer accessible browser locators

Tests use roles, labels, accessible names, and test IDs before implementation
selectors. RDF assertions use stable predicates and values rather than
presentation-specific markup.

## Tests Covered

### Profile Pane

#### Public data

- profile heading and primary contact details;
- bio text;
- skills and languages after expanding their sections;
- project and community data;
- social accounts;
- phone, email, and postal contact details.

#### Authenticated data persistence

- authenticated profile retrieval and local-file Turtle parsing;
- heading update and restoration;
- bio create, update, remove, and restore;
- custom blank-node skill creation and removal;
- secondary email create, update, and removal;
- phone create, update, and removal;
- postal-address create, update, and removal;
- resume-role create, update, and removal;
- project/community add and unfollow;
- language creation and removal;
- language RDF-list reordering and restoration;
- social-account creation and removal;
- social-account RDF-list reordering and restoration.

Every mutation is checked through the browser and the persisted RDF document.

#### Navigation and friendship

- opening the logged-in user's profile;
- Profile, Friends, Storage, Dashboard, Preferences, and Sign out menu
  destinations;
- route subjects and browser back navigation;
- self-profile restrictions;
- adding a friend and confirming the persisted already-friends state;
- logged-out login/signup visibility and restricted controls.

### Access Control

#### Server-enforced authorization (`test:access-control:server`)

- create disposable files and containers under the owner pod and discover ACL
  documents through the HTTP `Link: ...; rel=acl` header;
- use the real Manage Access UI to grant, edit, replace, and remove access;
- verify saved `acl:accessTo` and `acl:default` statements;
- authenticate a distinct viewer and check read/write outcomes for files,
  containers, and container contents across supported roles;
- preserve an existing conditional grant when editing it, without claiming
  condition editing or condition enforcement;
- verify combined principal and general-access changes;
- attempt anonymous public reads where the server supports public `Read`;
- delete each test resource in cleanup; the wrapper also cleans disposable
  local pod/runtime data, subject to the identity-cleanup limitation above.

#### Dialog/UI behavior (`test:access-control`)

- add/change/revoke direct subject kinds and authenticated-agent/public grants;
- exercise folder-only and folder-and-contents choices, inherited defaults,
  and classification when reopening the dialog using synthetic ACL fixtures;
- preserve existing conditions, coalesce matching principals, and keep
  distinct contents grants independent;
- search `acl:trustedApp` entries and retain direct-origin entry;
- report failed or unverifiable saves and handle partial saves.

These focused UI tests do not contact a pod and do not prove that synthetic
groups, origins, conditions, or other principals are enforced by a server.

#### Accessibility

- complete keyboard tab flow through the sharing dialog;
- keyboard selection of principals and roles;
- pending-grant removal by keyboard;
- Save, Cancel, and Escape behavior;
- restoration of focus to the dialog opener;
- visible keyboard focus indicators;
- scrolling the focused grant row into view;
- no horizontal overflow at a 320 CSS-pixel viewport;
- footer and dialog controls remain visible and operable after reflow.

### Smoke and configuration

- application reachability and page title;
- Playwright configuration validation;
- TypeScript validation for the E2E workspace.



## Repository layout

- `playwright.config.ts` — browser project, base URL, optional app startup, and reporting;
- `.env.example` — documented environment variables;
- `fixtures/` — runtime state, authentication helpers, and RDF verification;
- `scripts/setup-local.mjs` — opt-in disposable identities, pods, and owner
  profile setup;
- `scripts/cleanup-local.mjs` — disposable pod/runtime cleanup and attempted
  password-login cleanup;
- `scripts/check-config.mjs` — configuration validation;
- `tests/smoke/` — reachability coverage;
- `tests/profile/` — public reads and authenticated mutations;
- `tests/access-control/` — dialog accessibility, ACL UI changes, and
  server-side authorization enforcement;
- `tests/folder-pane/` — file-explorer, folder-pane, Source creation, and pane
  routing coverage;
- `tests/auth/` — authentication-flow coverage and placeholders;
- `.github/workflows/` — CI configuration.

Generated reports, screenshots, videos, traces, `.env` files, runtime state,
and Playwright storage state must remain uncommitted.

## Adding coverage

1. Add a `.spec.ts` file under the relevant `tests/` directory.
2. Use the existing suite-level environment gate when adding coverage to an
   already gated feature area.
3. Use accessible locators and stable RDF assertions.
4. Keep mutation tests serial where they share a disposable profile.
5. Restore or remove every value created by a test.
6. Add new environment variables to both `.env.example` and this README only
   when a new independently runnable test area needs configuration.
7. Run the focused test, then `npm run typecheck`.

### Folder-pane resource coverage

With the SolidOS application running at `http://localhost:3100`, run:

```bash
npm run test:folder-pane
```

The wrapper first requires a successful HTTP response from the running app
(default: `http://localhost:3100`); it does not start a server. If no usable
disposable runtime exists, it runs `npm run setup:local` to create the local
runtime and profile, then authenticates in the browser. Playwright
`storageState` does not preserve the localhost app's IndexedDB-backed OIDC
session, so folder-pane browser contexts sign in instead of relying on that
snapshot. By default, the runtime's disposable pod is the writable test
container. The wrapper runs Playwright with one worker and invokes cleanup in a
`finally` block when the runtime file exists, including after test failures.
Extra Playwright arguments can be passed after `--`, for example
`npm run test:folder-pane -- --headed`.

Cleanup removes disposable E2E pods, their local Pivot fixture directories,
and saved authentication-state files where available. As with the ACL server
runner, this is resource/pod cleanup, not guaranteed identity cleanup: deleting
the final password login may be rejected by the CSS v7 account API with HTTP
400, and the account can remain.

The command runs these five suites serially:

- `folder-pane-container.spec.ts` verifies grid/list presentation and stable
  resource identities, resource selection and Home navigation, pane switching,
  access indicators, the resource action menu's Manage Access event, and
  storage Add-menu basics including Upload, Source, and Folder creation.
- `folder-pane-resources.spec.ts` seeds representative resources for each
  viewable non-global pane with a registered `mintClass` (except questionnaire)
  in the disposable pod, then selects each by RDF `about` URI and checks the
  rendered pane. It also seeds image and HTML resources for pane-content
  scrolling and preview isolation coverage, including keeping content below
  the explorer header.
- `folder-pane-created-resources.spec.ts` discovers non-global panes with
  `mintNew` support, creates a Turtle resource for each through authenticated
  requests, opens it through the folder UI, checks the rendered pane, and
  removes the created resources. This is not the Add-menu creation test.
- `folder-pane-search.spec.ts` seeds disposable search files and verifies
  case-insensitive filtering, no-results and empty-query behavior, clearing
  search, and result selection. The describe is currently skipped by the
  spec-level gate until storage-search coverage is enabled.
- `folder-pane-add-menu-panes.spec.ts` uses the real storage **Add** menu and
  each pane's `mintNew` implementation to create resources, verifies their
  files and rendered targets, and recursively removes its disposable nested
  container after each test. Its serial describe and the wrapper's single
  worker prevent concurrent writes to the same pod.

Container presentation tests also cover grid/list switching, preserving resource identity,
and mouse/keyboard selection events. Run them against the authenticated disposable pod:

```bash
E2E_RUN_FOLDER_PANE=true \
E2E_USE_LOCAL_RUNTIME=true \
E2E_FOLDER_PANE_CONTAINER_URL=http://localhost:3100/<disposable-pod>/ \
npm run test:e2e -- tests/folder-pane/folder-pane-container.spec.ts
```

The representative-resource suites self-seed their fixtures in the configured
disposable container; they do not need pre-existing resources or
`E2E_FOLDER_PANE_CASES`.

The Add-menu suite creates contact and pad resources through the actual Add
menu. When opened from the normal storage browser, the resource view keeps the
storage header and sidebar. The tests then navigate directly to each resource's
container URL: this solo-resource route renders the pane for the expected
`index.ttl#this` subject without the storage header, sidebar, or container
listing. Choosing **Storage** afterwards returns to the standard storage shell.
