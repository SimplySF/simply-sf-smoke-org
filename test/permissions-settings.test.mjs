// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { addressCountries, buildSettingsTests, checkActivation, checkCreation, parseSettingsArgs, retrieveAddress } from '../scripts/run-settings-smoke.mjs';
import { assignFixtures, buildPermissionsTests, checkPermissionXml, parsePermissionsArgs, setupPermissions, root } from '../scripts/run-permissions-smoke.mjs';
import { assignPermset, runSuite } from '../scripts/lib/smoke.mjs';

const before = Buffer.from('<AddressSettings><countriesAndStates><countries><isoCode>US</isoCode><states><active>true</active><isoCode>CA</isoCode><visible>true</visible></states></countries><countries><isoCode>FR</isoCode></countries></countriesAndStates></AddressSettings>');
const definitions = { 'US-CA': 'California', 'US-ZZ': 'SSO Dry Run Only', 'ZZ-ZZ': 'SSO Missing Country' };
const creation = { states: Object.entries(definitions).map(([code, name], i) => ({ country: code.split('-')[0], code: code.split('-')[1], name,
  status: ['exists', 'would-create', 'country-missing'][i] })), summary: { created: 0, 'would-create': 1, exists: 1, 'country-missing': 1, rejected: 0, failed: 0 } };
const activated = { activated: [], alreadyActive: [creation.states[0]], notInOrg: creation.states.slice(1) };
const response = (result) => { const stdout = JSON.stringify({ status: 0, result }); return { exitCode: 0, stdout, output: stdout }; };
const context = { userId: '005Smoke', adminId: '005Admin', username: 'seed@example.com' };

test('suite flags reject unrelated arguments and settings offline skips only the download', async () => {
  for (const parse of [parseSettingsArgs, parsePermissionsArgs]) {
    const options = parse(['-o', 'scratch', '--only', '^1', '--skip-setup']);
    assert.equal(options.targetOrg, 'scratch'); assert.equal(options.skipSetup, true);
    for (const args of [['-o'], ['--apx-parity'], ['--redeploy-deps'], ['--unknown']]) assert.throws(() => parse(args));
  }
  const cases = await buildSettingsTests({ before, offline: true });
  assert.equal(cases.filter((t) => t.reason).length, 1);
  assert.match(cases.find((t) => t.reason).name, /^14/);
  assert.equal(parseSettingsArgs(['--offline']).offline, true);
});

test('settings statuses are checked by state identity, exact count and current org metadata', async () => {
  const countries = addressCountries(before);
  assert.equal(checkCreation(creation, definitions, countries), true);
  assert.equal(checkActivation(activated, definitions, countries), true);
  for (const changed of [ { ...creation, states: creation.states.slice(1) },
    { ...creation, states: creation.states.map((s) => ({ ...s, status: 'exists' })) },
    { ...creation, summary: { ...creation.summary, created: 1 } } ]) {
    assert.throws(() => checkCreation(changed, definitions, countries));
  }
  assert.throws(() => checkActivation({ ...activated, deployId: 'bad' }, definitions, countries));
  assert.throws(() => checkActivation({ ...activated, alreadyActive: [] }, definitions, countries));
  const inactive = addressCountries(Buffer.from(before.toString().replace('<active>true', '<active>false')));
  assert.equal(checkActivation({ ...activated, alreadyActive: [], activated: [creation.states[0]] }, definitions, inactive), true);
  const cases = await buildSettingsTests({ before });
  assert.equal(cases[0].check(response(creation)), true);
  const mutated = await buildSettingsTests({ before,
    definitions: { 'US-XX': definitions['US-CA'], 'US-ZZ': definitions['US-ZZ'], 'ZZ-ZZ': definitions['ZZ-ZZ'] } });
  assert.throws(() => mutated[0].check(response(creation)));
  const filtered = { states: creation.states.slice(0, 2), summary: { ...creation.summary, 'country-missing': 0 } };
  assert.equal(cases[1].check(response(filtered)), true);
  assert.throws(() => cases[1].check(response(creation)));
});

