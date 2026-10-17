# AGENTS.md

Guidance for coding agents working in this repository. Keep it short. Detailed
documentation lives in `docs/`; read only the file you need.

## What this repo is

Local smoke tests for the SimplySF `simply-*` Salesforce CLI plugins. Nine suites:
the AEP suite (`scripts/run-aep-smoke.mjs`) exercises the 17 AEP AT4DX commands
against a linked local `simply-aep` checkout; the local suite
(`scripts/run-local-smoke.mjs`) exercises five file-based commands from
`simply-project`, `simply-document` and `simply-schema`; the community suite
(`scripts/run-community-smoke.mjs`) exercises `simply community publish` from a
linked `simply-community` checkout against an Experience Cloud site; the
permissions suite (`scripts/run-permissions-smoke.mjs`) exercises the
`simply permissions` commands from `simply-permissions`; the settings suite
(`scripts/run-settings-smoke.mjs`) exercises `simply settings address state` in
dry-run mode from `simply-settings`; the Apex suite (`scripts/run-apex-smoke.mjs`)
exercises the five `simply apex` commands from `simply-apex`; and the Flow suite
(`scripts/run-flow-smoke.mjs`) exercises `simply flow delete` and
`simply flow version prune` from `simply-flow`. The Data and SObject suites
(`scripts/run-data-smoke.mjs` and `scripts/run-sobject-smoke.mjs`) cover file
upload/download, backup, deduplicate and history commands using dedicated
shared-org fixtures. Node 22 ESM, no npm dependencies.

## Commands

```bash
npm test                                       # offline gate; no org or network
npm run org:create -- <alias>                  # create scratch org, then set up
npm run org:setup -- <alias> [--redeploy-deps] # dependencies, reset, fixtures
npm run smoke:aep -- -o <alias> [--skip-setup] [--only <regex>] [--apx-parity]
npm run smoke:local -- --offline               # local suite; no org needed
npm run smoke:community -- -o <alias> [--skip-setup] [--only <regex>]
npm run smoke:permissions -- -o <alias> [--skip-setup] [--only <regex>]
npm run smoke:settings -- -o <alias> [--offline] [--only <regex>]
npm run smoke:apex -- -o <alias> [--skip-setup] [--only <regex>]
npm run smoke:flow -- -o <alias> [--skip-setup] [--only <regex>]
npm run smoke:data -- -o <alias> [--skip-setup] [--only <regex>]
npm run smoke:sobject -- -o <alias> [--skip-setup] [--only <regex>]
```

Live commands need an authenticated org and linked plugin checkouts. Run them
only against a disposable smoke org, except for the Data and SObject suites,
which run sequentially on the operator's shared smoke org (`simply-smoke-org`,
a 7-day Developer edition scratch org). Those suites own the `SSO_Data_Parent__c` and
`SSO_Data_Child__c` fixture records and ContentDocuments with literal
`SSO_Data_` title prefixes; setup and cleanup delete that data. See
[docs/data-sobject-suites.md](docs/data-sobject-suites.md) for the exception
and cleanup scope.

## Where to look

| Need | Read |
| --- | --- |
| Overview and doc index | [README.md](README.md) |
| Plugin link, org creation, setup chain, reset scope | [docs/org-setup.md](docs/org-setup.md) |
| AT4DX pins, dependency cache, sentinels | [docs/dependencies.md](docs/dependencies.md) |
| Flags, `--only` rules, fixtures, generate cases, APX parity | [docs/running-suites.md](docs/running-suites.md) |
| Reports, failure contract, offline gate, live acceptance, known issues | [docs/reports-and-gate.md](docs/reports-and-gate.md) |
| Local suite: plugin links, flags, workspace, org state | [docs/local-suite.md](docs/local-suite.md) |
| Community suite: plugin link, site setup, flags, timing, live status | [docs/community-suite.md](docs/community-suite.md) |
| Permissions suite: plugin link, fixtures, setup, destructive guards | [docs/permissions-suite.md](docs/permissions-suite.md) |
| Settings suite: plugin link, dry-run cases, AddressSettings check | [docs/settings-suite.md](docs/settings-suite.md) |
| Apex and Flow suites: plugin links, flags, cleanup, live status | [docs/apex-flow-suites.md](docs/apex-flow-suites.md) |
| Data/SObject setup, source contracts, cleanup and live status | [docs/data-sobject-suites.md](docs/data-sobject-suites.md) |
| Adding cases, reset rules, moving the repo | [docs/extending.md](docs/extending.md) |
| AEP command → case → proof table | [smoke/aep-commands.md](smoke/aep-commands.md) |
| Local command → case → proof table | [smoke/local-commands.md](smoke/local-commands.md) |
| Community command → case → proof table | [smoke/community-commands.md](smoke/community-commands.md) |
| Permissions command → case → proof table | [smoke/permissions-commands.md](smoke/permissions-commands.md) |
| Settings command → case → proof table | [smoke/settings-commands.md](smoke/settings-commands.md) |
| Apex command → case → proof table | [smoke/apex-commands.md](smoke/apex-commands.md) |
| Flow command → case → proof table | [smoke/flow-commands.md](smoke/flow-commands.md) |
| Data command → case → proof table | [smoke/data-commands.md](smoke/data-commands.md) |
| SObject command → case → proof table | [smoke/sobject-commands.md](smoke/sobject-commands.md) |

