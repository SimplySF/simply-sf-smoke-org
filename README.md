# simply-smoke-org

Local scratch-org smoke tests for the [SimplySF](https://github.com/SimplySF)
`simply-*` Salesforce CLI plugins. The first suite covers all 17 AEP AT4DX
commands, with a gated group for the five generators from simply-plugins PR #73.

## Quick start

```bash
npm test                                   # offline gate; no org or network needed
npm run org:create -- simply-smoke-org     # needs DEV_HUB_ALIAS or a default Dev Hub
npm run smoke:aep -- --target-org simply-smoke-org
npm run smoke:local -- --offline            # local commands; no org required
npm run smoke:community -- -o simply-smoke-org # Experience Cloud publish; live org
npm run smoke:apex -- -o simply-smoke-org
npm run smoke:flow -- -o simply-smoke-org
npm run smoke:data -- -o simply-smoke-org
npm run smoke:sobject -- -o simply-smoke-org
npm run smoke:permissions -- -o simply-smoke-org
npm run smoke:settings -- -o simply-smoke-org [--offline] # dry-run; offline skips Debian download only
```

Before creating an org, build and link the plugin under test. Prerequisites and
the link steps are in [docs/org-setup.md](docs/org-setup.md).

For the local suite, build and link `simply-project`, `simply-document`, and
`simply-schema` from the same checkout (remove the installed umbrella as described
in the link guide before linking):

```bash
# From the simply-plugins monorepo; repeat for document and schema.
pnpm --filter '@simplysf/simply-project...' run build
sf plugins link "$PWD/packages/simply-project" --no-install
```

The CLI 2.147.7 plugin-link command does not accept `--json`.
Set `SIMPLY_PLUGINS_DIR` to the absolute monorepo path when using a worktree.
`smoke:local` verifies all three links and command ownership, writes only under
`generated/local/` and the ignored `reports/` directory, and records provenance
and results. Omit `--offline` for the
schema deploy/describe and org visualization cases against the disposable shared
org. See [local command coverage](smoke/local-commands.md) for cases and contracts.

## Community publish suite

The shared scratch definition now enables `Communities`, `PartnerCommunity`,
`CustomerCommunityPlus`, Networks and ExperienceBundle metadata for fresh orgs.
Recreation is not required for existing smoke orgs: setup deploys the two
Digital Experiences settings before querying or creating the site. Use only a
disposable smoke org.

Build and link `@simplysf/simply-community` from your local monorepo, then set
`SIMPLY_PLUGINS_DIR` when running from a worktree. Shared `org:setup` (and the AEP
suite's setup, unless `--skip-setup`) enables Digital Experiences settings and
creates **SSO Smoke Site** after AEP setup. Existing sites are reused. Expect about
3–9 minutes for the publish cases, plus up to ten minutes on first site creation.
The zero-wait case can leave a server-side publish running, so let it finish
before rerunning. `community url set` is intentionally excluded because scratch
orgs cannot register a custom domain.

Flags, setup steps, timing, and live status are in
[docs/community-suite.md](docs/community-suite.md). Case assertions are in
[community command coverage](smoke/community-commands.md).

## Permissions and settings suites

Build and link `@simplysf/simply-permissions` and `@simplysf/simply-settings`
from the monorepo, and set `SIMPLY_PLUGINS_DIR` to that checkout. Run both only
against the disposable smoke org. Both record linked plugin provenance and results
under the ignored `reports/` directory.

- **Permissions** (`npm run smoke:permissions -- -o simply-smoke-org`) deploys its
  own fixtures and seeds a Standard User. Its destructive cases run only against
  fixture assignments, behind guards. Details are in
  [docs/permissions-suite.md](docs/permissions-suite.md), and case proofs are in
  [permissions command coverage](smoke/permissions-commands.md).
- **Settings** (`npm run smoke:settings -- -o simply-smoke-org [--offline]`) runs
  `--dry-run` only. Case 18 proves that AddressSettings is byte-identical after the
  run. Details are in [docs/settings-suite.md](docs/settings-suite.md), and case
  proofs are in [settings command coverage](smoke/settings-commands.md).

Both suites passed two consecutive operator runs against the shared smoke org
on 2026-10-16 (permissions 13/0/0, settings 11/0/0). The runs are recorded in
[docs/permissions-suite.md](docs/permissions-suite.md#live-status) and
[docs/settings-suite.md](docs/settings-suite.md#live-status).

## Apex and Flow suites

`smoke:apex` covers execute, trace setup/silence, logs purge and test-suite
generation. `smoke:flow` covers Flow deletion and obsolete-version pruning.
Build and link both packages, set `SIMPLY_PLUGINS_DIR`, and use the disposable
shared org. Apex requires the frameworks from AEP setup. Flow rebuilds three
versions before destructive cases; Apex cleans up TraceFlags in a finally block.
See [suite setup and live status](docs/apex-flow-suites.md),
[Apex command coverage](smoke/apex-commands.md) and
[Flow command coverage](smoke/flow-commands.md). Both suites passed two
consecutive operator runs (apex 20/0/0, flow 8/0/0). Case 24 asserts the
plugin's actual behavior for a missing Flow name (silently ignored), which is
recorded as a plugin follow-up.

## Data and SObject suites

`smoke:data` covers single/batch file upload and download, including binary
SHA-256 round trips. `smoke:sobject` covers backup, deduplicate and history
export/query/schema. Both deploy dedicated fixtures, seed records and real
history transitions, and clean generated files and SSO_Data_ ContentDocuments in
finally blocks. Run sequentially against the shared persistent Developer Edition
org after linking both plugins and setting `SIMPLY_PLUGINS_DIR`.
See [setup, source contracts and live status](docs/data-sobject-suites.md),
[data coverage](smoke/data-commands.md) and
[SObject coverage](smoke/sobject-commands.md). Live acceptance is **pending operator run**.

## Documentation

| Topic | Read |
| --- | --- |
| Guidance for coding agents | [AGENTS.md](AGENTS.md) |
| Prerequisites, plugin link, org creation, setup, reset | [docs/org-setup.md](docs/org-setup.md) |
| AT4DX dependency pins and cache | [docs/dependencies.md](docs/dependencies.md) |
| AEP suite: flags, `--only`, fixtures, generate, APX parity | [docs/running-suites.md](docs/running-suites.md) |
| Local suite: plugin links, flags, workspace, org state | [docs/local-suite.md](docs/local-suite.md) |
| Community suite: plugin link, site setup, flags, timing, live status | [docs/community-suite.md](docs/community-suite.md) |
| Permissions suite: fixtures, setup, destructive guards, live status | [docs/permissions-suite.md](docs/permissions-suite.md) |
| Settings suite: dry-run planning, AddressSettings byte check | [docs/settings-suite.md](docs/settings-suite.md) |
| Apex and Flow suites: plugin links, flags, cleanup, live status | [docs/apex-flow-suites.md](docs/apex-flow-suites.md) |
| Reports, failure contract, offline gate, live acceptance, known issues | [docs/reports-and-gate.md](docs/reports-and-gate.md) |
| Adding cases, reset rules, moving the repo | [docs/extending.md](docs/extending.md) |
| AEP command → case → proof table | [smoke/aep-commands.md](smoke/aep-commands.md) |
| Local command → case → proof table | [smoke/local-commands.md](smoke/local-commands.md) |
| Community command → case → proof table | [smoke/community-commands.md](smoke/community-commands.md) |
| Permissions command → case → proof table | [smoke/permissions-commands.md](smoke/permissions-commands.md) |
| Settings command → case → proof table | [smoke/settings-commands.md](smoke/settings-commands.md) |
| Apex command → case → proof table | [smoke/apex-commands.md](smoke/apex-commands.md) |
| Flow command → case → proof table | [smoke/flow-commands.md](smoke/flow-commands.md) |
| Data and SObject setup, source findings and live status | [docs/data-sobject-suites.md](docs/data-sobject-suites.md) |
| Data command → case → proof table | [smoke/data-commands.md](smoke/data-commands.md) |
| SObject command → case → proof table | [smoke/sobject-commands.md](smoke/sobject-commands.md) |

Copyright (c) 2026, SimplySF. Licensed under [Apache-2.0](LICENSE.txt).
