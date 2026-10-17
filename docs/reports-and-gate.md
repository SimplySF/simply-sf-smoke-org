# Reports, failure contract, and gates

What a run writes, how pass/fail is decided, the offline gate, live acceptance,
and known issues.

## Reports

Each suite run writes `reports/<suite>-<iso>.json`. The AEP suite's name is
`aep`, so its reports are `reports/aep-<iso>.json`. The local suite's name is
`local`, so its reports are `reports/local-<iso>.json`. The community suite's
name is `community`, so its reports are `reports/community-<iso>.json`. The
permissions suite writes `reports/permissions-<iso>.json`, the settings suite
writes `reports/settings-<iso>.json`, the Apex suite writes
`reports/apex-<iso>.json`, and the Flow suite writes `reports/flow-<iso>.json`.
The data and SObject suites write `reports/data-<iso>.json` and
`reports/sobject-<iso>.json`. The `reports/` directory is ignored by git.
Reports contain:

- target org;
- plugin provenance (see [running-suites.md](running-suites.md#plugin-provenance-preflight));
- pass, fail, and skip counts;
- each case's command, expected and actual exit codes, captured output, and
  assertion errors.

Setup and preflight failures also produce a report. In that case the failing
phase appears as a single `FAIL` result and no test cases run. A suite with a
`cleanup` callback (the Apex suite's TraceFlag cleanup) runs it in a `finally`
block, so a `cleanup` result, PASS or FAIL, is appended even after failed cases
or test discovery. The report is written after that result.

## Failure contract

- A mismatch, or malformed JSON, fails the suite.
- An expected failure requires exit code **1** and the relevant message or
  issue codes. Both checks must hold. Exceptions expect exit code **2**: the
  local suite's flag parser errors (`project update api-version`, cases 03 and 04),
  the settings suite's case 16 flag-relationship errors (conflicting or
  missing source, for both `create` and `activate`), and the Apex suite's case
  11c (`trace silence` with conflicting inputs). The permissions suite's
  case 05 (invalid `--type`) and the settings suite's case 17 (malformed JSON,
  for both `create` and `activate`) expect exit code **1**. The data suite's
  case 05 expects exit **0**: a missing file in a batch upload is recorded as a
  row in `upload/error.csv`, and the command does not fail.
- Community case 06 accepts either exit 1 with the JSON timeout error or exit 0
  with the full publish-success contract, since a zero-wait publish may already
  be complete at its first status check. Reports preserve the actual exit code.
- Missing authentication, bad deployments, and query errors remain failures.
  They are not converted into expected failures.
- If the CLI changes an expected exit-code contract, the smoke case reports it.
- Commands are invoked as raw `sf ... --json`. This keeps the JSON contract and
  the process exit status, which the harness is testing. Compact CLI wrappers
  would hide that evidence.

## Offline gate

The gate needs no Salesforce authentication or network:

```bash
npm test
```

`npm test` runs `scripts/check.mjs`, which:

- verifies that `SSO_Aep_Fixtures` grants readable/editable FLS for every
  non-required fixture custom field, excluding master-detail fields;
- syntax-checks every project `.mjs` file with `node --check`;
- checks Bash scripts with `bash -n`;
- runs ShellCheck if it is installed;
- runs `node --test` on `test/*.test.mjs`.

The tests cover process, JSON, report, and link helpers. They check reset
boundaries, check that the coverage outline maps to real successful org cases
for every AT4DX command, and check that an unchanged status or a missing
invalid-fixture rule fails the corresponding assertion. `test/permissions-settings.test.mjs` covers the
permissions and settings runners: destructive guards, PSG polling, XML and byte
checks, and the coverage pins. `test/apex-flow.test.mjs` covers the Apex and Flow
runners: flag rejection, Flow version and deletion proofs, rebuild sequencing,
TraceFlag cleanup on failure, purge scoping to the captured log snapshot, and
the case-count and coverage-doc pins. `test/data-sobject.test.mjs` covers the
data and SObject runners: setup ordering, literal-prefix cleanup, byte-level
download proofs, history transitions, the deduplication and reparenting proofs,
and the 9 and 13 case-count pins.

Gate success does not claim a live deploy.

## Live acceptance

The community suite's live status is in
[community-suite.md](community-suite.md#live-status), the permissions suite's is in
[permissions-suite.md](permissions-suite.md#live-status), and the settings suite's
is in [settings-suite.md](settings-suite.md#live-status). The Apex and Flow
suites' live status is in [apex-flow-suites.md](apex-flow-suites.md#live-status),
and the data and SObject suites' is in
[data-sobject-suites.md](data-sobject-suites.md#live-status). The steps below
cover the AEP suite.

Live acceptance is operator-run after the PR is opened:

1. Create an org.
2. Run the full suite twice, and record both reports and their pass counts in
   the work item.
3. Run with the generate branch, and run with a checkout that lacks that topic.
4. Run live fault injection: break an action, make an invalid source valid, and
   unlink AEP. Each should fail. Undo those edits afterwards.

Steps 1 to 3 are recorded. Two consecutive full runs on the existing org passed
49/0/0 (`reports/aep-2026-10-16T17-47-17.289Z.json` and
`reports/aep-2026-10-16T18-13-16.798Z.json`), including the generate group. On
2026-10-17 the org was recreated from scratch with `npm run org:create --
simply-smoke-org`, which deployed the four pinned dependencies and ran all
setup end to end. All nine suites then passed on the fresh org, 153 PASS in
total (`aep` 49, `local` 22, `community` 6, `permissions` 13, `settings` 11,
`apex` 20, `flow` 8, `data` 10, `sobject` 14). Plugins were linked from
simply-plugins `main` at `3c9a824`.

Step 4 was run live on 2026-10-17 against the same org and plugin revision.
Each fault turned the run red:

- **AEP unlinked** (umbrella `@simplysf/simply` installed instead): preflight
  failed before any case ran (`reports/aep-2026-10-17T18-43-27.613Z.json`).
- **Broken action** (`SSO_AepSetStatusAction` no longer sets the status): only
  case 13 failed, 48/1/0, with `'Pending'` instead of `'Injected'`
  (`reports/aep-2026-10-17T19-00-09.064Z.json`).
- **Invalid source made valid** (`SSO_Invalid_Dom2` bound to `Account`): case 08
  failed because `duplicate-domain-sobject` was missing. The command still
  exited 1 on the other rules, so the issue-code assertion is what caught it
  (`reports/aep-2026-10-17T19-01-06.548Z.json`).

After reverting both edits, a full run with setup passed 49/0/0
(`reports/aep-2026-10-17T19-17-12.577Z.json`).

## Known issues

The reported framework-wiring compile failure (`Field does not exist:
SSO_Status__c`) is addressed by the baseline `SSO_Aep_Fixtures` permission set
and setup assignment to the target-org user. Rerun setup before using
`--skip-setup` on an existing org. The passing live runs above confirm the fix.

The remaining issues are tracked in the work item changelog.

- **Flow delete silently ignores nonexistent names.** The operator confirmed
  this live with linked plugins from `b483669` (`simply-flow-core` 0.1.0): exit 0,
  no failure entry, and the real Flow still deleted. Case 24 now asserts that
  behavior per operator decision. Reported upstream as
  [SimplySF/simply-plugins#81](https://github.com/SimplySF/simply-plugins/issues/81). See
  [apex-flow-suites.md](apex-flow-suites.md#live-status) and
  [flow command coverage](../smoke/flow-commands.md#source-confirmed-contracts-and-plugin-observation).
- **Provenance check is not command-specific.** `assertLinkedPlugin` requires
  at least one `simply:aep:*` command owned by the linked plugin. It does not
  check for `simply:aep:at4dx:binding:list`, although the test fixtures use that
  command. See [running-suites.md](running-suites.md#plugin-provenance-preflight).
- **Usage text.** The usage message in `scripts/setup-aep.mjs` names
  `setup-aep.sh`, a wrapper. It works, but it does not name the `org:setup`
  entry point. Minor.
