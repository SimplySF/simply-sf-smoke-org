// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { sfJson, soql, assignPermset, run, resultFrom, envelopeFrom } from './smoke.mjs';
import { root, deploySource, command } from './apex-flow.mjs';

export const parentObject = 'SSO_Data_Parent__c';
export const childObject = 'SSO_Data_Child__c';
export const workspaceFor = (suite) => resolve(root, 'generated', suite);
export const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
export async function writeCsv(path, columns, rows) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n');
}
// Dependency-free RFC 4180 reader: plugin reports can contain quoted errors and newlines.
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else cell += c;
  }
  assert.equal(quoted, false, 'Unterminated CSV quote');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift() ?? [];
  const records = rows.map((values) => {
    assert.equal(values.length, headers.length, 'CSV column count');
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
  return { headers, records };
}
export async function readCsv(path) { return parseCsv(await readFile(path, 'utf8')); }
export function outputPath(workspace, path) {
  const absolute = resolve(workspace, path);
  assert.ok(absolute.startsWith(resolve(workspace) + sep), `Output outside suite workspace: ${path}`);
  return absolute;
}
export async function resetWorkspace(workspace) {
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
}
export async function runApex(targetOrg, path, { json = sfJson } = {}) {
  const result = await json(['apex', 'run', '-o', targetOrg, '--file', path]);
  assert.equal(result.success, true, 'Apex fixture transaction failed');
}
export async function cleanupDocuments(targetOrg, { query = soql, json = sfJson } = {}) {
  const docs = await query(targetOrg, "SELECT Id, Title FROM ContentDocument WHERE Title LIKE 'SSO_Data_%'");
  const errors = [];
  for (const doc of docs.filter((d) => d.Title.startsWith('SSO_Data_'))) {
    try { await json(['data', 'delete', 'record', '-o', targetOrg, '--sobject', 'ContentDocument', '--record-id', doc.Id]); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'ContentDocument cleanup failed');
  const remaining = await query(targetOrg, "SELECT Id, Title FROM ContentDocument WHERE Title LIKE 'SSO_Data_%'");
  assert.equal(remaining.filter((d) => d.Title.startsWith('SSO_Data_')).length, 0, 'Smoke documents remain');
}
export async function setupDataSobject(targetOrg, { json = sfJson, query = soql, deploy = deploySource,
  assign = assignPermset, workspace = workspaceFor('data-sobject') } = {}) {
  await resetWorkspace(workspace);
  await deploy(targetOrg, resolve(root, 'sfdx-source/data-sobject'));
  await assign(targetOrg, 'SSO_Data_Fixtures', { json });
  await cleanupDocuments(targetOrg, { json, query });
  await runApex(targetOrg, resolve(root, 'scripts/seedDataSobject.apex'), { json });
  // Separate transactions preserve both tracked transitions after the insert commits.
  for (const status of ['Changed', 'Final']) {
    const path = resolve(workspace, `history-${status}.apex`);
    await writeFile(path, `List<SSO_Data_Parent__c> rows = [SELECT Id, SSO_Status__c FROM SSO_Data_Parent__c WHERE Name IN ('SSO Parent 0','SSO Parent 2')];\nSystem.assertEquals(2, rows.size());\nfor (SSO_Data_Parent__c r : rows) r.SSO_Status__c = '${status}';\nupdate rows;\n`);
    await runApex(targetOrg, path, { json });
  }
}
export async function fixtureSnapshot(targetOrg, query = soql) {
  const parents = await query(targetOrg, `SELECT Id, Name, SSO_Key__c, SSO_Status__c, SSO_Amount__c FROM ${parentObject} ORDER BY Id`);
  const children = await query(targetOrg, `SELECT Id, SSO_Parent__c FROM ${childObject} ORDER BY Id`);
  assert.deepEqual(parents.map((p) => p.SSO_Key__c).sort(), ['A', 'A', 'B', 'B', 'C', 'D']);
  assert.equal(children.length, 4);
  return { parents, children };
}
export function suiteCase(suite, targetOrg, workspace, runner = run) {
  return (name, verb, flags, check, { before, expectedExitCode = 0, expectedOutput } = {}) => {
    const cmd = command(suite, verb, targetOrg, flags);
    return { name, cmd, expectedExitCode, expectedOutput, check,
      execute: async () => {
        if (before) await before();
        return runner(...cmd, { cwd: workspace, timeoutMs: 15 * 60_000 });
      } };
  };
}
export function checkedResult(execution) {
  assert.equal(execution.exitCode, 0);
  assert.equal(envelopeFrom(execution.stdout).status, 0, 'Command JSON must report success');
  return resultFrom(execution.stdout);
}
