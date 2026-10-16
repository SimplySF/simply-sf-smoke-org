# Org setup

How the plugin under test is linked, how the scratch org is created, and how
the org is prepared and reset. Dependency pins and the dependency cache are in
[dependencies.md](dependencies.md).

## Prerequisites

- Node.js 22+, npm, Bash, Git, Salesforce CLI (`sf`). No npm dependencies.
- An authenticated Dev Hub with scratch-org capacity, and network access to GitHub.
- A sibling `simply-plugins` checkout, built and linked locally.
- Optional: ShellCheck for the offline gate; APX for `--apx-parity`.

## Link the plugin under test

The runner exercises a linked local checkout of `simply-aep`. Build and link it:

```bash
cd ../simply-plugins
pnpm install
# Build the kit first when testing PR #73; the ... filter includes workspace dependencies.
pnpm --filter @simplysf/simply-plugin-kit run build
pnpm --filter '@simplysf/simply-aep...' run build
cd ../simply-smoke-org
# If the umbrella is installed, remove it before linking.
sf plugins uninstall @simplysf/simply
sf plugins link "$(cd ../simply-plugins/packages/simply-aep && pwd)" --no-install
```

Notes:

- On older main checkouts without `simply-plugin-kit`, omit the kit build.
- `--no-install` is supported by the installed oclif plugin-link command and
  preserves pnpm's workspace dependencies. Do not add `--json`: the installed
  CLI 2.147.7 rejects it on `plugins link`.
- For generate coverage before PR #73 merges, use its `feat/aep-generate`
  checkout and build kit before AEP.
- The installed umbrella `@simplysf/simply` silently shadows the linked
  plugin's `simply:aep:*` commands. Uninstall the umbrella before linking;
  `assertLinkedPlugin` in preflight catches commands resolving to the umbrella.
- Pass an absolute path to `sf plugins link`, as above. A relative path can
  report success without registering the link. For a different checkout,
  substitute its absolute `packages/simply-aep` path.
