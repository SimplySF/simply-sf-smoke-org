# Permissions command coverage

Source: simply-plugins origin/main `b483669` command source and messages.
All commands run with JSON; shared harness checks exits and failure patterns.

| Case | Command | Proof |
| --- | --- | --- |
| 01 build read-only | `simply permissions build` | Fresh XML: object read only, viewAllFields=true, no fieldPermissions entries |
| 02 build modify-all | `simply permissions build` | Fresh XML: CRUD, modifyAllRecords, record type, Second field edit override |
| 03 build file writes two sets | `simply permissions build` | Two fresh XML files, names and both baselines checked |
| 04 build deploy assign and query object access | `simply permissions build` | Regenerate RO, deploy terminal success, assign seeded user, query assignment and ObjectPermissions by ParentId |
| 05 build rejects invalid type | `simply permissions build` | Exit 1 and invalid enum diagnostic |
| 06 analyze filtered | `simply permissions analyze` | Fresh HTML includes PS A, PSG, object; exactly one set and group |
| 07 analyze all | `simply permissions analyze` | Fresh HTML, positive counts, fixture names and object; managed namespaces present when sets/groups carry them |
| 07b analyze rejects unwritable output | `simply permissions analyze` | Missing parent directory gives ENOENT |
| 08 assignment delete permission set | `simply permissions assignment delete` | Reassign fixtures, exact deleted assignment IDs, query zero PS A assignments |
| 09 assignment delete group | `simply permissions assignment delete` | Wait for Updated, idempotent assignment, exact deleted IDs, query zero PSG assignments |
| 10 assignment delete manifest | `simply permissions assignment delete` | Reassign both, manifest deletes exact IDs and query returns zero for both |
| 11 assignment delete missing name is no-op | `simply permissions assignment delete` | Source-confirmed success with empty deleted/failures |
| 11b assignment delete rejects conflicting inputs | `simply permissions assignment delete` | File plus explicit names rejected |

Before 08–10, refuse all non-seeded assignees; snapshot nonempty admin assignment
IDs and compare after invocation even on command failure. Both fixture targets
are explicit, with no wildcard or baseline reset. PS A/PSG are left unassigned
by case 10; the next run reassigns them. PS B and generated sets survive.
Generated files and reports are removed before their producing command so stale
output cannot pass, except case 04: it regenerates the RO prerequisite without that
removal and relies on the build's exit 0 envelope.
Unfiltered analyze also queries managed set/group namespaces and requires their
group labels in the report when present. With no managed permission metadata,
fixture coverage and positive report counts remain mandatory.

Live status: pending operator runs. Offline tests verify safety, polling,
duplicate handling, coverage and XML assertions; they do not prove an org deploy.
