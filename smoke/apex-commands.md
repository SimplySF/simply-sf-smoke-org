# Apex command coverage

All commands run through the shared harness and include `--json`. Live acceptance:
**passed** twice in a row on `simply-smoke-org` (20/0/0 each, cleanup PASS;
see [live status](../docs/apex-flow-suites.md#live-status)). Source inspection and offline tests are not proof of a live deploy.

Cases run in the order below, with trace setup before execution and purge. A
selected execution/purge case establishes its own user trace; case 05 establishes
its first flag if case 04 was filtered out. A generated suite is always rebuilt
before deploy, so `--only` cannot reuse stale output.

| Case | Command | Proof |
| --- | --- | --- |
| 04 trace setup running user | trace setup | User ID, one DEVELOPER_LOG, returned trace/debug-level IDs, ReplayDebuggerLevels, expiration within five minutes of now +24h |
| 05 trace setup updates existing flag | trace setup | Same flag ID and exactly one user flag |
| 06 trace setup on behalf of seeded user | trace setup | Username-selected Standard Platform User has exactly one flag and expected debug level |
| 07 trace setup rejects reversed dates | trace setup | Exit 1 and end-date/start-date diagnostic |
| 01 execute compiles and runs | execute | compiled and success true, SSO_APEX_PING log text, new user ApexLog present in org |
| 02 execute surfaces compile diagnostic | execute | Exit 1; compilation problem names SSO_Missing_Type, line 1 and column |
| 03 execute surfaces exception | execute | Exit 1; SSO_EXPECTED_EXCEPTION surfaced |
| 08 trace silence explicit class | trace silence | Exact class and ID; CLASS_TRACING flag; all eight debug categories NONE |
| 09 trace silence classes file | trace silence | Both JSON-listed classes get flags with NONE categories |
| 10 trace silence framework classes | trace silence | Exact seven framework classes and IDs get flags with NONE categories |
| 11 trace silence warns for missing class | trace silence | Exit 0, empty result array, no-classes warning |
| 11b trace silence rejects empty selection | trace silence | Exit 1 and no-classes-specified diagnostic |
| 11c trace silence rejects conflicting inputs | trace silence | Exit 2 and exclusive-flag diagnostic |
| 12 logs purge REST | logs purge | Fresh anonymous execution; nonempty log snapshot; exact returned IDs, Success true; Tooling query finds no remaining IDs |
| 13 logs purge Bulk API | logs purge | Fresh nonempty snapshot; --use-bulk-api --wait 10; same result and org deletion proof |
| 14 logs purge rejects invalid SOQL | logs purge | Exit 1; Nope/INVALID_FIELD diagnostic |
| 15 test-suite generate exact test classes | test-suite generate | Fresh XML and testClassNames list exactly LeadingComment and NoisyTest |
| 16 test-suite generate deploys and passes org tests | test-suite generate | Regenerate, validate, deploy suite; run named suite; outcome Passed and two tests run |
| 17 test-suite generate rejects source without tests | test-suite generate | Exit 1 and no @IsTest-annotated classes diagnostic |

Cleanup is a shared-harness `finally` callback before writing the report. It
snapshots only the two users and the fixture/framework class entities. It deletes
new flags and restores existing flags. Active flags retain their exact snapshot
fields. Flags whose snapshot expiration is past or within one minute of cleanup
are restored to their original DebugLevelId with StartDate = now and
ExpirationDate = now + two minutes: Salesforce rejects past expiration dates.
Those flags are checked on Id, DebugLevelId, TracedEntityId and LogType; active
flags are checked on all snapshot fields. The short renewed window expires shortly
after cleanup. It also removes newly created
ReplayDebuggerLevels/Silence records if no flags reference them. Existing debug
levels survive. Cleanup attempts remaining records after an individual deletion
fails and records any failure as a failing report row. Deleted/restored flag IDs
and removed debug-level IDs appear in the cleanup result. Run sequentially in the
disposable org; concurrent trace edits to the same entities are unsupported.

## Source-confirmed contracts

Read from `simply-plugins` origin/main `b483669`, package
`packages/simply-apex/src/commands/simply/apex/`, and its installed
`@simplysf/simply-apex-core` 0.3.11 `lib/` implementation:

- `execute.ts` / `apexExecute.js`: result fields are `compiled`, `success`,
  `compileProblem`, `exceptionMessage`, `exceptionStackTrace`, `line`, `column`,
  `logs`. Compile/execution failures become CLI errors with the diagnostic.
- `trace/setup.ts` / `apexTraceSetup.js`: default level name is
  `ReplayDebuggerLevels`; result is `{userId, debugLevelId, traceFlagId,
  expirationDate}`. Existing DEVELOPER_LOG flags are updated; duration is 24h.
- `trace/silence.ts` / `apexTraceSilence.js`: presets are
  `fflib_SObjectDescribe`, `fflib_SObjectDomain`, `ApplicationSObjectDomain`,
  `di_Binding`, `di_Module`, `di_PlatformCache`, `di_Injector`. Result entries
  contain `class`, `classId`, `traceFlagId`. Missing classes warn and are omitted;
  all missing returns `[]` with exit 0. Empty selection fails with exit 1.
  The shared debug level is `Silence` with eight NONE categories.
- `test-suite/generate.ts` / `apexTestSuite.js`: first meaningful line skips
  blank lines, line comments, and block comments; it must start with `@IsTest`.
  A method annotation alone is excluded. No tests throws, rather than writing an
  empty suite. Result fields are `filePath` and sorted `testClassNames`.
  The method-only fixture lives in `fixtures/apex/not-test` as scanner input,
  separate from deployable classes; generation combines both in `generated/`.
- `logs/purge.ts`: the WHERE string is appended to `SELECT Id FROM ApexLog`;
  results use capitalized `Id`, `Success`, `Error`. Individual deletion failures
  warn, so exit 0 alone is insufficient. The suite queries the real org for
  current admin's logs with `Operation = 'Api'` and StartTime at or after a
  timestamp captured just before each fresh execution, minus two seconds for
  StartTime's second precision. It passes only the captured IDs to purge and
  checks those IDs are gone. The operator checked the work item's
  `Operation LIKE '%executeAnonymous%'` filter live and confirmed it is wrong:
  anonymous executions have Operation/Request `Api`; test runs have Operation
  `ApexTestHandler`. Cases 12/13 now use this observed operation and time window.

See [running the suites](../docs/apex-flow-suites.md) for prerequisites and flags.