## Rules

- Run `npm test` before committing. It must pass without Salesforce access.
- Keep each command coverage doc in step with its runner:
  `smoke/aep-commands.md` with `scripts/run-aep-smoke.mjs`,
  `smoke/local-commands.md` with `scripts/run-local-smoke.mjs`,
  `smoke/community-commands.md` with `scripts/run-community-smoke.mjs`,
  `smoke/permissions-commands.md` with `scripts/run-permissions-smoke.mjs`,
  `smoke/settings-commands.md` with `scripts/run-settings-smoke.mjs`,
  `smoke/apex-commands.md` with `scripts/run-apex-smoke.mjs`, and
  `smoke/flow-commands.md` with `scripts/run-flow-smoke.mjs`.
  `test/aep.test.mjs` enforces that every AEP command has a successful org case;
  `test/local.test.mjs` enforces a success and an expected-failure case for every
  local command; `test/community.test.mjs` pins the community case list and its
  expected-failure count; `test/permissions-settings.test.mjs` pins the permissions
  (13) and settings (11) case lists, checks that each case name appears in its
  coverage doc, and requires a success and an expected-failure case for each command;
  `test/apex-flow.test.mjs` pins the Apex (19) and Flow (8) case lists and checks
  the same coverage-doc and success/failure rules.
- Do not commit `reports/`, `generated/`, `.deps/`, or `.sf/`. They are ignored.
  Runners must not change committed fixtures (`sfdx-source/aep`, `fixtures/local`,
  `sfdx-source/permissions`, `fixtures/permissions`, `fixtures/settings`,
  `sfdx-source/apex-flow`, `fixtures/apex`, `fixtures/flow`,
  `sfdx-source/data-sobject`, `fixtures/data`, `fixtures/sobject`); their working
  copies live under `generated/`.
- The settings suite is dry-run only. Every settings case must pass `--dry-run`.
  Do not add a live `create` or `activate` case without reworking the byte check
  in case 18 and [docs/settings-suite.md](docs/settings-suite.md).
- Change a dependency pin only in `config/dependencies.json`, and update
  `docs/dependencies.md` to match.
- Keep reset selection narrow. Baseline `SSO_Base_*` metadata and `SSO_Aep*`
  Apex must survive reset. See [docs/org-setup.md](docs/org-setup.md#reset-scope).
- Destructive permissions cases must keep their guards: fixture-only assignments,
  a non-empty snapshot, and an admin-assignment check after the command runs. See
  [docs/permissions-suite.md](docs/permissions-suite.md).
- Documented behavior is not proof of a live deploy. Live results are recorded
  only from operator runs. Do not claim them.
- Known bugs are listed in [docs/reports-and-gate.md](docs/reports-and-gate.md#known-issues).
- Keep `smoke/data-commands.md` and `smoke/sobject-commands.md` in step with their
  runners. `test/data-sobject.test.mjs` pins 9 and 13 cases and success/failure
  coverage for every command. Run these suites sequentially on the shared
  smoke org; cleanup must delete literal `SSO_Data_`
  ContentDocuments and generated files even after failures. Live acceptance
  was recorded by the operator; do not claim new live results. See
  [docs/data-sobject-suites.md](docs/data-sobject-suites.md).