test('AddressSettings retrieval finds nested metadata and cleans isolated directories', async () => {
  const paths = [];
  for (const layout of ['unpackaged/settings', 'unpackaged/unpackaged/settings', 'other/nested/settings']) {
    const json = async (args) => {
      assert.ok(args.includes('--manifest')); assert.ok(args.includes('--unzip'));
      assert.ok(args.includes('scratch')); assert.ok(!args.includes('--source-dir'));
      const path = args[args.indexOf('--target-metadata-dir') + 1]; paths.push(path);
      await mkdir(resolve(path, layout), { recursive: true });
      await writeFile(resolve(path, layout, 'Address.settings'), before);
      return {};
    };
    assert.deepEqual(await retrieveAddress('scratch', { json }), before);
    await assert.rejects(readFile(resolve(paths.at(-1), layout, 'Address.settings')), /ENOENT/);
  }
  assert.equal(new Set(paths).size, paths.length);
});

test('AddressSettings retrieval rejects missing or ambiguous files and cleans up', async () => {
  for (const layouts of [[], ['one', 'two']]) {
    let directory;
    await assert.rejects(retrieveAddress('scratch', { json: async (args) => {
      directory = args[args.indexOf('--target-metadata-dir') + 1];
      for (const layout of layouts) {
        await mkdir(resolve(directory, layout));
        await writeFile(resolve(directory, layout, 'Address.settings'), before);
      }
    } }), /Expected exactly one retrieved Address.settings/);
    await assert.rejects(readFile(resolve(directory, 'one/Address.settings')), /ENOENT/);
  }
});

