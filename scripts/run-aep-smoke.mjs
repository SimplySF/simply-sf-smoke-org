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
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, run, sf, sfJson, soql, resultFrom, envelopeFrom, success as commandSuccess, expectedFailure, skip,
  runSuite, assertLinkedPlugin } from './lib/smoke.mjs';
import { filesUnder, compareTrees } from './lib/files.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));
const object = 'SSO_Aep_Case__c';
const source = 'generated/aep/src';
const invalid = 'fixtures/aep-invalid';
const aep = (...args) => [sf, ['simply', 'aep', ...args, '--json']];
const at4dx = (group, action, ...args) => aep('at4dx', group, action, ...args);
const json = (execution) => resultFrom(execution.stdout ?? execution.output);
const success = (name, check, cmd) => commandSuccess(name, async (execution) => {
  const envelope = envelopeFrom(execution.stdout ?? execution.output);
  assert.equal(envelope.status ?? 0, 0, 'JSON status must indicate success');
  return check(execution);
}, cmd);
const clean = (execution) => {
  const result = json(execution);
  assert.ok(Array.isArray(result.issues), 'Missing issues array');
  assert.ok(!result.issues.some((i) => i.severity === 'error'), 'Unexpected validation errors');
  return true;
};
const contains = (rows, name) => rows.some((row) => row.developerName === name);
const issuesInclude = (...rules) => (execution) => {
  const found = json(execution).issues?.map((i) => i.rule) ?? [];
  for (const rule of rules) assert.ok(found.includes(rule), `Missing issue ${rule}`);
  return true;
};

