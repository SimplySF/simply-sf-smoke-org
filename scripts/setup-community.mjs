// Copyright (c) 2026, SimplySF. Licensed under Apache-2.0; see LICENSE.txt.
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { run, sfJson } from './lib/smoke.mjs';

export const siteName = 'SSO Smoke Site';
export const templateName = 'Build Your Own (LWR)';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function setupCommunity(targetOrg, { json = sfJson, log = console.log,
  pause = sleep, now = Date.now, timeoutMs = 600_000, intervalMs = 15_000 } = {}) {
  log('Enabling Digital Experiences and ExperienceBundle metadata.');
  const deployed = await json(['project', 'deploy', 'start', '--source-dir',
    resolve(root, 'sfdx-source/community'), '--target-org', targetOrg,
    '--ignore-conflicts', '--wait', '10'], { cwd: root,
    runner: (file, args, opts) => run(file, args, { ...opts, timeoutMs: 11 * 60_000 }) });
  if (deployed.success !== true || deployed.status !== 'Succeeded') {
    throw new Error(`Community settings deploy failed: ${JSON.stringify(deployed)}`);
  }
  const deadline = now() + timeoutMs;
  // Bound individual CLI requests as well as the overall creation poll.
  const options = () => ({ runner: (file, args, opts) => run(file, args,
    { ...opts, timeoutMs: Math.max(1, deadline - now()) }) });
  const query = async () => {
    const result = await json(['data', 'query', '--target-org', targetOrg, '--query',
      `SELECT Id, Status FROM Network WHERE Name = '${siteName}'`], options());
    if (!Array.isArray(result.records)) throw new Error('Network query has no records array');
    if (result.records.length > 1) throw new Error(`Multiple networks named ${siteName}`);
    const network = result.records[0];
    if (network && !network.Id) throw new Error('Network query returned a record without Id');
    return network;
  };
  const existing = await query();
  if (existing) {
    log(`Reusing ${siteName}: ${existing.Id} (${existing.Status})`);
    return existing;
  }
  const result = await json(['community', 'list', 'template', '--target-org', targetOrg], options());
  const templates = Array.isArray(result) ? result : result.templates;
  if (!Array.isArray(templates) || !templates.some((t) => t.templateName === templateName)) {
    throw new Error(`Required community template unavailable: ${templateName}`);
  }
  log(`Creating ${siteName} with ${templateName}; allowing up to 10 minutes.`);
  await json(['community', 'create', '--target-org', targetOrg, '--name', siteName,
    '--template-name', templateName, '--url-path-prefix', 'ssosmoke'], options());
  while (now() < deadline) {
    const network = await query();
    if (network) {
      log(`Created ${siteName}: ${network.Id} (${network.Status})`);
      return network;
    }
    log(`Waiting for ${siteName} (${Math.ceil((deadline - now()) / 1000)}s remaining)`);
    await pause(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  throw new Error(`Timed out waiting for Network ${siteName}; inspect site creation before retrying setup`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: setup-community.mjs [alias]');
    await setupCommunity(process.argv[2] ?? 'simply-smoke-org');
  } catch (error) { console.error(`Community setup failed: ${error.message}`); process.exitCode = 1; }
}
