// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertLinkedPlugin, envelopeFrom, expectedFailure, parseArgs, run, runSuite, sf, success } from './lib/smoke.mjs';
import { setupCommunity, siteName } from './setup-community.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function parseCommunityArgs(argv) {
  if (argv.some((arg) => ['--apx-parity', '--redeploy-deps'].includes(arg))) {
    throw new Error('Community suite accepts --target-org, --skip-setup and --only');
  }
  return parseArgs(argv);
}

export function buildCommunityTests({ targetOrg = 'simply-smoke-org', runner = run } = {}) {
  const command = (name, flags) => [sf, ['simply', 'community', 'publish', '--target-org', targetOrg,
    '--name', name, '--json', ...flags]];
  const checkSuccess = (execution) => {
    const envelope = envelopeFrom(execution.stdout ?? execution.output);
    assert.equal(envelope.status, 0);
    assert.equal(envelope.result.success, true);
    assert.equal(envelope.result.name, siteName);
    assert.ok(envelope.result.id, 'Missing published site id');
    assert.ok(envelope.result.url, 'Missing published site URL');
    return true;
  };
  const missing = 'No Such Site';
  const tests = [
    success('01 publish completes', checkSuccess, command(siteName, ['--wait', '20'])),
    success('02 unchanged site publishes again', checkSuccess, command(siteName, ['--wait', '20'])),
    success('03 retry flags accepted', checkSuccess, command(siteName,
      ['--wait', '20', '--retry-attempts', '2', '--retry-backoff', '1'])),
    expectedFailure('04 unknown site rejected', /No record found[^\n]*No Such Site/i, command(missing, [])),
    success('05 ignore lookup error with warning', (execution) => {
      const envelope = envelopeFrom(execution.stdout ?? execution.output);
      assert.equal(envelope.status, 0);
      assert.equal(envelope.result.success, false);
      assert.equal(envelope.result.name, missing);
      assert.match(envelope.result.error, /No record found.*No Such Site/i);
      assert.ok(envelope.warnings?.some((warning) =>
        /Failed to publish community "No Such Site".*No record found/i.test(warning)), 'Missing publish warning');
      return true;
    }, command(missing, ['--ignore-errors'])),
    { name: '06 zero wait completes or times out', expectedExitCode: [0, 1],
      cmd: command(siteName, ['--wait', '0']), check: (execution) => {
        if (execution.exitCode === 0) return checkSuccess(execution);
        const envelope = envelopeFrom(execution.stdout ?? execution.output);
        assert.equal(envelope.status, 1);
        assert.equal(envelope.name, 'CommunityPublishTimeoutError');
        return true;
      } },
  ];
  for (const test of tests) {
    test.execute = () => runner(...test.cmd, { cwd: root, timeoutMs: 25 * 60_000 });
  }
  return tests;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCommunityArgs(argv);
  let plugin;
  return runSuite({ suiteName: 'community', targetOrg: options.targetOrg, cwd: root,
    plugin: () => plugin, skipSetup: options.skipSetup, only: options.only,
    preflight: async () => {
      plugin = await assertLinkedPlugin('@simplysf/simply-community',
        resolve(process.env.SIMPLY_PLUGINS_DIR ?? resolve(root, '../simply-plugins'), 'packages/simply-community'));
    },
    setup: () => setupCommunity(options.targetOrg),
    tests: () => buildCommunityTests(options),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
