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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs, resultFrom, sfJson, run, success, expectedFailure, skip, withForbiddenOutput,
  runSuite, assertLinkedPlugin } from '../scripts/lib/smoke.mjs';

const execution = (exitCode, result) => ({ exitCode, output: JSON.stringify(result) });
const identity = async (path) => resolve(path);

test('argument parsing validates filters, missing values and unknown flags', () => {
  const parsed = parseArgs(['-o', 'scratch', '--skip-setup', '--only', '^binding', '--apx-parity', '--redeploy-deps']);
  assert.equal(parsed.targetOrg, 'scratch');
  assert.equal(parsed.skipSetup, true);
  assert.equal(parsed.only.test('binding create'), true);
  assert.deepEqual(parsed.extra, { apxParity: true, redeployDeps: true });
  assert.equal(parseArgs([]).targetOrg, 'simply-smoke-org');
  for (const args of [['--only'], ['--target-org', '--only'], ['--wat'], ['--only', '[']]) assert.throws(() => parseArgs(args));
});

test('JSON parsing handles preambles, arrays, results, malformed and absent JSON', () => {
  assert.deepEqual(resultFrom('Warning before JSON\n{ "status": 0, "result": {"ok":true} }\n'), { ok: true });
  assert.deepEqual(resultFrom('[{"name":"linked"}]'), [{ name: 'linked' }]);
  assert.equal(resultFrom('{"result":false}'), false);
  assert.throws(() => resultFrom('not JSON'), /did not return JSON/);
  assert.throws(() => resultFrom('{ broken'), /Invalid command JSON/);
});

test('process adapter preserves exit code and separate stdout/stderr', async () => {
  const result = await run(process.execPath, ['-e', 'process.stdout.write("json"); process.stderr.write("warning"); process.exitCode=7']);
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, 'json');
  assert.equal(result.stderr, 'warning');
  const missing = await run('/nonexistent-sso-binary', []);
  assert.equal(missing.exitCode, null);
  assert.match(missing.output, /ENOENT/);
});

test('sfJson adds --json, separates warnings, rejects exit and envelope errors', async () => {
  assert.deepEqual(await sfJson(['data', 'query'], { runner: async (file, args) => {
    assert.ok(file === 'sf' || file === 'sf.cmd');
    assert.deepEqual(args, ['data', 'query', '--json']);
    return { exitCode: 0, stdout: '{"status":0,"result":{"records":[]}}', output: 'warning' };
  } }), { records: [] });
  for (const result of [execution(2, { status: 0 }), execution(0, { status: 1 })]) {
    await assert.rejects(sfJson([], { runner: async () => result }));
  }
});

function pluginRunner(plugins, commands = [{ id: 'simply:aep:at4dx:binding:list', pluginName: '@simplysf/simply-aep', pluginType: 'link' }]) {
  return async (file, args) => {
    if (file === 'git') return { exitCode: 0, output: args[0] === 'rev-parse' ? 'abc123\n' : 'feat/test\n' };
    return execution(0, args[0] === 'commands' ? commands : plugins);
  };
}
const linked = { name: '@simplysf/simply-aep', version: '1.0.0', type: 'link', root: '/plugins/packages/simply-aep' };

test('linked plugin check records exact checkout and revision', async () => {
  const result = await assertLinkedPlugin(linked.name, linked.root, { runner: pluginRunner([linked]), canonicalize: identity });
  assert.deepEqual(result, { name: linked.name, version: '1.0.0', linkedPath: linked.root, gitSha: 'abc123', branch: 'feat/test' });
});