- Preflight runs on every suite run, including `--skip-setup`. It checks the
  link and records provenance. See
  [running-suites.md](running-suites.md#plugin-provenance-preflight).

After smoke testing, restore the umbrella if it was previously installed:

```bash
sf plugins install @simplysf/simply --json
```

Set `SIMPLY_PLUGINS_DIR` to the monorepo directory if it is not a sibling
(default `../simply-plugins`). This is especially useful when running this
project from a git worktree.

The local suite (`npm run smoke:local`) needs three linked plugins instead:
`simply-project`, `simply-document` and `simply-schema`. See
[local-suite.md](local-suite.md#plugin-links). The community suite
(`npm run smoke:community`) needs `simply-community` linked the same way. See
[community-suite.md](community-suite.md#plugin-link).

## Create the org

Authenticate the Dev Hub once, using an alias of your choice:

```bash
sf org login web --alias my-dev-hub --set-default-dev-hub --json
export DEV_HUB_ALIAS=my-dev-hub
npm run org:create -- simply-smoke-org
```

`DEV_HUB_ALIAS` is optional when the CLI already has a default Dev Hub.

`npm run org:create` runs `bin/create-smoke-org.sh`, which runs:

```bash
sf org create scratch --definition-file config/project-scratch-def.json \
  --duration-days 7 --alias <alias> --wait 30 --json
```

- It adds `--target-dev-hub "$DEV_HUB_ALIAS"` when `DEV_HUB_ALIAS` is set.
- The `sf` output is piped into `scripts/require-sf-success.mjs`, which exits
  non-zero when the envelope status is not `0`.
- On success it calls `bin/setup-smoke-org.sh <alias>`.
- The scratch definition is a Developer edition org named "Simply smoke org",
  created for 7 days. It now enables Communities, PartnerCommunity,
  CustomerCommunityPlus, Networks and ExperienceBundle metadata for fresh orgs.
  Existing smoke orgs do not require recreation; setup deploys the settings.

## Set up the org

```bash
npm run org:setup -- simply-smoke-org
npm run org:setup -- simply-smoke-org --redeploy-deps
```

The entry chain is:

```text
npm run org:setup
  → bin/setup-smoke-org.sh
    → bin/setup-aep.sh
      → scripts/setup-aep.mjs
    → scripts/setup-community.mjs
```

`npm run smoke:aep` runs the same `bin/setup-smoke-org.sh` before the suite,
unless `--skip-setup` is passed. That includes the community site setup below.
See [running-suites.md](running-suites.md).

`scripts/setup-aep.mjs` runs these steps in order:

1. **Dependencies.** Deploys the pinned mocks → common → force-di → AT4DX
   sources, unless the cache is valid. See [dependencies.md](dependencies.md).
2. **Reset.** Removes this harness's previous run and generated metadata. See
   [Reset scope](#reset-scope).
3. **Baseline deploy.** Deploys `sfdx-source/aep` (`--source-dir`), which
   holds the baseline bindings, fixture objects, classes, trigger, and
   `SSO_Aep_Fixtures` permission set.
4. **Fixture permissions.** Assigns `SSO_Aep_Fixtures` to the running target-org
   user with `sf org assign permset --name SSO_Aep_Fixtures --target-org <alias>
   --json`. Already-assigned/duplicate assignment errors count as success;
   other failures abort setup. The permission set grants full object access to
   all fixture objects and readable/editable access to their non-required
   custom fields (excluding master-detail fields). Anonymous Apex needs this
   access to compile references such as `SSO_Aep_Case__c.SSO_Status__c`.
5. **Data reset.** Runs `scripts/resetAepSmoke.apex`, which deletes the
   `SSO_FrameworkWiring` case row so the framework-wiring case starts from a
   clean state.

Use a dedicated disposable smoke org. Setup removes this harness's run metadata,
generated Apex, and `generated/aep/`, redeploys the baseline fixtures, and then
deletes the `SSO_FrameworkWiring` case row.

Failure behavior:

- Authentication and query errors abort setup. Query failures are not treated
  as missing dependencies, so an expired login cannot trigger a redeploy.
- Every AEP deploy runs with `--target-org <org> --ignore-conflicts --wait 30`. A
  result that is not `success: true` with status `Succeeded` aborts setup.
- No framework Apex tests run during setup.
- A setup failure is written to the run report as a `setup` failure. The suite
  then does not execute its test cases. See
  [reports-and-gate.md](reports-and-gate.md).

After AEP setup, `scripts/setup-community.mjs` first deploys the Settings metadata
in `sfdx-source/community`: `CommunitiesSettings.enableNetworksEnabled=true` and
`ExperienceBundleSettings.enableExperienceBundleMetadata=true`. This idempotently
enables Digital Experiences on existing orgs before any Network query; a failed
deploy aborts setup. It then reuses the Network named
`SSO Smoke Site`, or verifies the LWR template, starts asynchronous site creation,
and polls for the Network row for up to ten minutes. Query and creation errors
abort setup. The site survives AEP reset. The community suite calls this site
setup directly; it does not redeploy AEP dependencies. See
[community-suite.md](community-suite.md#live-status) for live validation limits.

`--redeploy-deps` forces the dependency deploy even when the cache is valid.
Pass the alias first (`npm run org:setup -- simply-smoke-org --redeploy-deps`).
A flag-first form targets the community step at the flag. See
[known issues](reports-and-gate.md#known-issues).

## Reset scope

Reset runs before the baseline deploy. It does not restore source itself;
steps 3–5 above do that.

Reset queries all seven CMDT types and selects only names starting with
`SSO_Run_`, `SSO_Gen`, or `SSOGen`, or the exact name `SSO_Aep_Gen`. It also
selects Apex classes and triggers whose names match `^I?SSO_Gen` or `^I?SSOGen`,
including the `ISSOGen*` interfaces. Those are removed with an empty package
manifest and `--post-destructive-changes`, but only if at least one member was
found. Reset then deletes the local `generated/aep/` directory.

Baseline `SSO_Base_*` metadata and `SSO_Aep*` Apex are not selected. Reset does
not remove the fixtures from the org. Setup redeploys them in step 3, so reruns
start from the same fixture state.

The seven CMDT types are `ApplicationFactory_{Service,Selector,Domain,UnitOfWork}Binding`,
`DomainProcessBinding`, `SelectorConfig_FieldSetInclusion`, and
`PlatformEvents_Subscription`.
