# Permissions suite

The permissions suite (`scripts/run-permissions-smoke.mjs`) runs the three
`simply permissions` commands (`build`, `analyze`, `assignment delete`) against
the shared smoke org. It deploys its own fixtures from `sfdx-source/permissions`,
separate from the AEP baseline. Per-case assertions are in
[smoke/permissions-commands.md](../smoke/permissions-commands.md). Reports and the
offline gate are shared with the other suites; see
[reports-and-gate.md](reports-and-gate.md). Org creation and the AEP setup chain
are in [org-setup.md](org-setup.md).

Run it only against the disposable smoke org. The `assignment delete` cases
remove permission set assignments.

## Commands

```bash
npm run smoke:permissions -- -o simply-smoke-org
npm run smoke:permissions -- -o simply-smoke-org --skip-setup
npm run smoke:permissions -- -o simply-smoke-org --only '^0[89]'
```

| Flag | Effect |
| --- | --- |
| `--target-org <alias>`, `-o <alias>` | Target org. Defaults to `simply-smoke-org`. |
| `--skip-setup` | Skips the fixture deploy, user seeding and assignment. Those must already exist. |
| `--only <regex>` | Runs only cases whose names match. An invalid regex is rejected, and a filter that matches nothing fails the run. |

`parsePermissionsArgs` rejects `--apx-parity` and `--redeploy-deps`, which belong
to the AEP suite. Unknown flags and missing values are errors. Cases run
sequentially. The command under test has a 20-minute timeout.

## Plugin link

The suite needs `@simplysf/simply-permissions` linked from a `simply-plugins`
checkout. It does not need the AEP plugin.

```bash
cd ../simply-plugins
pnpm install
pnpm --filter '@simplysf/simply-permissions...' run build
cd ../simply-smoke-org
# If the umbrella is installed, remove it before linking.
sf plugins uninstall @simplysf/simply
sf plugins link "$(cd ../simply-plugins/packages/simply-permissions && pwd)" --no-install
```

