// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildDataTests, checkDownloads, uploads } from '../scripts/run-data-smoke.mjs';
import { buildSobjectTests, checkDedupe, checkStatusHistory } from '../scripts/run-sobject-smoke.mjs';
import { parseCsv, writeCsv, readCsv, cleanupDocuments, setupDataSobject, fixtureSnapshot, outputPath, checkedResult, checkedVoid } from '../scripts/lib/data-sobject.mjs';
import { deploySource, root } from '../scripts/lib/apex-flow.mjs';

const response = (result = {}) => { const stdout = JSON.stringify({ status: 0, result }); return { exitCode: 0, stdout, output: stdout }; };
const parents = ['A', 'A', 'B', 'B', 'C', 'D'].map((key, i) => ({ Id: `p${i}`, Name: `SSO Parent ${i}`, SSO_Key__c: key }));
const children = Array.from({ length: 4 }, (_, i) => ({ Id: `c${i}`, SSO_Parent__c: `p${i}` }));
const snapshot = { parents, children };
const unique = [0, 2, 4, 5].map((i) => ({ Id: parents[i].Id, SSO_Key__c: parents[i].SSO_Key__c }));
const deleted = [1, 3].map((i) => ({ Id: parents[i].Id, SSO_Key__c: parents[i].SSO_Key__c }));
const modified = [{ Id: 'c1', SSO_Parent__c: 'p0' }, { Id: 'c3', SSO_Parent__c: 'p2' }];
const dedupeResult = { primaryObjectApiName: 'SSO_Data_Parent__c', totalRecords: 6, uniqueCount: 4, duplicateCount: 2, modifiedFiles: ['modified.csv'] };
const transitions = [0, 2].flatMap((i) => [['Initial', 'Changed'], ['Changed', 'Final']].map(([old, value]) =>
  ({ Id: `h${i}${old}`, ParentId: `p${i}`, Field: 'SSO_Status__c', OldValue: old, NewValue: value })));
const temp = () => mkdtemp(resolve(tmpdir(), 'sso-data-sobject-'));

test('successful commands require both process exit zero and JSON status zero', () => {
  assert.deepEqual(checkedResult(response({ ok: true })), { ok: true });
  assert.throws(() => checkedResult({ exitCode: 0, stdout: JSON.stringify({ status: 1, message: 'failed' }) }));
  assert.throws(() => checkedResult({ ...response(), exitCode: 1 }));
  assert.equal(checkedVoid({ exitCode: 0, stdout: '' }), true);
  assert.equal(checkedVoid(response()), true);
  assert.throws(() => checkedVoid({ exitCode: 1, stdout: '' }));
  assert.throws(() => checkedVoid({ exitCode: 0, stdout: JSON.stringify({ status: 1 }) }));
});

