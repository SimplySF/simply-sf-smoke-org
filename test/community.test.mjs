// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildCommunityTests, parseCommunityArgs, root } from '../scripts/run-community-smoke.mjs';
import { setupCommunity, siteName, templateName } from '../scripts/setup-community.mjs';
import { run, runSuite } from '../scripts/lib/smoke.mjs';

const deployment = { success: true, status: 'Succeeded' };
const network = { Id: '0DM000000000001', Status: 'Live' };
const response = (result, status = 0, warnings = []) => {
  const stdout = JSON.stringify({ status, result, warnings });
  return { exitCode: status, stdout, output: stdout };
};

test('community parser supports org, filtering and setup flags, rejecting invalid arguments', () => {
  const options = parseCommunityArgs(['-o', 'scratch', '--skip-setup', '--only', '^04']);
  assert.equal(options.targetOrg, 'scratch');
  assert.equal(options.skipSetup, true);
  assert.ok(options.only.test('04 unknown site rejected'));
  for (const args of [['-o'], ['--only'], ['--unknown'], ['--apx-parity'], ['--redeploy-deps']]) {
    assert.throws(() => parseCommunityArgs(args));
  }
});

test('setup reuses an existing network without creating or listing templates', async () => {
  const calls = [];
  assert.deepEqual(await setupCommunity('scratch', { log: () => {}, json: async (args) => {
    calls.push(args);
    return args[0] === 'project' ? deployment : { records: [network] };
  } }), network);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 3), ['project', 'deploy', 'start']);
  assert.equal(calls[1][0], 'data');
  assert.ok(calls[0].includes(resolve(root, 'sfdx-source/community')));
  assert.ok(calls[0].includes('--ignore-conflicts'));
  assert.ok(calls[0].includes('scratch'));
});

test('setup validates template, creates once and polls with progress until network exists', async () => {
  const calls = [], logs = [];
  let queries = 0, clock = 0;
  const result = await setupCommunity('scratch', { log: (line) => logs.push(line),
    now: () => clock, pause: async (ms) => { clock += ms; }, json: async (args) => {
      calls.push(args);
      if (args[0] === 'project') return deployment;
      if (args[0] === 'data') return { records: ++queries === 3 ? [network] : [] };
      if (args[1] === 'list') return { templates: [{ templateName }] };
      return { jobId: 'job' };
    } });
  assert.deepEqual(result, network);
  assert.equal(calls.filter((args) => args[1] === 'create').length, 1);
  const create = calls.find((args) => args[1] === 'create');
  for (const value of ['scratch', siteName, templateName, 'ssosmoke']) assert.ok(create.includes(value));
  assert.ok(logs.some((line) => line.includes('Waiting')));
});

test('setup fails closed on auth, malformed queries, unavailable template and creation errors', async () => {
  await assert.rejects(setupCommunity('scratch', { json: async () => { throw new Error('Expired auth'); } }), /Expired auth/);
  for (const result of [{}, { records: [{}] }, { records: [network, network] }]) {
    await assert.rejects(setupCommunity('scratch', { json: async (args) => args[0] === 'project' ? deployment : result }));
  }
  await assert.rejects(setupCommunity('scratch', { json: async (args) =>
    args[0] === 'project' ? deployment : args[0] === 'data' ? { records: [] } : { templates: [] } }), /template unavailable/);
  await assert.rejects(setupCommunity('scratch', { log: () => {}, json: async (args) => {
    if (args[0] === 'project') return deployment;
    if (args[0] === 'data') return { records: [] };
    if (args[1] === 'list') return [{ templateName }];
    throw new Error('Creation failed');
  } }), /Creation failed/);
});

test('setup stops polling at its deadline without repeatedly creating the site', async () => {
  let clock = 0, creates = 0;
  await assert.rejects(setupCommunity('scratch', { log: () => {}, timeoutMs: 30, intervalMs: 10,
    now: () => clock, pause: async (ms) => { clock += ms; }, json: async (args) => {
      if (args[0] === 'project') return deployment;
      if (args[0] === 'data') return { records: [] };
      if (args[1] === 'list') return [{ templateName }];
      creates++;
      return {};
    } }), /Timed out waiting for Network/);
  assert.equal(clock, 30);
  assert.equal(creates, 1);
});

