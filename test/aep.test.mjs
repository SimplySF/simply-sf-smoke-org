/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildAt4dxTests, buildGenerateTests, root } from '../scripts/run-aep-smoke.mjs';
import { isRunMetadata, isGeneratedApex, manifest } from '../scripts/lib/metadata.mjs';
import { compareTrees, filesUnder } from '../scripts/lib/files.mjs';
import { checkFixturePermissions } from '../scripts/lib/fixture-permissions.mjs';

const commandId = (test) => test.cmd?.[1].slice(0, 5).join(' ');
test('coverage outline and runnable successful org cases cover all 17 at4dx commands', async () => {
  const outline = await readFile(resolve(root, 'smoke/aep-commands.md'), 'utf8');
  const documented = [...outline.matchAll(/`(simply aep at4dx [a-z-]+ [a-z]+)`/g)].map((m) => m[1]);
  assert.equal(new Set(documented).size, 17);
  const tests = buildAt4dxTests('test-org');
  for (const id of documented) {
    assert.ok(tests.some((t) => commandId(t) === id), `No executable case: ${id}`);
    assert.ok(tests.some((t) => commandId(t) === id && t.expectedExitCode === 0 && t.cmd[1].includes('--target-org')), `No success against org: ${id}`);
  }
  for (const t of tests.filter((t) => t.cmd[0] !== 'bash')) assert.ok(t.cmd[1].includes('--json'), t.name);
  const generated = buildGenerateTests('test-org');
  for (const subcommand of ['selector', 'domain', 'service', 'unit-of-work']) {
    assert.ok(generated.some((t) => t.cmd[1][3] === subcommand), `Missing generator ${subcommand}`);
  }
  assert.ok(generated.some((t) => t.cmd[1][3] === '--target-org'), 'Missing aggregate generator');
});

test('framework wiring fails if the deployed action stops setting status', async () => {
  for (const status of ['Pending', 'Injected']) {
    const tests = buildAt4dxTests('test-org', { query: async () => [{ SSO_Status__c: status }] });
    const wiring = tests.find((t) => t.name.startsWith('13 '));
    const check = () => wiring.check({ output: '{"result":{"success":true}}' });
    if (status === 'Pending') await assert.rejects(check(), /Injected/);
    else assert.equal(await check(), true);
  }
});

test('invalid source assertions cannot pass on an unrelated failure or missing issue', () => {
  const validate = buildAt4dxTests('test-org').find((t) => t.name.startsWith('08 '));
  assert.throws(() => validate.check({ output: '{"result":{"issues":[{"rule":"duplicate-domain-sobject"}]}}' }), /Missing issue/);
  const all = ['duplicate-domain-sobject', 'duplicate-to', 'sequence-collision', 'missing-domain-trigger'].map((rule) => ({ rule }));
  assert.equal(validate.check({ output: JSON.stringify({ result: { issues: all } }) }), true);
});

