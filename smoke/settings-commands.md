# Settings command coverage

Source: simply-plugins origin/main `b483669`, linked settings-core 0.3.1.
Every invocation, including expected failures, includes `--dry-run --json`.

| Case | Command | Proof |
| --- | --- | --- |
| 12 create plans fixture statuses | `simply settings address state create` | Exact keys/names/statuses and summary: US-CA exists, US-ZZ would-create, ZZ-ZZ country-missing, matched against retrieved metadata |
| 13 create filters country | `simply settings address state create` | Only both US fixtures, exact statuses and counts |
| 14 create pinned Debian subdivisions | `simply settings address state create` | Debian v4.20.1 source, nonempty unique FR subdivisions, each status checked against metadata; SKIP only with --offline |
| 15 activate plans fixture statuses | `simply settings address state activate` | Exact activated/alreadyActive/notInOrg membership from baseline active/visible flags; no deployId |
| 16 create rejects conflicting sources | `simply settings address state create` | Exit 2: file and ISO source mutually exclusive |
| 16 create rejects missing source | `simply settings address state create` | Exit 2: exactly one source required |
| 17 create rejects malformed JSON | `simply settings address state create` | JSON read/parse failure |
| 16 activate rejects conflicting sources | `simply settings address state activate` | Exit 2: file and ISO source mutually exclusive |
| 16 activate rejects missing source | `simply settings address state activate` | Exit 2: exactly one source required |
| 17 activate rejects malformed JSON | `simply settings address state activate` | JSON read/parse failure |
| 18 AddressSettings bytes unchanged | both | Baseline before selected cases and fresh mdapi retrieve after: Buffer.equals, no normalization or ignored content |

The two snapshots use distinct temporary directories with `--manifest`,
`--target-metadata-dir`, `--unzip`, and explicit target org. Retrieval errors fail
the suite. The runner recursively locates exactly one `Address.settings`, including
nested `unpackaged` directories. Temporary directories are removed after reading
their raw bytes.
With --only, case 18 must also be selected to get an after snapshot. Full suite
execution is the acceptance run. Baseline fixture requirements fail loudly if
an org already contains US-ZZ or ZZ, or lacks US-CA; they are never silently
adapted. Mutating the existing-state key makes case 12 fail offline.

Picklists need not be enabled when AddressSettings contains countries. Create's
dry-run branches before openSetupSession; activateStates returns before deploy.
Neither checks Account.BillingStateCode. No irreversible enablement, browser
session, or scratch-definition change is needed for this shared org.

Live status: two consecutive operator runs on `c353d9a` passed 11/0/0 on
2026-10-16, including the case 18 byte check, with picklists disabled; see
[docs/settings-suite.md](../docs/settings-suite.md#live-status).
