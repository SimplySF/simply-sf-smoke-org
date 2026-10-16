# Data command coverage

Source contract: `simply-plugins` origin/main `b483669`, simply-data 2.4.15.
See [setup, source findings and live acceptance](../docs/data-sobject-suites.md).
All commands use `--target-org` and `--json`. Each case prepares its own inputs,
so `--only` works without earlier cases. Expected exits are checked exactly.

| Case | Command | Exit | Proof |
| --- | --- | --- | --- |
| 01 file upload preserves basename and bytes | file upload | 0 | Returned version/document IDs match SOQL; PathOnClient is sso-one.txt; ContentSize matches source. |
| 02 file upload links a seeded parent | file upload | 0 | Same checks plus ContentDocumentLink to SSO Parent 0. |
| 03 files upload writes three successes and correct sizes | files upload | 0 | Success CSV has the exact three titles and document IDs; no errors; SOQL verifies sizes and basenames, including 256 binary bytes. |
| 04 files download hash matches all uploads | files download | 0 | Uploads its own three files first; exact success manifest, empty error manifest, source size and SHA-256 match for every downloaded file. |
| 05 files upload records a missing file per row with exit zero | files upload | 0 | One ENOENT error row for SSO_Data_Missing, no success rows or created version. This is a row failure, not a command failure. |
| 06 file upload rejects missing local file | file upload | 1 | ENOENT. |
| 07 files upload rejects missing CSV | files upload | 1 | ENOENT. |
| 08 files download rejects invalid where clause | files download | 1 | Invalid field Nope__c. |
| 09 files upload refuses a computed one percent API budget | files upload | 1 | More than 1% of daily maximum requests planned; ApiBudgetExceededError and no SSO_Data_Budget version. |

The harness adds a cleanup result. Final cleanup deletes only literal
`SSO_Data_` ContentDocuments, verifies absence and removes generated local files,
including after a failed case. Reports under `reports/` remain for diagnosis.
`files upload` and `files download` print no JSON envelope on success (void
commands), so their success cases assert exit 0 and the CSV manifests.
Live acceptance: **passed** two consecutive operator runs (10/0/0 each, including
cleanup). See [Live status](../docs/data-sobject-suites.md#live-status).