test('org missing-trigger case requires the rule and reset proves the temporary binding is absent', async () => {
  let records = [{ DeveloperName: 'SSO_Run_NoTrigger', BindingSObject__c: '01Icf000007asDz',
    BindingSObject__r: { QualifiedApiName: 'SSO_Aep_Untriggered__c' } }];
  const tests = buildAt4dxTests('test-org', { query: async (org, query) => {
    assert.equal(org, 'test-org');
    assert.match(query, /FROM ApplicationFactory_DomainBinding__mdt WHERE DeveloperName = 'SSO_Run_NoTrigger'/);
    return records;
  } });
  const create = tests.find((t) => t.name.startsWith('31 '));
  const validate = tests.find((t) => t.name.startsWith('32 '));
  const reset = tests.find((t) => t.name.startsWith('33 '));
  assert.ok(tests.indexOf(create) < tests.indexOf(validate) && tests.indexOf(validate) < tests.indexOf(reset));
  assert.ok(create.cmd[1].includes('--force'));
  assert.ok(create.cmd[1].includes('SSO_Aep_Untriggered__c'));
  assert.equal(create.cmd[1][create.cmd[1].indexOf('--to') + 1], 'SSO_AepUntriggereds');
  await create.check({ output: '{"status":0,"result":{}}' });
  assert.ok(validate.cmd[1].includes('--target-org'));
  assert.ok(!validate.cmd[1].includes('--source-dir'));
  assert.equal(validate.expectedExitCode, 1);
  assert.throws(() => validate.check({ output: '{"result":{"issues":[{"rule":"duplicate-to"}]}}' }), /Missing issue missing-domain-trigger/);
  const output = '{"result":{"issues":[{"rule":"missing-domain-trigger"}]}}';
  assert.ok(validate.expectedOutput.test(output));
  assert.equal(validate.check({ output }), true);
  assert.deepEqual(reset.cmd, ['bash', ['bin/setup-smoke-org.sh', 'test-org']]);
  await assert.rejects(reset.check(), /Reset left/);
  records = [];
  assert.equal(await reset.check(), true);
});

test('org domain verification queries the entity API name and rejects wrong or missing relationships', async () => {
  for (const relationship of [{ QualifiedApiName: 'SSO_Aep_Untriggered__c' }, { QualifiedApiName: 'Account' }, null, undefined]) {
    const tests = buildAt4dxTests('test-org', { query: async (org, query) => {
      assert.equal(org, 'test-org');
      assert.match(query, /^SELECT DeveloperName, BindingSObject__r\.QualifiedApiName FROM ApplicationFactory_DomainBinding__mdt /);
      return [{ BindingSObject__c: '01Icf000007asDz', BindingSObject__r: relationship }];
    } });
    const create = tests.find((t) => t.name.startsWith('31 '));
    const check = () => create.check({ output: '{"status":0,"result":{}}' });
    if (relationship?.QualifiedApiName === 'SSO_Aep_Untriggered__c') assert.equal(await check(), true);
    else await assert.rejects(check(), { code: 'ERR_ASSERTION' });
  }
});

test('successful org binding creates use unique deployed targets and the untriggered domain has no trigger', async () => {
  const targets = new Set();
  const metadata = resolve(root, 'sfdx-source/aep/main/customMetadata');
  for (const file of await filesUnder(metadata)) {
    if (!file.startsWith('ApplicationFactory_')) continue;
    const xml = await readFile(resolve(metadata, file), 'utf8');
    const target = xml.match(/<field>To__c<\/field><value[^>]*>([^<]+)<\/value>/)?.[1];
    if (target) targets.add(`${file.split('.')[0]}:${target}`);
  }
  for (const spec of buildAt4dxTests('test-org')) {
    const args = spec.cmd[1];
    if (commandId(spec) !== 'simply aep at4dx binding create' || spec.expectedExitCode !== 0 || !args.includes('--target-org') || !args.includes('--to')) continue;
    const type = args[args.indexOf('--type') + 1];
    const target = args[args.indexOf('--to') + 1];
    const key = `ApplicationFactory_${type[0].toUpperCase() + type.slice(1)}Binding:${target}`;
    assert.ok(!targets.has(key), `Duplicate org binding target: ${key}`);
    targets.add(key);
    await readFile(resolve(root, `sfdx-source/aep/main/classes/${target}.cls-meta.xml`));
  }
  const classes = resolve(root, 'sfdx-source/aep/main/classes');
  const domain = await readFile(resolve(classes, 'SSO_AepUntriggereds.cls'), 'utf8');
  assert.match(domain, /extends ApplicationSObjectDomain implements ISSO_AepUntriggereds/);
  assert.match(domain, /return new SSO_AepUntriggereds\(records\)/);
  const triggers = resolve(root, 'sfdx-source/aep/main/triggers');
  for (const file of (await filesUnder(triggers)).filter((file) => file.endsWith('.trigger'))) {
    assert.doesNotMatch(await readFile(resolve(triggers, file), 'utf8'), /\bon\s+SSO_Aep_Untriggered__c\b/i);
  }
});

