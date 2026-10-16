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
`generated/local/`, and records provenance and results. Omit `--offline` for the
schema deploy/describe and org visualization cases against the disposable shared
org. See [local command coverage](smoke/local-commands.md) for cases and contracts.

## Documentation

| Topic | Read |
| --- | --- |
| Guidance for coding agents | [AGENTS.md](AGENTS.md) |
| Prerequisites, plugin link, org creation, setup, reset | [docs/org-setup.md](docs/org-setup.md) |
| AT4DX dependency pins and cache | [docs/dependencies.md](docs/dependencies.md) |
| Running suites: flags, `--only`, fixtures, generate, APX parity | [docs/running-suites.md](docs/running-suites.md) |
| Reports, failure contract, offline gate, live acceptance, known issues | [docs/reports-and-gate.md](docs/reports-and-gate.md) |
| Adding cases, reset rules, moving the repo | [docs/extending.md](docs/extending.md) |
| Command → case → proof table | [smoke/aep-commands.md](smoke/aep-commands.md) |

Copyright (c) 2026, SimplySF. Licensed under [Apache-2.0](LICENSE.txt).
