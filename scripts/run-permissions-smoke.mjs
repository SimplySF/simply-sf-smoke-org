// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertLinkedPlugin, assignPermset, envelopeFrom, expectedFailure, parseArgs, run, runSuite, sf, sfJson, soql, success } from './lib/smoke.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'generated/permissions');
const sets = resolve(output, 'permissionsets');
const source = resolve(root, 'sfdx-source/permissions');
const fixture = (name) => resolve(root, 'fixtures/permissions', name);
const built = (name) => resolve(sets, `${name}.permissionset-meta.xml`);
const targets = "(PermissionSet.Name = 'SSO_Perm_PS_A' OR PermissionSetGroup.DeveloperName = 'SSO_Perm_PSG')";
const ids = (records) => records.map((r) => r.Id).sort();
const quote = (value) => String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");

export function parsePermissionsArgs(argv) {
  if (argv.some((arg) => ['--apx-parity', '--redeploy-deps'].includes(arg))) throw new Error('Unsupported permissions argument');
  return parseArgs(argv);
}

export async function permissionContext(targetOrg, { json = sfJson, query = soql } = {}) {
  const org = await json(['org', 'display', '--target-org', targetOrg]);
  assert.match(org.id, /^[a-zA-Z0-9]{15,18}$/);
  const username = `sso.perm.${org.id.toLowerCase()}@example.com`;
  const users = await query(targetOrg, `SELECT Id, Username, IsActive FROM User WHERE Username = '${quote(username)}'`);
  const admins = await query(targetOrg, `SELECT Id FROM User WHERE Username = '${quote(org.username)}'`);
  assert.equal(users.length, 1, 'Run setup to seed the standard smoke user');
  assert.equal(admins.length, 1);
  assert.equal(users[0].IsActive, true);
  assert.notEqual(users[0].Id, admins[0].Id, 'Smoke user must differ from CLI admin');
  return { userId: users[0].Id, username, adminId: admins[0].Id };
}

export async function assignFixtures(targetOrg, context, { json = sfJson, query = soql,
  assign = assignPermset, sleep = pause, attempts = 60 } = {}) {
  await assign(targetOrg, 'SSO_Perm_PS_A', { json, onBehalfOf: context.username });
  let group;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const groups = await query(targetOrg, "SELECT Id, Status FROM PermissionSetGroup WHERE DeveloperName = 'SSO_Perm_PSG'");
    assert.equal(groups.length, 1, 'Fixture PSG missing');
    group = groups[0];
    if (group.Status === 'Updated') break;
    if (attempt === attempts - 1) throw new Error('Timed out waiting for SSO_Perm_PSG Status=Updated');
    await sleep(2000);
  }
  assert.equal(group?.Status, 'Updated');
  const existing = await query(targetOrg, `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${context.userId}' AND PermissionSetGroupId = '${group.Id}'`);
  if (!existing.length) {
    await json(['data', 'create', 'record', '--target-org', targetOrg, '--sobject', 'PermissionSetAssignment',
      '--values', `AssigneeId=${context.userId} PermissionSetGroupId=${group.Id}`]);
  }
}

export async function setupPermissions(targetOrg, dependencies = {}) {
  const json = dependencies.json ?? sfJson;
  const deploy = await json(['project', 'deploy', 'start', '--target-org', targetOrg,
    '--source-dir', source, '--ignore-conflicts', '--wait', '10']);
  assert.equal(deploy.success, true);
  assert.equal(deploy.status, 'Succeeded');
  const seeded = await json(['apex', 'run', '--target-org', targetOrg, '--file', fixture('seedSmokeUsers.apex')]);
  assert.equal(seeded.compiled, true);
  assert.equal(seeded.success, true);
  const context = await permissionContext(targetOrg, dependencies);
  await assignFixtures(targetOrg, context, dependencies);
  return context;
}