test('reset scope keeps baseline and unrelated components while covering generated interfaces and CMDT', () => {
  for (const name of ['SSO_Run_Sel', 'SSO_Run_NoTrigger', 'SSO_GenDomain', 'SSOGenDomain', 'SSO_Aep_Gen']) assert.equal(isRunMetadata(name), true);
  for (const name of ['SSO_Base_Dom', 'Other', 'SSOXRunXSomething']) assert.equal(isRunMetadata(name), false);
  for (const name of ['SSOGenCases', 'ISSOGenCases', 'SSO_GenCases', 'ISSO_GenCases']) assert.equal(isGeneratedApex(name), true);
  for (const name of ['SSO_AepCases', 'Other', 'ISSO_AepCases', 'SSO_AepUntriggereds', 'ISSO_AepUntriggereds']) assert.equal(isGeneratedApex(name), false);
  assert.match(manifest({ CustomMetadata: ['Type.SSO_Run_Sel'], ApexClass: [] }), /<members>Type.SSO_Run_Sel<\/members><name>CustomMetadata<\/name>/);
  assert.ok(!manifest({ ApexClass: [] }).includes('<types>'));
});

test('fixtures keep invalid metadata outside the deployable package', async () => {
  const config = JSON.parse(await readFile(resolve(root, 'sfdx-project.json'), 'utf8'));
  assert.deepEqual(config.packageDirectories.map((d) => d.path),
    ['sfdx-source/aep', 'sfdx-source/community', 'sfdx-source/permissions']);
  const baseline = await filesUnder(resolve(root, 'sfdx-source/aep'));
  assert.ok(baseline.some((p) => p.includes('SSO_Aep_Gen__c.object-meta.xml')));
  assert.ok(!baseline.some((p) => p.includes('SSO_Invalid_')));
  const dependencies = JSON.parse(await readFile(resolve(root, 'config/dependencies.json'), 'utf8'));
  assert.deepEqual(dependencies.map((d) => d.name), ['fflib-apex-mocks', 'fflib-apex-common', 'force-di', 'at4dx']);
  for (const d of dependencies) assert.match(d.ref, /^[a-f0-9]{40}$/);
});

