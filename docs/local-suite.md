# Local suite

The local suite (`scripts/run-local-smoke.mjs`) runs five commands from
`simply-project`, `simply-document` and `simply-schema` against throwaway copies
of fixtures. Per-command cases are in [smoke/local-commands.md](../smoke/local-commands.md).
Reports and the offline gate are shared with the AEP suite; see
[reports-and-gate.md](reports-and-gate.md). Unlike the AEP suite, it does not run
org setup or deploy AT4DX dependencies.

## Commands

```bash
npm run smoke:local -- --offline                     # no org; cases 13 and 17 are SKIP
npm run smoke:local -- --target-org simply-smoke-org # adds the org cases
npm run smoke:local -- -o simply-smoke-org
```

| Flag | Effect |
| --- | --- |
| `--offline` | Does not need an org. Reports 13 and 17 as SKIP and omits 18b, the mixed-source check that needs org flag resolution. |
| `--target-org <alias>`, `-o <alias>` | Target org for 13, 17 and 18b. Defaults to `simply-smoke-org`. |

Unknown flags and missing values are errors (`parseLocalArgs` in the runner).
The local suite has no `--only`, `--skip-setup` or `--apx-parity` flags.

## Plugin links

Link all three plugins from the same `simply-plugins` checkout before running.
Preflight calls `assertLinkedPlugin` for `@simplysf/simply-project`,
`@simplysf/simply-document` and `@simplysf/simply-schema`, each at
`packages/simply-<name>` under `SIMPLY_PLUGINS_DIR` (default `../simply-plugins`).
A missing, bundled, shadowed or wrongly owned plugin fails the run before any case.

```bash
cd <simply-plugins>
pnpm --filter '@simplysf/simply-project...' run build   # repeat for document and schema
sf plugins link "$PWD/packages/simply-project" --no-install
```

- Do not pass `--json` to `sf plugins link`; the installed CLI 2.147.7 rejects it.
- Remove the installed umbrella before linking, as described in
  [org-setup.md](org-setup.md#link-the-plugin-under-test).
- Set `SIMPLY_PLUGINS_DIR` to the absolute monorepo path when running from a worktree.

The report's `plugin` field records each linked plugin's name, version, path,
`git rev-parse HEAD` and branch.

## Workspace and fixtures

Each run wipes and rebuilds `generated/local/` (`prepareLocal`):

- `project/`, a copy of `fixtures/local/project`: one custom object, an Apex class
  and test, a flow, a permission set, and a mix of `apiVersion` values;
- copies of `schema.csv`, `schema.xlsx` and `tdd.hbs`;
- `empty/`, `unknown.csv` and `malformed.csv` for the negative cases;
- `gitrepo/`, a two-commit repository from `fixtures/local/make-git-fixture.mjs`,
  tagged `v1.0.0` and `v1.1.0`.

The committed fixtures are never written. Case 19 compares the bytes of
`fixtures/local` with a snapshot taken during preflight.

`fixtures/local/schema.xlsx` is committed. It is rebuilt by hand only, with
`SIMPLY_PLUGINS_DIR=/absolute/path/to/simply-plugins node fixtures/local/build-xlsx.mjs`,
which reuses the schema plugin's `exceljs`. The harness adds no npm dependency.

## Org state

Case 13 deploys `generated/local/schema` to the target org, which creates
`SSO_Schema_Csv__c` and the `SSO_Schema_Fixtures` permission set copied from
`fixtures/local/`. It assigns that permission set to the running user before
describing the object so both generated fields are visible through field-level
security. Reruns redeploy over the same names.
The AEP reset selects only `SSO_Run_`, `SSO_Gen`/`SSOGen` and `SSO_Aep_Gen` names
(see [org-setup.md](org-setup.md#reset-scope)), so nothing removes this object.
The suite does not run `bin/setup-smoke-org.sh`, so it needs only a reachable org.
Any org from `npm run org:create` works; that command runs AEP setup as part of creation.

## Reports and gate

- Reports are written to `reports/local-<iso>.json`. Offline runs have a null
  `targetOrg`.
- `npm test` runs `test/local.test.mjs` offline. It checks the flags, that
  `smoke/local-commands.md` names each command with a success and an expected-failure
  case, that only 13 and 17 are SKIP offline, the fixture preparation and the
  tagged diff, and that every case uses `--json` and omits `--target-org`.
  See [reports-and-gate.md](reports-and-gate.md#offline-gate).

Live org cases (13, 17, 18b) passed against the disposable `simply-smoke-org`
on 2026-10-16. Report `reports/local-2026-10-16T17-25-07.772Z.json`
recorded **22 PASS, 0 FAIL, 0 SKIP**, including fixture integrity. Case 13's
deployment `0Afcf00000Cp2C9CAJ` succeeded and describe verified the text field
and Account lookup; case 17's CSV included that relationship. The three linked
plugins were at monorepo revision `dbdfc2e0995f13b3a6db99a48c19efdec1d58053`.
Reports remain ignored runtime artifacts. See
[reports-and-gate.md](reports-and-gate.md#live-acceptance).

## Adding a case

Add the case in `buildLocalTests` in `scripts/run-local-smoke.mjs`, then update the
matching row in [smoke/local-commands.md](../smoke/local-commands.md). Run `npm test`.
The general process is in [extending.md](extending.md#adding-a-case).