The rules are the same as for AEP: remove the installed umbrella first, pass an
absolute path, do not pass `--json`, and set `SIMPLY_PLUGINS_DIR` when the project
is run from a worktree. See
[org-setup.md](org-setup.md#link-the-plugin-under-test).

Preflight calls `assertLinkedPlugin('@simplysf/simply-permissions', ...)` for
`packages/simply-permissions` under `SIMPLY_PLUGINS_DIR` (default
`../simply-plugins`). It requires the linked package and at least one
`simply:permissions:*` command owned by it. The report's `plugin` field records
the name, version, linked path, `git rev-parse HEAD` and branch.

## Fixtures

Metadata in `sfdx-source/permissions/main/default/`:

| Metadata | Contents |
| --- | --- |
| `objects/SSO_Perm_Obj__c` | Fields `First__c` and `Second__c`, record type `Smoke`, and a tab. |
| `permissionsets/SSO_Perm_PS_A` | Read-only access to `SSO_Perm_Obj__c`. Assigned by setup. |
| `permissionsets/SSO_Perm_PS_B` | Read-only access to `SSO_Perm_Obj__c`. Only member of the group. |
| `permissionsetgroups/SSO_Perm_PSG` | Group containing `SSO_Perm_PS_B`. Assigned by setup. |

Inputs in `fixtures/permissions/`:

- `build-all.json`: `--file` manifest for build case 03.
- `overrides.json`: `--config` for build case 02. It makes `SSO_Perm_Obj__c.Second__c` not editable.
- `destructiveChanges.xml`: manifest for assignment case 10.
- `seedSmokeUsers.apex`: creates the seeded standard user (see setup).

`sfdx-project.json` lists `sfdx-source/permissions` as a non-default package
directory. AEP setup deploys only `sfdx-source/aep`, so these fixtures are
deployed only by the permissions suite.

## Setup

Unless `--skip-setup` is passed, `setupPermissions` runs in this order:

1. **Deploy.** `sf project deploy start --source-dir sfdx-source/permissions
   --ignore-conflicts --wait 10`. The result must be `success: true` with status
   `Succeeded`.
2. **Seed user.** `sf apex run --file fixtures/permissions/seedSmokeUsers.apex`.
   If `sso.perm.<orgid>@example.com` does not exist, the Apex creates it with the
   Standard User profile. The `<orgid>` is the lowercased org ID. If it exists,
   the Apex asserts it is active. The admin user is never modified.
3. **Verify context.** `permissionContext` finds exactly one seeded user, which
   must be active and different from the CLI admin from `sf org display`. If it is
   missing, setup fails with "Run setup to seed the standard smoke user".
4. **Assign.** `assignFixtures` assigns `SSO_Perm_PS_A` to the seeded user with
   `sf org assign permset --on-behalf-of <seeded username>`, through the shared
   `assignPermset` helper. It then polls `SSO_Perm_PSG` until `Status = 'Updated'`:
   up to 60 polls, 2 seconds apart. Only after that does it create a
   `PermissionSetAssignment` for the group, and only if none exists.

A setup failure is written to the report as a `setup` result, and no cases run.

With `--skip-setup`, preflight still runs `permissionContext`. The fixtures and
seeded user must already exist, or preflight fails. Cases 08–10 reassign the
fixture assignments before they run, so they do not depend on earlier setup
state.

## Case behavior

- **Build (01–05).** Cases 01–04 delete their previous XML first and validate
  the fresh output, so a stale file cannot pass. Case 04 validates the read-only
  XML before it deploys the generated set,
  assigns it to the seeded user, and queries `PermissionSet`,
  `PermissionSetAssignment` and `ObjectPermissions` by `ParentId`. It requires `PermissionsRead=true` and
  create, edit and delete false. Case 05 is an expected failure with exit 1 for an
  invalid `--type` with `--json`. Read-only and view-all builds require
  `viewAllFields=true` and no field permissions; modify-all builds still check
  both readable fields and the edit override.
- **Analyze (06, 07, 07b).** Each analyze case deletes its previous HTML report
  first. Unfiltered analyze (case 07) also queries managed `NamespacePrefix` values
  on `PermissionSet` and `PermissionSetGroup`. For each namespace found, the report
  must contain either the namespace or a matching package name from
  `sf package installed list`. With no managed metadata, this check does not run.
- **Assignment delete (08–10).** Before each destructive command, the suite:
  - reassigns the fixtures to the seeded user;
  - refuses to continue unless at least two fixture assignments exist and all of
    them belong to the seeded user;
  - snapshots the IDs the command should delete, and requires a non-empty
    snapshot;
  - snapshots the admin user's assignment IDs, and requires a non-empty snapshot.

  After the command runs, the admin snapshot is compared again, even if the command
  failed. Each case must delete exactly its snapshotted IDs and leave zero matching
  assignments.
- **Assignment delete, no-op and conflict (11, 11b).** Case 11 deletes a missing
  permission set name and expects empty `deleted` and `failures`. Case 11b passes
  `--file` together with `--permission-set-name`, which is an expected failure
  with exit 1.

After case 10, `SSO_Perm_PS_A` and the group have no assignments. The next setup
reassigns them. `SSO_Perm_PS_B` and the generated sets are not affected.

## Reset

The permissions suite has no reset step. AEP reset selects only `SSO_Run_*`,
`SSO_Gen*`, `SSOGen*` and `SSO_Aep_Gen` names (see
[org-setup.md](org-setup.md#reset-scope)), so it does not remove the `SSO_Perm_*`
metadata or the seeded user. Each setup redeploys the fixtures over themselves,
and the seeded user and assignments are created only when missing.

## Outputs and reports

- `reports/permissions-<iso>.json`, as described in
  [reports-and-gate.md](reports-and-gate.md#reports).
- `generated/permissions/permissionsets/*.permissionset-meta.xml` from build, and
  `generated/permissions/filtered.html` and `all.html` from analyze. `generated/`
  is ignored by git.
- Preflight creates `generated/permissions/permissionsets` and removes any stale
  `generated/permissions/absent` directory.

## Live status

The operator ran the suite against the shared `simply-smoke-org` scratch org on
2026-10-16, with the `simply-permissions` plugin linked from `simply-plugins`
`origin/main` `b483669`, at commit `c353d9a`:

| Run | Report | Result |
| --- | --- | --- |
| 1 | `permissions-2026-10-16T20-11-37.018Z.json` | 13 PASS, 0 FAIL, 0 SKIP |
| 2 | `permissions-2026-10-16T20-22-09.727Z.json` | 13 PASS, 0 FAIL, 0 SKIP |

Both runs deployed the built `SSO_Perm_Built_RO` set, assigned it, and read its
`ObjectPermissions` (case 04), and deleted only fixture-user assignments in cases
08–10. After the second run, the admin user still held its own assignments
(`SSO_Aep_Fixtures`, `SSO_Schema_Fixtures` and the org's default set). Earlier
operator runs on `453aefc` found three runner bugs, fixed in `c1e39c3`: the
read-only field-permission expectation, the case 05 exit code and the
AddressSettings retrieve path. The offline tests in
`test/permissions-settings.test.mjs` cover the destructive guards, PSG polling,
duplicate handling, XML assertions and the coverage pins.

## Adding a case

Add the case in `buildPermissionsTests` in `scripts/run-permissions-smoke.mjs`.
Add its row to [smoke/permissions-commands.md](../smoke/permissions-commands.md),
since the test checks that each case name appears there. Update the pinned case
count (13) in `test/permissions-settings.test.mjs`. Destructive cases must use
the guards above. Then run `npm test`. The general process is in
[extending.md](extending.md#adding-a-case).
