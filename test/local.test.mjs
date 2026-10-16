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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildLocalTests, localCommands, parseLocalArgs, prepareLocal, root, snapshot } from '../scripts/run-local-smoke.mjs';
import { assertLinkedPlugin, run } from '../scripts/lib/smoke.mjs';

async function fixture(fn) {
  const workspace = await mkdtemp(resolve(tmpdir(), 'sso-local-'));
  try { await prepareLocal(workspace); await fn(workspace); }
  finally { await rm(workspace, { recursive: true, force: true }); }
}
const json = (value) => ({ exitCode: 0, output: JSON.stringify({ result: value }) });

test('local flags reject missing values and keep offline independent of target org', () => {
  assert.deepEqual(parseLocalArgs(['--offline', '-o', 'scratch']), { offline: true, targetOrg: 'scratch' });
  for (const args of [['--target-org'], ['-o', '--offline'], ['--wat']]) assert.throws(() => parseLocalArgs(args));
});

test('outline covers five commands with success, failure and org-free offline cases', async () => {
  const outline = await readFile(resolve(root, 'smoke/local-commands.md'), 'utf8');
  const cases = buildLocalTests({ offline: true });
  for (const id of localCommands) {
    assert.ok(outline.includes(`\`${id}\``));
    const matching = cases.filter((t) => t.cmd?.[1].slice(0, id.split(' ').length).join(' ') === id);
    assert.ok(matching.some((t) => t.expectedExitCode === 0), `${id}: success`);
    assert.ok(matching.some((t) => t.expectedExitCode > 0), `${id}: expected failure`);
  }
  assert.deepEqual(cases.filter((t) => t.reason).map((t) => t.name.slice(0, 2)), ['13', '17']);
  for (const t of cases.filter((t) => t.cmd)) {
    assert.ok(t.cmd[1].includes('--json'), t.name);
    assert.ok(!t.cmd[1].includes('--target-org'), t.name);
  }
});

test('fixture preparation is repeatable, preserves originals and creates real tagged diffs', async () => {
  const before = await snapshot(resolve(root, 'fixtures/local'));
  await fixture(async (workspace) => {
    const cwd = resolve(workspace, 'generated/local/gitrepo');
    const diff = await run('git', ['diff', '--name-status', 'v1.0.0..v1.1.0'], { cwd });
    assert.equal(diff.exitCode, 0);
    assert.match(diff.stdout, /M\s+.*SSO_LocalService.cls/);
    assert.match(diff.stdout, /A\s+.*SSO_LocalFlow.flow-meta.xml/);
    assert.match(diff.stdout, /D\s+.*Note__c.field-meta.xml/);
    await writeFile(resolve(workspace, 'generated/local/stale'), 'stale');
    await prepareLocal(workspace);
    assert.ok(!('stale' in await snapshot(resolve(workspace, 'generated/local'))));
  });
  assert.deepEqual(await snapshot(resolve(root, 'fixtures/local')), before);
});

test('API assertion detects wrong nested versions and non-meta mutations', async () => {
  await fixture(async (workspace) => {
    const project = resolve(workspace, 'generated/local/project');
    const original = await snapshot(project);
    for (const [file, data] of Object.entries(original)) {
      if (file.endsWith('-meta.xml')) await writeFile(resolve(project, file), Buffer.from(data, 'base64').toString().replace(/<apiVersion>[^<]+<\/apiVersion>/g, '<apiVersion>62.0</apiVersion>'));
    }
    const config = JSON.parse(await readFile(resolve(project, 'sfdx-project.json'), 'utf8'));
    config.sourceApiVersion = '62.0';
    await writeFile(resolve(project, 'sfdx-project.json'), JSON.stringify(config));
    const check = buildLocalTests({ workspace })[0].check;
    assert.equal(await check(json({})), true);
    const nested = resolve(project, 'sfdx-source/x/main/default/classes/SSO_Nested.cls-meta.xml');
    const valid = await readFile(nested, 'utf8');
    await writeFile(nested, valid.replace('62.0', '61.0'));
    await assert.rejects(check(json({})));
    await writeFile(nested, valid);
    await writeFile(resolve(project, 'notes.txt'), 'changed');
    await assert.rejects(check(json({})));
  });
});

