# AT4DX dependencies

`config/dependencies.json` pins the AT4DX framework source that setup deploys
into the org. Each entry is cloned into the ignored `.deps/<name>` directory,
checked out at its pinned SHA, and deployed from its own DX project.

## Pins

The array order is the deploy order. The
[AT4DX environment setup](https://github.com/apex-enterprise-patterns/at4dx/wiki/Environment-Setup)
documents this install order.

| Order | Name | Pinned SHA | Source dir (in clone) | Sentinel class |
| --- | --- | --- | --- | --- |
| 1 | `fflib-apex-mocks` | `d81e9e1833e27e6d704281ae7ffa39cbc304edea` | `sfdx-source/apex-mocks` | `fflib_ApexMocks` |
| 2 | `fflib-apex-common` | `c91fa6f32781c02969dc57d9fd1453478b541f6a` | `sfdx-source/apex-common` | `fflib_Application` |
| 3 | `force-di` | `574d0509fbc28c4492e732bccf9b480a26f12457` | `force-di` | `di_Injector` |
| 4 | `at4dx` | `8c109e4ff4f604144f8c1c74905d319a15a46c14` | `sfdx-source/core` | `ApplicationSObjectDomain` |

The pins are full SHAs from upstream HEADs, recorded on 2026-10-15. Local checks
against the clones in `.deps/` confirm that each clone's `HEAD` matches its pin,
each `sourceDir` exists, and each sentinel class is defined in its clone. The
fixture selectors' `getSObjectType` and private `getAdditionalSObjectFieldList`
declarations match the sample selector at
`.deps/at4dx/sfdx-source/core/test/classes/framework-application-factory/ApplicationSObjectSelectorTest.cls`.
These checks are local. They do not prove live deploy compatibility.

## Deploy steps

For each entry, `scripts/setup-aep.mjs`:

1. Clones with `--filter=blob:none` into `.deps/<name>` if the directory is absent.
2. Runs `git fetch origin <ref>` and `git checkout --detach <ref>` there.
3. Verifies `HEAD` equals the pin. A pin that is not 40 lowercase hex characters
   aborts setup before that entry is cloned. Earlier entries in the array have
   already been deployed by then.
4. Deploys `--source-dir <sourceDir>` with the org flags, from inside `.deps/<name>`.

## Cache

After every deploy succeeds, setup writes `.deps/deployed-<orgId>.json`. The
file contains the JSON of the whole `config/dependencies.json`. The org ID must
be 15 to 18 alphanumeric characters, or setup aborts.

On later runs the dependency deploy is skipped only when all of these hold:

- the cache file for this org ID exists and matches the current config exactly;
- all four sentinel `ApexClass` names exist in the org;
- `--redeploy-deps` was not passed.

A changed pin, a missing sentinel, or `--redeploy-deps` forces a full redeploy.
Setup deletes the existing cache before redeploying and writes a new cache only
after all four dependencies succeed. A partial failure leaves no cache, so the
next run retries all four. The reset step still runs when the cache is valid.

Sentinel checks are SOQL queries. If the query fails, setup aborts.

## Items to confirm live

The following are not verified until a live run:

- the four pins deploy together;
- generated files deploy from outside `packageDirectories`;
- two consecutive runs reset successfully.

These pins are reproducible source pending live compatibility verification. The
offline gate does not fabricate live results.

Org and local Apex trigger scans feed the `missing-domain-trigger` rule in binding
validation. That code lives in `simply-plugins`, not in this repository.
`scanOrgTriggersIfNeeded` is in
`packages/simply-aep/src/commands/simply/aep/at4dx/binding/validate.ts`. It is
present at revision `a70eb57` of a local `simply-plugins` checkout, which is not
necessarily the commit under test.