test('linked plugin check rejects bundled, installed, wrong root, prefix siblings and command shadowing', async () => {
  for (const plugins of [[], [{ ...linked, type: 'user' }], [{ ...linked, root: linked.root + '-other' }],
    [{ name: '@simplysf/simply', children: [linked] }]]) {
    await assert.rejects(assertLinkedPlugin(linked.name, linked.root, { runner: pluginRunner(plugins), canonicalize: identity }), /sf plugins link/);
  }
  await assert.rejects(assertLinkedPlugin(linked.name, linked.root, {
    runner: pluginRunner([linked], [{ id: 'simply:aep:at4dx:binding:list', pluginName: '@simplysf/simply', pluginType: 'user' }]), canonicalize: identity,
  }), /resolves simply aep/);
});

async function suite(options) {
  const cwd = await mkdtemp(resolve(tmpdir(), 'sso-suite-'));
  try {
    const result = await runSuite({ suiteName: 'unit', targetOrg: 'scratch', plugin: () => ({ name: 'plugin', gitSha: 'sha' }),
      cwd, log: () => {}, setExitCode: false, ...options });
    const report = JSON.parse(await readFile(result.reportPath, 'utf8'));
    assert.equal(report.targetOrg, 'scratch');
    assert.equal(report.plugin.gitSha, 'sha');
    assert.deepEqual(report.results, JSON.parse(JSON.stringify(result.results)));
    return result;
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

test('suite counts pass/fail/skip and preserves command evidence, including throwing checks', async () => {
  const command = ['fake', ['--json']];
  const result = await suite({ runner: async () => ({ exitCode: 0, output: 'ok' }), tests: [
    success('works', () => true, command), success('wrong output', () => false, command),
    success('throws', () => { throw new Error('bad contract'); }, command),
    expectedFailure('wrong exit', /ok/, command), skip('gated', 'no topic'),
    withForbiddenOutput(/ok/, success('forbidden', () => true, command)),
  ] });
  assert.deepEqual(result.counts, { pass: 1, fail: 4, skip: 1 });
  assert.deepEqual(result.results[0].command, command);
  assert.equal(result.results[2].error, 'bad contract');
  assert.equal(result.results[2].output, 'ok');
  assert.equal(result.results[4].reason, 'no topic');
});

test('expected failures require both exit 1 and pattern and optional state check', async () => {
  const command = ['fake', []];
  const result = await suite({ runner: async () => ({ exitCode: 1, output: 'duplicate-domain-sobject' }), tests: [
    expectedFailure('expected', /duplicate-domain-sobject/, command),
    expectedFailure('wrong text', /unrelated/, command),
    expectedFailure('wrong state', /duplicate/, command, () => false),
  ] });
  assert.deepEqual(result.counts, { pass: 1, fail: 2, skip: 0 });
});

test('preflight always runs, skip setup works, and empty selections fail', async () => {
  let preflights = 0;
  const result = await suite({ skipSetup: true, preflight: async () => preflights++,
    setup: () => { throw new Error('must skip'); }, only: /selected/,
    runner: async () => ({ exitCode: 0, output: '' }), tests: [success('selected', () => true, ['fake', []]), skip('other', 'reason')] });
  assert.equal(preflights, 1);
  assert.deepEqual(result.counts, { pass: 1, fail: 0, skip: 0 });
  assert.equal((await suite({ only: /none/, tests: [skip('other', 'reason')] })).counts.fail, 1);
});

test('setup and preflight failure produce failing reports without executing tests', async () => {
  for (const phase of ['setup', 'preflight']) {
    const result = await suite({ [phase]: async () => { throw new Error('auth failure'); },
      runner: () => { throw new Error('must not run'); }, tests: [success('never', () => true, ['fake', []])] });
    assert.equal(result.counts.fail, 1);
    assert.equal(result.results[0].name, phase);
    assert.equal(result.results[0].output, 'auth failure');
  }
});

test('test definition failures are retained in the report', async () => {
  const result = await suite({ tests: async function* () { throw new Error('cannot prepare source'); } });
  assert.equal(result.counts.fail, 1);
  assert.equal(result.results[0].name, 'test discovery');
  assert.equal(result.results[0].output, 'cannot prepare source');
});