test('CSV assertion rejects missing fields or record type despite successful JSON', async () => {
  await fixture(async (workspace) => {
    const check = buildLocalTests({ workspace }).find((t) => t.name.startsWith('12 ')).check;
    await assert.rejects(check(json({ objectCount: 1, fieldCount: 1, recordTypeCount: 1 })));
    await assert.rejects(check(json({ objectCount: 1, fieldCount: 2, recordTypeCount: 1 })), /ENOENT/);
  });
});

test('diff executes in fixture git root and non-repo case stops ancestor discovery', async () => {
  const calls = [];
  const tests = buildLocalTests({ runner: async (...args) => { calls.push(args); return { exitCode: 0, output: '' }; } });
  await tests.find((t) => t.name.startsWith('09 ')).execute();
  await tests.find((t) => t.name.startsWith('11 ')).execute();
  assert.ok(calls[0][2].cwd.endsWith('/generated/local/gitrepo'));
  assert.equal(calls[1][2].env.GIT_CEILING_DIRECTORIES, resolve(root, 'generated/local'));
});

test('deploy proof requires successful deployment and described lookup target', async () => {
  const make = (fields) => buildLocalTests({ json: async () => ({ fields }) }).find((t) => t.name.startsWith('13 ')).check;
  const good = json({ success: true, status: 'Succeeded' });
  const fields = [{ name: 'Note__c', type: 'string' }, { name: 'Account__c', type: 'reference', referenceTo: ['Account'] }];
  assert.equal(await make(fields)(good), true);
  await assert.rejects(make([])(good));
  await assert.rejects(make(fields)(json({ success: false, status: 'Failed' })));
});

test('linked checks use each plugin topic and reject umbrella shadowing', async () => {
  for (const topic of ['project', 'document', 'schema']) {
    const name = `@simplysf/simply-${topic}`, root = `/plugins/${topic}`;
    for (const shadow of [false, true]) {
      const promise = assertLinkedPlugin(name, root, { canonicalize: async (p) => p, runner: async (file, args) => {
        if (file === 'git') return { exitCode: 0, stdout: 'revision' };
        return json(args[0] === 'plugins' ? [{ name, root, type: 'link' }] :
          [{ id: `simply:${topic}:generate`, pluginName: shadow ? '@simplysf/simply' : name, pluginType: 'link' }]);
      } });
      if (shadow) await assert.rejects(promise, /resolves simply/);
      else assert.equal((await promise).name, name);
    }
  }
});

test('local successes reject error envelopes even when the process exits zero', async () => {
  const check = buildLocalTests().find((t) => t.name.startsWith('02 ')).check;
  await assert.rejects(check({ exitCode: 0, output: JSON.stringify({ status: 1,
    result: { updatedFiles: [], projectFileUpdated: false } }) }), /Nonzero JSON status/);
});

test('parser errors require exit 2 and diff proof keeps status within the component row', async () => {
  const tests = buildLocalTests();
  for (const number of ['03 ', '04 ']) assert.equal(tests.find((t) => t.name.startsWith(number)).expectedExitCode, 2);
  await fixture(async (workspace) => {
    const check = buildLocalTests({ workspace }).find((t) => t.name.startsWith('09 ')).check;
    const rows = [
      '<tr><td>SSO_LocalService</td><td>apexClasses</td><td>Modified</td></tr>',
      '<tr><td>SSO_LocalFlow</td><td>flows</td><td>Added</td></tr>',
      '<tr><td>Note__c.field-meta.xml</td><td>customObjects</td><td>Deleted</td></tr>',
    ];
    const path = resolve(workspace, 'generated/local/diff.html');
    const html = rows.join('');
    await writeFile(path, html);
    assert.equal(await check(json({ html })), true);
    const wrong = html.replace('Modified', 'Added');
    await writeFile(path, wrong);
    await assert.rejects(check(json({ html: wrong })), /Missing diff row/);
  });
});
