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
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, sfJson, soql } from './lib/smoke.mjs';
import { metadataTypes, isRunMetadata, isGeneratedApex, manifest } from './lib/metadata.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const targetOrg = args[0] && !args[0].startsWith('--') ? args.shift() : 'simply-smoke-org';
if (args.some((arg) => arg !== '--redeploy-deps')) throw new Error('Usage: setup-aep.sh [alias] [--redeploy-deps]');
const dependencies = JSON.parse(await readFile(resolve(root, 'config/dependencies.json'), 'utf8'));

async function git(args, cwd) {
  const result = await run('git', args, { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.output}`);
  return result.stdout.trim();
}
async function deploy(args, cwd = root) {
  const result = await sfJson(['project', 'deploy', 'start', ...args, '--target-org', targetOrg,
    '--ignore-conflicts', '--wait', '30'], { cwd });
  if (result.success !== true || result.status !== 'Succeeded') throw new Error(`Deploy failed: ${JSON.stringify(result)}`);
}

async function setupDependencies() {
  const org = await sfJson(['org', 'display', '--target-org', targetOrg]);
  if (!org.id || !/^[a-zA-Z0-9]{15,18}$/.test(org.id)) throw new Error('Cannot identify target org for dependency cache');
  await mkdir(resolve(root, '.deps'), { recursive: true });
  const cachePath = resolve(root, `.deps/deployed-${org.id}.json`);
  const signature = JSON.stringify(dependencies);
  let cached;
  try { cached = await readFile(cachePath, 'utf8'); } catch { /* First deployment. */ }
  // Query failures must abort, rather than treating expired auth as missing dependencies.
  const sentinels = await soql(targetOrg, `SELECT Name FROM ApexClass WHERE Name IN (${dependencies.map((d) => `'${d.sentinel}'`).join(',')})`);
  if (!args.includes('--redeploy-deps') && cached === signature && dependencies.every((d) => sentinels.some((c) => c.Name === d.sentinel))) {
    console.log('Pinned framework dependencies already deployed.');
    return;
  }
  // A failed redeploy must not leave an earlier successful signature reusable.
  await rm(cachePath, { force: true });
  for (const dependency of dependencies) {
    if (!/^[a-f0-9]{40}$/.test(dependency.ref)) throw new Error(`Unverified pin for ${dependency.name}; confirm config/dependencies.json`);
    const directory = resolve(root, '.deps', dependency.name);
    if (!existsSync(directory)) await git(['clone', '--filter=blob:none', dependency.repo, directory], root);
    await git(['fetch', 'origin', dependency.ref], directory);
    await git(['checkout', '--detach', dependency.ref], directory);
    if (await git(['rev-parse', 'HEAD'], directory) !== dependency.ref) throw new Error(`Wrong revision: ${dependency.name}`);
    console.log(`Deploying ${dependency.name} @ ${dependency.ref}`);
    await deploy(['--source-dir', dependency.sourceDir], directory);
  }
  // Only a fully successful deployment is cached; partial installs always retry.
  await writeFile(cachePath, signature);
}

async function reset() {
  const groups = { CustomMetadata: [], ApexClass: [], ApexTrigger: [] };
  for (const type of metadataTypes) {
    const records = await soql(targetOrg, `SELECT DeveloperName FROM ${type}__mdt`);
    groups.CustomMetadata.push(...records.filter((r) => isRunMetadata(r.DeveloperName)).map((r) => `${type}.${r.DeveloperName}`));
  }
  for (const type of ['ApexClass', 'ApexTrigger']) {
    const records = await soql(targetOrg, `SELECT Name FROM ${type} WHERE Name LIKE '%SSO%'`);
    groups[type] = records.filter((r) => isGeneratedApex(r.Name)).map((r) => r.Name);
  }
  if (Object.values(groups).some((members) => members.length)) {
    const directory = await mkdtemp(resolve(tmpdir(), 'sso-reset-'));
    try {
      await writeFile(resolve(directory, 'package.xml'), manifest({}));
      await writeFile(resolve(directory, 'destructiveChanges.xml'), manifest(groups));
      await deploy(['--manifest', resolve(directory, 'package.xml'), '--post-destructive-changes', resolve(directory, 'destructiveChanges.xml')]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  await rm(resolve(root, 'generated/aep'), { recursive: true, force: true });
}

try {
  await setupDependencies();
  await reset();
  await deploy(['--source-dir', 'sfdx-source/aep']);
  await sfJson(['apex', 'run', '--file', 'scripts/resetAepSmoke.apex', '--target-org', targetOrg], { cwd: root });
  console.log(`AEP fixtures ready in ${targetOrg}`);
} catch (error) {
  console.error(`AEP setup failed: ${error.message}`);
  process.exitCode = 1;
}
