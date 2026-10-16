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
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { filesUnder } from './lib/files.mjs';
import { assertLinkedPlugin, envelopeFrom, expectedFailure, resultFrom, run, runSuite, sf, sfJson, skip, success } from './lib/smoke.mjs';
import { makeGitFixture } from '../fixtures/local/make-git-fixture.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const localCommands = ['simply project update api-version', 'simply document generate',
  'simply document diff', 'simply schema generate', 'simply schema visualize'];

export function parseLocalArgs(argv) {
  const options = { offline: false, targetOrg: 'simply-smoke-org' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--offline') options.offline = true;
    else if (['--target-org', '-o'].includes(argv[i])) {
      const value = argv[++i];
      if (!value || value.startsWith('-')) throw new Error('Missing target org');
      options.targetOrg = value;
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

export async function snapshot(directory) {
  return Object.fromEntries(await Promise.all((await filesUnder(directory)).map(async (file) =>
    [file, (await readFile(resolve(directory, file))).toString('base64')])));
}

export async function prepareLocal(workspace = root) {
  const base = resolve(workspace, 'generated/local');
  await rm(base, { recursive: true, force: true });
  await mkdir(base, { recursive: true });
  await cp(resolve(root, 'fixtures/local/project'), resolve(base, 'project'), { recursive: true });
  for (const name of ['schema.csv', 'schema.xlsx', 'tdd.hbs']) {
    await cp(resolve(root, 'fixtures/local', name), resolve(base, name));
  }
  await mkdir(resolve(base, 'empty'), { recursive: true });
  await makeGitFixture(resolve(base, 'gitrepo'));
  await writeFile(resolve(base, 'unknown.csv'), 'Type,ObjectName\nUnknown,SSO_Unknown__c\n');
  await writeFile(resolve(base, 'malformed.csv'), 'Type,ObjectName\n"unterminated');
}

export function buildLocalTests({ offline = false, targetOrg = 'simply-smoke-org', workspace = root,
  runner = run, json = sfJson } = {}) {
  const base = resolve(workspace, 'generated/local');
  const path = (file) => resolve(base, file);
  const project = path('project');
  const source = path('project/force-app');
  const result = (e) => resultFrom(e.stdout ?? e.output);
  const text = (file) => readFile(path(file), 'utf8');
  const contains = async (file, ...markers) => {
    const content = await text(file);
    assert.ok(content.length > 0, `Empty ${file}`);
    for (const marker of markers) assert.ok(content.includes(marker), `Missing ${marker} in ${file}`);
    return true;
  };
  const cmd = (id, ...args) => [sf, [...id.split(' '), ...args, '--json']];
  const ok = (name, id, args, check, cwd = workspace, env = process.env) => {
    const test = success(name, async (execution) => {
      const envelope = envelopeFrom(execution.stdout ?? execution.output);
      assert.ok(envelope.status === undefined || envelope.status === 0, 'Nonzero JSON status');
      return check(execution);
    }, cmd(id, ...args));
    test.execute = () => runner(...test.cmd, { cwd, env });
    return test;
  };
  const bad = (name, id, args, pattern, cwd = workspace, env = process.env) => {
    const test = expectedFailure(name, pattern, cmd(id, ...args));
    test.execute = () => runner(...test.cmd, { cwd, env });
    return test;
  };
  const flagError = (...args) => ({ ...bad(...args), expectedExitCode: 2 });
  const api = localCommands[0], doc = localCommands[1], diff = localCommands[2], gen = localCommands[3], viz = localCommands[4];
  const docArgs = ['--directory', source, '--output-file', path('tdd.html')];
  const diffArgs = ['--from-tag', 'v1.0.0', '--to-tag', 'v1.1.0', '--output-file', path('diff.html')];
  const schemaPath = 'schema/objects/SSO_Schema_Csv__c';
  return [
    ok('01 api version updates metadata only', api, ['--directory', project, '--api-version', '62.0'], async () => {
      const original = await snapshot(resolve(root, 'fixtures/local/project'));
      const updated = await snapshot(project);
      assert.deepEqual(Object.keys(updated), Object.keys(original));
      let versions = 0;
      for (const file of Object.keys(original)) {
        if (file.endsWith('-meta.xml')) {
          const before = Buffer.from(original[file], 'base64').toString();
          const after = Buffer.from(updated[file], 'base64').toString();
          versions += [...before.matchAll(/<apiVersion>[^<]+<\/apiVersion>/g)].length;
          assert.equal(after, before.replace(/<apiVersion>[^<]+<\/apiVersion>/g, '<apiVersion>62.0</apiVersion>'));
        } else if (file !== 'sfdx-project.json') assert.equal(updated[file], original[file], file);
      }
      assert.ok(versions >= 4);
      assert.equal(JSON.parse(await text('project/sfdx-project.json')).sourceApiVersion, '62.0');
      return true;
    }),
    ok('02 api version rerun changes nothing', api, ['--directory', project, '--api-version', '62.0'], (e) => {
      assert.deepEqual(result(e).updatedFiles, []);
      assert.equal(result(e).projectFileUpdated, false);
      return true;
    }),
    flagError('03 api version invalid', api, ['--directory', project, '--api-version', 'abc'], /abc is not a valid API version/i),
    flagError('04 api directory missing', api, ['--directory', path('missing'), '--api-version', '62.0'], /No directory found/i),
    ok('05 document default html', doc, docArgs, () => contains('tdd.html', 'SSO_Local__c', 'SSO_LocalService')),
    ok('06 document custom template', doc, [...docArgs.slice(0, 2), '--output-file', path('custom.html'), '--template-file', path('tdd.hbs')], () => contains('custom.html', 'SSO_CUSTOM_TEMPLATE')),
    ok('07 document explicit html', doc, [...docArgs, '--output-format', 'html'], () => contains('tdd.html', 'SSO_Local__c')),
    ok('08 document empty directory', doc, ['--directory', path('empty'), '--output-file', path('empty.html')], async (e) => {
      assert.equal(result(e).componentCount, 0);
      return contains('empty.html');
    }),
    bad('08b document rejects unsupported format', doc, [...docArgs, '--output-format', 'pdf'], /output-format|html/i),
    ok('09 document diff tagged metadata', diff, diffArgs, async (e) => {
      const html = await text('diff.html');
      assert.equal(html, result(e).html);
      // Assert each change in its own table row so unrelated markers cannot satisfy it.
      for (const markers of [['SSO_LocalService', 'apexClasses', 'Modified'], ['SSO_LocalFlow', 'flows', 'Added'], ['Note__c.field-meta.xml', 'customObjects', 'Deleted']]) {
        assert.ok((html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).some((row) => markers.every((m) => row.includes(m))), `Missing diff row ${markers}`);
      }
      return true;
    }, path('gitrepo')),
    bad('10 document diff unknown ref', diff, ['--from-tag', 'nope', '--to-tag', 'v1.1.0'], /unknown revision|bad revision|ambiguous argument/i, path('gitrepo')),
    bad('11 document diff outside git', diff, diffArgs, /not a git repository|outside a working tree/i, path('empty'),
      { ...process.env, GIT_CEILING_DIRECTORIES: base }),
    ok('12 schema csv metadata', gen, ['--file', path('schema.csv'), '--output-dir', path('schema/objects')], async (e) => {
      assert.equal(result(e).objectCount, 1);
      assert.equal(result(e).fieldCount, 2);
      assert.equal(result(e).recordTypeCount, 1);
      await contains(`${schemaPath}/SSO_Schema_Csv__c.object-meta.xml`, '<CustomObject');
      await contains(`${schemaPath}/fields/Note__c.field-meta.xml`, '<type>Text</type>');
      await contains(`${schemaPath}/fields/Account__c.field-meta.xml`, '<referenceTo>Account</referenceTo>');
      return contains(`${schemaPath}/recordTypes/Smoke.recordType-meta.xml`, '<active>true</active>');
    }),
    offline ? skip('13 schema deploy round trip', '--offline: requires disposable smoke org') :
      ok('13 schema deploy round trip', 'project deploy start', ['--source-dir', path('schema'), '--target-org', targetOrg, '--wait', '30', '--ignore-conflicts'], async (e) => {
        assert.equal(result(e).success, true);
        assert.equal(result(e).status, 'Succeeded');
        const described = await json(['sobject', 'describe', '--sobject', 'SSO_Schema_Csv__c', '--target-org', targetOrg], { cwd: workspace });
        assert.ok(described.fields.some((f) => f.name === 'Note__c' && f.type === 'string'));
        assert.ok(described.fields.some((f) => f.name === 'Account__c' && f.type === 'reference' && f.referenceTo.includes('Account')));
        return true;
      }),
    ok('14 schema xlsx metadata', gen, ['--file', path('schema.xlsx'), '--output-dir', path('xlsx/objects')], async (e) => {
      assert.equal(result(e).objectCount, 1);
      assert.equal(result(e).fieldCount, 1);
      assert.equal(result(e).recordTypeCount, 0);
      const files = await filesUnder(path('xlsx'));
      assert.ok(!files.some((f) => f.includes('recordTypes/')));
      await contains('xlsx/objects/SSO_Schema_Xlsx__c/SSO_Schema_Xlsx__c.object-meta.xml', '<CustomObject');
      return contains('xlsx/objects/SSO_Schema_Xlsx__c/fields/SSO_Note__c.field-meta.xml', '<type>Text</type>');
    }),
    ok('15 schema unknown type ignored', gen, ['--file', path('unknown.csv'), '--output-dir', path('unknown')], async (e) => {
      assert.equal(result(e).objectCount, 0);
      assert.equal(result(e).fieldCount, 0);
      assert.deepEqual(await filesUnder(path('unknown')), []);
      return true;
    }),
    bad('15b schema malformed csv rejected', gen, ['--file', path('malformed.csv'), '--output-dir', path('invalid')], /Failed to parse CSV|Quote Not Closed/i),
    ok('16 visualize source html and markdown', viz, ['--source-dir', source, '--output-type', 'html,md', '--output-dir', path('viz-src')], async () => {
      await contains('viz-src/schema_report.html', 'SSO_Local__c');
      return contains('viz-src/schema_erd.md', 'erDiagram', 'SSO_Local__c');
    }),
    offline ? skip('17 visualize org relationship', '--offline: requires disposable smoke org') :
      ok('17 visualize org relationship', viz, ['--target-org', targetOrg, '--source-objects', 'SSO_Schema_Csv__c', '--related-objects', 'all', '--object-type', 'all', '--output-type', 'csv', '--output-dir', path('viz-org')],
        () => contains('viz-org/schema.csv', 'SSO_Schema_Csv__c', 'Account', 'Account__c')),
    bad('18 visualize requires source selection', viz, [], /either.*target-org.*source-dir|target-org.*source-dir.*not both/i, workspace,
      { ...process.env, SF_TARGET_ORG: '', SFDX_DEFAULTUSERNAME: '' }),
    ...offline ? [] : [bad('18b visualize rejects mixed sources', viz, ['--source-dir', source, '--target-org', targetOrg], /either.*target-org.*source-dir|target-org.*source-dir.*not both/i)],
  ];
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseLocalArgs(argv);
  const plugins = [];
  let original;
  await runSuite({ suiteName: 'local', targetOrg: options.offline ? null : options.targetOrg, cwd: root,
    plugin: () => plugins,
    preflight: async () => {
      for (const name of ['project', 'document', 'schema']) {
        plugins.push(await assertLinkedPlugin(`@simplysf/simply-${name}`,
          resolve(process.env.SIMPLY_PLUGINS_DIR ?? resolve(root, '../simply-plugins'), `packages/simply-${name}`)));
      }
      original = await snapshot(resolve(root, 'fixtures/local'));
      await prepareLocal();
    },
    tests: async function* () {
      yield* buildLocalTests(options);
      const test = success('19 committed fixtures unchanged', async () => {
        assert.deepEqual(await snapshot(resolve(root, 'fixtures/local')), original);
        return true;
      }, null);
      test.execute = async () => ({ exitCode: 0, output: 'Fixture integrity check' });
      yield test;
    },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
