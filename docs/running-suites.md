# Running suites

How the AEP smoke suite is invoked, what each flag does, and how the cases are
prepared. The local suite (`smoke:local`) is in [local-suite.md](local-suite.md),
the community suite (`smoke:community`) is in [community-suite.md](community-suite.md),
the permissions suite (`smoke:permissions`) is in [permissions-suite.md](permissions-suite.md),
the settings suite (`smoke:settings`) is in [settings-suite.md](settings-suite.md),
and the Apex and Flow suites (`smoke:apex`, `smoke:flow`) are in
[apex-flow-suites.md](apex-flow-suites.md).
Org creation and setup are in [org-setup.md](org-setup.md). Report format and the
offline gate are in [reports-and-gate.md](reports-and-gate.md).

## Commands

```bash
npm run smoke:aep -- --target-org simply-smoke-org
npm run smoke:aep -- -o simply-smoke-org --skip-setup
npm run smoke:aep -- -o simply-smoke-org --skip-setup --only '^23 '
npm run smoke:aep -- --apx-parity
```

`scripts/run-aep-smoke.mjs` is the entry point. Flags are parsed by
`parseArgs` in `scripts/lib/smoke.mjs`:

| Flag | Effect |
| --- | --- |
| `--target-org <alias>`, `-o <alias>` | Target org. Defaults to `simply-smoke-org`. |
| `--skip-setup` | Skips `bin/setup-smoke-org.sh`. Keeps org state. |
| `--only <regex>` | Runs only cases whose names match the regex. Invalid regex is rejected. |
| `--apx-parity` | Runs the optional APX parity comparison. |
| `--redeploy-deps` | Forces the dependency deploy. Passed through to setup. Ignored with `--skip-setup`. |

Unknown flags and missing values are errors. Cases run sequentially.

## Plugin provenance preflight

Preflight runs on every suite run, including `--skip-setup`. It is
`assertLinkedPlugin` in `scripts/lib/smoke.mjs`. It checks:

- The expected checkout path exists. It is resolved from `SIMPLY_PLUGINS_DIR`
  or `../simply-plugins`, plus `packages/simply-aep`.
- `sf plugins --json` lists `@simplysf/simply-aep` with `type: link` and a
  `root` that canonicalizes to exactly that path. A sibling path with the same
  prefix does not match, and a bundled or installed copy fails.
- At least one `simply:aep:*` command is reported by `sf commands --json`, and
  every such command has `pluginName` `@simplysf/simply-aep` and `pluginType`
  `link`. No specific command is required. In particular,
  `simply:aep:at4dx:binding:list` is not checked. See
  [known issues](reports-and-gate.md#known-issues).

On success it records the plugin name, version, linked path, `git rev-parse HEAD`,
and `git branch --show-current` in the report. On failure, the error message
includes the `sf plugins link ... --no-install` command to run. The report
still gets written. See [org-setup.md](org-setup.md#link-the-plugin-under-test).

## Filtering with `--only`

`--skip-setup` preserves org state and skips deployment and reset. It refreshes
only the local working source copy. Full create cases will normally fail on
duplicate names if run twice with this flag.

Use `--only` to debug read and update cases against an existing state. A filter
does not run prerequisite cases. In particular:

- G7 needs G1.
- The simulation needs case 22.
- G11 needs G10.

Filtered runs are partial verification. A filter that matches nothing fails the
run.

## Case preparation

- The runner copies fixtures into `generated/aep/src` before local write tests.
  It never changes the committed fixtures.
- Case 13 inserts a record through the real fixture trigger and verifies the
  injected status with SOQL.
- Additional selector and service fixture implementations avoid AT4DX's unique
  `To__c` constraint.
- Trigger-operation flags use `Before_Insert`, not `BeforeInsert`.

Case coverage: the 17 AEP AT4DX commands are listed in
[smoke/aep-commands.md](../smoke/aep-commands.md), along with the case that
proves each one. `test/aep.test.mjs` checks that every documented command has
a runnable successful org case.

## Generate cases

The gated group covers the five generators from simply-plugins PR #73.

- The generate probe (`sf simply aep generate --help`) emits SKIP only when its
  output reports that the topic is not a command. Any other probe failure runs
  the group as a case, so it fails with the probe output.
- With the topic available, output lives under `generated/aep/gen/`.
- Aggregate tests use `--force`, because fixture bindings already occupy that
  object. Two guards are tested separately:
  - Existing output files are refused even with `--force` (G7). `--overwrite`
    replaces them (G7b).
  - A duplicate-domain conflict is refused without `--force` (G8). With
    `--force` it writes and reports the conflict (G8b).
- The deploy round trip uses a third object, `SSO_Aep_Gen__c`, and the prefix
  `SSOGen`.
- API fallback coverage verifies that omitting `--api-version` produces a valid
  numeric version in a service class metadata file. It does not pin an upstream
  default version.

## APX parity

`--apx-parity` generates for the third object into two isolated directories,
`generated/aep/parity/apx` and `generated/aep/parity/aep`. It fails on code
differences and reports CMDT differences separately. If `sf apx --help` does not
succeed, the parity case is recorded as SKIP with the reason `sf apx is unavailable`.
It is not a failure.

## Live verification

Live acceptance is operator-run. See
[reports-and-gate.md](reports-and-gate.md#live-acceptance).
