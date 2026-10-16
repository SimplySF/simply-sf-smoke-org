// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildApexTests, prepareTraceCleanup, frameworkClasses, checkSuiteMembers, setupApex } from '../scripts/run-apex-smoke.mjs';
import { buildFlowTests, rebuildFlow, checkThreeVersions, checkPrune, checkDelete } from '../scripts/run-flow-smoke.mjs';
import { parseSuiteArgs, root } from '../scripts/lib/apex-flow.mjs';
import { runSuite } from '../scripts/lib/smoke.mjs';

const versions = [1, 2, 3].map((v) => ({ Id: `301${v}`, VersionNumber: v, Status: v < 3 ? 'Obsolete' : 'Active' }));
const context = { userId: '005Seed', adminId: '005Admin', username: 'seed@example.com', startedAt: '2026-10-16T00:00:00Z',
  classIds: Object.fromEntries(['SSO_ApexNoisy', 'SSO_ApexNoisyTest', ...frameworkClasses].map((n, i) => [n, `01p${i}`])) };
const response = (result, exitCode = 0) => { const stdout = JSON.stringify({ status: exitCode, result }); return { exitCode, stdout, output: stdout }; };
const prune = { dryRun: false, candidates: versions.slice(0, 2).map((v) => ({ id: v.Id, developerName: 'SSO_Flow_Prune' })),
  deleted: ['SSO_Flow_Prune', 'SSO_Flow_Prune'], failures: [] };
const deletion = { deactivated: ['SSO_Flow_Delete'], deleted: Array(3).fill('SSO_Flow_Delete'), failures: [] };

test('flags accept harness selection and reject unrelated suite flags', () => {
  assert.equal(parseSuiteArgs(['-o', 'scratch', '--skip-setup', '--only', '^01']).targetOrg, 'scratch');
  for (const argv of [['-o'], ['--offline'], ['--apx-parity'], ['--redeploy-deps']]) assert.throws(() => parseSuiteArgs(argv));
});

test('Flow proofs require exact candidate IDs, statuses, deleted version counts and unchanged active version', () => {
  assert.equal(checkThreeVersions(versions), true);
  assert.equal(checkPrune(prune, versions, versions.slice(2), false), true);
  assert.equal(checkPrune({ ...prune, dryRun: true, deleted: [] }, versions, versions, true), true);
  assert.equal(checkDelete(deletion, []), true);
  assert.throws(() => checkThreeVersions(versions.map((v) => ({ ...v, Status: 'Draft' }))));
  assert.throws(() => checkThreeVersions(versions.slice(1)));
  for (const result of [{ ...prune, deleted: ['SSO_Flow_Prune'] }, { ...prune, candidates: [] },
    { ...prune, candidates: prune.candidates.map((c) => ({ ...c, id: 'wrong' })) }, { ...prune, failures: ['failed'] }]) {
    assert.throws(() => checkPrune(result, versions, versions.slice(2), false));
  }
  assert.throws(() => checkPrune(prune, versions, [{ ...versions[2], Id: 'replaced' }], false));
  assert.throws(() => checkDelete({ ...deletion, deleted: ['SSO_Flow_Delete'] }, []));
  assert.throws(() => checkDelete(deletion, versions));
});

test('rebuild deletes leftovers, deploys three changed active versions and refuses foreign flows', async () => {
  const calls = [], contents = [];
  let queries = 0;
  const deps = { json: async (args) => { calls.push(args); return { failures: [] }; },
    query: async () => ++queries === 1 ? [] : versions,
    deploy: async (org, directory) => { contents.push(await readFile(resolve(directory, 'SSO_Flow_Prune.flow-meta.xml'), 'utf8')); } };
  assert.deepEqual(await rebuildFlow('scratch', 'SSO_Flow_Prune', deps), versions);
  assert.ok(calls[0].includes('delete')); assert.ok(calls[0].includes('SSO_Flow_Prune'));
  assert.equal(new Set(contents).size, 3);
  for (const content of contents) assert.match(content, /<status>Active<\/status>/);
  await assert.rejects(rebuildFlow('scratch', 'ForeignFlow', deps), /Refusing/);
  await assert.rejects(rebuildFlow('scratch', 'SSO_Flow_Prune', { ...deps, json: async () => ({ failures: ['error'] }) }));
  await assert.rejects(rebuildFlow('scratch', 'SSO_Flow_Prune', { ...deps, query: async () => versions }), /deep-equal/);
});

