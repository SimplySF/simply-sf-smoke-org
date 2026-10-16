# Data and SObject suites

Build and link `@simplysf/simply-data` and `@simplysf/simply-sobject` from the
same monorepo. Set `SIMPLY_PLUGINS_DIR` to that checkout's absolute path. The
operator's reference checkout is
`/home/jprichter/projects/simply/.loop-worktrees/sp-smoke-main`, at simply-plugins
origin/main `b483669` (data 2.4.15, sobject 1.6.23). Preflight uses the shared
`assertLinkedPlugin` to check exact link paths and command ownership; each report
records version, path, SHA and branch. No installed umbrella fallback is accepted.

```bash
SIMPLY_PLUGINS_DIR=/absolute/path/to/simply-plugins npm run smoke:data -- -o simply-smoke-org
SIMPLY_PLUGINS_DIR=/absolute/path/to/simply-plugins npm run smoke:sobject -- -o simply-smoke-org
# Repeat both commands to verify rerun stability.
```

These suites target the operator's shared persistent Developer Edition org,
`simply-smoke-org`. Run sequentially: both own the same fixture records and file
prefix, so concurrent runs would interfere. They do not create users or consume
another user license. `--skip-setup` reuses previously seeded fixtures;
`--only <regex>` selects cases by name. Even a filtered download prepares its
own uploads. Without `--skip-setup`, each suite performs its own setup. There is
no offline mode on these live runners; `npm test` is entirely offline.

## Setup and cleanup

Setup deploys only `sfdx-source/data-sobject/` through `deploySource`, with
`sf project deploy start --source-dir <dir> --ignore-conflicts --wait 15 --json`.
The conflict flag is required for fresh worktree snapshots without source
tracking state. Setup assigns SSO_Data_Fixtures to the current operator and runs
`scripts/seedDataSobject.apex`: delete child records before parents, insert six
parents with keys A/A/B/B/C/D and four children attached to the first four
parents. The fixture-only objects are dedicated to these suites.

SSO_Data_Parent__c enables history on SSO_Status__c and SSO_Amount__c. Setup
inserts status Initial, then runs two separate anonymous Apex transactions to
change SSO Parent 0 and 2 to Changed and Final. Separate committed updates avoid
relying on multiple updates in one transaction to preserve intermediate values.
The history assertions require the four real status transitions; empty history
fails the suite. No history rows are synthesized. Metadata and seeded records
may stay between runs, and setup resets them each time.

Setup clears existing literal SSO_Data_ ContentDocuments. The data suite also
clears them before each case. The shared harness calls cleanup in its finally
block, including setup and discovery failures: remove prefixed documents, verify
none remain, then remove generated suite/setup files in a local finally block.
A broad SOQL LIKE can match underscore wildcards; a literal startsWith guard
prevents deleting other titles. Cleanup attempts all owned document deletions
and reports errors. Reports in `reports/` are retained. Committed fixtures are
never modified. Both suites require the operator's normal admin access.

## Verified source findings

