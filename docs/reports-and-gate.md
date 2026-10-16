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
The `reports/` directory is ignored by git.
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
  for both `create` and `activate`) expect exit code **1**.
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
the case-count and coverage-doc pins.

Gate success does not claim a live deploy.

## Live acceptance

The community suite's live status is in
[community-suite.md](community-suite.md#live-status), the permissions suite's is in
[permissions-suite.md](permissions-suite.md#live-status), and the settings suite's
is in [settings-suite.md](settings-suite.md#live-status). The Apex and Flow
suites' live status is in [apex-flow-suites.md](apex-flow-suites.md#live-status).
The steps below cover the AEP suite.

Live acceptance is operator-run after the PR is opened:

1. Create an org.
2. Run the full suite twice, and record both reports and their pass counts in
   the work item.
3. Run with the generate branch, and run with a checkout that lacks that topic.
4. Run live fault injection: break an action, make an invalid source valid, and
   unlink AEP. Each should fail. Undo those edits afterwards.

The operator reported 29 PASS and 3 FAIL in
`reports/aep-2026-10-16T04-01-54.859Z.json`. The three fixes are recorded in the
work item. A later run, `reports/aep-2026-10-16T04-16-44.835Z.json`, reported
33 PASS, 2 FAIL (cases 31 and 32), and 1 SKIP (generate group). Those failures
came from the shared `SSO_AepCases` domain target. The untriggered domain now
binds to its own baseline class, `SSO_AepUntriggereds`, which has not yet been
rerun live. A passing rerun and the remaining live acceptance checks are pending.

## Known issues

The reported framework-wiring compile failure (`Field does not exist:
SSO_Status__c`) is addressed by the baseline `SSO_Aep_Fixtures` permission set
and setup assignment to the target-org user. Rerun setup before using
`--skip-setup` on an existing org. A live rerun is still needed to confirm it.

The remaining issues are tracked in the work item changelog.

- **Flow case 24 expects a missing-flow failure the plugin does not report.**
  Per the source at `simply-plugins` `b483669` (`simply-flow-core` 0.1.0),
  `flow delete` with a nonexistent `--flow-name` produces no failure entry, exits
  0, and still deletes the real flow. Case 24 keeps the required nonzero
  missing-flow assertion, so it is expected to fail on a live run. This is
  source-confirmed, not a recorded live result. See
  [apex-flow-suites.md](apex-flow-suites.md#live-status) and
  [flow command coverage](../smoke/flow-commands.md#source-confirmed-contracts-and-known-mismatch).
- **Provenance check is not command-specific.** `assertLinkedPlugin` requires
  at least one `simply:aep:*` command owned by the linked plugin. It does not
  check for `simply:aep:at4dx:binding:list`, although the test fixtures use that
  command. See [running-suites.md](running-suites.md#plugin-provenance-preflight).
- **Usage text.** The usage message in `scripts/setup-aep.mjs` names
  `setup-aep.sh`, a wrapper. It works, but it does not name the `org:setup`
  entry point. Minor.
