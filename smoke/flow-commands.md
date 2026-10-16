# Flow command coverage

Live acceptance: **pending operator run**. Run twice on `simply-smoke-org`.
Every invocation includes `--json`; reports include linked-plugin provenance.

| Case | Command | Proof |
| --- | --- | --- |
| 18 version prune dry-run preserves history | version prune | Exact v1/v2 candidate IDs and developer names, dryRun true, no deleted entries, unchanged three-version org snapshot |
| 19 version prune removes obsolete versions | version prune | Exact v1/v2 candidates, two deleted developer-name entries, no failures, original active v3 survives |
| 20 version prune scans source directory | version prune | Rebuild, scan isolated generated copy of prune Flow metadata; same candidate/deletion/active-ID proof |
| 21 version prune rejects conflicting sources | version prune | Exit 1 and source-dir/flow-name source-selection diagnostic |
| 22 delete active flow by name | delete | One deactivated developer name, three deleted developer-name entries, no failures, org has zero versions |
| 23 delete active flow by manifest | delete | Rebuild, destructiveChanges.xml fixture; same deactivation/deletion/zero-version proof |
| 24 delete collects missing-flow failure and deletes real flow | delete | Required exit 1 and missing-flow failure entry; real fixture's three versions deleted and org count zero; known source mismatch below |
| 25 delete rejects missing source | delete | Exit 1 and manifest/flow-name source-selection diagnostic |

Setup deletes only SSO_Flow_Prune and SSO_Flow_Delete via the plugin, checks for
zero remaining versions, then deploys three changed definitions per Flow. Each
version is activated so replacement makes the preceding version Obsolete. Setup
requires exactly version numbers 1,2,3, statuses Obsolete,Obsolete,Active and three
distinct IDs. Each destructive/dry-run case independently rebuilds its fixture so
filtered runs and repeated runs have identical starting state. Metadata is copied
under `generated/flow/`; committed fixtures are never modified. The source-dir
case scans only the prune fixture to isolate its proof from delete cases.

## Source-confirmed contracts and known mismatch

Read from `simply-plugins` origin/main `b483669`, including refactor `849d67f`:
`packages/simply-flow/src/commands/simply/flow/delete.ts`, `version/prune.ts`,
and installed `@simplysf/simply-flow-core` 0.1.0 `lib/flowDelete.js`,
`flowVersionPrune.js`, `flowQueries.js`, `flowSource.js`.

- Prune queries exactly `Status = 'Obsolete'`, not every inactive version.
  `candidates` contains `{id, developerName}`; `deleted` contains a developer
  name per destroyed version (duplicates expected). `dryRun` is boolean;
  `failures` contains `{developerName, message}`. Source scans recursively find
  `*.flow-meta.xml` and deduplicate developer names.
- Delete deactivates each distinct FlowDefinition with activeVersionNumber 0,
  then attempts deletion of every queried version even after deactivation
  failure. `deactivated` is one developer name per definition, `deleted` one per
  version, and failures are `{developerName, stage, message}`, where stage is
  `deactivate` or `delete`. Per-item exceptions/failures are collected; query
  failures throw. CLI sets exit 1 for nonempty failures.
- **Known mismatch (case 24):** nonexistent names produce no query records and
  the core does not create a missing-flow failure. The current source therefore
  deletes the real Flow and returns exit 0, empty failures. The suite retains
  the work item's required nonzero/missing-flow assertion, so this case is
  expected to reveal the discrepancy on an operator run. Acceptance remains
  open; no plugin changes or acceptance-criteria changes were made here.
- Both commands enforce source selection in `run()` with `Messages.createError`;
  these are runtime errors (exit 1), not oclif `exactlyOne` parse errors (exit 2).

See [running the suites](../docs/apex-flow-suites.md).