test('source-dir prune rebuilds and scans only the prune fixture', async () => {
  let rebuilt, args;
  const cases = buildFlowTests({ rebuild: async (org, name) => { rebuilt = name; return versions; },
    runner: async (file, flags) => { args = flags; return response(prune); }, query: async () => versions.slice(2) });
  const source = cases.find((t) => t.name.startsWith('20'));
  assert.equal(await source.check(await source.execute()), true);
  assert.equal(rebuilt, 'SSO_Flow_Prune');
  assert.ok(args.includes('--source-dir'));
  const path = args[args.indexOf('--source-dir') + 1];
  await assert.rejects(readFile(resolve(path, 'SSO_Flow_Delete.flow-meta.xml')), /ENOENT/);
});

test('mixed delete ignores the missing name and proves all real versions were deleted', async () => {
  let rebuilt, args, remaining = [];
  const mixed = buildFlowTests({ rebuild: async (org, name) => { rebuilt = name; return versions; },
    runner: async (file, flags) => { args = flags; return response(deletion); }, query: async () => remaining,
  }).find((t) => t.name.startsWith('24'));
  assert.equal(mixed.expectedExitCode, 0);
  assert.equal(await mixed.check(await mixed.execute()), true);
  assert.equal(rebuilt, 'SSO_Flow_Delete');
  assert.deepEqual(args.slice(args.indexOf('--flow-name'), -1), ['--flow-name', 'SSO_Flow_Delete', '--flow-name', 'SSO_Does_Not_Exist']);
  for (const result of [{ ...deletion, failures: [{ developerName: 'SSO_Does_Not_Exist' }] },
    { ...deletion, deleted: [...deletion.deleted, 'SSO_Does_Not_Exist'] },
    { ...deletion, deactivated: [...deletion.deactivated, 'SSO_Does_Not_Exist'] }]) {
    await assert.rejects(mixed.check(response(result)));
  }
  await assert.rejects(mixed.check(response(deletion, 1)));
  remaining = versions;
  await assert.rejects(mixed.check(response(deletion)));
});

test('TraceFlag cleanup removes partial side effects, restores baseline and removes only unreferenced new levels', async () => {
  const baseline = { Id: '7tfOld', TracedEntityId: '005Admin', LogType: 'DEVELOPER_LOG', DebugLevelId: '7dlOld', StartDate: '2099-01-01T00:00:00Z', ExpirationDate: '2099-01-02T00:00:00Z' };
  let flags = [{ ...baseline }], levels = [{ Id: '7dlOld' }];
  const actions = [];
  const deps = { query: async (org, q) => q.includes('FROM DebugLevel') ? [...levels] : q.includes('WHERE DebugLevelId') ? [] : flags.map((f) => ({ ...f })),
    json: async (args) => {
      actions.push(args);
      const id = args[args.indexOf('--record-id') + 1];
      if (args.includes('TraceFlag') && args.includes('delete')) flags = flags.filter((f) => f.Id !== id);
      if (args.includes('update')) flags = flags.map((f) => f.Id === id ? { ...baseline } : f);
      if (args.includes('DebugLevel')) levels = levels.filter((l) => l.Id !== id);
      return {};
    } };
  const cleanup = await prepareTraceCleanup('scratch', ['005Admin', '01pSmoke'], deps);
  flags[0].DebugLevelId = '7dlNew';
  flags.push({ Id: '7tfNew', TracedEntityId: '01pSmoke' }); levels.push({ Id: '7dlNew' });
  const result = await cleanup();
  assert.deepEqual(flags, [baseline]); assert.deepEqual(levels, [{ Id: '7dlOld' }]);
  assert.deepEqual(result.deletedTraceFlagIds, ['7tfNew']);
  assert.deepEqual(result.restoredTraceFlagIds, ['7tfOld']);
  assert.ok(actions.every((args) => args.includes('--use-tooling-api')));
  const update = actions.find((args) => args.includes('update'));
  assert.equal(update.at(-1), `DebugLevelId=${baseline.DebugLevelId} StartDate=${baseline.StartDate} ExpirationDate=${baseline.ExpirationDate}`);
});

