// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sf, sfJson, parseArgs, assertLinkedPlugin } from './smoke.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function parseSuiteArgs(argv) {
  const options = parseArgs(argv);
  if (Object.keys(options.extra).length) throw new Error('Unsupported suite flag');
  return options;
}
export const command = (suite, verb, targetOrg, flags = []) => [sf,
  ['simply', suite, ...verb.split(' '), ...(targetOrg ? ['--target-org', targetOrg] : []), ...flags, '--json']];
export const linkedPlugin = (suite) => assertLinkedPlugin(`@simplysf/simply-${suite}`,
  resolve(process.env.SIMPLY_PLUGINS_DIR ?? resolve(root, '../simply-plugins'), `packages/simply-${suite}`));
export async function queryOrg(targetOrg, query, { tooling = true, json = sfJson } = {}) {
  const result = await json(['data', 'query', '-o', targetOrg, '--query', query, ...(tooling ? ['--use-tooling-api'] : [])]);
  assert.ok(Array.isArray(result.records), 'Query must return records');
  return result.records;
}
export async function deploySource(targetOrg, path, { json = sfJson } = {}) {
  const result = await json(['project', 'deploy', 'start', '-o', targetOrg, '--source-dir', path, '--wait', '15']);
  assert.equal(result.success, true, 'Fixture deployment failed');
  return result;
}
