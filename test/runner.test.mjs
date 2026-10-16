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
import { cp, mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, delimiter } from 'node:path';
import { root } from '../scripts/run-aep-smoke.mjs';
import { run } from '../scripts/lib/smoke.mjs';

for (const { name, output, status } of [
  { name: 'missing generate command', output: 'Warning: simply aep generate is not a sf command.', status: 'SKIP' },
  { name: 'missing generate topic', output: 'Error: command simply:aep:generate not found', status: 'SKIP' },
  { name: 'plugin initialization failure', output: 'Error: Cannot find module generate-handler while initializing simply aep generate', status: 'FAIL' },
  { name: 'empty probe failure', output: '', status: 'FAIL' },
]) {
test(`runner reports provenance and ${name} as ${status}`, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sso-runner-'));
  try {
    for (const path of ['scripts', 'sfdx-source']) await cp(resolve(root, path), resolve(directory, path), { recursive: true });
    const fakeBin = resolve(directory, 'fake-bin'); await mkdir(fakeBin);
    const pluginRoot = resolve(directory, 'plugins/packages/simply-aep'); await mkdir(pluginRoot, { recursive: true });
    const fake = `#!${process.execPath}
import { basename } from 'node:path';
const args=process.argv.slice(2);
if(basename(process.argv[1])==='git') {console.log(args[0]==='rev-parse'?'test-sha':'feat/test');}
else if(args[0]==='plugins') console.log(JSON.stringify([{name:'@simplysf/simply-aep',version:'test',type:'link',root:process.env.PLUGIN_ROOT}]));
else if(args[0]==='commands') console.log(JSON.stringify([{id:'simply:aep:at4dx:binding:list',pluginName:'@simplysf/simply-aep',pluginType:'link'}]));
else if(args.includes('generate')) {console.error(process.env.PROBE_OUTPUT); process.exitCode=1;}
else console.log(JSON.stringify({status:0,result:{bindings:[{developerName:'SSO_Base_Dom'},{developerName:'SSO_Run_Sel'}]}}));
`;
    for (const name of ['sf', 'git']) { await writeFile(resolve(fakeBin, name), fake); await chmod(resolve(fakeBin, name), 0o755); }
    const execution = await run(process.execPath, ['scripts/run-aep-smoke.mjs', '--target-org', 'test-org', '--skip-setup', '--only', '^04 |generate group'], {
      cwd: directory, env: { ...process.env, PATH: fakeBin + delimiter + process.env.PATH,
        SIMPLY_PLUGINS_DIR: resolve(directory, 'plugins'), PLUGIN_ROOT: pluginRoot, PROBE_OUTPUT: output },
    });
    assert.equal(execution.exitCode, status === 'FAIL' ? 1 : 0, execution.output);
    const reports = await readdir(resolve(directory, 'reports'));
    assert.equal(reports.length, 1);
    const report = JSON.parse(await readFile(resolve(directory, 'reports', reports[0]), 'utf8'));
    assert.deepEqual(report.counts, { pass: 1, fail: status === 'FAIL' ? 1 : 0, skip: status === 'SKIP' ? 1 : 0 });
    assert.equal(report.targetOrg, 'test-org');
    assert.equal(report.plugin.gitSha, 'test-sha');
    assert.equal(report.plugin.branch, 'feat/test');
    assert.equal(report.plugin.linkedPath, pluginRoot);
    assert.ok(report.results[0].command[1].includes('--json'));
    assert.equal(report.results[1].status, status);
    if (status === 'FAIL') {
      assert.deepEqual(report.results[1].command, ['sf', ['simply', 'aep', 'generate', '--help']]);
      assert.equal(report.results[1].exitCode, 1);
      assert.equal(report.results[1].stderr, output + '\n');
      assert.equal(report.results[1].output, output + '\n');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
}
