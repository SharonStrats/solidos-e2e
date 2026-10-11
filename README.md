# SolidOS End-to-End Tests

`npm run test:local` and `npm run test:all` run the authenticated and smoke tests against `http://localhost:3100`. The public profile-read tests use `https://sharon.pivot-test.solidproject.org:3000/profile/card#me` by default and can be overridden with `E2E_PROFILE_URL`.

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

### One command for the complete E2E suite

Start SolidOS on `http://localhost:3100`, then run this from the E2E workspace:

```bash
npm run test:all
```

This runs the localhost:3100 SolidOS tests first, then builds and runs the
access-control tests using their temporary port-3101 component host. If
`.e2e-runtime.json` does not exist, it creates the disposable account and
profile automatically using `../pivot/data`; later runs reuse that runtime.
Set `E2E_PIVOT_DATA_ROOT` when using a different local environment.

Public profile-read fixtures are skipped unless `E2E_PROFILE_URL` points to a
complete readable profile, because the disposable mutation profile is
intentionally minimal. To run those reads as part of the same command:

```bash
E2E_PROFILE_URL=http://localhost:3100/<public-profile>/profile/card#me \
npm run test:all
```

The command reports both workflows and exits unsuccessfully if either workflow
fails.

The access-control tests are separate because they build Solid UI and run a
temporary test host on port 3101:

```bash
npm run test:access-control
```

There are two functional test modes:

1. **Public profile reads** — run against a readable profile, including a
   locally running SolidOS application. These tests do not write data.
2. **Authenticated local mutations** — run against a disposable local account
   and profile created by `setup:local`. These tests create, update, reorder,
   and remove profile data, then verify the saved RDF.
3. **Access-control dialog keyboard and reflow verification** — builds the
   local Solid UI CDN bundle and serves a focused test host containing the real
   dialog. It does not contact a pod or modify application data.

There is also a safe discovery mode. Running `npm run test:e2e` with no
environment flags only discovers the tests; it does not run the functional
scenarios. Gated tests will be reported as skipped.

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
application. A successful run reports `1 passed` for the smoke test and
`5 passed` for the current public profile suite. These commands perform real
browser tests; they are different from plain `npm run test:e2e`, which only
discovers gated tests when no flags are supplied.

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

The setup script creates a unique account and pod, authenticates the browser
once, seeds the test profile, stores runtime details in `.e2e-runtime.json`,
and saves that authenticated browser state under `storage-state/`. Both
locations are ignored by Git. The authenticated suite restores only that
runtime's disposable profile file *before navigating to it* for every
scenario; it does not repeat the identity-provider UI flow or replace the
saved browser session. Local-profile runs use one Playwright worker so these
file resets cannot overlap, while the normal (non-serial) test mode still
continues with later tests after an individual failure. Cleanup should be run
after successful and interrupted test runs.

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

## Current coverage

### Smoke and configuration

- application reachability and page title;
- Playwright configuration validation;
- TypeScript validation for the E2E workspace.

### Public profile rendering

The read suite currently covers:

- profile heading and primary contact details;
- bio text;
- skills;
- languages;
- projects and community links;
- social accounts;
- additional phone, email, and postal contact details.

Sections are expanded through their accessible controls before assertions are
made, so collapsed-section behavior is not mistaken for missing data.

### Authenticated profile persistence

The disposable local profile suite currently covers:

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



## Repository layout

- `playwright.config.ts` — browser project, base URL, optional app startup, and reporting;
- `.env.example` — documented environment variables;
- `fixtures/` — runtime state, authentication helpers, and RDF verification;
- `scripts/setup-local.mjs` — opt-in disposable account and profile setup;
- `scripts/cleanup-local.mjs` — disposable account and data cleanup;
- `scripts/check-config.mjs` — configuration validation;
- `tests/smoke/` — reachability coverage;
- `tests/profile/` — public reads and authenticated mutations;
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
