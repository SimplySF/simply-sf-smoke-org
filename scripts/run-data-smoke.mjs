// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, sfJson, soql, runSuite } from './lib/smoke.mjs';
import { root, parseSuiteArgs, linkedPlugin, command } from './lib/apex-flow.mjs';
import { parentObject, workspaceFor, resetWorkspace, setupDataSobject, cleanupDocuments,
  suiteCase, readCsv, writeCsv, outputPath, checkedResult } from './lib/data-sobject.mjs';

export const uploads = [
  ['sso-one.txt', 'SSO_Data_Batch_One'], ['sso-two.txt', 'SSO_Data_Batch_Two'], ['sso-binary.bin', 'SSO_Data_Batch_Binary'],
];
const sourcePath = (name) => resolve(root, 'fixtures/data', name);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function checkDownloads(workspace, expected = uploads) {
  const { records } = await readCsv(resolve(workspace, 'download/success.csv'));
  assert.equal((await readCsv(resolve(workspace, 'download/error.csv'))).records.length, 0);
  assert.deepEqual(records.map((r) => r.Title).sort(), expected.map((r) => r[1]).sort());
  for (const [file, title] of expected) {
    const row = records.find((r) => r.Title === title);
    const actual = await readFile(outputPath(workspace, row.FilePath));
    const source = await readFile(sourcePath(file));
    assert.equal(Number(row.ContentSize), source.length);
    assert.equal(digest(actual), digest(source));
  }
  return true;
}
export function buildDataTests({ targetOrg = 'simply-smoke-org', workspace = workspaceFor('data'),
  runner = run, query = soql, json = sfJson, clean = cleanupDocuments } = {}) {
  const make = suiteCase('data', targetOrg, workspace, runner);
  const prepare = async () => { await clean(targetOrg, { query, json }); await resetWorkspace(workspace); };
  const parentId = async () => {
    const rows = await query(targetOrg, `SELECT Id FROM ${parentObject} WHERE Name = 'SSO Parent 0'`);
    assert.equal(rows.length, 1); return rows[0].Id;
  };
  const batchCsv = resolve(workspace, 'upload.csv');
  const prepareBatch = async () => {
    await prepare(); const id = await parentId();
    await writeCsv(batchCsv, ['PathOnClient', 'Title', 'FirstPublishLocationId'], uploads.map(([file, title]) => [sourcePath(file), title, id]));
  };
  const runBatch = async () => {
    await prepareBatch();
    const execution = await runner(...command('data', 'files upload', targetOrg, ['--file-path', batchCsv]), { cwd: workspace });
    checkedResult(execution);
    assert.equal((await readCsv(resolve(workspace, 'upload/success.csv'))).records.length, 3);
    assert.equal((await readCsv(resolve(workspace, 'upload/error.csv'))).records.length, 0);
  };
  const checkVersion = async (execution, title, linked) => {
    const result = checkedResult(execution);
    const rows = await query(targetOrg, `SELECT Id, ContentDocumentId, Title, PathOnClient, ContentSize FROM ContentVersion WHERE Title = '${title}' AND IsLatest = true`);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.Id, result.Id); assert.equal(row.ContentDocumentId, result.ContentDocumentId);
    assert.equal(row.PathOnClient, 'sso-one.txt');
    assert.equal(row.ContentSize, (await readFile(sourcePath('sso-one.txt'))).length);
    if (linked) {
      const links = await query(targetOrg, `SELECT Id FROM ContentDocumentLink WHERE ContentDocumentId = '${row.ContentDocumentId}' AND LinkedEntityId = '${await parentId()}'`);
      assert.equal(links.length, 1);
    }
    return true;
  };
  const singleFlags = ['--file-path', sourcePath('sso-one.txt'), '--title', 'SSO_Data_One'];
  const linked = make('02 file upload links a seeded parent', 'file upload', [], (e) => checkVersion(e, 'SSO_Data_Linked', true));
  linked.execute = async () => {
    await prepare();
    linked.cmd = command('data', 'file upload', targetOrg, ['--file-path', sourcePath('sso-one.txt'), '--title', 'SSO_Data_Linked', '--first-publish-location-id', await parentId()]);
    return runner(...linked.cmd, { cwd: workspace });
  };
  return [
    make('01 file upload preserves basename and bytes', 'file upload', singleFlags, (e) => checkVersion(e, 'SSO_Data_One'), { before: prepare }),
    linked,
    make('03 files upload writes three successes and correct sizes', 'files upload', ['--file-path', batchCsv, '--max-parallel-jobs', '2'], async (e) => {
      checkedResult(e);
      const successes = (await readCsv(resolve(workspace, 'upload/success.csv'))).records;
      assert.deepEqual(successes.map((r) => r.Title).sort(), uploads.map((r) => r[1]).sort());
      assert.equal((await readCsv(resolve(workspace, 'upload/error.csv'))).records.length, 0);
      const versions = await query(targetOrg, "SELECT ContentDocumentId, Title, ContentSize, PathOnClient FROM ContentVersion WHERE Title LIKE 'SSO_Data_Batch_%' AND IsLatest = true");
      assert.equal(versions.length, 3);
      for (const [file, title] of uploads) {
        const row = versions.find((r) => r.Title === title); assert.ok(row);
        assert.equal(row.ContentSize, (await readFile(sourcePath(file))).length);
        assert.equal(row.PathOnClient, basename(file));
        assert.equal(successes.find((r) => r.Title === title).ContentDocumentId, row.ContentDocumentId);
      }
      return true;
    }, { before: prepareBatch }),
    make('04 files download hash matches all uploads', 'files download', ['--where-content-version', "Title LIKE 'SSO_Data_Batch_%' AND IsLatest = true", '--max-parallel-jobs', '2'], async (e) => {
      checkedResult(e); return checkDownloads(workspace);
    }, { before: runBatch }),
    make('05 files upload records a missing file per row with exit zero', 'files upload', ['--file-path', batchCsv], async (e) => {
      checkedResult(e);
      const errors = (await readCsv(resolve(workspace, 'upload/error.csv'))).records;
      assert.equal(errors.length, 1); assert.match(errors[0].Error, /ENOENT/);
      assert.equal(errors[0].Title, 'SSO_Data_Missing');
      assert.equal((await readCsv(resolve(workspace, 'upload/success.csv'))).records.length, 0);
      assert.equal((await query(targetOrg, "SELECT Id FROM ContentVersion WHERE Title = 'SSO_Data_Missing'")).length, 0);
      return true;
    }, { before: async () => { await prepare(); await writeCsv(batchCsv, ['PathOnClient', 'Title'], [[resolve(workspace, 'absent.txt'), 'SSO_Data_Missing']]); } }),
    make('06 file upload rejects missing local file', 'file upload', ['--file-path', resolve(workspace, 'absent.txt')], () => true,
      { before: prepare, expectedExitCode: 1, expectedOutput: /ENOENT/ }),
    make('07 files upload rejects missing CSV', 'files upload', ['--file-path', resolve(workspace, 'absent.csv')], () => true,
      { before: prepare, expectedExitCode: 1, expectedOutput: /ENOENT/ }),
    make('08 files download rejects invalid where clause', 'files download', ['--where-content-version', 'Nope__c = true'], () => true,
      { before: prepare, expectedExitCode: 1, expectedOutput: /INVALID_FIELD|Nope__c/i }),
    make('09 files upload refuses a computed one percent API budget', 'files upload', ['--file-path', batchCsv, '--max-api-usage', '1'], async () => {
      assert.equal((await query(targetOrg, "SELECT Id FROM ContentVersion WHERE Title = 'SSO_Data_Budget'")).length, 0); return true;
    }, { expectedExitCode: 1, expectedOutput: /ApiBudgetExceededError|This run needs .* API requests but/,
      before: async () => {
        await prepare();
        const limits = await json(['org', 'list', 'limits', '-o', targetOrg]);
        const daily = limits.find((l) => l.name === 'DailyApiRequests');
        assert.ok(Number.isFinite(daily?.max) && daily.max > 0, 'Daily API maximum required for deterministic budget refusal');
        const count = Math.ceil(daily.max / 200) + 2;
        await writeCsv(batchCsv, ['PathOnClient', 'Title'], Array.from({ length: count }, () => [sourcePath('sso-one.txt'), 'SSO_Data_Budget']));
      } }),
  ];
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseSuiteArgs(argv); const workspace = workspaceFor('data');
  let plugin, ready = false;
  return runSuite({ suiteName: 'data', cwd: root, ...options, plugin: () => plugin,
    preflight: async () => { plugin = await linkedPlugin('data'); ready = true; await resetWorkspace(workspace); },
    setup: () => setupDataSobject(options.targetOrg), tests: buildDataTests(options),
    cleanup: async () => { try { if (ready) await cleanupDocuments(options.targetOrg); }
      finally { await rm(workspace, { recursive: true, force: true }); await rm(workspaceFor('data-sobject'), { recursive: true, force: true }); } },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
