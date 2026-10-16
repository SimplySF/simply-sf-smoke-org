# Settings suite

The settings suite (`scripts/run-settings-smoke.mjs`) exercises the
`simply settings address state` commands (`create` and `activate`) in
`--dry-run` mode only. It never writes to the org. Its one mutation check is
case 18, which proves the AddressSettings metadata is byte-identical before and
after the cases. Per-case assertions are in
[smoke/settings-commands.md](../smoke/settings-commands.md). Reports and the
offline gate are shared with the other suites; see
[reports-and-gate.md](reports-and-gate.md).

Dry-run is the only mode the suite allows. Do not add a live `create` or
`activate` case, or drop `--dry-run` from a case, without reworking case 18 and
the coverage doc. The coverage doc records the plugin-side reasoning for why
dry-run does not open a Setup session or deploy.

## Commands

```bash
npm run smoke:settings -- -o simply-smoke-org
npm run smoke:settings -- -o simply-smoke-org --offline
npm run smoke:settings -- -o simply-smoke-org --only '^1[2-5]'
```

| Flag | Effect |
| --- | --- |
| `--target-org <alias>`, `-o <alias>` | Target org. Defaults to `simply-smoke-org`. |
| `--offline` | Skips case 14, which needs network access for the pinned Debian ISO source. |
| `--skip-setup` | Accepted, but has no effect. This suite has no setup phase. |
| `--only <regex>` | Runs only cases whose names match. Case 18 runs only if it is selected, so a filtered run has no after snapshot. |

`parseSettingsArgs` strips `--offline` before `parseArgs`. It rejects
`--apx-parity` and `--redeploy-deps`, which belong to the AEP suite. Unknown
flags and missing values are errors. Commands run sequentially, each with a
40-minute timeout.

## Plugin link

The suite needs `@simplysf/simply-settings` linked from a `simply-plugins`
checkout (`packages/simply-settings`). It does not need the AEP plugin.

```bash
cd ../simply-plugins
pnpm install
pnpm --filter '@simplysf/simply-settings...' run build
cd ../simply-smoke-org
# If the umbrella is installed, remove it before linking.
sf plugins uninstall @simplysf/simply
sf plugins link "$(cd ../simply-plugins/packages/simply-settings && pwd)" --no-install
```

The rules are the same as for AEP: remove the installed umbrella first, pass an
absolute path, do not pass `--json`, and set `SIMPLY_PLUGINS_DIR` when the project
is run from a worktree. See
[org-setup.md](org-setup.md#link-the-plugin-under-test).

Preflight calls `assertLinkedPlugin('@simplysf/simply-settings', ...)`. It requires
the linked package and at least one `simply:settings:*` command owned by it. The
report's `plugin` field records the name, version, linked path, `git rev-parse
HEAD` and branch.

## Fixtures and baseline

Inputs in `fixtures/settings/`:

- `states.json`: the three-state create plan. `US-CA` is expected to exist in the
  org, `US-ZZ` is expected to be absent, and `ZZ-ZZ` has no country, so it is
  reported as `country-missing`.
- `malformed.json`: invalid JSON, for case 17.
- `package.xml`: the mdapi manifest that retrieves `Address` settings.

The suite does not deploy any metadata. Its baseline is the org's current
AddressSettings, which must already contain `US` with state `CA`. The case
expectations assume `US-ZZ` and the `ZZ` country are absent. If the org already
has them, or lacks `US-CA`, the cases fail and the fixture is not adapted.

Preflight retrieves AddressSettings through `retrieveAddress`. It runs
`sf project retrieve start --target-org <alias> --manifest fixtures/settings/package.xml
--target-metadata-dir <tmp> --unzip --wait 10`, reads
exactly one `Address.settings` found recursively under the retrieval directory
as a raw Buffer, and removes the temp directory. This handles the operator-observed
`unpackaged/unpackaged/settings/Address.settings` layout. Parsing into country
and state maps is done separately, and the comparison in case 18 uses the Buffer.

## Setup

There is no setup phase, so no deploy, seeding, or reset happens. The only
preflight work is the plugin link check and the baseline retrieve above. A
preflight failure is written to the report as a `preflight` result, and no cases
run.

## Case behavior

Every command includes `--target-org`, `--dry-run` and `--json`.

- **Create (12, 13, 14).** Case 12 runs `create --file states.json` and checks
  each key, name and status against the baseline: `US-CA` `exists`, `US-ZZ`
  `would-create`, `ZZ-ZZ` `country-missing`. It also checks the summary counts.
  Case 13 adds `--country US` and expects only the two US entries. Case 14 uses the
  pinned Debian source (`--iso-codes debian --iso-codes-version v4.20.1
  --country FR`). It requires the source metadata, and the statuses come from the
  baseline. Case 14 is SKIP under `--offline`.
- **Activate (15).** Runs `activate --file states.json`. States are sorted into
  `activated`, `alreadyActive` (active and visible in the baseline) and `notInOrg`.
  The result must have no `deployId`, which shows that nothing was deployed.
- **Source validation (16, 17), both verbs.** For `create` and for `activate`:
  - `--file` with `--iso-codes` is an expected failure with exit 2.
  - No source is an expected failure with exit 2.
  - oclif reports flag-relationship errors (`exclusive`, `exactlyOne`) with exit
    2 under `--json`, while enum-option errors such as permissions case 05 exit 1.
    Both codes were observed live.
  - `malformed.json` is an expected failure with exit 1.
- **Byte check (18).** Fetches AddressSettings again with `retrieveAddress` and
  requires `before.equals(after)`. Nothing is normalized or ignored. The `before`
  Buffer comes from preflight, so the check covers the whole run.

## Reports and gate

- `reports/settings-<iso>.json`, as described in
  [reports-and-gate.md](reports-and-gate.md#reports).
- No files are written under `generated/`. Temp directories from retrieval are
  deleted on completion.

## Live status

No live run is recorded in this repository. The operator has confirmed that mdapi
retrieval of AddressSettings works in the shared org, with 396 states, even
though picklists are disabled. That is a prerequisite observation, not a suite
pass. Acceptance needs two consecutive operator runs; see
[reports-and-gate.md](reports-and-gate.md#live-acceptance).

These points are unverified against a live org, and they are part of acceptance:

- Dry-run does not open a Setup session or deploy, as the coverage doc describes.
- Case 14 needs the Debian ISO source to be reachable from the operator's network.

## Coverage limits

The plugin's dry-runs do not check `Account.BillingStateCode`, and the suite does
not enable picklists, so the cases do not prove that picklist-backed billing state
fields work. The coverage doc records these limits in
[smoke/settings-commands.md](../smoke/settings-commands.md).

## Adding a case

Add the case to `buildSettingsTests` in `scripts/run-settings-smoke.mjs`, and
include `--dry-run --json` in its command. Add its row to
[smoke/settings-commands.md](../smoke/settings-commands.md), since the test checks
that each case name appears there. Update the pinned case count (11) in
`test/permissions-settings.test.mjs`. Then run `npm test`. The general process is
in [extending.md](extending.md#adding-a-case).
