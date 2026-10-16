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

## Documentation

| Topic | Read |
| --- | --- |
| Guidance for coding agents | [AGENTS.md](AGENTS.md) |
| Prerequisites, plugin link, org creation, setup, reset | [docs/org-setup.md](docs/org-setup.md) |
| AT4DX dependency pins and cache | [docs/dependencies.md](docs/dependencies.md) |
| AEP suite: flags, `--only`, fixtures, generate, APX parity | [docs/running-suites.md](docs/running-suites.md) |
| Local suite: plugin links, flags, workspace, org state | [docs/local-suite.md](docs/local-suite.md) |
| Community suite: plugin link, site setup, flags, timing, live status | [docs/community-suite.md](docs/community-suite.md) |
| Reports, failure contract, offline gate, live acceptance, known issues | [docs/reports-and-gate.md](docs/reports-and-gate.md) |
| Adding cases, reset rules, moving the repo | [docs/extending.md](docs/extending.md) |
| AEP command → case → proof table | [smoke/aep-commands.md](smoke/aep-commands.md) |
| Local command → case → proof table | [smoke/local-commands.md](smoke/local-commands.md) |
| Community command → case → proof table | [smoke/community-commands.md](smoke/community-commands.md) |

Copyright (c) 2026, SimplySF. Licensed under [Apache-2.0](LICENSE.txt).
