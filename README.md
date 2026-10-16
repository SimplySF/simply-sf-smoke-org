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

Build and link `@simplysf/simply-community` from your local monorepo using the
same link procedure as AEP (`pnpm --filter '@simplysf/simply-community...' run build`,
then `sf plugins link /absolute/path/to/packages/simply-community --no-install`).
Set `SIMPLY_PLUGINS_DIR` when running from a worktree.

Shared `org:setup` now enables Digital Experiences and creates **SSO Smoke Site**
after AEP setup. The community runner performs only its own site setup by default; use `--skip-setup` to reuse
a prepared site, `-o`/`--target-org` for the alias, and `--only <regex>` to select
cases. Setup verifies the Build Your Own (LWR) template is available, creates
with URL prefix `ssosmoke` if absent, and polls Network for up to ten minutes.
Existing sites are reused without resetting or deploying site metadata.

Budget about 3–9 minutes for three sequential successful publishes (typically
1–3 minutes each), plus the settings deploy, up to ten minutes on first site
creation, and any AEP setup time. Each case has a 25-minute process limit. The final zero-wait case
can leave a server-side publish running; let it finish before another run.
Reports include plugin provenance and expected failures. See
[community command coverage](smoke/community-commands.md) for exact assertions
and live validation limitations. `community url set` is intentionally excluded
because scratch orgs cannot register a custom domain.

## Documentation

| Topic | Read |
| --- | --- |
| Guidance for coding agents | [AGENTS.md](AGENTS.md) |
| Prerequisites, plugin link, org creation, setup, reset | [docs/org-setup.md](docs/org-setup.md) |
| AT4DX dependency pins and cache | [docs/dependencies.md](docs/dependencies.md) |
| AEP suite: flags, `--only`, fixtures, generate, APX parity | [docs/running-suites.md](docs/running-suites.md) |
| Local suite: plugin links, flags, workspace, org state | [docs/local-suite.md](docs/local-suite.md) |
| Reports, failure contract, offline gate, live acceptance, known issues | [docs/reports-and-gate.md](docs/reports-and-gate.md) |
| Adding cases, reset rules, moving the repo | [docs/extending.md](docs/extending.md) |
| AEP command → case → proof table | [smoke/aep-commands.md](smoke/aep-commands.md) |
| Local command → case → proof table | [smoke/local-commands.md](smoke/local-commands.md) |
| Community command → case → proof table | [smoke/community-commands.md](smoke/community-commands.md) |

Copyright (c) 2026, SimplySF. Licensed under [Apache-2.0](LICENSE.txt).
