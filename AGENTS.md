# AGENTS.md

Guidance for coding agents working in this repository. Keep it short. Detailed
documentation lives in `docs/`; read only the file you need.

## What this repo is

Local smoke tests for the SimplySF `simply-*` Salesforce CLI plugins. Three suites:
the AEP suite (`scripts/run-aep-smoke.mjs`) exercises the 17 AEP AT4DX commands
against a linked local `simply-aep` checkout; the local suite
(`scripts/run-local-smoke.mjs`) exercises five file-based commands from
`simply-project`, `simply-document` and `simply-schema`; and the community suite
(`scripts/run-community-smoke.mjs`) exercises `simply community publish` from a
linked `simply-community` checkout against an Experience Cloud site. Node 22 ESM,
no npm dependencies.

## Commands

```bash
npm test                                       # offline gate; no org or network
npm run org:create -- <alias>                  # create scratch org, then set up
npm run org:setup -- <alias> [--redeploy-deps] # dependencies, reset, fixtures
npm run smoke:aep -- -o <alias> [--skip-setup] [--only <regex>] [--apx-parity]
npm run smoke:local -- --offline               # local suite; no org needed
npm run smoke:community -- -o <alias> [--skip-setup] [--only <regex>]
```

Live commands need an authenticated org and linked plugin checkouts. Run them
only against a disposable smoke org.

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
| Adding cases, reset rules, moving the repo | [docs/extending.md](docs/extending.md) |
| AEP command → case → proof table | [smoke/aep-commands.md](smoke/aep-commands.md) |
| Local command → case → proof table | [smoke/local-commands.md](smoke/local-commands.md) |
| Community command → case → proof table | [smoke/community-commands.md](smoke/community-commands.md) |

## Rules

- Run `npm test` before committing. It must pass without Salesforce access.
- Keep `smoke/aep-commands.md` in step with the cases in
  `scripts/run-aep-smoke.mjs`, `smoke/local-commands.md` with
  `scripts/run-local-smoke.mjs`, and `smoke/community-commands.md` with
  `scripts/run-community-smoke.mjs`. `test/aep.test.mjs` enforces that every AEP
  command has a successful org case; `test/local.test.mjs` enforces a success
  and an expected-failure case for every local command; `test/community.test.mjs`
  pins the community case list and its expected-failure count.
- Do not commit `reports/`, `generated/`, `.deps/`, or `.sf/`. They are ignored.
  Runners must not change committed fixtures (`sfdx-source/aep`, `fixtures/local`);
  their working copies live under `generated/`.
- Change a dependency pin only in `config/dependencies.json`, and update
  `docs/dependencies.md` to match.
- Keep reset selection narrow. Baseline `SSO_Base_*` metadata and `SSO_Aep*`
  Apex must survive reset. See [docs/org-setup.md](docs/org-setup.md#reset-scope).
- Documented behavior is not proof of a live deploy. Live results are recorded
  only from operator runs. Do not claim them.
- Known bugs are listed in [docs/reports-and-gate.md](docs/reports-and-gate.md#known-issues).
