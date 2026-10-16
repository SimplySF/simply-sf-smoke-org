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
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, delimiter } from 'node:path';
import { run } from '../scripts/lib/smoke.mjs';
import { root } from '../scripts/run-aep-smoke.mjs';

// Exercise the real setup entry point against fake external boundaries, with no sf install or network.
test('setup deploys in dependency order, caches by org identity, resets safely, and retries failures', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sso-setup-'));
  try {
    for (const path of ['scripts', 'bin', 'config', 'sfdx-source']) await cp(resolve(root, path), resolve(directory, path), { recursive: true });
    const fakeBin = resolve(directory, 'fake-bin'); await mkdir(fakeBin);
    const fake = `#!${process.execPath}
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
const args = process.argv.slice(2), file = basename(process.argv[1]);
const entry = { file, args, cwd: process.cwd() };
const flag = (name) => args[args.indexOf(name) + 1];
if (args.includes('--post-destructive-changes')) entry.destructive = readFileSync(flag('--post-destructive-changes'), 'utf8');
appendFileSync(process.env.CALLS, JSON.stringify(entry) + '\\n');
if (file === 'git') {
 if (args[0] === 'clone') mkdirSync(args.at(-1), {recursive:true});
 if (args[0] === 'checkout') await import('node:fs').then(fs => fs.writeFileSync('.pin', args.at(-1)));
 if (args[0] === 'rev-parse') console.log(readFileSync('.pin', 'utf8'));
} else {
 let result = {};
 if (args[0] === 'org') result = {id:process.env.ORG_ID ?? '00D000000000001AAA'};
 if (args[0] === 'data') {
  const q = flag('--query');
  if (process.env.FAIL_QUERY) { console.log(JSON.stringify({status:1,message:'auth expired'})); process.exit(1); }
  let records = [];
  if (q.includes('FROM ApexClass WHERE Name IN')) records = ['fflib_ApexMocks','fflib_Application','di_Injector','ApplicationSObjectDomain'].map(Name=>({Name}));
  else if (q.includes('DeveloperName')) records = ['SSO_Run_Test', 'SSO_Run_NoTrigger', 'SSO_Base_Keep', 'SSO_Aep_Gen', 'SSOXRunXKeep'].map(DeveloperName=>({DeveloperName}));
  else records = ['ISSOGenCases','SSOGenCases','SSO_AepCases'].map(Name=>({Name}));
  result = {records};
 }
 if (args[0] === 'project') {
  if (process.env.FAIL_DEPLOY && process.cwd().endsWith('force-di')) { console.log(JSON.stringify({status:1,message:'deploy failure'})); process.exit(1); }
  result = {success:true,status:'Succeeded'};
 }
 console.log(JSON.stringify({status:0,result}));
}
`;
    for (const name of ['sf', 'git']) { await writeFile(resolve(fakeBin, name), fake); await chmod(resolve(fakeBin, name), 0o755); }
    const callsPath = resolve(directory, 'calls.jsonl');
    const env = { ...process.env, PATH: fakeBin + delimiter + process.env.PATH, CALLS: callsPath };
    async function setup(extra = [], overrides = {}) {
      await writeFile(callsPath, '');
      const result = await run('bash', ['bin/setup-aep.sh', 'smoke', ...extra], { cwd: directory, env: { ...env, ...overrides } });
      const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      return { ...result, calls };
    }
    const first = await setup();
    assert.equal(first.exitCode, 0, first.output);
    const depNames = (calls) => calls.filter((c) => c.file === 'sf' && c.args[0] === 'project' && c.cwd.includes('/.deps/')).map((c) => c.cwd.split('/').at(-1));
    assert.deepEqual(depNames(first.calls), ['fflib-apex-mocks', 'fflib-apex-common', 'force-di', 'at4dx']);
    const destructive = first.calls.find((c) => c.destructive).destructive;
    assert.ok(destructive.includes('<members>ApplicationFactory_DomainBinding.SSO_Run_NoTrigger</members>'));
    for (const name of ['SSO_Run_Test','SSO_Aep_Gen','ISSOGenCases','SSOGenCases']) assert.ok(destructive.includes(name));
    for (const name of ['SSO_Base_Keep','SSOXRunXKeep','SSO_AepCases']) assert.ok(!destructive.includes(name));
    const second = await setup();
    assert.equal(second.exitCode, 0, second.output);
    assert.deepEqual(depNames(second.calls), []);
    assert.ok(second.calls.some((c) => c.destructive), 'Reset must run even when dependencies are cached');
    assert.equal((await setup([], { FAIL_QUERY: '1' })).exitCode, 1);
    const forced = await setup(['--redeploy-deps']);
    assert.equal(forced.exitCode, 0, forced.output);
    assert.equal(depNames(forced.calls).length, 4);
    const forcedFailure = await setup(['--redeploy-deps'], { FAIL_DEPLOY: '1' });
    assert.equal(forcedFailure.exitCode, 1, forcedFailure.output);
    assert.deepEqual(depNames(forcedFailure.calls), ['fflib-apex-mocks', 'fflib-apex-common', 'force-di']);
    await assert.rejects(readFile(resolve(directory, '.deps/deployed-00D000000000001AAA.json')), { code: 'ENOENT' });
    const forcedRetry = await setup();
    assert.equal(forcedRetry.exitCode, 0, forcedRetry.output);
    assert.deepEqual(depNames(forcedRetry.calls), ['fflib-apex-mocks', 'fflib-apex-common', 'force-di', 'at4dx'],
      'Failed forced deployment must invalidate the existing cache so normal setup retries every dependency');
    const afterRetry = await setup();
    assert.equal(afterRetry.exitCode, 0, afterRetry.output);
    assert.deepEqual(depNames(afterRetry.calls), [], 'Successful retry must restore the cache');
    const changedOrg = { ORG_ID: '00D000000000002AAA' };
    assert.equal((await setup([], { ...changedOrg, FAIL_DEPLOY: '1' })).exitCode, 1);
    const retry = await setup([], changedOrg);
    assert.equal(retry.exitCode, 0, retry.output);
    assert.equal(depNames(retry.calls).length, 4, 'Partial deployment must not populate cache');
    const pinsPath = resolve(directory, 'config/dependencies.json');
    const pins = JSON.parse(await readFile(pinsPath, 'utf8')); pins[0].ref = 'a'.repeat(40);
    await writeFile(pinsPath, JSON.stringify(pins));
    assert.equal(depNames((await setup()).calls).length, 4, 'Changed pins must redeploy');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
