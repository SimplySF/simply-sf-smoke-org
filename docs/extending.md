# Extending and moving

How to add cases, add another plugin suite, and move the repository.

## Adding a case

1. Add the case in `buildAt4dxTests` or `buildGenerateTests` in
   `scripts/run-aep-smoke.mjs`. Use the runner's `success(name, check, cmd)`
   helper for JSON commands; it asserts a zero envelope `status` before
   running `check`. For commands without a JSON envelope, use `commandSuccess`
   (the `success` export of `scripts/lib/smoke.mjs`, as case 33 does). Use
   `expectedFailure` and `skip` from `scripts/lib/smoke.mjs`.
2. Update the matching row in [smoke/aep-commands.md](../smoke/aep-commands.md).
   `test/aep.test.mjs` fails if a documented command has no runnable successful
   org case.
3. Run `npm test`. See [reports-and-gate.md](reports-and-gate.md#offline-gate).

For the local suite, add cases in `buildLocalTests` in `scripts/run-local-smoke.mjs`
and update [smoke/local-commands.md](../smoke/local-commands.md). See
[local-suite.md](local-suite.md#adding-a-case).

For the community suite, add cases in `buildCommunityTests` in
`scripts/run-community-smoke.mjs` and update
[smoke/community-commands.md](../smoke/community-commands.md). `test/community.test.mjs`
pins the case count and expected-failure count, so update it too. See
[community-suite.md](community-suite.md#adding-a-case).

For the permissions suite, add cases in `buildPermissionsTests` in
`scripts/run-permissions-smoke.mjs`, update
[smoke/permissions-commands.md](../smoke/permissions-commands.md), and update the
pinned case count in `test/permissions-settings.test.mjs`. For the settings suite,
add cases in `buildSettingsTests` in `scripts/run-settings-smoke.mjs`, keep every
case dry-run, and update [smoke/settings-commands.md](../smoke/settings-commands.md).
See [permissions-suite.md](permissions-suite.md#adding-a-case) and
[settings-suite.md](settings-suite.md#adding-a-case).

For the Apex and Flow suites, add cases in `buildApexTests` in
`scripts/run-apex-smoke.mjs` or `buildFlowTests` in `scripts/run-flow-smoke.mjs`,
update [smoke/apex-commands.md](../smoke/apex-commands.md) or
[smoke/flow-commands.md](../smoke/flow-commands.md), and update the pinned case
count in `test/apex-flow.test.mjs`. See [apex-flow-suites.md](apex-flow-suites.md).

## Changing reset scope

Reset selects metadata by the `metadataTypes` list and the `isRunMetadata` and
`isGeneratedApex` rules in `scripts/lib/metadata.mjs`. Any new CMDT type or
name prefix must be added there and covered by the reset-boundary tests in
`test/aep.test.mjs`. Baseline names must stay outside the selection. See
[org-setup.md](org-setup.md#reset-scope).

## Changing dependency pins

Edit `config/dependencies.json`. Each `ref` must be a full lowercase 40-character SHA.
Update the table in [dependencies.md](dependencies.md) to match, and re-verify
the source paths and sentinel classes. Setup detects a changed config and
redeploys automatically.

## Adding another plugin suite

Use `scripts/lib/smoke.mjs` for process execution, JSON parsing, test
constructors, plugin provenance, and reporting. `runSuite` writes the report
and sets the exit code. Put the ordered cases and fixture copying in the suite's
runner, as `scripts/run-aep-smoke.mjs` and `scripts/run-local-smoke.mjs` do. The
AEP org setup is separate: `bin/setup-smoke-org.sh` runs before the AEP cases
unless `--skip-setup` is passed. It runs `scripts/setup-aep.mjs` and then the
community site setup in `scripts/setup-community.mjs`. The community runner calls
its setup directly, so a new suite that needs a site should reuse that function
rather than its own copy. The local suite needs no org setup
([local-suite.md](local-suite.md)). The permissions suite runs its own fixture
deploy and user seeding in its setup. The settings suite has no setup
([settings-suite.md](settings-suite.md)). A suite that changes org state it must
undo passes a `cleanup` callback to `runSuite`; the Apex suite uses this for
TraceFlags ([reports-and-gate.md](reports-and-gate.md#reports)).

## Moving the repository

All paths are relative to the checkout or derived from it. The repository is
private at first. Transfer to SimplySF, and any release, require separate
maintainer work.
