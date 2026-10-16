# Extending and moving

How to add cases, add another plugin suite, and move the repository.

## Adding a case

1. Add the case in `buildAt4dxTests` or `buildGenerateTests` in
   `scripts/run-aep-smoke.mjs`. Use the `success`, `expectedFailure`, and `skip`
   constructors from `scripts/lib/smoke.mjs`.
2. Update the matching row in [smoke/aep-commands.md](../smoke/aep-commands.md).
   `test/aep.test.mjs` fails if a documented command has no runnable successful
   org case.
3. Run `npm test`. See [reports-and-gate.md](reports-and-gate.md#offline-gate).

## Changing reset scope

Reset selects metadata by the `metadataTypes` list and the `isRunMetadata` and
`isGeneratedApex` rules in `scripts/lib/metadata.mjs`. Any new CMDT type or
name prefix must be added there and covered by the reset-boundary tests in
`test/aep.test.mjs`. Baseline names must stay outside the selection. See
[org-setup.md](org-setup.md#reset-scope).

## Changing dependency pins

Edit `config/dependencies.json`. Each `ref` must be a full 40-character SHA.
Update the table in [dependencies.md](dependencies.md) to match, and re-verify
the source paths and sentinel classes. Setup detects a changed config and
redeploys automatically.

## Adding another plugin suite

Use `scripts/lib/smoke.mjs` for process execution, JSON parsing, test
constructors, plugin provenance, and reporting. `runSuite` writes the report
and sets the exit code. Keep fixture setup and ordered case definitions in
separate files, as the AEP suite does.

## Moving the repository

All paths are relative to the checkout or derived from it. The repository is
private at first. Transfer to SimplySF, and any release, require separate
maintainer work.