export function checkPermissionXml(xml, { modify = false, recordTypes = false, override = false } = {}) {
  const entries = (tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
  const has = (entry, tag, value) => assert.match(entry, new RegExp(`<${tag}>${value}</${tag}>`));
  const object = entries('objectPermissions').find((entry) => entry.includes('<object>SSO_Perm_Obj__c</object>'));
  assert.ok(object, 'Missing object permissions');
  has(object, 'allowRead', true);
  for (const tag of ['allowCreate', 'allowEdit', 'allowDelete', 'modifyAllRecords']) has(object, tag, modify);
  if (!modify) {
    has(object, 'viewAllFields', true);
    assert.equal(entries('fieldPermissions').length, 0, 'viewAllFields must replace field permissions');
  }
  for (const field of modify ? ['First', 'Second'] : []) {
    const entry = entries('fieldPermissions').find((e) => e.includes(`<field>SSO_Perm_Obj__c.${field}__c</field>`));
    assert.ok(entry, `Missing ${field} field permission`);
    has(entry, 'readable', true);
    has(entry, 'editable', modify && !(override && field === 'Second'));
  }
  if (recordTypes) {
    const entry = entries('recordTypeVisibilities').find((e) => e.includes('<recordType>SSO_Perm_Obj__c.Smoke</recordType>'));
    assert.ok(entry, 'Missing record type visibility');
    has(entry, 'visible', true);
  }
  return true;
}

export function buildPermissionsTests({ targetOrg = 'simply-smoke-org', context,
  runner = run, json = sfJson, query = soql, assign = assignPermset, reassign = assignFixtures } = {}) {
  const command = (words, flags = [], org = true) => [sf, ['simply', 'permissions', ...words,
    ...(org ? ['--target-org', targetOrg] : []), '--json', ...flags]];
  const buildCommand = (name, type, flags = []) => command(['build'], ['--directory', source,
    '--name', name, '--type', type, '--output', sets, ...flags], false);
  const result = (execution) => {
    const envelope = envelopeFrom(execution.stdout ?? execution.output);
    assert.equal(envelope.status, 0);
    return envelope.result;
  };
  const invoke = (cmd) => runner(...cmd, { cwd: root, timeoutMs: 20 * 60_000 });
  const buildCase = (number, name, type, flags, options) => {
    const test = success(`${number} build ${type}`, async (execution) => {
      result(execution);
      return checkPermissionXml(await readFile(built(name), 'utf8'), options);
    }, buildCommand(name, type, flags));
    test.execute = async () => { await rm(built(name), { force: true }); return invoke(test.cmd); };
    return test;
  };
  const tests = [
    buildCase('01', 'SSO_Perm_Built_RO', 'read-only', [], {}),
    buildCase('02', 'SSO_Perm_Built_MA', 'modify-all', ['--include-record-types', '--config', fixture('overrides.json')],
      { modify: true, recordTypes: true, override: true }),
    success('03 build file writes two sets', async (execution) => {
      const results = result(execution);
      assert.equal(results.length, 2);
      for (const [name, modify] of [['SSO_Perm_Built_File_RO', false], ['SSO_Perm_Built_File_MA', true]]) {
        assert.ok(results.some((r) => r.name === name));
        checkPermissionXml(await readFile(built(name), 'utf8'), { modify });
      }
      return true;
    }, command(['build'], ['--file', fixture('build-all.json')], false)),
    { name: '04 build deploy assign and query object access', expectedExitCode: 0, check: () => true,
      execute: async () => {
        const execution = await invoke(buildCommand('SSO_Perm_Built_RO', 'read-only'));
        assert.equal(execution.exitCode, 0); result(execution);
        const deployed = await json(['project', 'deploy', 'start', '--target-org', targetOrg,
          '--source-dir', built('SSO_Perm_Built_RO'), '--ignore-conflicts', '--wait', '10']);
        assert.equal(deployed.success, true); assert.equal(deployed.status, 'Succeeded');
        await assign(targetOrg, 'SSO_Perm_Built_RO', { json, onBehalfOf: context.username });
        const ps = await query(targetOrg, "SELECT Id FROM PermissionSet WHERE Name = 'SSO_Perm_Built_RO'");
        assert.equal(ps.length, 1);
        const assigned = await query(targetOrg, `SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = '${context.userId}' AND PermissionSetId = '${ps[0].Id}'`);
        assert.equal(assigned.length, 1);
        const access = await query(targetOrg, `SELECT PermissionsRead, PermissionsEdit, PermissionsCreate, PermissionsDelete FROM ObjectPermissions WHERE ParentId = '${ps[0].Id}' AND SobjectType = 'SSO_Perm_Obj__c'`);
        assert.equal(access.length, 1);
        assert.equal(access[0].PermissionsRead, true);
        for (const permission of ['PermissionsEdit', 'PermissionsCreate', 'PermissionsDelete']) assert.equal(access[0][permission], false);
        return { exitCode: 0, output: 'Deployed, assigned and verified ObjectPermissions' };
      } },
    expectedFailure('05 build rejects invalid type', /Expected --type=nonsense to be one of: read-only, view-all, modify-all/i,
      buildCommand('SSO_Perm_Invalid', 'nonsense')),
  ];
  const fileCase = tests[2];
  fileCase.execute = async () => {
    for (const name of ['SSO_Perm_Built_File_RO', 'SSO_Perm_Built_File_MA']) await rm(built(name), { force: true });
    return invoke(fileCase.cmd);
  };
  for (const [number, filtered] of [['06', true], ['07', false]]) {
    const report = resolve(output, filtered ? 'filtered.html' : 'all.html');
    const test = success(`${number} analyze ${filtered ? 'filtered' : 'all'}`, async (execution) => {
      const summary = result(execution);
      assert.ok(summary.permissionSetCount >= 1 && summary.permissionSetGroupCount >= 1);
      if (filtered) { assert.equal(summary.permissionSetCount, 1); assert.equal(summary.permissionSetGroupCount, 1); }
      const html = await readFile(report, 'utf8');
      for (const name of ['SSO_Perm_PS_A', 'SSO_Perm_PSG', 'SSO_Perm_Obj__c']) assert.ok(html.includes(name), `Report missing ${name}`);
      if (!filtered) {
        const namespaces = new Set();
        for (const table of ['PermissionSet', 'PermissionSetGroup']) {
          const managed = await query(targetOrg, `SELECT NamespacePrefix FROM ${table} WHERE NamespacePrefix != null`);
          for (const entry of managed) namespaces.add(entry.NamespacePrefix);
        }
        if (namespaces.size) {
          const installed = await json(['package', 'installed', 'list', '--target-org', targetOrg]);
          assert.ok(Array.isArray(installed), 'Expected installed package list');
          for (const namespace of namespaces) {
            const names = installed.filter((pkg) => pkg.SubscriberPackageNamespace === namespace).map((pkg) => pkg.SubscriberPackageName);
            assert.ok([namespace, ...names].some((name) => name && html.includes(name)), `Missing package grouping ${namespace}`);
          }
        }
      }
      return true;
    }, command(['analyze'], ['--output', report, ...(filtered ? ['--filter', 'SSO_Perm_PS_A', '--filter', 'SSO_Perm_PSG'] : [])]));
    test.execute = async () => { await rm(report, { force: true }); return invoke(test.cmd); };
    tests.push(test);
  }
  tests.push(expectedFailure('07b analyze rejects unwritable output', /ENOENT|no such file|not a directory/i,
    command(['analyze'], ['--filter', 'SSO_Perm_PS_A', '--output', resolve(output, 'absent/report.html')])));
  const assignments = (condition) => query(targetOrg, `SELECT Id, AssigneeId FROM PermissionSetAssignment WHERE ${condition}`);
  for (const [number, flags, condition] of [
    ['08', ['--permission-set-name', 'SSO_Perm_PS_A'], "PermissionSet.Name = 'SSO_Perm_PS_A'"],
    ['09', ['--permission-set-group-name', 'SSO_Perm_PSG'], "PermissionSetGroup.DeveloperName = 'SSO_Perm_PSG'"],
    ['10', ['--file', fixture('destructiveChanges.xml')], targets],
  ]) {
    const test = success(`${number} assignment delete ${number === '08' ? 'permission set' : number === '09' ? 'group' : 'manifest'}`, async (execution) => {
      const deleted = result(execution);
      assert.deepEqual(deleted.failures, []);
      assert.deepEqual([...deleted.deleted].sort(), test.beforeIds);
      assert.equal((await assignments(condition)).length, 0);
      return true;
    }, command(['assignment', 'delete'], flags));
    test.execute = async () => {
      await reassign(targetOrg, context, { json, query, assign });
      const all = await assignments(targets);
      assert.ok(all.length >= 2, 'Expected both fixture assignments before deletion');
      assert.ok(all.every((r) => r.AssigneeId === context.userId), 'Refusing deletion: fixture assigned to another user');
      test.beforeIds = ids(await assignments(condition));
      assert.ok(test.beforeIds.length > 0, 'Deletion must have a real effect');
      const admin = ids(await assignments(`AssigneeId = '${context.adminId}'`));
      assert.ok(admin.length > 0, 'Admin assignment snapshot must not be empty');
      try { return await invoke(test.cmd); }
      finally { assert.deepEqual(ids(await assignments(`AssigneeId = '${context.adminId}'`)), admin, 'Admin assignments changed'); }
    };
    tests.push(test);
  }
  tests.push(success('11 assignment delete missing name is no-op', (execution) => {
    assert.deepEqual(result(execution), { deleted: [], failures: [] }); return true;
  }, command(['assignment', 'delete'], ['--permission-set-name', 'SSO_Perm_Does_Not_Exist'])));
  tests.push(expectedFailure('11b assignment delete rejects conflicting inputs', /either.*--file.*not both/is,
    command(['assignment', 'delete'], ['--file', fixture('destructiveChanges.xml'), '--permission-set-name', 'SSO_Perm_PS_A'])));
  for (const test of tests) test.execute ??= () => invoke(test.cmd);
  return tests;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parsePermissionsArgs(argv);
  let plugin, context;
  return runSuite({ suiteName: 'permissions', cwd: root, ...options, plugin: () => plugin,
    preflight: async () => {
      plugin = await assertLinkedPlugin('@simplysf/simply-permissions',
        resolve(process.env.SIMPLY_PLUGINS_DIR ?? resolve(root, '../simply-plugins'), 'packages/simply-permissions'));
      await mkdir(sets, { recursive: true });
      await rm(resolve(output, 'absent'), { recursive: true, force: true });
      if (options.skipSetup) context = await permissionContext(options.targetOrg);
    },
    setup: async () => { context = await setupPermissions(options.targetOrg); },
    tests: () => buildPermissionsTests({ ...options, context }),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
