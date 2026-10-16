// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertLinkedPlugin, envelopeFrom, expectedFailure, parseArgs, run, runSuite, sf, sfJson, skip, success } from './lib/smoke.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = resolve(root, 'fixtures/settings/states.json');
const key = (state) => `${state.country}-${state.code}`;

export function parseSettingsArgs(argv) {
  const offline = argv.includes('--offline');
  const args = argv.filter((arg) => arg !== '--offline');
  if (args.some((arg) => ['--apx-parity', '--redeploy-deps'].includes(arg))) throw new Error('Unsupported settings argument');
  return { ...parseArgs(args), offline };
}

// Metadata API AddressSettings has no attributes on country/state entries.
// Keep the original Buffer separately: parsing never participates in the byte comparison.
export function addressCountries(bytes) {
  const xml = bytes.toString('utf8');
  assert.match(xml, /<AddressSettings[\s>]/);
  const value = (entry, tag) => entry.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
  const countries = new Map();
  for (const [, entry] of xml.matchAll(/<countries>([\s\S]*?)<\/countries>/g)) {
    const states = new Map([...entry.matchAll(/<states>([\s\S]*?)<\/states>/g)].map(([, state]) =>
      [value(state, 'isoCode'), { active: value(state, 'active') === 'true', visible: value(state, 'visible') === 'true' }]));
    countries.set(value(entry.replace(/<states>[\s\S]*?<\/states>/g, ''), 'isoCode'), states);
  }
  assert.ok(countries.size > 0, 'AddressSettings contains no countries');
  return countries;
}

export async function retrieveAddress(targetOrg, { json = sfJson } = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sso-address-'));
  try {
    await json(['project', 'retrieve', 'start', '--target-org', targetOrg,
      '--manifest', resolve(root, 'fixtures/settings/package.xml'), '--target-metadata-dir', directory,
      '--unzip', '--wait', '10'], { cwd: root });
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    const matches = entries.filter((entry) => entry.isFile() && entry.name === 'Address.settings');
    assert.equal(matches.length, 1, 'Expected exactly one retrieved Address.settings file');
    return await readFile(resolve(matches[0].parentPath, matches[0].name));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function checkCreation(result, definitions, countries) {
  const expected = Object.keys(definitions).map((code) => {
    const [country, state] = code.split('-');
    return [code, !countries.has(country) ? 'country-missing' : countries.get(country).has(state) ? 'exists' : 'would-create'];
  });
  assert.deepEqual(result.states.map((state) => [key(state), state.status]), expected);
  for (const [code, name] of Object.entries(definitions)) assert.equal(result.states.find((s) => key(s) === code)?.name, name);
  for (const status of ['created', 'would-create', 'exists', 'country-missing', 'rejected', 'failed']) {
    assert.equal(result.summary[status], expected.filter(([, token]) => token === status).length);
  }
  return true;
}

export function checkActivation(result, definitions, countries) {
  const expected = { activated: [], alreadyActive: [], notInOrg: [] };
  for (const code of Object.keys(definitions)) {
    const [country, stateCode] = code.split('-');
    const state = countries.get(country)?.get(stateCode);
    expected[!state ? 'notInOrg' : state.active && state.visible ? 'alreadyActive' : 'activated'].push(code);
  }
  for (const category of Object.keys(expected)) assert.deepEqual(result[category].map(key), expected[category]);
  assert.equal(result.deployId, undefined, 'Dry-run must not deploy');
  return true;
}

export async function buildSettingsTests({ targetOrg = 'simply-smoke-org', offline = false,
  before, retrieve = retrieveAddress, runner = run, definitions = undefined } = {}) {
  definitions ??= JSON.parse(await readFile(fixture, 'utf8'));
  const countries = addressCountries(before);
  const command = (verb, flags) => [sf, ['simply', 'settings', 'address', 'state', verb,
    '--target-org', targetOrg, '--dry-run', '--json', ...flags]];
  const result = (execution) => {
    const envelope = envelopeFrom(execution.stdout ?? execution.output);
    assert.equal(envelope.status, 0);
    return envelope.result;
  };
  const tests = [
    success('12 create plans fixture statuses', (execution) => {
      // These three roles are intentional: a fixture mutation must fail the case.
      assert.deepEqual(Object.keys(definitions), ['US-CA', 'US-ZZ', 'ZZ-ZZ']);
      assert.ok(countries.get('US')?.has('CA'), 'US-CA must exist');
      assert.ok(!countries.get('US').has('ZZ'), 'US-ZZ must be absent');
      assert.ok(!countries.has('ZZ'), 'ZZ must be absent');
      return checkCreation(result(execution), definitions, countries);
    }, command('create', ['--file', fixture])),
    success('13 create filters country', (execution) => checkCreation(result(execution),
      Object.fromEntries(Object.entries(definitions).filter(([code]) => code.startsWith('US-'))), countries),
    command('create', ['--file', fixture, '--country', 'US'])),
    offline ? skip('14 create pinned Debian subdivisions', 'Offline: Debian ISO source needs network') :
      success('14 create pinned Debian subdivisions', (execution) => {
        const plan = result(execution);
        assert.deepEqual(plan.source, { kind: 'iso-codes', provider: 'debian', version: 'v4.20.1', allLevels: false });
        assert.ok(plan.states.length > 0);
        assert.ok(plan.states.every((s) => s.country === 'FR'));
        assert.equal(new Set(plan.states.map(key)).size, plan.states.length);
        return checkCreation(plan, Object.fromEntries(plan.states.map((s) => [key(s), s.name])), countries);
      }, command('create', ['--iso-codes', 'debian', '--iso-codes-version', 'v4.20.1', '--country', 'FR'])),
    success('15 activate plans fixture statuses', (execution) => checkActivation(result(execution), definitions, countries),
      command('activate', ['--file', fixture])),
  ];
  for (const verb of ['create', 'activate']) {
    tests.push(expectedFailure(`16 ${verb} rejects conflicting sources`, /--(?:file|iso-codes) cannot also be provided when using --(?:file|iso-codes)/i,
      command(verb, ['--file', fixture, '--iso-codes', 'debian'])));
    tests.push(expectedFailure(`16 ${verb} rejects missing source`, /Exactly one of the following must be provided:.*--file.*--iso-codes/i,
      command(verb, [])));
    tests.push(expectedFailure(`17 ${verb} rejects malformed JSON`, /(?:read|parse).*file|JSON/i,
      command(verb, ['--file', resolve(root, 'fixtures/settings/malformed.json')])));
  }
  tests.push({ name: '18 AddressSettings bytes unchanged', expectedExitCode: 0,
    execute: async () => {
      const after = await retrieve(targetOrg);
      assert.ok(before.equals(after), 'AddressSettings changed: byte comparison ignores nothing');
      return { exitCode: 0, output: 'AddressSettings byte-identical' };
    }, check: () => true });
  for (const test of tests.filter((t) => t.cmd)) test.execute = () => runner(...test.cmd, { cwd: root, timeoutMs: 40 * 60_000 });
  return tests;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseSettingsArgs(argv);
  let plugin, before;
  return runSuite({ suiteName: 'settings', cwd: root, ...options, plugin: () => plugin,
    preflight: async () => {
      plugin = await assertLinkedPlugin('@simplysf/simply-settings',
        resolve(process.env.SIMPLY_PLUGINS_DIR ?? resolve(root, '../simply-plugins'), 'packages/simply-settings'));
      before = await retrieveAddress(options.targetOrg);
    },
    tests: async function* () { yield* await buildSettingsTests({ ...options, before }); },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
