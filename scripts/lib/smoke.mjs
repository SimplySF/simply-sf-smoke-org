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
import { spawn } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const sf = process.platform === 'win32' ? 'sf.cmd' : 'sf';

export function parseArgs(argv) {
  const options = { targetOrg: 'simply-smoke-org', skipSetup: false, only: undefined, extra: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--target-org', '-o', '--only'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--only') options.only = new RegExp(value);
      else options.targetOrg = value;
    } else if (arg === '--skip-setup') options.skipSetup = true;
    else if (arg === '--apx-parity') options.extra.apxParity = true;
    else if (arg === '--redeploy-deps') options.extra.redeployDeps = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function run(file, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((done) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true });
    let stdout = '', stderr = '', output = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; output += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; output += chunk; });
    child.on('error', (error) => done({ exitCode: null, stdout, stderr: stderr + error.message, output: output + error.message }));
    child.on('close', (exitCode) => done({ exitCode, stdout, stderr, output }));
  });
}

export function envelopeFrom(output) {
  const start = output.search(/^[\s]*[\[{]/m);
  if (start < 0) throw new Error('Command did not return JSON');
  try { return JSON.parse(output.slice(start)); }
  catch (error) { throw new Error(`Invalid command JSON: ${error.message}`); }
}

export function resultFrom(output) {
  const parsed = envelopeFrom(output);
  return parsed.result ?? parsed;
}

export async function sfJson(args, { runner = run, ...options } = {}) {
  const execution = await runner(sf, [...args, '--json'], options);
  if (execution.exitCode !== 0) throw new Error(`sf ${args.join(' ')} exited ${execution.exitCode}\n${execution.output}`);
  const envelope = envelopeFrom(execution.stdout ?? execution.output);
  if (envelope.status !== undefined && envelope.status !== 0) throw new Error(`sf returned status ${envelope.status}\n${execution.output}`);
  return envelope.result ?? envelope;
}

export async function soql(targetOrg, query, options = {}) {
  const result = await sfJson(['data', 'query', '--target-org', targetOrg, '--query', query], options);
  if (!Array.isArray(result.records)) throw new Error('SOQL result has no records array');
  return result.records;
}

export const success = (name, check, cmd) => ({ name, check, cmd, expectedExitCode: 0 });
export const expectedFailure = (name, expectedOutput, cmd, check = () => true) =>
  ({ name, expectedOutput, cmd, check, expectedExitCode: 1 });
export const skip = (name, reason) => ({ name, reason });
export function withForbiddenOutput(pattern, test) {
  return { ...test, check: async (execution) => !pattern.test(execution.output) && await test.check(execution) };
}

export async function assertLinkedPlugin(pluginName, expectedPath, { runner = run, canonicalize = realpath } = {}) {
  let expected;
  try { expected = await canonicalize(expectedPath); } catch {
    throw new Error(`Expected plugin checkout is missing: ${expectedPath}. Set SIMPLY_PLUGINS_DIR, build AEP, then run: sf plugins link \"${expectedPath}\" --no-install`);
  }
  const plugins = await sfJson(['plugins'], { runner });
  if (!Array.isArray(plugins)) throw new Error('Unexpected sf plugins JSON shape');
  // A nested dependency is not a user link. Require the exact package root, not a sibling prefix.
  const plugin = plugins.find((candidate) => candidate.name === pluginName && candidate.type === 'link');
  if (!plugin?.root || await canonicalize(plugin.root) !== expected) {
    throw new Error(`Expected linked ${pluginName} at ${expected}. Run: sf plugins link "${expected}" --no-install`);
  }
  const commands = await sfJson(['commands'], { runner });
  if (!Array.isArray(commands)) throw new Error('Unexpected sf commands JSON shape');
  const owned = commands.find((command) => command.id === 'simply:aep:at4dx:binding:list');
  const aepCommands = commands.filter((command) => command.id?.startsWith('simply:aep:'));
  if (!owned || aepCommands.some((command) => command.pluginName !== pluginName || command.pluginType !== 'link')) {
    throw new Error(`sf resolves simply aep to another plugin. Relink: sf plugins link "${expected}" --no-install`);
  }
  const sha = await runner('git', ['rev-parse', 'HEAD'], { cwd: expected });
  const branch = await runner('git', ['branch', '--show-current'], { cwd: expected });
  if (sha.exitCode !== 0 || branch.exitCode !== 0) throw new Error('Cannot determine linked plugin git revision');
  return { name: plugin.name, version: plugin.version, linkedPath: expected,
    gitSha: (sha.stdout ?? sha.output).trim(), branch: (branch.stdout ?? branch.output).trim() };
}

export async function runSuite({ suiteName, targetOrg, tests, setup, plugin, skipSetup = false,
  only, preflight, cwd = process.cwd(), runner = run, log = console.log, setExitCode = true }) {
  const results = [];
  async function execute(test) {
    const definition = { name: test.name, command: test.cmd ?? null, expectedExitCode: test.expectedExitCode };
    if (test.reason) return { ...definition, status: 'SKIP', reason: test.reason, exitCode: null, output: '' };
    let execution;
    try {
      execution = test.execute ? await test.execute() : await runner(test.cmd[0], test.cmd[1], { cwd });
      const outputMatches = !test.expectedOutput || test.expectedOutput.test(execution.output);
      const passed = execution.exitCode === test.expectedExitCode && outputMatches && await test.check(execution);
      return { ...definition, ...execution, status: passed ? 'PASS' : 'FAIL', expectedOutput: test.expectedOutput?.source };
    } catch (error) {
      return { ...definition, ...execution, status: 'FAIL', exitCode: execution?.exitCode ?? null,
        output: execution?.output ?? '', error: error.message };
    }
  }
  let ready = true;
  if (preflight) {
    try { await preflight(); } catch (error) {
      ready = false;
      results.push({ name: 'preflight', status: 'FAIL', command: null, exitCode: null, output: error.message });
      log(`FAIL preflight: ${error.message}`);
    }
  }
  if (ready && setup && !skipSetup) {
    try { await setup(); }
    catch (error) {
      ready = false;
      results.push({ name: 'setup', status: 'FAIL', command: null, exitCode: null, output: error.message });
      log(`FAIL setup: ${error.message}`);
    }
  }
  if (ready) {
    try {
      for await (const test of typeof tests === 'function' ? tests() : tests) {
        if (only && !only.test(test.name)) continue;
        const result = await execute(test);
        results.push(result);
        log(`${result.status} ${test.name}${result.error ? `: ${result.error}` : ''}`);
      }
    } catch (error) {
      results.push({ name: 'test discovery', status: 'FAIL', command: null, exitCode: null, output: error.message });
      log(`FAIL test discovery: ${error.message}`);
    }
  }
  if (results.length === 0) results.push({ name: 'test selection', status: 'FAIL', command: null,
    exitCode: null, output: 'No tests matched --only' });
  const counts = Object.fromEntries(['PASS', 'FAIL', 'SKIP'].map((status) => [status.toLowerCase(), results.filter((r) => r.status === status).length]));
  const report = { suiteName, targetOrg, plugin: (typeof plugin === 'function' ? plugin() : plugin) ?? null, counts, results };
  const reportsDir = resolve(cwd, 'reports');
  await mkdir(reportsDir, { recursive: true });
  const reportPath = resolve(reportsDir, `${suiteName}-${new Date().toISOString().replaceAll(':', '-')}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  log(`Report: ${reportPath}\n${counts.pass} PASS, ${counts.fail} FAIL, ${counts.skip} SKIP`);
  if (setExitCode) process.exitCode = counts.fail ? 1 : 0;
  return { ...report, reportPath };
}
