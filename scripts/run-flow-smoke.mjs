// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, sfJson, resultFrom, runSuite, success, expectedFailure } from './lib/smoke.mjs';
import { root, parseSuiteArgs, command, linkedPlugin, queryOrg, deploySource } from './lib/apex-flow.mjs';

export const flowNames = ['SSO_Flow_Prune', 'SSO_Flow_Delete'];
export async function flowVersions(targetOrg, name, { query = queryOrg } = {}) {
  assert.ok(flowNames.includes(name), 'Only smoke fixture flows may be queried/deleted');
  return query(targetOrg, `SELECT Id, VersionNumber, Status FROM Flow WHERE Definition.DeveloperName = '${name}' ORDER BY VersionNumber`);
}
export function checkThreeVersions(versions) {
  assert.deepEqual(versions.map((v) => Number(v.VersionNumber)), [1, 2, 3]);
  assert.deepEqual(versions.map((v) => v.Status), ['Obsolete', 'Obsolete', 'Active']);
  assert.equal(new Set(versions.map((v) => v.Id)).size, 3);
  return true;
}
export async function rebuildFlow(targetOrg, name, { json = sfJson, query = queryOrg, deploy = deploySource } = {}) {
  assert.ok(flowNames.includes(name), 'Refusing non-fixture flow deletion');
  console.log(`Rebuilding ${name}: setup deletes existing versions with simply flow delete`);
  const result = await json(command('flow', 'delete', targetOrg, ['--flow-name', name])[1].slice(0, -1));
  assert.deepEqual(result.failures, []);
  assert.deepEqual(await flowVersions(targetOrg, name, { query }), []);
  const workspace = resolve(root, 'generated/flow', name);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  for (const version of [1, 2, 3]) {
    await cp(resolve(root, `fixtures/flow/${name}/v${version}/${name}.flow-meta.xml`), resolve(workspace, `${name}.flow-meta.xml`));
    await deploy(targetOrg, workspace, { json });
  }
  const versions = await flowVersions(targetOrg, name, { query });
  checkThreeVersions(versions);
  return versions;
}
export function checkPrune(result, before, after, dryRun) {
  assert.equal(result.dryRun, dryRun);
  assert.deepEqual(result.failures, []);
  const obsolete = before.filter((v) => v.Status === 'Obsolete');
  assert.equal(obsolete.length, 2);
  assert.deepEqual(result.candidates.map((v) => v.id).sort(), obsolete.map((v) => v.Id).sort());
  assert.ok(result.candidates.every((v) => v.developerName === 'SSO_Flow_Prune'));
  assert.deepEqual(result.deleted, dryRun ? [] : ['SSO_Flow_Prune', 'SSO_Flow_Prune']);
  assert.deepEqual(after, dryRun ? before : before.filter((v) => v.Status === 'Active'));
  return true;
}
export function checkDelete(result, after) {
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.deactivated, ['SSO_Flow_Delete']);
  assert.deepEqual(result.deleted, Array(3).fill('SSO_Flow_Delete'));
  assert.deepEqual(after, []);
  return true;
}
export function buildFlowTests({ targetOrg = 'simply-smoke-org', runner = run, query = queryOrg, rebuild = rebuildFlow } = {}) {
  const cmd = (verb, flags) => command('flow', verb, targetOrg, flags);
  const tests = [];
  for (const [name, flags, dryRun] of [
    ['18 version prune dry-run preserves history', ['--flow-name', 'SSO_Flow_Prune', '--dry-run'], true],
    ['19 version prune removes obsolete versions', ['--flow-name', 'SSO_Flow_Prune'], false],
    ['20 version prune scans source directory', ['--source-dir', resolve(root, 'generated/flow/prune-source')], false],
  ]) {
    let before;
    const test = success(name, async (e) => checkPrune(resultFrom(e.stdout), before,
      await flowVersions(targetOrg, 'SSO_Flow_Prune', { query }), dryRun), cmd('version prune', flags));
    test.execute = async () => {
      before = await rebuild(targetOrg, 'SSO_Flow_Prune');
      if (name.startsWith('20')) {
        const source = resolve(root, 'generated/flow/prune-source');
        await rm(source, { recursive: true, force: true });
        await mkdir(source, { recursive: true });
        await cp(resolve(root, 'sfdx-source/apex-flow/main/flows/SSO_Flow_Prune.flow-meta.xml'), resolve(source, 'SSO_Flow_Prune.flow-meta.xml'));
      }
      return runner(...test.cmd, { cwd: root, timeoutMs: 30 * 60_000 });
    };
    tests.push(test);
  }
  tests.push(expectedFailure('21 version prune rejects conflicting sources', /must specify either --source-dir or --flow-name, but not both/i,
    cmd('version prune', ['--flow-name', 'SSO_Flow_Prune', '--source-dir', resolve(root, 'sfdx-source/apex-flow')])));
  for (const [name, flags] of [
    ['22 delete active flow by name', ['--flow-name', 'SSO_Flow_Delete']],
    ['23 delete active flow by manifest', ['--manifest', resolve(root, 'fixtures/flow/destructiveChanges.xml')]],
  ]) {
    const test = success(name, async (e) => checkDelete(resultFrom(e.stdout), await flowVersions(targetOrg, 'SSO_Flow_Delete', { query })), cmd('delete', flags));
    test.execute = async () => { await rebuild(targetOrg, 'SSO_Flow_Delete'); return runner(...test.cmd, { cwd: root, timeoutMs: 30 * 60_000 }); };
    tests.push(test);
  }
  const mixed = expectedFailure('24 delete collects missing-flow failure and deletes real flow', /SSO_Does_Not_Exist/,
    cmd('delete', ['--flow-name', 'SSO_Flow_Delete', '--flow-name', 'SSO_Does_Not_Exist']), async (e) => {
      const result = resultFrom(e.stdout);
      assert.deepEqual(result.deleted, Array(3).fill('SSO_Flow_Delete'));
      assert.deepEqual(result.deactivated, ['SSO_Flow_Delete']);
      assert.ok(result.failures.some((f) => f.developerName === 'SSO_Does_Not_Exist' && f.message));
      assert.deepEqual(await flowVersions(targetOrg, 'SSO_Flow_Delete', { query }), []);
      return true;
    });
  mixed.execute = async () => { await rebuild(targetOrg, 'SSO_Flow_Delete'); return runner(...mixed.cmd, { cwd: root, timeoutMs: 30 * 60_000 }); };
  tests.push(mixed, expectedFailure('25 delete rejects missing source', /must specify either --manifest or --flow-name, but not both/i, cmd('delete', [])));
  return tests;
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseSuiteArgs(argv);
  let plugin;
  return runSuite({ suiteName: 'flow', cwd: root, ...options, plugin: () => plugin,
    preflight: async () => { plugin = await linkedPlugin('flow'); },
    setup: async () => { for (const name of flowNames) await rebuildFlow(options.targetOrg, name); },
    tests: buildFlowTests(options),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
