# simply-smoke-org

Local scratch-org smoke tests for the [SimplySF](https://github.com/SimplySF)
`simply-*` Salesforce CLI plugins. The first suite covers all 17 AEP AT4DX
commands, with a gated group for the five generators from simply-plugins PR #73.

## Prerequisites

- Node.js 22+, npm, Bash, Git, Salesforce CLI (`sf`). No npm dependencies.
- An authenticated Dev Hub with scratch-org capacity, and network access to GitHub.
- A sibling `simply-plugins` checkout, built and linked locally.
- Optional: ShellCheck for the offline gate; APX for `--apx-parity`.

Build and link the plugin under test:

```bash
cd ../simply-plugins
pnpm install
# Build the kit first when testing PR #73; the ... filter includes workspace dependencies.
pnpm --filter @simplysf/simply-plugin-kit run build
pnpm --filter '@simplysf/simply-aep...' run build
cd ../simply-smoke-org
sf plugins link ../simply-plugins/packages/simply-aep --no-install
```

On older main checkouts without `simply-plugin-kit`, omit the kit build.
`--no-install` is supported by the installed oclif plugin-link command and
preserves pnpm's workspace dependencies. For generate coverage before PR #73
merges, use its `feat/aep-generate` checkout and build kit before AEP. The
umbrella `@simplysf/simply` depends on AEP; a user link overrides installed/core
commands. Preflight checks the exact canonical package root, `type: link`, and
`sf commands --json` ownership of every advertised AEP command (including
`simply:aep:at4dx:binding:list`), then records
version, linked path, git SHA and branch. A bundled copy fails preflight.

Set `SIMPLY_PLUGINS_DIR` to the monorepo directory if it is not a sibling.
This is especially useful when running this project from a git worktree.

## Create and run

Authenticate the Dev Hub once, using an alias of your choice:

```bash
sf org login web --alias my-dev-hub --set-default-dev-hub --json
export DEV_HUB_ALIAS=my-dev-hub
npm run org:create -- simply-smoke-org
npm run smoke:aep -- --target-org simply-smoke-org
```

Org creation uses a 7-day Developer scratch org and immediately runs setup.
`DEV_HUB_ALIAS` is optional when the CLI already has a default Dev Hub.
Use a dedicated disposable smoke org: setup removes this harness's run/generated
metadata and smoke data before restoring the baseline fixtures.

```bash
npm run org:setup -- simply-smoke-org
npm run org:setup -- simply-smoke-org --redeploy-deps
npm run smoke:aep -- -o simply-smoke-org --skip-setup
npm run smoke:aep -- -o simply-smoke-org --skip-setup --only '^23 '
npm run smoke:aep -- -o simply-smoke-org --apx-parity
```

Setup deploys pinned mocks → common → force-di → AT4DX, then fixture metadata.
Dependencies live in ignored `.deps/`; each deployment runs from that dependency's
DX project. A cache keyed by org ID plus the complete dependency configuration
skips deployments only if all four sentinel classes also exist. Changed pins or
`--redeploy-deps` force deployment. Authentication/query errors abort setup.
No framework Apex tests run during setup.

Reset queries all seven CMDT types and removes only names starting `SSO_Run_`,
`SSO_Gen`, `SSOGen`, or the exact generated binding name `SSO_Aep_Gen`.
It removes generated Apex including `ISSOGen*` interfaces, using an empty package
manifest with `--post-destructive-changes`, then deletes `generated/aep/`,
restores baseline source, and removes the framework-wiring data row. Baseline
`SSO_Base_*` metadata and `SSO_Aep*` Apex survive. Reset does not remove the
fixtures from the org. Reruns therefore start with the same fixture state.

`--skip-setup` preserves org state and skips deployment/reset. It refreshes only
the local working source copy. Full create cases will normally fail on duplicate
names if run twice with this flag. Use `--only` to debug read/update cases against
an existing state; a filter does not automatically run prerequisite cases. In
particular G7 needs G1, simulation needs case 22, and G11 needs G10. Filtered runs
are partial verification. An empty selection fails. All cases run sequentially.

The runner copies fixtures into `generated/aep/src` before local write tests.
It never changes the committed fixtures. Case 13 inserts a record through the
real fixture trigger and verifies the injected status with SOQL. Additional
selector/service fixture implementations avoid AT4DX's unique `To__c` constraint.
Trigger-operation flags use `Before_Insert`, not `BeforeInsert`.

The generate probe emits SKIP when the linked checkout lacks the topic. With
it available, output lives under `generated/aep/gen/`. Aggregate tests use
`--force` because fixture bindings already occupy that object. Separate tests
verify refusal without force and structured conflict reporting with force.
The deploy round trip uses a third object `SSO_Aep_Gen__c` and prefix `SSOGen`.
API fallback coverage verifies that omitted `--api-version` produces a valid
numeric version in a service class metadata file; it does not pin an upstream
default version. Optional APX parity generates for the third object into two
isolated directories, fails on code differences and records CMDT differences.

## Reports and failures

Reports are written to ignored `reports/aep-<iso>.json`, including target org,
plugin provenance, pass/fail/skip counts, each case's command, expected and actual
exit codes, captured output, and assertion errors. Setup/preflight failures also
produce reports. A mismatch or malformed JSON fails the suite; expected failures
require exit **1** and the relevant message or issue codes. Missing authentication,
bad deployments and query errors remain failures. Source-flag errors can use the
CLI's configured exit 1; if the CLI changes that contract, the smoke case reports it.
Commands are invoked as raw `sf ... --json` to retain the JSON contract and process
exit status; compact CLI wrappers would obscure evidence this harness is testing.

The offline gate runs with no Salesforce authentication or network:

```bash
npm test
```

It syntax-checks every project `.mjs`, checks Bash scripts, runs ShellCheck if
installed, tests process/JSON/report/link helpers, checks reset boundaries, and
ensures the coverage outline maps to real successful org cases for every AT4DX
command. It also proves that an unchanged status or missing invalid-fixture rule
fails the corresponding assertion. Gate success does not claim a live deploy.

Live acceptance is operator-run after the PR is opened: create an org, run the
full suite twice, and record both reports/pass counts in the work item. Also run
with the generate branch and with a checkout lacking that topic. Live fault
injection (break action, make invalid source valid, unlink AEP) should fail; undo
those edits afterwards. These live results have not yet been recorded.

## Dependency provenance

`config/dependencies.json` pins full SHAs from upstream HEADs verified on
2026-10-15. The DX package paths and fixture APIs were checked in temporary
clones at those exact revisions. Source paths are `sfdx-source/apex-mocks`,
`sfdx-source/apex-common`, `force-di`, and `sfdx-source/core` respectively.
The [AT4DX environment setup](https://github.com/apex-enterprise-patterns/at4dx/wiki/Environment-Setup)
documents this install order. Sentinels are `fflib_ApexMocks`, `fflib_Application`,
`di_Injector`, and `ApplicationSObjectDomain`. Fixture inheritance and method
signatures were checked against pinned AT4DX source. Org trigger scans are wired
into binding validation in the local AEP implementation.

**Confirm during live verification:** these four pins deploy together, generated
files deploy from outside `packageDirectories`, and two runs reset successfully.
These pins provide reproducible source pending live compatibility verification.
No live results are fabricated by the offline gate.

## Extending and moving

Use `scripts/lib/smoke.mjs` for process execution, JSON parsing, test constructors,
plugin provenance and reporting when adding another plugin suite. Keep its fixture
setup and ordered definitions in separate files. See [the coverage outline](smoke/aep-commands.md).
All paths are relative or derived from this checkout. The repository is private
initially; transfer to SimplySF and any release require separate maintainer work.

Copyright (c) 2026, SimplySF. Licensed under [Apache-2.0](LICENSE.txt).