export function buildAt4dxTests(targetOrg, { query = soql, projectRoot = root } = {}) {
  const org = ['--target-org', targetOrg];
  async function verify(type, name, fields = {}) {
    const rows = await query(targetOrg, `SELECT DeveloperName${Object.keys(fields).map((f) => `, ${f}`).join('')} FROM ${type}__mdt WHERE DeveloperName = '${name}'`);
    assert.equal(rows.length, 1, `Expected ${type}.${name} in org`);
    for (const [field, value] of Object.entries(fields)) assert.equal(rows[0][field], value);
    return true;
  }
  const written = async (filename) => {
    const files = await filesUnder(resolve(projectRoot, source));
    assert.ok(files.some((file) => file.endsWith(filename)), `Missing ${filename}`);
    return true;
  };
  const domainFlags = ['--type', 'domain', '--developer-name', 'SSO_Run_Dom2', '--sobject', object, '--to', 'SSO_AepCases'];
  const processFlags = ['--developer-name', 'SSO_Run_Dpb', '--sobject', object, '--process-context', 'TriggerExecution',
    '--trigger-operation', 'Before_Insert', '--type', 'Action', '--class-to-inject', 'SSO_AepSetStatusAction'];
  return [
    success('01 binding create deploy only', async (e) => {
      assert.equal(json(e).developerName, 'SSO_Run_Sel');
      await verify('ApplicationFactory_SelectorBinding', 'SSO_Run_Sel');
      const localFiles = await filesUnder(projectRoot, '', { ignored: ['.git', '.deps', 'node_modules', '.sf', '.sfdx', '.agents', '.codex', '.aws'] });
      assert.ok(!localFiles.some((f) => f.endsWith('ApplicationFactory_SelectorBinding.SSO_Run_Sel.md-meta.xml')), 'Deploy-only create left a local metadata file');
      return true;
    }, at4dx('binding', 'create', ...org, '--type', 'selector', '--developer-name', 'SSO_Run_Sel', '--sobject', 'Account', '--to', 'SSO_AepAccountsSelector', '--priority', '5')),
    success('02 binding create source and org', async (e) => {
      assert.equal(json(e).developerName, 'SSO_Run_Svc');
      await written('ApplicationFactory_ServiceBinding.SSO_Run_Svc.md-meta.xml');
      return verify('ApplicationFactory_ServiceBinding', 'SSO_Run_Svc');
    }, at4dx('binding', 'create', ...org, '--source-dir', source, '--type', 'service', '--developer-name', 'SSO_Run_Svc', '--binding-interface', 'ISSO_AepRunService', '--to', 'SSO_AepRunServiceImpl')),
    success('03 binding create unit of work', () => verify('ApplicationFactory_UnitOfWorkBinding', 'SSO_Run_Uow', { BindingSequence__c: 10 }),
      at4dx('binding', 'create', ...org, '--type', 'unit-of-work', '--developer-name', 'SSO_Run_Uow', '--sobject', object, '--sequence', '10')),
    success('04 binding list org', (e) => contains(json(e).bindings, 'SSO_Base_Dom') && contains(json(e).bindings, 'SSO_Run_Sel'),
      at4dx('binding', 'list', ...org)),
    success('05 binding list effective only', (e) => contains(json(e).bindings, 'SSO_Run_Sel') &&
      !contains(json(e).bindings, 'SSO_Base_Account') && json(e).bindings.every((b) => b.effective),
    at4dx('binding', 'list', ...org, '--type', 'selector', '--effective-only')),
    success('06 binding update priority', () => verify('ApplicationFactory_SelectorBinding', 'SSO_Run_Sel', { Priority__c: 7 }),
      at4dx('binding', 'update', ...org, '--type', 'selector', '--developer-name', 'SSO_Run_Sel', '--priority', '7')),
    success('07 binding validate org', clean, at4dx('binding', 'validate', ...org)),
    expectedFailure('08 binding validate invalid source', /duplicate-domain-sobject/, at4dx('binding', 'validate', '--source-dir', invalid),
      issuesInclude('duplicate-domain-sobject', 'duplicate-to', 'sequence-collision', 'missing-domain-trigger')),
    expectedFailure('09 duplicate domain refused', /wiring problem|validation/i, at4dx('binding', 'create', ...org, ...domainFlags), async () => {
      const rows = await query(targetOrg, "SELECT DeveloperName FROM ApplicationFactory_DomainBinding__mdt WHERE DeveloperName = 'SSO_Run_Dom2'");
      return rows.length === 0;
    }),
    success('10 force duplicate domain in copied source', () => written('ApplicationFactory_DomainBinding.SSO_Run_Dom2.md-meta.xml'),
      at4dx('binding', 'create', '--source-dir', source, ...domainFlags, '--force')),
    expectedFailure('11 unit of work rejects to', /--to.*(?:not|only|allow)|unit.of.work.*--to/i,
      at4dx('binding', 'create', '--source-dir', source, '--type', 'unit-of-work', '--developer-name', 'SSO_Run_Bad', '--sobject', object, '--to', 'X')),
    success('12 domain process create', () => verify('DomainProcessBinding', 'SSO_Run_Dpb', { IsActive__c: true }),
      at4dx('domain-process-binding', 'create', ...org, ...processFlags, '--order', '1')),
    success('13 framework wiring inserts injected status', async (e) => {
      assert.equal(json(e).success, true);
      const rows = await query(targetOrg, "SELECT SSO_Status__c FROM SSO_Aep_Case__c WHERE Name = 'SSO_FrameworkWiring'");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].SSO_Status__c, 'Injected');
      return true;
    }, [sf, ['apex', 'run', ...org, '--file', 'scripts/checkAepWiring.apex', '--json']]),
    success('14 domain process list active', (e) => contains(json(e).bindings, 'SSO_Run_Dpb'),
      at4dx('domain-process-binding', 'list', ...org, '--sobject', object, '--active-only')),
    success('15 domain process deactivate', async () => {
      await verify('DomainProcessBinding', 'SSO_Run_Dpb', { IsActive__c: false });
      const result = await sfJson(['simply', 'aep', 'at4dx', 'domain-process-binding', 'list', ...org, '--active-only']);
      return !contains(result.bindings, 'SSO_Run_Dpb');
    }, at4dx('domain-process-binding', 'update', ...org, '--developer-name', 'SSO_Run_Dpb', '--no-active')),
    success('16 domain process validate org', clean, at4dx('domain-process-binding', 'validate', ...org)),
    expectedFailure('17 domain process invalid order', /not a valid --order.*number/i,
      at4dx('domain-process-binding', 'create', '--source-dir', source, ...processFlags.map((f) => f === 'SSO_Run_Dpb' ? 'SSO_Run_BadOrder' : f), '--order', '10.1.2')),
    success('18 field set inclusion create', () => verify('SelectorConfig_FieldSetInclusion', 'SSO_Run_Fsi', { IsActive__c: true }),
      at4dx('field-set-inclusion', 'create', ...org, '--developer-name', 'SSO_Run_Fsi', '--sobject', object, '--fieldset-name', 'SSO_Aep_Case_Fields')),
    success('19 field set inclusion list', (e) => contains(json(e).records, 'SSO_Run_Fsi'), at4dx('field-set-inclusion', 'list', ...org)),
    success('20 field set inclusion deactivate', () => verify('SelectorConfig_FieldSetInclusion', 'SSO_Run_Fsi', { IsActive__c: false }),
      at4dx('field-set-inclusion', 'update', ...org, '--developer-name', 'SSO_Run_Fsi', '--no-active')),
    expectedFailure('21 field set inclusion invalid source', /missing-sobject-reference/, at4dx('field-set-inclusion', 'validate', '--source-dir', invalid), issuesInclude('missing-sobject-reference')),
    success('21b field set inclusion validate org', clean, at4dx('field-set-inclusion', 'validate', ...org)),
    success('22 event subscription create', () => verify('PlatformEvents_Subscription', 'SSO_Run_Pes', { IsActive__c: true }),
      at4dx('platform-event-subscription', 'create', ...org, '--developer-name', 'SSO_Run_Pes', '--event-bus', 'AT4DXMessage__e', '--consumer', 'SSO_AepEventConsumer', '--matcher-rule', 'MatchEventBusAndCategoryAndEventName', '--event-category', 'SSO', '--event-name', 'Ping')),
    success('23 event simulation matches consumer', (e) => json(e).matches.some((m) => m.consumer === 'SSO_AepEventConsumer'),
      at4dx('platform-event-subscription', 'simulate', ...org, '--event-bus', 'AT4DXMessage__e', '--category', 'SSO', '--event-name', 'Ping')),
    success('24 event simulation no match', (e) => !json(e).matches.some((m) => m.consumer === 'SSO_AepEventConsumer') &&
      json(e).misses.some((m) => m.developerName === 'SSO_Run_Pes' && m.reason === 'no-match'),
    at4dx('platform-event-subscription', 'simulate', ...org, '--event-bus', 'AT4DXMessage__e', '--category', 'SSO', '--event-name', 'Other')),
    success('25 event subscription deactivate', () => verify('PlatformEvents_Subscription', 'SSO_Run_Pes', { IsActive__c: false }),
      at4dx('platform-event-subscription', 'update', ...org, '--developer-name', 'SSO_Run_Pes', '--no-active')),
    success('25b event simulation inactive', (e) => !json(e).matches.some((m) => m.consumer === 'SSO_AepEventConsumer') &&
      json(e).misses.some((m) => m.developerName === 'SSO_Run_Pes' && m.reason === 'inactive'),
    at4dx('platform-event-subscription', 'simulate', ...org, '--event-bus', 'AT4DXMessage__e', '--category', 'SSO', '--event-name', 'Ping')),
    success('26 event subscription list', (e) => contains(json(e).records, 'SSO_Run_Pes'), at4dx('platform-event-subscription', 'list', ...org)),
    success('27 event subscription validate org', clean, at4dx('platform-event-subscription', 'validate', ...org)),
    expectedFailure('28 event simulation rejects mixed sources', /exactly one of.*--target-org.*--source-dir/i,
      at4dx('platform-event-subscription', 'simulate', ...org, '--source-dir', source, '--event-bus', 'AT4DXMessage__e')),
    expectedFailure('29 domain process invalid source', /missing-sobject-reference/, at4dx('domain-process-binding', 'validate', '--source-dir', invalid), issuesInclude('missing-sobject-reference')),
    expectedFailure('30 event subscription invalid source', /matcher-rule-missing-field/, at4dx('platform-event-subscription', 'validate', '--source-dir', invalid), issuesInclude('matcher-rule-missing-field')),
  ];
}