test('case 18 rejects even whitespace and line-ending changes through the report contract', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'sso-proof-'));
  try {
    for (const [after, pass] of [[Buffer.from(before), true], [Buffer.concat([before, Buffer.from('\n')]), false]]) {
      const cases = await buildSettingsTests({ before, retrieve: async () => after });
      const report = await runSuite({ cwd, suiteName: 'proof', setExitCode: false, log: () => {}, tests: [cases.at(-1)] });
      assert.equal(report.counts.pass, Number(pass));
      assert.equal(report.counts.fail, Number(!pass));
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('permission assignment uses the shared duplicate-safe helper on behalf of seeded user', async () => {
  let args;
  await assignPermset('scratch', 'SSO_Perm_PS_A', { onBehalfOf: context.username, json: async (value) => {
    args = value;
    throw Object.assign(new Error('duplicate'), { envelope: { result: { failures: [{ message: 'Already assigned' }] } } });
  } });
  assert.deepEqual(args.slice(-2), ['--on-behalf-of', context.username]);
});

test('PSG assignment waits for Updated, reuses assignments and fails at deadline', async () => {
  let polls = 0, creates = 0, sleeps = 0, assigned = 0;
  const dependencies = { assign: async () => { assigned++; }, sleep: async () => { sleeps++; },
    json: async () => { creates++; }, query: async (org, query) => query.includes('FROM PermissionSetGroup')
      ? [{ Id: '0PG', Status: ++polls === 1 ? 'Updating' : 'Updated' }] : [{ Id: 'existing' }] };
  await assignFixtures('scratch', context, dependencies);
  assert.equal(polls, 2); assert.equal(sleeps, 1); assert.equal(creates, 0); assert.equal(assigned, 1);
  await assignFixtures('scratch', context, { ...dependencies, query: async (org, q) =>
    q.includes('FROM PermissionSetGroup') ? [{ Id: '0PG', Status: 'Updated' }] : [] });
  assert.equal(creates, 1);
  await assert.rejects(assignFixtures('scratch', context, { ...dependencies, attempts: 2,
    query: async () => [{ Id: '0PG', Status: 'Updating' }] }), /Timed out/);
});

test('failed fixture deployment stops before user seeding', async () => {
  let calls = 0;
  await assert.rejects(setupPermissions('scratch', { json: async () => { calls++; return { success: false }; } }));
  assert.equal(calls, 1);
  const seed = await readFile(resolve(root, 'fixtures/permissions/seedSmokeUsers.apex'), 'utf8');
  assert.match(seed, /if \(existing.isEmpty\(\)\)/); assert.match(seed, /Standard User/);
});

test('destructive cases refuse foreign assignments before invoking plugin and check admin afterwards', async () => {
  let invoked = 0, deleted = false, corruptAdmin = false;
  const runner = async () => { invoked++; deleted = true; return response({ deleted: ['assignment'], failures: [] }); };
  let foreign = true;
  const query = async (org, q) => {
    if (q.includes("AssigneeId = '005Admin'")) return corruptAdmin && deleted ? [] : [{ Id: 'admin-assignment' }];
    if (deleted && !q.includes(' OR ')) return [];
    return [{ Id: 'assignment', AssigneeId: foreign ? context.adminId : context.userId },
      ...(q.includes(' OR ') ? [{ Id: 'group-assignment', AssigneeId: context.userId }] : [])];
  };
  const cases = buildPermissionsTests({ context, runner, query, reassign: async () => {} });
  const test = cases.find((t) => t.name.startsWith('08'));
  await assert.rejects(test.execute(), /Refusing deletion/); assert.equal(invoked, 0);
  foreign = false;
  const execution = await test.execute();
  assert.equal(await test.check(execution), true);
  await assert.rejects(test.check(response({ deleted: [], failures: [] })));
  deleted = false; corruptAdmin = true;
  await assert.rejects(test.execute(), /Admin assignments changed/);
});

test('read-only and view-all XML require viewAllFields without field entries or write grants', () => {
  const xml = '<PermissionSet><objectPermissions><object>SSO_Perm_Obj__c</object><allowRead>true</allowRead><allowCreate>false</allowCreate><allowEdit>false</allowEdit><allowDelete>false</allowDelete><modifyAllRecords>false</modifyAllRecords><viewAllFields>true</viewAllFields></objectPermissions></PermissionSet>';
  assert.equal(checkPermissionXml(xml), true);
  for (const tag of ['allowCreate', 'allowEdit', 'allowDelete', 'modifyAllRecords']) {
    assert.throws(() => checkPermissionXml(xml.replace(`<${tag}>false`, `<${tag}>true`)));
  }
  for (const tag of ['allowRead', 'viewAllFields']) {
    assert.throws(() => checkPermissionXml(xml.replace(`<${tag}>true`, `<${tag}>false`)));
  }
  assert.throws(() => checkPermissionXml(xml.replace('<viewAllFields>true</viewAllFields>', '')));
  assert.throws(() => checkPermissionXml(xml.replace('</PermissionSet>', '<fieldPermissions><field>SSO_Perm_Obj__c.First__c</field></fieldPermissions></PermissionSet>')));
});

test('modify-all XML still requires readable fields and applies the edit override', () => {
  const xml = `<PermissionSet><objectPermissions><object>SSO_Perm_Obj__c</object><allowRead>true</allowRead><allowCreate>true</allowCreate><allowEdit>true</allowEdit><allowDelete>true</allowDelete><modifyAllRecords>true</modifyAllRecords></objectPermissions>${['First', 'Second'].map((f) => `<fieldPermissions><field>SSO_Perm_Obj__c.${f}__c</field><readable>true</readable><editable>${f === 'First'}</editable></fieldPermissions>`).join('')}</PermissionSet>`;
  const options = { modify: true, override: true };
  assert.equal(checkPermissionXml(xml, options), true);
  assert.throws(() => checkPermissionXml(xml.replace('First__c', 'Other__c'), options));
  assert.throws(() => checkPermissionXml(xml.replace('<readable>true', '<readable>false'), options));
  assert.throws(() => checkPermissionXml(xml.replace('<editable>false', '<editable>true'), options));
});

test('round trip assigns the seeded user and fails if deployed object access is wrong', async () => {
  const calls = [];
  let readable = true;
  const path = resolve(root, 'generated/permissions/permissionsets/SSO_Perm_Built_RO.permissionset-meta.xml');
  const xml = '<PermissionSet><objectPermissions><object>SSO_Perm_Obj__c</object><allowRead>true</allowRead><allowCreate>false</allowCreate><allowEdit>false</allowEdit><allowDelete>false</allowDelete><modifyAllRecords>false</modifyAllRecords><viewAllFields>true</viewAllFields></objectPermissions></PermissionSet>';
  let output = xml;
  await mkdir(resolve(path, '..'), { recursive: true });
  const cases = buildPermissionsTests({ context, targetOrg: 'scratch', runner: async () => {
    await assert.rejects(readFile(path), { code: 'ENOENT' });
    if (output !== null) await writeFile(path, output);
    return response({});
  },
    json: async (args) => { calls.push(args); return { success: true, status: 'Succeeded' }; },
    assign: async (...args) => { calls.push(args); }, query: async (org, q) => {
      assert.equal(org, 'scratch'); calls.push(q);
      if (q.includes('ObjectPermissions')) return [{ PermissionsRead: readable, PermissionsEdit: false, PermissionsCreate: false, PermissionsDelete: false }];
      return [{ Id: q.includes('FROM PermissionSet WHERE') ? '0PS' : '0PA' }];
    } });
  const roundTrip = cases.find((t) => t.name.startsWith('04'));
  try {
    await writeFile(path, xml);
    output = null;
    await assert.rejects(roundTrip.execute(), { code: 'ENOENT' });
    assert.equal(calls.length, 0, 'A successful build without output must not deploy stale XML');
    output = xml.replace('<allowEdit>false', '<allowEdit>true');
    await assert.rejects(roundTrip.execute(), /allowEdit/);
    assert.equal(calls.length, 0, 'Invalid fresh XML must not be deployed');
    output = xml;
    assert.equal((await roundTrip.execute()).exitCode, 0);
    const assignment = calls.find((call) => Array.isArray(call) && call[1] === 'SSO_Perm_Built_RO');
    assert.equal(assignment[2].onBehalfOf, context.username);
    assert.ok(calls.some((q) => typeof q === 'string' && q.includes("AssigneeId = '005Smoke' AND PermissionSetId = '0PS'")));
    assert.ok(calls.some((q) => typeof q === 'string' && q.includes("ParentId = '0PS' AND SobjectType = 'SSO_Perm_Obj__c'")));
    readable = false;
    await assert.rejects(roundTrip.execute());
  } finally { await rm(path, { force: true }); }
});

test('parser expected failures require the observed JSON exit code and the specific source or enum diagnostic', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'sso-parser-'));
  try {
    const cases = [...buildPermissionsTests({ context }), ...await buildSettingsTests({ before })]
      .filter((t) => /^(05|16) /.test(t.name));
    assert.equal(cases.length, 5);
    for (const t of cases) {
      const output = t.name.startsWith('05') ? 'Expected --type=nonsense to be one of: read-only, view-all, modify-all' :
        t.name.includes('conflicting') ? '--iso-codes cannot also be provided when using --file' :
          'Exactly one of the following must be provided: --file, --iso-codes';
      const code = t.name.startsWith('05') ? 1 : 2;
      const wrong = code === 1 ? 2 : 1;
      for (const [exitCode, message, pass] of [[code, output, true], [wrong, output, false], [code, 'expired org auth', false]]) {
        const report = await runSuite({ cwd, suiteName: 'parser', setExitCode: false, log: () => {},
          tests: [{ ...t, execute: async () => ({ exitCode, output: JSON.stringify({ status: exitCode, exitCode, message }) }) }] });
        assert.equal(report.counts.pass, Number(pass), t.name);
      }
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('coverage pins every case, success and expected failure for each command, and settings dry-run', async () => {
  for (const [suite, cases] of [['permissions', buildPermissionsTests({ context })], ['settings', await buildSettingsTests({ before })]]) {
    const doc = await readFile(resolve(root, `smoke/${suite}-commands.md`), 'utf8');
    assert.equal(cases.length, suite === 'permissions' ? 13 : 11);
    for (const t of cases) {
      assert.ok(doc.includes(t.name), `Coverage missing ${t.name}`);
      if (t.cmd) {
        assert.ok(t.cmd[1].includes('--json'));
        if (suite === 'settings') assert.ok(t.cmd[1].includes('--dry-run'));
      }
    }
    for (const command of suite === 'permissions' ? ['build', 'analyze', 'assignment'] : ['create', 'activate']) {
      const matches = cases.filter((t) => t.cmd?.[1].includes(command));
      assert.ok(matches.some((t) => t.expectedExitCode === 0));
      assert.ok(matches.some((t) => t.expectedExitCode > 0));
    }
  }
});
