# Local command smoke coverage

Run `npm run smoke:local -- --offline` after building and linking all three
plugins. Omit `--offline` to deploy to the disposable shared smoke org (default
`simply-smoke-org`; override with `--target-org`). Reports use `reports/local-*.json`.

| Command | Success cases | Expected failures | Proof |
| --- | --- | --- | --- |
| `simply project update api-version` | 01, 02 | 03, 04 | All metadata tags and project version; non-meta bytes preserved; zero updates on rerun; parser errors exit 2 |
| `simply document generate` | 05–08 | 08b | Known object/class, custom marker, explicit HTML, empty document component count |
| `simply document diff` | 09 | 10, 11 | Modified class, added flow, deleted field path in individual HTML rows; real tagged git fixture |
| `simply schema generate` | 12, 13 (org only), 14, 15 | 15b | CSV object, fields, record type; org deploy and describe of the CSV fields (13); XLSX object/field without record types; unknown Type rows ignored (15); malformed CSV error (15b) |
| `simply schema visualize` | 16, 17 | 18, 18b | HTML and Mermaid source output; org CSV lookup; missing or mixed source rejection |

Cases 13 (deploy and describe fields) and 17 (Tooling API visualization) are
SKIP under `--offline`. Case 18b also runs only with an org because org flag
parsing requires authentication; case 18 proves expected failure offline.
No org setup or AEP dependency deployment is needed. Schema objects are redeployed
over the same names on reruns. Use only a disposable smoke org.

Every run recreates `generated/local/`, including copied CSV/XLSX/template inputs
and a two-commit git repository. Case 19 compares committed fixture bytes.
The non-repo diff uses a Git ceiling to prevent discovering this parent checkout.

Confirmed command contracts: HTML is the only allowed document format; an empty
metadata directory generates a zero-component document; API-version reruns return
`updatedFiles: []` and `projectFileUpdated: false`. Unknown CSV Types are ignored
(case 15); case 15b supplies the required schema-generate failure. Diff returns
HTML rather than grouped JSON, so case 09 checks rows in the written HTML. Its current renderer groups deleted
field paths under `customObjects` (the parent object), classes under
`apexClasses`, and flows under `flows`; the suite asserts those actual keys.

Rebuild the committed workbook manually with
`SIMPLY_PLUGINS_DIR=/absolute/path/to/simply-plugins node fixtures/local/build-xlsx.mjs`.
It reuses the schema plugin's exceljs; the smoke harness adds no npm dependency.
Live acceptance must be recorded from operator runs, not inferred from offline tests.