test('fixture selectors use the pinned AT4DX sample method declarations', async () => {
  const classes = resolve(root, 'sfdx-source/aep/main/classes');
  const selectors = [];
  for (const file of (await filesUnder(classes)).filter((file) => file.endsWith('.cls'))) {
    const source = await readFile(resolve(classes, file), 'utf8');
    if (!/extends\s+ApplicationSObjectSelector\b/.test(source)) continue;
    selectors.push(file);
    assert.match(source, /\bpublic Schema\.SObjectType getSObjectType\(\)/, file);
    assert.match(source, /\bprivate List<Schema\.SObjectField> getAdditionalSObjectFieldList\(\)/, file);
    assert.doesNotMatch(source, /\boverride\s+[^{};]*\b(?:getSObjectType|getAdditionalSObjectFieldList)\s*\(/, file);
  }
  assert.equal(selectors.length, 3);
});

test('APX parity fails for code changes and reports intentional CMDT differences separately', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sso-parity-'));
  try {
    const left = resolve(directory, 'left'), right = resolve(directory, 'right');
    await mkdir(left); await mkdir(right);
    await writeFile(resolve(left, 'Class.cls'), 'same'); await writeFile(resolve(right, 'Class.cls'), 'same');
    await writeFile(resolve(left, 'Binding.md-meta.xml'), 'old');
    assert.deepEqual(await compareTrees(left, right), { differences: [], cmdtDifferences: ['Binding.md-meta.xml'] });
    await writeFile(resolve(right, 'Class.cls'), 'broken');
    assert.deepEqual((await compareTrees(left, right)).differences, ['Class.cls']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a successful process cannot hide an error JSON status behind existing org state', async () => {
  const create = buildAt4dxTests('test-org', { query: async () => [{ DeveloperName: 'SSO_Run_Uow', BindingSequence__c: 10 }] }).find((t) => t.name.startsWith('03 '));
  await assert.rejects(create.check({ output: '{"status":1,"result":{}}' }), /JSON status/);
});

test('live validation failures require the reported message and error code', () => {
  const cases = [
    ['11 ', 'TypeFieldMismatchError', 'to cannot be set when bindingType is UnitOfWork, which has no To__c field — use sequence instead.'],
    ['28 ', 'TargetOrgOrSourceDirRequiredError', 'You must specify either --target-org or --source-dir, but not both.'],
  ];
  for (const [prefix, name, message] of cases) {
    const spec = buildAt4dxTests('test-org').find((t) => t.name.startsWith(prefix));
    const output = JSON.stringify({ status: 1, name, message });
    assert.equal(spec.expectedExitCode, 1);
    assert.match(output, spec.expectedOutput);
    assert.equal(spec.check({ output }), true);
    assert.throws(() => spec.check({ output: JSON.stringify({ name: 'UnrelatedError', message }) }));
    assert.doesNotMatch('Authentication failed', spec.expectedOutput);
  }
});

test('fixture permission gate rejects missing FLS and exempts required and master-detail fields', async () => {
  await checkFixturePermissions(root);
  const permissions = await readFile(resolve(root,
    'sfdx-source/aep/main/permissionsets/SSO_Aep_Fixtures.permissionset-meta.xml'), 'utf8');
  const objectEntries = [...permissions.matchAll(/<objectPermissions>([\s\S]*?)<\/objectPermissions>/g)].map(([, entry]) => entry);
  for (const file of await filesUnder(resolve(root, 'sfdx-source/aep/main/objects'))) {
    if (!file.endsWith('.object-meta.xml')) continue;
    const object = file.split('/')[0];
    const entry = objectEntries.find((entry) => entry.includes(`<object>${object}</object>`));
    assert.ok(entry, `Missing objectPermissions for ${object}`);
    for (const flag of ['allowRead', 'allowCreate', 'allowEdit', 'allowDelete', 'viewAllRecords', 'modifyAllRecords']) {
      assert.ok(entry.includes(`<${flag}>true</${flag}>`), `${object} needs ${flag}`);
    }
  }
  const directory = await mkdtemp(resolve(tmpdir(), 'sso-fls-'));
  try {
    const main = resolve(directory, 'sfdx-source/aep/main');
    const fields = resolve(main, 'objects/Example__c/fields');
    await mkdir(fields, { recursive: true });
    await mkdir(resolve(main, 'permissionsets'));
    const permset = resolve(main, 'permissionsets/SSO_Aep_Fixtures.permissionset-meta.xml');
    await writeFile(permset, '<PermissionSet/>');
    await writeFile(resolve(fields, 'Required__c.field-meta.xml'), '<CustomField><required>true</required></CustomField>');
    await writeFile(resolve(fields, 'Parent__c.field-meta.xml'), '<CustomField><type>MasterDetail</type></CustomField>');
    await checkFixturePermissions(directory);
    await writeFile(resolve(fields, 'Status__c.field-meta.xml'), '<CustomField><type>Text</type></CustomField>');
    await assert.rejects(checkFixturePermissions(directory), /Example__c.Status__c/);
    const entry = '<fieldPermissions><field>Example__c.Status__c</field><readable>true</readable><editable>true</editable></fieldPermissions>';
    await writeFile(permset, `<PermissionSet>${entry}</PermissionSet>`);
    await checkFixturePermissions(directory);
    await writeFile(permset, `<PermissionSet>${entry.replace('<editable>true', '<editable>false')}</PermissionSet>`);
    await assert.rejects(checkFixturePermissions(directory), /Example__c.Status__c/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