test('coverage records all six publish cases, exclusions, target and per-case timeout', async () => {
  const outline = await readFile(resolve(root, 'smoke/community-commands.md'), 'utf8');
  assert.ok(outline.includes('`simply community publish`'));
  assert.ok(outline.includes('`simply community url set`'));
  assert.match(outline, /custom domain/);
  const calls = [];
  const cases = buildCommunityTests({ targetOrg: 'scratch', runner: async (...args) => calls.push(args) });
  assert.equal(cases.length, 6);
  assert.equal(cases.filter((t) => t.expectedExitCode === 1).length, 1);
  assert.deepEqual(cases.at(-1).expectedExitCode, [0, 1]);
  for (const t of cases) {
    assert.ok(outline.includes(t.name));
    await t.execute();
    assert.deepEqual(t.cmd[1].slice(0, 3), ['simply', 'community', 'publish']);
    assert.ok(t.cmd[1].includes('--json'));
    assert.ok(t.cmd[1].includes('scratch'));
  }
  assert.ok(calls.every((call) => call[2].timeoutMs > 20 * 60_000));
  assert.ok(cases[2].cmd[1].includes('--retry-attempts'));
  assert.deepEqual(cases.at(-1).cmd[1].slice(-2), ['--wait', '0']);
});

test('publish proof rejects false success and ignored errors require the warning', () => {
  const cases = buildCommunityTests();
  const good = { success: true, name: siteName, id: network.Id, url: 'https://example.test' };
  assert.equal(cases[0].check(response(good)), true);
  for (const changed of [{ success: false }, { name: 'Other' }, { id: undefined }, { url: undefined }]) {
    assert.throws(() => cases[0].check(response({ ...good, ...changed })));
  }
  assert.throws(() => cases[0].check(response(good, 1)));
  const ignored = { success: false, name: 'No Such Site', error: 'No record found for No Such Site' };
  assert.throws(() => cases[4].check(response(ignored)), /warning/);
  assert.equal(cases[4].check(response(ignored, 0,
    ['Failed to publish community "No Such Site": No record found for No Such Site'])), true);
});

test('failure regex mutation fails the real harness report and exit contract', async () => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'sso-community-'));
  try {
    const original = buildCommunityTests()[3];
    original.execute = async () => ({ exitCode: 1, output: 'No record found for No Such Site' });
    for (const mutated of [false, true]) {
      const result = await runSuite({ suiteName: 'community', cwd: workspace, log: () => {}, setExitCode: false,
        tests: [{ ...original, expectedOutput: mutated ? /this cannot match/ : original.expectedOutput }] });
      assert.equal(result.counts.fail, mutated ? 1 : 0);
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('command timeout terminates a stalled child and cannot pass as expected failure', async () => {
  const execution = await run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 });
  assert.notEqual(execution.exitCode, 0);
  assert.notEqual(execution.exitCode, 1);
});

test('settings enable existing orgs before Network queries and failed deploys abort setup', async () => {
  for (const [name, setting] of [['Communities', 'enableNetworksEnabled'],
    ['ExperienceBundle', 'enableExperienceBundleMetadata']]) {
    const xml = await readFile(resolve(root,
      `sfdx-source/community/main/default/settings/${name}.settings-meta.xml`), 'utf8');
    assert.ok(xml.includes(`<${setting}>true</${setting}>`));
  }
  for (const result of [{ success: false, status: 'Failed' }, { success: true, status: 'Pending' }, {}]) {
    const calls = [];
    await assert.rejects(setupCommunity('scratch', { log: () => {}, json: async (args) => {
      calls.push(args);
      return result;
    } }), /settings deploy failed/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'project');
  }
});


test('zero wait accepts only terminal success or the publish timeout through the harness', async () => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'sso-community-wait-'));
  try {
    const good = { success: true, name: siteName, id: network.Id, url: 'https://example.test' };
    const timeout = JSON.stringify({ status: 1, name: 'CommunityPublishTimeoutError' });
    const scenarios = [
      [response(good), true],
      [{ exitCode: 1, stdout: timeout, output: timeout }, true],
      [response({ ...good, success: false }), false],
      [response({ ...good, name: 'Other' }), false],
      [response({ ...good, id: undefined }), false],
      [response({ ...good, url: undefined }), false],
      [response(good, 1), false],
      [{ exitCode: 1, output: 'CommunityPublishTimeoutError' }, false],
      [{ exitCode: 1, output: JSON.stringify({ status: 1, name: 'AuthError', message: 'CommunityPublishTimeoutError' }) }, false],
      [{ exitCode: 0, output: timeout }, false],
      [{ exitCode: null, output: timeout }, false],
      [{ exitCode: 2, output: timeout }, false],
    ];
    for (const [execution, passes] of scenarios) {
      const zeroWait = buildCommunityTests({ runner: async () => execution }).at(-1);
      const report = await runSuite({ suiteName: 'community', cwd: workspace, log: () => {},
        setExitCode: false, tests: [zeroWait] });
      assert.equal(report.counts.pass, passes ? 1 : 0, JSON.stringify(execution));
      assert.equal(report.results[0].exitCode, execution.exitCode);
      assert.deepEqual(report.results[0].expectedExitCode, [0, 1]);
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
