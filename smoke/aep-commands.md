# AEP command coverage

Case numbers match `buildAt4dxTests` in `scripts/run-aep-smoke.mjs`.
Each listed command has a successful org-backed case. Invalid source fixtures never deploy.

| Command | Cases | Proof |
| --- | --- | --- |
| `simply aep at4dx binding create` | 01–03, 09–11, 31 | Deploy only, source + deploy, UOW sequence, duplicate refusal, force, flag rules, untriggered org binding |
| `simply aep at4dx binding list` | 04–05 | Baseline/run records and effective priority winner |
| `simply aep at4dx binding update` | 06 | Priority persisted, verified with SOQL |
| `simply aep at4dx binding validate` | 07–08, 32, G12 | Org clean, structured invalid rules, missing org trigger, generated round trip |
| `simply aep at4dx domain-process-binding create` | 12–13, 17 | Persisted binding, runtime status injection, bad order refusal |
| `simply aep at4dx domain-process-binding list` | 14–15 | Active binding present, deactivated binding excluded |
| `simply aep at4dx domain-process-binding update` | 15 | IsActive__c false verified with SOQL |
| `simply aep at4dx domain-process-binding validate` | 16, 29 | Org clean; missing-sobject-reference locally |
| `simply aep at4dx field-set-inclusion create` | 18 | Persisted active field set inclusion |
| `simply aep at4dx field-set-inclusion list` | 19 | Created record returned |
| `simply aep at4dx field-set-inclusion update` | 20 | IsActive__c false verified with SOQL |
| `simply aep at4dx field-set-inclusion validate` | 21–21b | Missing-sobject-reference locally; org clean |
| `simply aep at4dx platform-event-subscription create` | 22 | Persisted active consumer subscription |
| `simply aep at4dx platform-event-subscription list` | 26 | Created record returned |
| `simply aep at4dx platform-event-subscription update` | 25 | IsActive__c false verified with SOQL |
| `simply aep at4dx platform-event-subscription validate` | 27, 30 | Org clean; matcher-rule-missing-field locally |
| `simply aep at4dx platform-event-subscription simulate` | 23–24, 25b, 28 | Matching consumer, no-match, inactive, exclusive source flags |

Case 08 requires all of `duplicate-domain-sobject`, `duplicate-to`,
`sequence-collision` (warning), and `missing-domain-trigger` (error).
Case 13 inserts through the fixture trigger after case 12 deploys the action
binding; SOQL must read `SSO_Status__c = 'Injected'`.
Cases 31–33 force-deploy `SSO_Run_NoTrigger` for `SSO_Aep_Untriggered__c`,
require org validation to fail with `missing-domain-trigger`, then run setup
and query to prove reset removed the binding before generate cases run.
The forced binding reuses `SSO_AepCases`, so additional wiring issues are allowed.
Case 33 resets all run state even with `--skip-setup`; include all three cases
when selecting this sequence with `--only`.

| Generate command | Cases | Proof |
| --- | --- | --- |
| `simply aep generate` | G1, G6–G7b, G10–G12 | Aggregate artifacts, empty selection refusal, overwrite refusal preserves content/mtimes, overwrite success, deploy + validate |
| `simply aep generate selector` | G2–G3 | Dry run has no disk effects, fflib omits CMDT |
| `simply aep generate domain` | G8–G8b | Project package scope catches duplicate Domain; force writes and reports issue |
| `simply aep generate service` | G5, G9 | Offline service and valid API version fallback in class metadata |
| `simply aep generate unit-of-work` | G4 | fflib dry run explains manual registration |

The generate group emits one SKIP when its help probe fails. `--apx-parity`
adds an optional APX comparison: code must be byte-identical; CMDT differences
are recorded without failing. The round trip uses `SSO_Aep_Gen__c` and
`--prefix SSOGen` to avoid the fixture trigger and baseline binding names.
