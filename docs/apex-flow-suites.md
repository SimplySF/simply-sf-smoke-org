# Apex and Flow suites

Build and link `@simplysf/simply-apex` and `@simplysf/simply-flow` from the same
local simply-plugins checkout (use the link instructions in
[org setup](org-setup.md)). Set `SIMPLY_PLUGINS_DIR` to the monorepo root when
using a worktree. The harness verifies exact linked package paths and command
ownership, and records package version, branch, commit and path in `reports/`.

Use only the disposable shared smoke org. Apex needs the AT4DX, fflib and
force-di frameworks already deployed by the AEP setup. It deploys its own Apex
classes and seeds an org-specific Standard User. Flow needs no AEP dependencies.

```bash
npm run smoke:apex -- -o simply-smoke-org
npm run smoke:flow -- -o simply-smoke-org
```

Both accept `--target-org`/`-o`, `--skip-setup`, and `--only <regex>`. Other suite
flags are rejected. `--skip-setup` requires Apex fixtures and its seed user to
exist. For Flow it skips the initial two-flow rebuild; selected cases still
rebuild their own fixture to guarantee repeatable destructive tests. For example:

```bash
npm run smoke:flow -- -o simply-smoke-org --skip-setup --only '^18 '
npm run smoke:apex -- -o simply-smoke-org --skip-setup --only '^15 '
```

Allow several minutes for Flow's serial version deploys and Apex's suite deploy,
test run and Bulk API jobs. Flow setup prints the fixture being deleted/rebuilt;
failures appear as setup or case failures, never as a successful empty run.
Apex cleanup runs even after failed assertions or test discovery. It is reported
before the report file is written; failure to remove a new flag or restore an
existing flag fails the suite. See the detailed
[Apex proofs and cleanup](../smoke/apex-commands.md) and
[Flow proofs and known mismatch](../smoke/flow-commands.md).

Generated XML, working Flow versions and scanner inputs live in `generated/`.
Reports live in ignored `reports/`. Existing DebugLevel records survive cleanup;
newly created suite levels are removed when unreferenced. New TraceFlags on the
suite entities are removed and existing flags restored. Do not run concurrent
sessions changing the same flags. No broad org reset or general log purge runs:
log deletions are scoped to a nonempty snapshot of this user's anonymous-execution
logs created after the run began.

## Offline gate

`npm test` syntax-checks both runners and runs `test/apex-flow.test.mjs` without
Salesforce, network access or linked plugins. Tests pin case lists and coverage,
exercise exact result/state assertions, version rebuild sequencing, source-scan
isolation, failure cleanup, preservation of existing flags, and stale-output
rejection. The leading-comment mutation proof removes that test from the generated
suite result and XML and requires case 15's checker to reject it. A separate implementation-time check also ran the installed apex-core 0.3.11
scanner on temporary fixture copies, removed LeadingComment's class annotation,
and confirmed that case 15's checker rejected the changed output. That local
check passed with SF_DISABLE_LOG_FILE=true; it used no CLI or org connection.

## Live status

**pending operator run**. The authoritative operator instruction for this run
says "Do NOT attempt live org runs" because `~/.sf` log writes fail with EROFS,
and assigns live execution and recording results to the operator. No live
command has been attempted during implementation or review round 1.
The operator should run each suite twice against `simply-smoke-org`, record the
report paths/counts and cleanup results here, and investigate the source-confirmed
case 24 missing-flow discrepancy before declaring acceptance. Source inspection
shows that discrepancy; it is not a recorded live failure.