export function buildGenerateTests(targetOrg) {
  const base = 'generated/aep/gen';
  const aggregate = `${base}/aggregate`;
  const common = ['--target-org', targetOrg, '--sobject', object, '--flavor', 'at4dx'];
  // Baseline bindings deliberately conflict; force is tested independently in G8.
  const aggregateFlags = [...common, '--selector', '--domain', '--unit-of-work', '--output-dir', aggregate, '--force'];
  let originalFiles;
  const created = (e, suffix) => json(e).created?.some((path) => path.endsWith(suffix));
  const cmd = (...args) => aep('generate', ...args);
  return [
    success('G1 aggregate at4dx generation', async (e) => {
      assert.ok(created(e, 'ApplicationFactory_UnitOfWorkBinding.SSO_Aep_Case.md-meta.xml'));
      assert.ok(created(e, '.trigger'));
      originalFiles = await snapshot(resolve(root, aggregate));
      return true;
    }, cmd(...aggregateFlags)),
    success('G2 selector dry run leaves no files', (e) => json(e).created?.length === 0 &&
      json(e).wouldCreate?.some((p) => p.endsWith('ApplicationFactory_SelectorBinding.SSO_Aep_Case.md-meta.xml')) &&
      !existsSync(resolve(root, `${base}/preview`)),
    cmd('selector', ...common, '--dry-run', '--output-dir', `${base}/preview`)),
    success('G3 fflib selector', (e) => created(e, 'Selector.cls') && !json(e).created.some((p) => p.includes('ApplicationFactory_SelectorBinding')),
      cmd('selector', '--target-org', targetOrg, '--sobject', object, '--flavor', 'fflib', '--output-dir', `${base}/fflib`)),
    success('G4 fflib unit of work manual step', (e) => json(e).created?.length === 0 &&
      JSON.stringify(json(e).manualSteps).includes(`${object}.SObjectType`),
    cmd('unit-of-work', '--target-org', targetOrg, '--sobject', object, '--flavor', 'fflib', '--dry-run', '--output-dir', `${base}/uow`)),
    success('G5 service without org', (e) => created(e, 'ISSO_GenSmokeService.cls'),
      cmd('service', '--service-basename', 'SSO_GenSmoke', '--flavor', 'at4dx', '--output-dir', `${base}/service`)),
    expectedFailure('G6 empty selection', /Select at least one artifact group/i, cmd(...common, '--dry-run', '--output-dir', `${base}/empty`)),
    expectedFailure('G7 overwrite refused without touching files', /already exist|file.exists/i, cmd(...aggregateFlags), async (e) => {
      assert.ok(originalFiles, 'Run G1 first');
      assert.deepEqual(await snapshot(resolve(root, aggregate)), originalFiles);
      assert.ok(Object.keys(originalFiles).some((p) => e.output.includes(p)), 'Refusal must list conflicting paths');
      return true;
    }),
    success('G7b overwrite allowed', (e) => created(e, '.trigger'), cmd(...aggregateFlags, '--overwrite')),
    expectedFailure('G8 domain scoped validation refuses conflict', /validation|wiring problem/i,
      cmd('domain', ...common, '--output-dir', `${base}/scoping`)),
    success('G8b domain force reports conflict and writes', (e) => created(e, '.trigger') &&
      json(e).issues?.some((i) => i.rule === 'duplicate-domain-sobject'),
    cmd('domain', ...common, '--force', '--output-dir', `${base}/scoping`)),
    success('G9 API version fallback', async (e) => {
      const file = json(e).created?.find((p) => p.endsWith('.cls-meta.xml'));
      assert.ok(file, 'Missing generated class metadata');
      const version = (await readFile(file, 'utf8')).match(/<apiVersion>(\d+\.\d+)<\/apiVersion>/)?.[1];
      assert.ok(version && Number(version) > 0, 'Missing or invalid fallback API version');
      return true;
    }, cmd('service', '--service-basename', 'SSO_GenVersion', '--flavor', 'at4dx', '--output-dir', `${base}/api-version`)),
    success('G10 generate round trip', (e) => created(e, '.trigger') && created(e, 'ApplicationFactory_DomainBinding.SSO_Aep_Gen.md-meta.xml'),
      cmd('--target-org', targetOrg, '--sobject', 'SSO_Aep_Gen__c', '--flavor', 'at4dx', '--prefix', 'SSOGen', '--selector', '--domain', '--unit-of-work', '--sequence', '20', '--output-dir', `${base}/deploy`)),
    success('G11 deploy generated code', (e) => json(e).success === true && json(e).status === 'Succeeded',
      [sf, ['project', 'deploy', 'start', '--source-dir', `${base}/deploy`, '--target-org', targetOrg, '--wait', '30', '--json']]),
    success('G12 generated bindings validate', clean, at4dx('binding', 'validate', '--target-org', targetOrg)),
  ];
}

