# Flow command coverage

Live acceptance: **passed** twice in a row on `simply-smoke-org` (8/0/0 each;
see [live status](../docs/apex-flow-suites.md#live-status)).
Every invocation includes `--json`; reports include linked-plugin provenance.

| Case | Command | Proof |
| --- | --- | --- |
| 18 version prune dry-run preserves history | version prune | Exact v1/v2 candidate IDs and developer names, dryRun true, no deleted entries, unchanged three-version org snapshot |
| 19 version prune removes obsolete versions | version prune | Exact v1/v2 candidates, two deleted developer-name entries, no failures, original active v3 survives |
| 20 version prune scans source directory | version prune | Rebuild, scan isolated generated copy of prune Flow metadata; same candidate/deletion/active-ID proof |
| 21 version prune rejects conflicting sources | version prune | Exit 1 and source-dir/flow-name source-selection diagnostic |
| 22 delete active flow by name | delete | One deactivated developer name, three deleted developer-name entries, no failures, org has zero versions |
| 23 delete active flow by manifest | delete | Rebuild, destructiveChanges.xml fixture; same deactivation/deletion/zero-version proof |
| 24 delete ignores missing flow name and deletes real flow | delete | Exit 0, status 0, empty failures; real fixture deactivated and three versions deleted, Tooling count zero; missing name absent from deactivated/deleted |
| 25 delete rejects missing source | delete | Exit 1 and manifest/flow-name source-selection diagnostic |

Setup deletes only SSO_Flow_Prune and SSO_Flow_Delete via the plugin, checks for
zero remaining versions, then deploys three changed definitions per Flow. Each
version is activated so replacement makes the preceding version Obsolete. Setup
requires exactly version numbers 1,2,3, statuses Obsolete,Obsolete,Active and three
distinct IDs. Each destructive/dry-run case independently rebuilds its fixture so
filtered runs and repeated runs have identical starting state. Metadata is copied
under `generated/flow/`; committed fixtures are never modified. The source-dir
case scans only the prune fixture to isolate its proof from delete cases.

## Source-confirmed contracts and plugin observation

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
- **Plugin observation / follow-up (case 24):** the operator confirmed live on
  linked plugins from `b483669` that nonexistent names are silently ignored:
  exit 0, status 0, empty failures, the real Flow deactivated and all three
  versions deleted. This differs from the description's “failures are collected”
  expectation for a missing name: no queried record means no failure is added.
  Per operator decision, case 24 asserts this actual behavior, including absence
  of the missing name from both result lists. Follow up upstream to clarify the
  description or report missing names. Case 25 remains delete's expected failure;
  Goals and Acceptance Criteria are unchanged.
- Both commands enforce source selection in `run()` with `Messages.createError`;
  these are runtime errors (exit 1), not oclif `exactlyOne` parse errors (exit 2).

See [running the suites](../docs/apex-flow-suites.md).
