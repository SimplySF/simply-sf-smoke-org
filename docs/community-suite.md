# Community suite

The community suite (`scripts/run-community-smoke.mjs`) runs
`simply community publish` from a linked `simply-community` checkout against an
Experience Cloud site in the shared smoke org. Per-case assertions are in
[smoke/community-commands.md](../smoke/community-commands.md). Reports and the
offline gate are shared with the other suites; see
[reports-and-gate.md](reports-and-gate.md). The AEP and local suites are in
[running-suites.md](running-suites.md) and [local-suite.md](local-suite.md).

## Commands

```bash
npm run smoke:community -- -o simply-smoke-org
npm run smoke:community -- -o simply-smoke-org --skip-setup
npm run smoke:community -- -o simply-smoke-org --only '^0[12]'
```

| Flag | Effect |
| --- | --- |
| `--target-org <alias>`, `-o <alias>` | Target org. Defaults to `simply-smoke-org`. |
| `--skip-setup` | Skips the site setup in `scripts/setup-community.mjs`. Use it only when `SSO Smoke Site` already exists. |
| `--only <regex>` | Runs only cases whose names match the regex. An invalid regex is rejected, and a filter that matches nothing fails the run. |

`parseCommunityArgs` rejects `--apx-parity` and `--redeploy-deps`; those belong
to the AEP suite. Unknown flags and missing values are errors. Cases run
sequentially. Each case runs `sf simply community publish --json` with a 25-minute
process timeout.

Run the suite only against a disposable smoke org. A process timeout is a
harness failure, not an expected CLI failure.

## Plugin link

The suite needs `@simplysf/simply-community` linked from a `simply-plugins`
checkout. It does not need the AEP plugin linked, and it does not run AEP setup.

```bash
cd <simply-plugins>
pnpm --filter '@simplysf/simply-community...' run build
sf plugins link "$PWD/packages/simply-community" --no-install
```

Use the same link rules as AEP: remove the installed umbrella first, pass an
absolute path, do not pass `--json`, and set `SIMPLY_PLUGINS_DIR` when running
from a worktree. See [org-setup.md](org-setup.md#link-the-plugin-under-test).

Preflight runs `assertLinkedPlugin('@simplysf/simply-community', ...)` before any
setup. It checks the link and that every `simply:community:*` command is owned by
the linked plugin. The report's `plugin` field records the name, version, linked
path, `git rev-parse HEAD` and branch.

## Site setup

`setupCommunity` in `scripts/setup-community.mjs` runs in this order:

1. **Settings.** Deploys `sfdx-source/community` with `--ignore-conflicts --wait 10`.
   That enables `CommunitiesSettings.enableNetworksEnabled` and
   `ExperienceBundleSettings.enableExperienceBundleMetadata`, so existing orgs need
   no recreation. Anything other than `success: true` with status `Succeeded` aborts setup.
2. **Lookup.** Queries `Network` for `SSO Smoke Site`. More than one match aborts.
   An existing row is reused, and setup stops there.
3. **Template.** If the site is absent, `sf community list template` must list
   `Build Your Own (LWR)`. Otherwise setup aborts.
4. **Create.** Runs `sf community create` with URL path prefix `ssosmoke`. The
   site is not deployed from metadata source.
5. **Poll.** Queries `Network` every 15 seconds for up to 10 minutes. A timeout
   aborts setup with a message to inspect site creation before retrying.

Query, auth and creation errors also abort. The 10-minute deadline starts after
the settings deploy and bounds the lookups and creation requests, each of which
is limited to the time remaining.

Where setup runs:

- `npm run org:setup` runs it after AEP setup, through `bin/setup-smoke-org.sh`.
  Because the script uses `set -e`, a failed AEP setup prevents it from running.
- `npm run smoke:aep` also runs `bin/setup-smoke-org.sh` unless `--skip-setup`
  is passed. So the AEP suite's setup phase includes the community site setup.
- `npm run smoke:community` calls `setupCommunity` directly, unless `--skip-setup`
  is passed.

AEP reset does not touch `Network` or the site. See
[org-setup.md](org-setup.md#reset-scope).

## Timing

No live timing has been recorded in this repository. These are the bounds the
code allows, plus an estimate:

- Settings deploy: up to 11 minutes (`--wait 10` with a process timeout).
- Site creation: up to 10 minutes, on the first run only.
- Publish cases: about 1–3 minutes per successful publish, estimated. Cases 01–03
  wait for completion, so three successful publishes cost about 3–9 minutes.
- Each case: 25-minute process timeout, above the largest `--wait` used (20 minutes).
- Case 06 starts a real publish with `--wait 0`. The server-side publish can keep
  running after the case ends, so do not rerun the suite until it finishes.

## Reports

Each run writes `reports/community-<iso>.json` with the target org, plugin
provenance, pass/fail/skip counts, and each case's command, exit codes, output and
assertion errors. Preflight failures are recorded as `preflight` and setup failures
as `setup`. In both cases no cases run. See
[reports-and-gate.md](reports-and-gate.md#reports).

## Live status

Operator-reported on 2026-10-16, not re-verified by this repository: enabling
the settings made `Network` queryable on the shared smoke org, and
`sf community create` produced `SSO Smoke Site` within about a minute.

Not yet recorded in this repository:

- a community suite run;
- a fresh-org creation or reuse run;
- automatic Digital Experiences domain creation on a fresh org;
- `Build Your Own (LWR)` availability on a fresh org, which setup checks at runtime.

Until an operator records those runs, the suite's acceptance criteria are open.
See [reports-and-gate.md](reports-and-gate.md#live-acceptance).

## Coverage limits

`simply community url set` is not covered. A scratch org cannot register a custom
domain. Site content checks and forced transient retry failures are also out of
scope. The case list and expected-failure rules are in
[smoke/community-commands.md](../smoke/community-commands.md).

## Adding a case

Add the case in `buildCommunityTests` in `scripts/run-community-smoke.mjs`, then
update [smoke/community-commands.md](../smoke/community-commands.md).
`test/community.test.mjs` asserts the case count (6), the expected-failure count
(2), and that each case name appears in the coverage doc. Update those assertions
with the case. The general process is in [extending.md](extending.md#adding-a-case).
