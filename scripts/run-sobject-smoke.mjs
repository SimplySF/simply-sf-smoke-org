// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, sfJson, soql, runSuite } from './lib/smoke.mjs';
import { root, parseSuiteArgs, linkedPlugin } from './lib/apex-flow.mjs';
import { parentObject, childObject, workspaceFor, resetWorkspace, setupDataSobject, cleanupDocuments,
  fixtureSnapshot, suiteCase, readCsv, outputPath, checkedResult } from './lib/data-sobject.mjs';

export function checkDedupe(result, unique, deleted, modified, snapshot, dryRun) {
  assert.equal(result.primaryObjectApiName, parentObject);
  assert.equal(result.totalRecords, 6); assert.equal(result.uniqueCount, 4); assert.equal(result.duplicateCount, 2);
  assert.equal(unique.length, 4); assert.equal(deleted.length, 2);
  const byId = new Map(snapshot.parents.map((p) => [p.Id, p]));
  assert.deepEqual([...unique, ...deleted].map((p) => p.Id).sort(), snapshot.parents.map((p) => p.Id).sort());
  assert.deepEqual(unique.map((p) => p.SSO_Key__c).sort(), ['A', 'B', 'C', 'D']);
  assert.deepEqual(deleted.map((p) => p.SSO_Key__c).sort(), ['A', 'B']);
  for (const row of [...unique, ...deleted]) assert.equal(row.SSO_Key__c, byId.get(row.Id)?.SSO_Key__c);
  const survivors = new Map(unique.map((p) => [p.SSO_Key__c, p.Id]));
  const expected = snapshot.children.filter((c) => c.SSO_Parent__c !== survivors.get(byId.get(c.SSO_Parent__c)?.SSO_Key__c))
    .map((c) => ({ Id: c.Id, SSO_Parent__c: survivors.get(byId.get(c.SSO_Parent__c)?.SSO_Key__c) }));
  if (dryRun) { assert.deepEqual(result.modifiedFiles, []); assert.deepEqual(modified, []); }
  else {
    assert.equal(result.modifiedFiles.length, 1);
    assert.deepEqual(modified.sort((a, b) => a.Id.localeCompare(b.Id)), expected.sort((a, b) => a.Id.localeCompare(b.Id)));
    assert.equal(modified.length, 2);
  }
  return true;
}
export function checkStatusHistory(rows, parents, { exported = false } = {}) {
  const statusRows = rows.filter((r) => (exported ? r.FIELD_API_NAME : r.Field) === 'SSO_Status__c');
  const expected = parents.filter((p) => ['SSO Parent 0', 'SSO Parent 2'].includes(p.Name))
    .flatMap((p) => [`${p.Id}:Initial:Changed`, `${p.Id}:Changed:Final`]).sort();
  assert.equal(expected.length, 4);
  const actual = statusRows.map((r) => exported ? `${r.PARENT_ID}:${r.OLD_VALUE}:${r.NEW_VALUE}` : `${r.ParentId}:${r.OldValue}:${r.NewValue}`).sort();
  assert.deepEqual(actual, expected, 'Expected four committed seeded status transitions');
  return true;
}
export function buildSobjectTests({ targetOrg = 'simply-smoke-org', workspace = workspaceFor('sobject'),
  runner = run, query = soql, json = sfJson, now = () => Date.now() } = {}) {
  const make = suiteCase('sobject', targetOrg, workspace, runner);
  const dir = (name) => resolve(workspace, name);
  const csv = async (path) => (await readCsv(outputPath(workspace, path))).records;
  const fixture = (file) => resolve(root, 'fixtures/sobject', file);
  const date = (offset) => new Date(now() + offset * 86400_000).toISOString().slice(0, 10);
  const dateFlags = ['--start-date', date(-1), '--end-date', date(1)];
  const history = () => query(targetOrg, `SELECT Id, ParentId, Field, OldValue, NewValue FROM SSO_Data_Parent__History WHERE Field = 'SSO_Status__c'`);
  const snapshot = () => fixtureSnapshot(targetOrg, query);
  let beforeDedupe;
  const dedupe = (dryRun) => make(dryRun ? '04 deduplicate dry run partitions seeded IDs' : '05 deduplicate prepares exact reparent CSV without mutations', 'deduplicate',
    ['--config', fixture('dedupe-parent.json'), '--output-dir', dir(dryRun ? 'dedupe-dry' : 'dedupe'), ...(dryRun ? ['--dry-run'] : [])], async (e) => {
      const r = checkedResult(e);
      const unique = await csv(r.uniqueFile), deleted = await csv(r.deleteFile);
      const modified = (await Promise.all(r.modifiedFiles.map(csv))).flat();
      checkDedupe(r, unique, deleted, modified, beforeDedupe, dryRun);
      assert.deepEqual(await snapshot(), beforeDedupe, 'Deduplicate must not mutate fixture records');
      return true;
    }, { before: async () => { beforeDedupe = await snapshot(); } });
  return [
    make('01 backup includes every described field and six seeded records', 'backup', ['--sobject', parentObject, '--output-dir', dir('backup')], async (e) => {
      const r = checkedResult(e); assert.equal(r.sobject, parentObject); assert.equal(r.recordCount, 6);
      const { headers, records } = await readCsv(outputPath(workspace, r.path));
      const describe = await json(['sobject', 'describe', '-o', targetOrg, '--sobject', parentObject]);
      for (const field of describe.fields) assert.ok(headers.includes(field.name), field.name);
      const seed = await snapshot(); assert.equal(records.length, 6);
      assert.deepEqual(records.map((p) => p.Id).sort(), seed.parents.map((p) => p.Id).sort());
      for (const p of seed.parents) {
        const row = records.find((r) => r.Id === p.Id);
        for (const field of ['Name', 'SSO_Key__c', 'SSO_Status__c']) assert.equal(row[field], p[field]);
        assert.equal(Number(row.SSO_Amount__c), p.SSO_Amount__c);
      }
      return true;
    }),
    make('02 backup expands parent name and explicit owner name', 'backup', ['--sobject', childObject, '--include-relationship-fields', '--additional-fields', 'Owner.Name', '--output-dir', dir('relationships')], async (e) => {
      const r = checkedResult(e); assert.equal(r.recordCount, 4);
      const { headers, records } = await readCsv(outputPath(workspace, r.path));
      assert.ok(headers.includes('SSO_Parent__r.Name')); assert.ok(headers.includes('Owner.Name'));
      const rows = await query(targetOrg, `SELECT Id, SSO_Parent__r.Name, Owner.Name FROM ${childObject}`);
      assert.equal(records.length, 4);
      assert.deepEqual(records.map((r) => r.Id).sort(), rows.map((r) => r.Id).sort());
      for (const row of rows) {
        const actual = records.find((r) => r.Id === row.Id);
        assert.equal(actual['SSO_Parent__r.Name'], row.SSO_Parent__r.Name);
        assert.equal(actual['Owner.Name'], row.Owner.Name);
      }
      return true;
    }),
    make('03 backup rejects unknown object', 'backup', ['--sobject', 'SSO_Nope__c', '--output-dir', dir('bad-backup')], () => true,
      { expectedExitCode: 1, expectedOutput: /NOT_FOUND|SSO_Nope__c|INVALID_TYPE/ }),
    dedupe(true), dedupe(false),
    make('06 deduplicate rejects unknown key field', 'deduplicate', ['--config', fixture('dedupe-invalid.json'), '--output-dir', dir('bad-dedupe')], () => true,
      { expectedExitCode: 1, expectedOutput: /Nope__c|INVALID_FIELD/ }),
    make('07 history export contains four seeded transitions', 'history export', ['--sobject', parentObject, ...dateFlags, '--output-dir', dir('history-export')], async (e) => {
      const r = checkedResult(e); assert.equal(r.historyObject, 'SSO_Data_Parent__History');
      const rows = await csv(r.path); assert.equal(rows.length, r.recordCount);
      return checkStatusHistory(rows, (await snapshot()).parents, { exported: true });
    }),
    make('08 history export empty past range writes zero rows', 'history export', ['--sobject', parentObject, '--start-date', '2000-01-01', '--end-date', '2000-01-02', '--output-dir', dir('history-empty')], async (e) => {
      const r = checkedResult(e); assert.equal(r.recordCount, 0); assert.deepEqual(await csv(r.path), []); return true;
    }),
    make('09 history export rejects malformed date', 'history export', ['--sobject', parentObject, '--start-date', 'yesterday', '--end-date', date(1), '--output-dir', dir('bad-export')], () => true,
      { expectedExitCode: 2, expectedOutput: /InvalidDateError|Invalid value for --start-date/ }),
    make('10 history query file filter returns only seeded status changes', 'history query', ['--object', parentObject, '--filters', fixture('history-filter.json'), '--output-dir', dir('history-query')], async (e) => {
      const r = checkedResult(e); const rows = await csv(r.path);
      assert.equal(r.historyObject, 'SSO_Data_Parent__History');
      assert.equal(r.totalWritten, rows.length); assert.equal(r.totalQueried, rows.length);
      assert.ok(rows.every((r) => r.Field === 'SSO_Status__c'));
      assert.deepEqual(rows.map((r) => r.Id).sort(), (await history()).map((r) => r.Id).sort());
      return checkStatusHistory(rows, (await snapshot()).parents);
    }),
    make('11 history query rejects malformed JSON', 'history query', ['--object', parentObject, '--filters', '{broken', '--output-dir', dir('bad-query')], () => true,
      { expectedExitCode: 1, expectedOutput: /invalid.*filter|JSON|parse/i }),
    make('12 history schema reports both tracked fixture fields and HTML', 'history schema', ['--output-dir', dir('schema')], async (e) => {
      const r = checkedResult(e); const rows = await csv(r.csvPath);
      assert.equal(r.trackedFieldCount, rows.length); assert.ok(r.trackedObjectCount >= 1);
      const fields = rows.filter((r) => r.OBJECT_API_NAME === parentObject).map((r) => r.FIELD_API_NAME).sort();
      assert.deepEqual(fields, ['SSO_Amount__c', 'SSO_Status__c']);
      const html = await readFile(outputPath(workspace, r.htmlPath), 'utf8');
      for (const text of [parentObject, 'SSO_Status__c', 'SSO_Amount__c']) assert.ok(html.includes(text));
      assert.match(html, /<html/i); return true;
    }),
    make('13 history schema rejects a file as output directory', 'history schema', ['--output-dir', dir('blocked/output')], () => true,
      { expectedExitCode: 1, expectedOutput: /ENOTDIR|EEXIST|not a directory/i,
        before: () => writeFile(dir('blocked'), 'not a directory\n') }),
  ];
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseSuiteArgs(argv); const workspace = workspaceFor('sobject');
  let plugin, ready = false;
  return runSuite({ suiteName: 'sobject', cwd: root, ...options, plugin: () => plugin,
    preflight: async () => { plugin = await linkedPlugin('sobject'); ready = true; await resetWorkspace(workspace); },
    setup: () => setupDataSobject(options.targetOrg), tests: buildSobjectTests(options),
    cleanup: async () => { try { if (ready) await cleanupDocuments(options.targetOrg); }
      finally { await rm(workspace, { recursive: true, force: true }); await rm(workspaceFor('data-sobject'), { recursive: true, force: true }); } },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
