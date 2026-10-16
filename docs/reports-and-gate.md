# Reports, failure contract, and gates

What a run writes, how pass/fail is decided, the offline gate, live acceptance,
and known issues.

## Reports

Each suite run writes `reports/<suite>-<iso>.json`. The AEP suite's name is
`aep`, so its reports are `reports/aep-<iso>.json`. The `reports/` directory is
ignored by git. Reports contain:

- target org;
- plugin provenance (see [running-suites.md](running-suites.md#plugin-provenance-preflight));
- pass, fail, and skip counts;
- each case's command, expected and actual exit codes, captured output, and
  assertion errors.

Setup and preflight failures also produce a report. In that case the failing
phase appears as a single `FAIL` result and no test cases run.

## Failure contract

- A mismatch, or malformed JSON, fails the suite.
- An expected failure requires exit code **1** and the relevant message or
  issue codes. Both checks must hold.
- Missing authentication, bad deployments, and query errors remain failures.
  They are not converted into expected failures.
- Source-flag errors can use the CLI's configured exit code 1. If the CLI
  changes that contract, the smoke case reports it.
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
invalid-fixture rule fails the corresponding assertion.

Gate success does not claim a live deploy.

## Live acceptance

Live acceptance is operator-run after the PR is opened:

1. Create an org.
2. Run the full suite twice, and record both reports and their pass counts in
   the work item.
3. Run with the generate branch, and run with a checkout that lacks that topic.
4. Run live fault injection: break an action, make an invalid source valid, and
   unlink AEP. Each should fail. Undo those edits afterwards.

The operator reported 29 PASS and 3 FAIL in
`reports/aep-2026-10-16T04-01-54.859Z.json`. The three fixes are recorded in the
work item; a passing rerun and the remaining live acceptance checks are pending.

## Known issues

The reported framework-wiring compile failure (`Field does not exist:
SSO_Status__c`) is addressed by the baseline `SSO_Aep_Fixtures` permission set
and setup assignment to the target-org user. Rerun setup before using
`--skip-setup` on an existing org. A live rerun is still needed to confirm it.

The remaining issues are tracked in the work item changelog.

- **Usage text.** The usage message in `scripts/setup-aep.mjs` names
  `setup-aep.sh`, a wrapper. It works, but it does not name the `org:setup`
  entry point. Minor.