test('CSV round trips quotes, embedded newline, CRLF, BOM, binary-safe paths and empty reports', async () => {
  const workspace = await temp();
  try {
    const path = resolve(workspace, 'a.csv');
    await writeCsv(path, ['Id', 'Error'], [['1', 'a,"b"\nline'], ['2', '']]);
    assert.deepEqual((await readCsv(path)).records, [{ Id: '1', Error: 'a,"b"\nline' }, { Id: '2', Error: '' }]);
    assert.deepEqual(parseCsv('\uFEFFId,Error\r\n1,"comma,quote"\r\n').records, [{ Id: '1', Error: 'comma,quote' }]);
    assert.deepEqual(parseCsv('Id,Error\n').records, []);
    assert.throws(() => parseCsv('Id\n"unterminated'), /Unterminated/);
    assert.throws(() => parseCsv('Id\na,b\n'), /column count/);
    assert.throws(() => outputPath(workspace, '../outside.csv'), /outside/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('dedupe proof rejects third duplicate, wrong partitions, missing reparent rows and incorrect survivors', () => {
  assert.equal(checkDedupe(dedupeResult, unique, deleted, [...modified], snapshot, false), true);
  assert.equal(checkDedupe({ ...dedupeResult, modifiedFiles: [] }, unique, deleted, [], snapshot, true), true);
  assert.throws(() => checkDedupe({ ...dedupeResult, duplicateCount: 3 }, unique, deleted, modified, snapshot, false));
  assert.throws(() => checkDedupe(dedupeResult, unique.slice(1), [...deleted, unique[0]], modified, snapshot, false));
  assert.throws(() => checkDedupe(dedupeResult, unique, deleted, modified.slice(1), snapshot, false));
  assert.throws(() => checkDedupe(dedupeResult, unique, deleted, [{ ...modified[0], SSO_Parent__c: 'p2' }, modified[1]], snapshot, false));
  const mutated = { ...snapshot, parents: parents.map((p, i) => i === 5 ? { ...p, SSO_Key__c: 'A' } : p) };
  assert.throws(() => checkDedupe(dedupeResult, unique, deleted, modified, mutated, false));
});

test('history proof requires real four transitions with seeded parent IDs and old/new values', () => {
  assert.equal(checkStatusHistory(transitions, parents), true);
  const exported = transitions.map((r) => ({ FIELD_API_NAME: r.Field, PARENT_ID: r.ParentId, OLD_VALUE: r.OldValue, NEW_VALUE: r.NewValue }));
  assert.equal(checkStatusHistory(exported, parents, { exported: true }), true);
  for (const rows of [[], transitions.slice(1), transitions.map((r) => ({ ...r, OldValue: '' })), transitions.map((r) => ({ ...r, ParentId: 'foreign' }))]) {
    assert.throws(() => checkStatusHistory(rows, parents));
  }
});

test('download proof checks exact manifest, sizes and bytes including binary data', async () => {
  const workspace = await temp();
  try {
    await mkdir(resolve(workspace, 'download'));
    const records = [];
    for (const [file, title] of uploads) {
      await copyFile(resolve(root, 'fixtures/data', file), resolve(workspace, 'download', file));
      records.push([title, `download/${file}`, (await readFile(resolve(root, 'fixtures/data', file))).length]);
    }
    await writeCsv(resolve(workspace, 'download/success.csv'), ['Title', 'FilePath', 'ContentSize'], records);
    await writeCsv(resolve(workspace, 'download/error.csv'), ['Title', 'Error'], []);
    assert.equal(await checkDownloads(workspace), true);
    const binary = resolve(workspace, 'download/sso-binary.bin');
    const bytes = await readFile(binary); bytes[0] ^= 255; await writeFile(binary, bytes);
    await assert.rejects(checkDownloads(workspace));
    await copyFile(resolve(root, 'fixtures/data/sso-binary.bin'), binary);
    await writeCsv(resolve(workspace, 'download/success.csv'), ['Title', 'FilePath', 'ContentSize'], records.slice(1));
    await assert.rejects(checkDownloads(workspace));
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('setup deploys with ignore-conflicts and commits seed plus each history update separately; aborts failed deploy', async () => {
  const workspace = await temp();
  try {
    const calls = [], apex = [];
    await deploySource('shared', '/fixture', { json: async (args) => { calls.push(args); return { success: true }; } });
    assert.ok(calls[0].includes('--ignore-conflicts')); assert.equal(calls[0].at(-1), '15');
    let assigned = false;
    await setupDataSobject('shared', { workspace, deploy: async () => {}, assign: async () => { assigned = true; }, query: async () => [],
      json: async (args) => {
        assert.equal(args[0], 'apex');
        apex.push(await readFile(args.at(-1), 'utf8')); return { success: true };
      } });
    assert.equal(assigned, true); assert.equal(apex.length, 3);
    assert.match(apex[0], /insert parents/); assert.match(apex[1], /'Changed'/); assert.match(apex[2], /'Final'/);
    assert.ok(apex.slice(1).every((s) => s.includes('System.assertEquals(2, rows.size())')));
    let ran = false;
    await assert.rejects(setupDataSobject('shared', { workspace, deploy: async () => { throw new Error('deploy failed'); }, json: async () => { ran = true; } }), /deploy failed/);
    assert.equal(ran, false);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('document cleanup guards literal prefix, attempts all deletions and verifies absence', async () => {
  const docs = [{ Id: 'own1', Title: 'SSO_Data_One' }, { Id: 'other', Title: 'SSOxDataxOther' }, { Id: 'own2', Title: 'SSO_Data_Two' }];
  const deletedIds = []; let queryCount = 0;
  await cleanupDocuments('shared', { query: async () => ++queryCount === 1 ? docs : [], json: async (args) => { deletedIds.push(args.at(-1)); } });
  assert.deepEqual(deletedIds, ['own1', 'own2']);
  deletedIds.length = 0;
  await assert.rejects(cleanupDocuments('shared', { query: async () => docs, json: async (args) => { deletedIds.push(args.at(-1)); throw new Error('delete failed'); } }), /cleanup failed/);
  assert.deepEqual(deletedIds, ['own1', 'own2']);
  await assert.rejects(cleanupDocuments('shared', { query: async () => docs, json: async () => {} }), /documents remain/);
});

test('fixture seed mutation fails snapshot validation; dry-run proof detects changed org records', async () => {
  await assert.rejects(fixtureSnapshot('shared', async (org, q) => q.includes('FROM SSO_Data_Parent') ?
    parents.map((p, i) => i === 5 ? { ...p, SSO_Key__c: 'A' } : p) : children));
  const workspace = await temp();
  try {
    let changed = false;
    const config = { ...dedupeResult, modifiedFiles: [], uniqueFile: resolve(workspace, 'unique.csv'), deleteFile: resolve(workspace, 'delete.csv') };
    await writeCsv(config.uniqueFile, ['Id', 'SSO_Key__c'], unique.map((r) => [r.Id, r.SSO_Key__c]));
    await writeCsv(config.deleteFile, ['Id', 'SSO_Key__c'], deleted.map((r) => [r.Id, r.SSO_Key__c]));
    const t = buildSobjectTests({ workspace, runner: async () => { changed = true; return response(config); },
      query: async (org, q) => q.includes('FROM SSO_Data_Parent') ? parents : children.map((c) => changed ? { ...c, SSO_Parent__c: 'p0' } : c),
    }).find((t) => t.name.startsWith('04'));
    await assert.rejects(t.check(await t.execute()), /must not mutate/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('data download selection prepares its own uploads and budget refuses before files are sent', async () => {
  const workspace = await temp();
  try {
    const commands = [];
    const cases = buildDataTests({ workspace, clean: async () => {}, query: async () => [{ Id: 'p0' }],
      json: async () => [{ name: 'DailyApiRequests', max: 15000, remaining: 10000 }],
      runner: async (file, args) => {
        commands.push(args);
        if (args.includes('upload')) {
          const rows = (await readCsv(resolve(workspace, 'upload.csv'))).records;
          if (args.includes('--max-api-usage')) {
            assert.ok(rows.length * 2 > 15000 * .01);
            return { exitCode: 1, stdout: '{}', output: 'ApiBudgetExceededError' };
          }
          assert.equal(rows.length, 3); assert.ok(rows.every((r) => r.FirstPublishLocationId === 'p0'));
          await writeCsv(resolve(workspace, 'upload/success.csv'), ['Title'], uploads.map((r) => [r[1]]));
          await writeCsv(resolve(workspace, 'upload/error.csv'), ['Error'], []);
        }
        return response();
      } });
    await cases.find((t) => t.name.startsWith('04')).execute();
    assert.deepEqual(commands.map((c) => c.slice(2, 4).join(' ')), ['files upload', 'files download']);
    assert.ok(commands.every((c) => c.includes('--json')));
    const budget = cases.find((t) => t.name.startsWith('09'));
    assert.equal((await budget.execute()).exitCode, 1);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('each command has pinned documented success and expected failure using JSON and current flags', async () => {
  for (const [suite, cases, count, verbs] of [
    ['data', buildDataTests(), 9, ['file upload', 'files upload', 'files download']],
    ['sobject', buildSobjectTests(), 13, ['backup', 'deduplicate', 'history export', 'history query', 'history schema']],
  ]) {
    assert.equal(cases.length, count);
    const doc = await readFile(resolve(root, `smoke/${suite}-commands.md`), 'utf8');
    for (const t of cases) {
      assert.ok(doc.includes(t.name), t.name); assert.ok(t.cmd[1].includes('--json'));
      assert.ok(t.cmd[1].includes('--target-org'));
    }
    for (const verb of verbs) {
      const matches = cases.filter((t) => t.cmd[1].join(' ').includes(`simply ${suite} ${verb} `));
      assert.ok(matches.some((t) => t.expectedExitCode === 0), verb);
      assert.ok(matches.some((t) => t.expectedExitCode > 0), verb);
    }
  }
  assert.equal(buildDataTests().find((t) => t.name.startsWith('05')).expectedExitCode, 0);
  const schemaFailure = buildSobjectTests().find((t) => t.name.startsWith('13'));
  assert.ok(schemaFailure.expectedOutput.test('ENOTDIR'));
});
