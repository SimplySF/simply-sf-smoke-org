# SObject command coverage

Source contract: `simply-plugins` origin/main `b483669`, simply-sobject 1.6.23.
See [setup, source findings and live acceptance](../docs/data-sobject-suites.md).
All commands use `--target-org` and `--json`. All output is isolated under
`generated/sobject/`; returned JSON paths locate timestamped files exactly.

| Case | Command | Exit | Proof |
| --- | --- | --- | --- |
| 01 backup includes every described field and six seeded records | backup | 0 | recordCount=6; header includes every described field; exact seeded IDs, names, keys, statuses and amounts. |
| 02 backup expands parent name and explicit owner name | backup | 0 | Four child rows match SOQL IDs, SSO_Parent__r.Name and Owner.Name. |
| 03 backup rejects unknown object | backup | 1 | NOT_FOUND (live), or SSO_Nope__c / INVALID_TYPE. |
| 04 deduplicate dry run partitions seeded IDs | deduplicate --dry-run | 0 | Six input IDs partition into four unique A/B/C/D and two duplicate A/B IDs, keys verified per ID; no modified files; full before/after snapshot unchanged. |
| 05 deduplicate prepares exact reparent CSV without mutations | deduplicate | 0 | Same partition plus exactly two child lookup updates to the matching survivor IDs; full before/after snapshot unchanged. |
| 06 deduplicate rejects unknown key field | deduplicate | 1 | Nope__c / INVALID_FIELD. |
| 07 history export contains four seeded transitions | history export | 0 | recordCount matches CSV; exact Initial→Changed→Final transitions for SSO Parent 0 and 2, using real parent IDs and old/new values. |
| 08 history export empty past range writes zero rows | history export | 0 | recordCount=0 and empty CSV data. |
| 09 history export rejects malformed date | history export | 2 | InvalidDateError: Invalid value for --start-date (flag parse error). |
| 10 history query file filter returns only seeded status changes | history query | 0 | Exact history IDs match SOQL; all Field=SSO_Status__c; totalQueried/totalWritten match CSV; same four seeded transitions. |
| 11 history query rejects malformed JSON | history query | 1 | Filter parsing/validation error. |
| 12 history schema reports both tracked fixture fields and HTML | history schema | 0 | CSV identifies SSO_Status__c and SSO_Amount__c on SSO_Data_Parent__c; trackedFieldCount matches rows; HTML includes object and both fields. |
| 13 history schema rejects a file as output directory | history schema | 1 | ENOTDIR/EEXIST when attempting to create reports under a regular file. |

No deduplicate mode writes to Salesforce. Only children pointing to the selected
duplicate IDs appear in Modified.csv: two rows here, not all four children.
Selection among equal CreatedDate values is unspecified, so proofs derive the
survivors from Unique.csv and check every ID against the seed snapshot.
Live acceptance: **passed** two consecutive operator runs (14/0/0 each, including
cleanup). See [Live status](../docs/data-sobject-suites.md#live-status).