async function snapshot(directory) {
  const entries = [];
  for (const file of await filesUnder(directory)) entries.push([file, { contents: await readFile(resolve(directory, file), 'utf8'), mtime: (await stat(resolve(directory, file))).mtimeMs }]);
  return Object.fromEntries(entries);
}

async function parityTest(targetOrg) {
  const args = ['generate', '--target-org', targetOrg, '--sobject', 'SSO_Aep_Gen__c', '--selector', '--domain', '--unit-of-work'];
  const test = success('APX parity non CMDT files identical', (e) => json(e).differences.length === 0, null);
  test.execute = async () => {
    const apxDir = resolve(root, 'generated/aep/parity/apx');
    const aepDir = resolve(root, 'generated/aep/parity/aep');
    const executions = [];
    for (const command of [
      ['apx', ...args, '--at4dx', '--output-path', apxDir, '--json'],
      ['simply', 'aep', ...args, '--flavor', 'at4dx', '--output-dir', aepDir, '--json'],
    ]) {
      const result = await run(sf, command, { cwd: root });
      executions.push({ command: [sf, command], ...result });
      if (result.exitCode !== 0) return { ...result, executions };
    }
    const comparison = await compareTrees(apxDir, aepDir);
    return { exitCode: 0, output: JSON.stringify(comparison), executions };
  };
  return test;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const expectedPlugin = resolve(process.env.SIMPLY_PLUGINS_DIR ?? resolve(root, '../simply-plugins'), 'packages/simply-aep');
  let plugin;
  await runSuite({ suiteName: 'aep', targetOrg: options.targetOrg, skipSetup: options.skipSetup, only: options.only, cwd: root,
    // Always verify the link, even when setup is skipped, and persist preflight failures in a report.
    tests: async function* () {
      await mkdir(resolve(root, source), { recursive: true });
      await cp(resolve(root, 'sfdx-source/aep'), resolve(root, source), { recursive: true });
      yield* buildAt4dxTests(options.targetOrg);
      const probe = await run(sf, ['simply', 'aep', 'generate', '--help'], { cwd: root });
      if (probe.exitCode !== 0) {
        yield skip('generate group', 'linked simply-aep has no generate topic (PR #73 not merged/checked out)');
        return;
      }
      yield* buildGenerateTests(options.targetOrg);
      if (options.extra.apxParity) {
        const apx = await run(sf, ['apx', '--help'], { cwd: root });
        yield apx.exitCode === 0 ? await parityTest(options.targetOrg) : skip('APX parity', 'sf apx is unavailable');
      }
    },
    preflight: async () => {
      plugin = await assertLinkedPlugin('@simplysf/simply-aep', expectedPlugin);
      await rm(resolve(root, source), { recursive: true, force: true });
    },
    setup: async () => {
      const execution = await run('bash', ['bin/setup-smoke-org.sh', options.targetOrg,
        ...(options.extra.redeployDeps ? ['--redeploy-deps'] : [])], { cwd: root });
      if (execution.exitCode !== 0) throw new Error(execution.output);
    },
    plugin: () => plugin,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