test('cleanup restores expired and expiring flags with a short future window and releases new debug levels', async () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  for (const expiration of ['2017-01-01T00:00:00Z', new Date(now + 60_000).toISOString()]) {
    const baseline = { Id: '7tfOld', TracedEntityId: '005Admin', LogType: 'DEVELOPER_LOG',
      DebugLevelId: '7dlOld', StartDate: '2017-01-01T00:00:00Z', ExpirationDate: expiration };
    let flag = { ...baseline }, levels = [{ Id: '7dlOld' }];
    const cleanup = await prepareTraceCleanup('scratch', ['005Admin'], {
      now: () => now,
      query: async (org, q) => q.includes('FROM DebugLevel') ? [...levels] :
        q.includes('WHERE DebugLevelId') ? (flag.DebugLevelId === '7dlNew' ? [flag] : []) : [{ ...flag }],
      json: async (args) => {
        if (args.includes('update')) {
          const values = Object.fromEntries(args.at(-1).split(' ').map((value) => value.split('=')));
          assert.equal(values.DebugLevelId, baseline.DebugLevelId);
          assert.equal(Date.parse(values.StartDate), now);
          assert.equal(Date.parse(values.ExpirationDate), now + 120_000);
          flag = { ...flag, ...values };
        } else if (args.includes('DebugLevel')) levels = levels.filter((level) => level.Id !== args.at(-1));
      },
    });
    flag.DebugLevelId = '7dlNew'; levels.push({ Id: '7dlNew' });
    assert.deepEqual((await cleanup()).deletedDebugLevelIds, ['7dlNew']);
    assert.deepEqual(levels, [{ Id: '7dlOld' }]);
  }
});

test('cleanup keeps attempting other records after a deletion failure and reports failure', async () => {
  let snapshot = true;
  const deleted = [];
  const cleanup = await prepareTraceCleanup('scratch', ['005Admin'], {
    query: async (org, q) => q.includes('FROM DebugLevel') ? [] : snapshot ? [] : [{ Id: 'fail' }, { Id: 'other' }],
    json: async (args) => { const id = args.at(-1); deleted.push(id); if (id === 'fail') throw new Error('delete rejected'); },
  });
  snapshot = false;
  await assert.rejects(cleanup(), /delete rejected/);
  assert.deepEqual(deleted, ['fail', 'other']);
});

test('cleanup rejects changed identity fields and active dates, and aggregates restoration errors', async () => {
  const baseline = { Id: '7tfOld', TracedEntityId: '005Admin', LogType: 'DEVELOPER_LOG',
    DebugLevelId: '7dlOld', StartDate: '2026-10-16T00:00:00Z', ExpirationDate: '2099-01-02T00:00:00Z' };
  for (const field of ['DebugLevelId', 'TracedEntityId', 'LogType', 'StartDate', 'ExpirationDate']) {
    let flag = { ...baseline };
    const cleanup = await prepareTraceCleanup('scratch', ['005Admin'], {
      query: async (org, q) => q.includes('FROM DebugLevel') ? [] : [{ ...flag }],
      json: async () => { flag[field] = 'wrong'; },
    });
    await assert.rejects(cleanup(), /did not restore baseline/);
  }
  const attempted = [];
  const cleanup = await prepareTraceCleanup('scratch', ['005Admin'], {
    query: async (org, q) => q.includes('FROM DebugLevel') ? [] : [baseline, { ...baseline, Id: '7tfOther' }],
    json: async (args) => { const id = args[args.indexOf('--record-id') + 1]; attempted.push(id); throw new Error(`restore rejected ${id}`); },
  });
  await assert.rejects(cleanup(), (error) => error instanceof AggregateError && error.errors.length === 2 &&
    error.message.includes('7tfOld') && error.message.includes('7tfOther'));
  assert.deepEqual(attempted, ['7tfOld', '7tfOther']);
});