These were checked against the pinned reference source above. Source reads
covered all eight command TypeScript implementations and the deduplicate schema
in the two packages above, plus imported installed shared-core implementations
(`lib/` under the packages' `node_modules/@simplysf/`). No plugin code is copied
into this repository and no new npm dependencies are needed.

- **Upload flags and results:** file upload accepts --file-path, --title,
  --first-publish-location-id and --max-api-usage. The return value has Id,
  ContentDocumentId, FileExtension and Title. `contentVersionUtils.js` in
  simply-data-core uses the absolute local path for reading, sends only basename
  as PathOnClient, and makes a follow-up query for the document ID.
- **Batch upload:** files upload accepts --file-path and --max-parallel-jobs
  (default 1), plus the budget flag. CSV fields are PathOnClient, Title and
  optional FirstPublishLocationId. Source resolves paths relative to cwd, so
  runtime CSVs contain absolute fixture paths and the seeded parent ID. The
  committed upload.csv is a human-readable template; the runner writes its
  actual inputs under generated/data. Successes are upload/success.csv with
  ContentDocumentId; failures are upload/error.csv with Error. Per-row failures
  are caught and the command exits 0; a missing CSV is an uncaught exit 1.
- **Download:** files download accepts --where-content-version,
  --max-parallel-jobs and the budget flag, without an output-dir flag. It writes
  download/success.csv (including FilePath) and download/error.csv under cwd.
  File names are `<ContentDocumentId>_<Title with spaces replaced by _>.<FileExtension>`.
  The runner reads FilePath rather than guessing names and hash-checks bytes.
- **Budget:** apiBudgetFlag.ts sets --max-api-usage to an integer 1–100,
  default 20. simply-core/org/apiBudget.js uses that percentage of *remaining*
  daily requests, preferring limit headers then the limits API. An unreadable
  allocation warns and proceeds; exceeded throws ApiBudgetExceededError:
  “This run needs … API requests but …” with a raise/split/wait hint. Upload
  costs two requests, download one plus query pagination. A tiny upload at 1%
  would generally succeed, so case 09 reads the daily maximum via org list
  limits and writes ceil(max/200)+2 upload rows. Their planned requests exceed
  1% of even the full daily maximum. The plugin must refuse before any upload;
  no large live workload is sent. Unreadable limits fail preparation explicitly.
- **Backup:** accepts --sobject, --output-dir, --include-relationship-fields,
  and repeatable --additional-fields. Result is {sobject, recordCount, path}.
  Files are `<sobject>_<timestamp>.csv`. simply-sobject-core/relationshipFields.js
  expands only identifying name/DeveloperName fields for single-target
  references, excluding polymorphic ones. The child header is SSO_Parent__r.Name,
  and Owner.Name is requested explicitly. Every described direct field is
  selected. simply-core/query/queryRecords.js uses REST for ≤2000 rows and
  Bulk API v2 above that threshold; these small fixtures exercise REST.
- **Deduplicate:** the checked-in JSON schema requires primaryObjectApiName,
  primaryObjectCompositeKeyField, primaryObjectFields,
  primaryObjectCompositeKeyFields (nonempty) and associatedObjects (map from
  object name to lookup-field arrays); primaryObjectFilter is optional.
  Both modes write `<object>_Delete.csv` and `<object>_Unique.csv` with Id/key.
  Result fields are primaryObjectApiName, totalRecords, duplicateCount,
  uniqueCount, deleteFile, uniqueFile, modifiedFiles. Dry run skips associated
  processing. Normal mode additionally writes `<child>_Modified.csv` with
  Id/SSO_Parent__c only for losing-parent references (two rows here). Neither
  mode deletes or updates org records, so no reseed is required afterward.
  Associated query failures warn rather than fail the command; requiring the
  modified file and its exact rows catches those failures. The command removes
  its output directory recursively first, so each case passes its own directory
  strictly inside generated/sobject.
- **History export:** --sobject, --start-date, --end-date, --output-dir;
  dates are YYYY-MM-DD, explicitly expanded to UTC T00:00:00Z and T23:59:59Z
  inclusive. Result is {sobject, historyObject, recordCount, path}. Output is
  `<historyObject>_<timestamp>.csv`, uppercase columns HISTORY_ID, PARENT_ID,
  CREATED_DATE, CREATED_BY_ID, CREATED_BY_NAME, FIELD_API_NAME, OLD_VALUE,
  NEW_VALUE. An empty range succeeds with a header and zero rows. The bad-date
  message is “Invalid value for --start-date” with the required format
  (InvalidDateError, exit 2 live).
- **History query:** uses --object, not --sobject, and --filters accepts a file
  or inline JSON group. The filter schema allows AND/OR groups of conditions.
  Field is pushed to SOQL; OldValue/NewValue are client filters. Result fields:
  object, historyObject, totalQueried, totalWritten, path; CSV columns Id,
  ParentId, Field, OldValue, NewValue, CreatedById, CreatedDate. Malformed JSON
  produces a filter parsing/validation failure. Custom history names are
  SSO_Data_Parent__History with ParentId (fieldHistory.js).
- **History schema:** --output-dir; result trackedObjectCount,
  trackedFieldCount, csvPath, htmlPath. Files are
  field_history_schema_<timestamp>.csv/.html. CSV identifies OBJECT_API_NAME
  and FIELD_API_NAME. The command queries EntityDefinition/FieldDefinition via
  Tooling and resolves package attribution through simply-core; its HTML uses
  the same tracked field entries. A regular file in the output-directory path
  causes ENOTDIR/EEXIST.
- **Exit codes:** runtime/SfError failures exit 1 under --json. Flag parse
  errors exit 2, and that includes the custom date flag's `InvalidDateError`
  (case 09, checked live). The row-failure upload case intentionally expects 0.
  `files upload`/`files download` print no JSON on success; see Live status.
- **Optional Account case:** omitted. The core supports AccountHistory/AccountId,
  but that alone does not establish that changing standard Account history
  metadata is safe for this shared Developer Edition org. The custom fixture
  provides controlled history coverage without changing shared Account fields.
  No scratch-org assumption is used.

## Offline verification

`test/data-sobject.test.mjs` pins 9 data and 13 sobject cases, requires documented
success/failure coverage for all eight commands, checks setup ordering and
ignore-conflicts, literal-prefix cleanup, independent download preparation,
computed budget inputs, CSV parsing, byte-level download mutations, history
transitions and deduplication/reparenting proofs. A third duplicate key fails
both snapshot validation and the deduplication proof. `npm test` includes the
new file and syntax checks through the existing discovery mechanism.

## Live status

**Passed two consecutive operator runs** on 2026-10-16 against simply-smoke-org,
from commit `087435f` (plugins linked from simply-plugins `b483669`:
simply-data 2.4.15, simply-sobject 1.6.23). The suites ran one at a time, in
the order data, sobject, data, sobject:

| Run | Suite | Result (incl. cleanup) | Report |
| --- | --- | --- | --- |
| 1 | data | 10 PASS / 0 FAIL / 0 SKIP | `data-2026-10-16T22-43-45.215Z.json` |
| 1 | sobject | 14 PASS / 0 FAIL / 0 SKIP | `sobject-2026-10-16T22-50-18.671Z.json` |
| 2 | data | 10 PASS / 0 FAIL / 0 SKIP | `data-2026-10-16T22-58-52.431Z.json` |
| 2 | sobject | 14 PASS / 0 FAIL / 0 SKIP | `sobject-2026-10-16T23-05-08.346Z.json` |

History cases 07 and 10 asserted the four `SSO_Status__c` transitions (Initial →
Changed → Final on SSO Parent 0 and 2) that setup created. After the runs the
org held no `SSO_Data_%` ContentDocuments and only the six reseeded fixture
parents, and `generated/` was removed.

The first live runs (on `85f795f`) found the issues that `087435f` fixes:

- The permission set interleaved `objectPermissions` and `fieldPermissions`, so
  the deploy failed with "Element objectPermissions is duplicated". Elements
  are now grouped.
- `files upload` and `files download` are `SfCommand<void>`. A successful
  `--json` run exits 0 and prints **no** JSON envelope, so cases 03–05 use
  `checkedVoid` (exit 0, and either empty stdout or a status-0 envelope).
- `backup --sobject SSO_Nope__c` fails with `NOT_FOUND` ("The requested resource
  does not exist"), exit 1.
- A malformed `--start-date` is rejected at flag parsing with
  `InvalidDateError`, exit **2**.