test('harness cleanup runs on failed checks, setup and discovery, reports cleanup failure and rejects empty selection', async () => {
  const cwd = await mkdtemp(resolve(tmpdir(), 'sso-cleanup-'));
  try {
    for (const stage of ['check', 'setup', 'discovery', 'cleanup', 'empty']) {
      let cleaned = false;
      const bad = () => { throw new Error(`${stage} error`); };
      const report = await runSuite({ cwd, suiteName: 'cleanup-proof', setExitCode: false, log: () => {},
        setup: stage === 'setup' ? bad : undefined,
        tests: stage === 'discovery' ? async function* () { bad(); } : stage === 'empty' ? [] :
          [{ name: 'case', expectedExitCode: 0, execute: async () => response({}), check: stage === 'check' ? bad : () => true }],
        cleanup: async () => { cleaned = true; if (stage === 'cleanup') bad(); return { deleted: ['flag'] }; },
      });
      assert.equal(cleaned, true); assert.equal(report.counts.fail, 1, stage);
      assert.equal(report.results.at(-1).status, stage === 'cleanup' ? 'FAIL' : 'PASS');
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('generator proof rejects missing leading-comment test (annotation mutation) and stale output is removed', async () => {
  const members = ['SSO_ApexLeadingComment', 'SSO_ApexNoisyTest'];
  const xml = members.map((n) => `<testClassName>${n}</testClassName>`).join('');
  assert.equal(checkSuiteMembers(xml, members), true);
  assert.throws(() => checkSuiteMembers(xml.replace('<testClassName>SSO_ApexLeadingComment</testClassName>', ''), members.slice(1)));
  const path = resolve(root, 'generated/apex/testSuites/SSO_Smoke_Suite.testSuite-meta.xml');
  await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, xml);
  const test = buildApexTests({ context, runner: async () => {
    await assert.rejects(readFile(path), /ENOENT/); return response({ filePath: path, testClassNames: members });
  } }).find((t) => t.name.startsWith('15'));
  await test.execute();
  await assert.rejects(test.check(response({ filePath: path, testClassNames: members })), /ENOENT/);
});

test('purge refuses empty logs and scopes real deletion to snapshot IDs', async () => {
  let records = [], invoked = 0;
  let executionStartedAt;
  const cases = buildApexTests({ context, json: async (args) => { if (args.includes('execute')) executionStartedAt = Date.now(); return {}; }, query: async (org, q) => {
    if (q.includes('LogUserId')) {
      assert.ok(q.includes(`LogUserId = '${context.adminId}'`));
      assert.ok(q.includes("Operation = 'Api'"));
      const since = Date.parse(q.match(/StartTime >= (\S+)/)[1]);
      assert.ok(executionStartedAt - since >= 2_000 && executionStartedAt - since < 5_000);
    }
    return records;
  },
    runner: async (file, args) => { invoked++; assert.ok(args.includes("Id IN ('07Lsmoke')")); return response([{ Id: '07Lsmoke', Success: true }]); } });
  for (const t of cases.filter((t) => /^1[23] /.test(t.name))) {
    records = []; await assert.rejects(t.execute(), /nonempty/); assert.equal(invoked, 0);
    records = [{ Id: '07Lsmoke' }]; const execution = await t.execute();
    records = []; assert.equal(await t.check(execution), true);
    await assert.rejects(t.check(response([{ Id: '07Lforeign', Success: true }])));
    invoked = 0;
  }
});

test('deployment failure stops Apex seeding; each command has a pinned documented success and failure', async () => {
  let seeded = false;
  await assert.rejects(setupApex('scratch', { deploy: async () => { throw new Error('deploy failed'); }, json: async () => { seeded = true; } }), /deploy failed/);
  assert.equal(seeded, false);
  for (const [suite, cases, commands, count] of [
    ['apex', buildApexTests({ context }), ['execute', 'trace setup', 'trace silence', 'logs purge', 'test-suite generate'], 19],
    ['flow', buildFlowTests(), ['delete', 'version prune'], 8],
  ]) {
    assert.equal(cases.length, count);
    const doc = await readFile(resolve(root, `smoke/${suite}-commands.md`), 'utf8');
    for (const t of cases) { assert.ok(doc.includes(t.name), t.name); assert.ok(t.cmd[1].includes('--json')); }
    for (const verb of commands) {
      const matches = cases.filter((t) => t.cmd[1].join(' ').includes(`simply ${suite} ${verb} `));
      assert.ok(matches.some((t) => t.expectedExitCode === 0), verb);
      assert.ok(matches.some((t) => t.expectedExitCode > 0), verb);
    }
  }
  const conflicting = buildApexTests({ context }).find((t) => t.name.startsWith('11c'));
  assert.equal(conflicting.expectedExitCode, 2);
  assert.equal(buildFlowTests().find((t) => t.name.startsWith('21')).expectedExitCode, 1);
});
